//! Downloading one track to disk for offline playback.
//!
//! The file is streamed straight to a temporary path, written range by range at its own offset,
//! so a long track never has to fit in memory. Every network wait has a deadline: a connection
//! that goes quiet (a laptop that slept mid-download, a Wi-Fi drop) fails after `stall` instead
//! of hanging the whole download queue behind it. Failures come back as a small set of kinds
//! the frontend queue can act on without parsing messages.

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;

/// What went wrong, in terms the download queue decides on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ErrorKind {
    /// Stopped on request. Not a failure.
    Cancelled,
    /// No connection, a stall, or a server hiccup. Worth retrying once the network is back.
    Network,
    /// The signed URL was refused (403/410). A fresh URL usually works.
    Expired,
    /// Any other refusal from the server.
    Http,
    /// The download folder could not be written: missing, full, or read-only.
    Storage,
    /// The response was not the audio file it claimed to be.
    Invalid,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DownloadError {
    pub kind: ErrorKind,
    pub message: String,
}

impl DownloadError {
    pub(crate) fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }
}

impl std::fmt::Display for DownloadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

/// Deadlines and retry policy. Production uses `Timing::default()`; tests shrink them.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Timing {
    /// Longest wait for response headers or for the next piece of a body.
    pub stall: Duration,
    /// Delay before retrying a failed range; multiplied by the attempt number.
    pub backoff: Duration,
    /// Attempts per range (and for the whole-file fallback) before giving up.
    pub attempts: u32,
    /// Ranges in flight at once.
    pub concurrency: usize,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            stall: Duration::from_secs(30),
            backoff: Duration::from_millis(750),
            attempts: 3,
            concurrency: 6,
        }
    }
}

/// Where the bytes come from.
pub(crate) struct Source<'a> {
    pub client: &'a reqwest::Client,
    /// The signed URL, without any `range=` parameter.
    pub url: &'a str,
    /// Total size from the URL's `clen`, or 0 when unknown.
    pub total: u64,
    /// Adds the headers the server expects to every request.
    pub dress: &'a (dyn Fn(reqwest::RequestBuilder) -> reqwest::RequestBuilder + Sync),
    /// Range size for a given total.
    pub chunk_size: fn(u64) -> u64,
}

/* ── Active downloads, so a download can be cancelled from another command ─────────────── */

fn active() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static ACTIVE: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    ACTIVE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Registration of one running download. Dropping it unregisters.
pub(crate) struct ActiveDownload {
    id: String,
    pub cancelled: Arc<AtomicBool>,
}

impl Drop for ActiveDownload {
    fn drop(&mut self) {
        if let Ok(mut map) = active().lock() {
            // Only remove our own flag: a later download of the same id may have replaced it.
            if map.get(&self.id).is_some_and(|flag| Arc::ptr_eq(flag, &self.cancelled)) {
                map.remove(&self.id);
            }
        }
    }
}

/// Registers a download, or `None` when one for the same id is already running.
pub(crate) fn register(id: &str) -> Option<ActiveDownload> {
    let mut map = active().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if map.contains_key(id) {
        return None;
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    map.insert(id.to_string(), Arc::clone(&cancelled));
    Some(ActiveDownload { id: id.to_string(), cancelled })
}

/// Asks a running download to stop. Returns whether one was running.
/// Cancels every download in progress.
pub(crate) fn cancel_all() {
    let map = active().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    for flag in map.values() {
        flag.store(true, Ordering::SeqCst);
    }
}

pub(crate) fn any_active() -> bool {
    !active().lock().unwrap_or_else(|poisoned| poisoned.into_inner()).is_empty()
}

pub(crate) fn cancel(id: &str) -> bool {
    let map = active().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    match map.get(id) {
        Some(flag) => {
            flag.store(true, Ordering::SeqCst);
            true
        }
        None => false,
    }
}

pub(crate) fn is_active(id: &str) -> bool {
    active()
        .lock()
        .map(|map| map.contains_key(id))
        .unwrap_or(false)
}

/* ── The download itself ─────────────────────────────────────────────────────────────────── */

/// Downloads `source` into `dest`, which is created or truncated. Returns the byte count.
///
/// On failure `dest` may hold a partial file; the caller removes it.
pub(crate) async fn download(
    source: &Source<'_>,
    dest: &Path,
    cancelled: &AtomicBool,
    timing: Timing,
    on_progress: &(dyn Fn(u64, u64) + Sync),
) -> Result<u64, DownloadError> {
    if source.total == 0 {
        return download_whole(source, dest, cancelled, timing, on_progress).await;
    }

    match download_ranges(source, dest, cancelled, timing, on_progress).await {
        Err(RangeFailure::Ignored) => {
            eprintln!("[internal][tauri][warn] offline download: server ignored ranges, using one request");
            download_whole(source, dest, cancelled, timing, on_progress).await
        }
        Err(RangeFailure::Error(error)) => Err(error),
        Ok(bytes) => Ok(bytes),
    }
}

enum RangeFailure {
    /// The server sent more than the range asked for, so ranges cannot be trusted here.
    Ignored,
    Error(DownloadError),
}

impl From<DownloadError> for RangeFailure {
    fn from(error: DownloadError) -> Self {
        RangeFailure::Error(error)
    }
}

async fn download_ranges(
    source: &Source<'_>,
    dest: &Path,
    cancelled: &AtomicBool,
    timing: Timing,
    on_progress: &(dyn Fn(u64, u64) + Sync),
) -> Result<u64, RangeFailure> {
    let total = source.total;
    let file = create_file(dest)?;
    file.set_len(total).map_err(storage_error)?;

    let chunk = (source.chunk_size)(total).max(1);
    let mut ranges = Vec::new();
    let mut start = 0u64;
    while start < total {
        let end = (start + chunk - 1).min(total - 1);
        ranges.push((start, end));
        start = end + 1;
    }

    let received = AtomicU64::new(0);
    let mut results = futures_util::stream::iter(ranges.into_iter().map(|(start, end)| {
        fetch_range(source, &file, start, end, cancelled, timing, &received, on_progress)
    }))
    .buffer_unordered(timing.concurrency.max(1));

    while let Some(result) = results.next().await {
        // The first failure ends the download; dropping the stream stops the other ranges.
        result?;
    }
    drop(results);

    file.sync_all().map_err(storage_error)?;
    let written = file.metadata().map_err(storage_error)?.len();
    if written != total {
        return Err(RangeFailure::Error(DownloadError::new(
            ErrorKind::Invalid,
            format!("file is {written} bytes, expected {total}"),
        )));
    }
    Ok(total)
}

/// One range, retried from where it stopped when the connection drops.
#[allow(clippy::too_many_arguments)]
async fn fetch_range(
    source: &Source<'_>,
    file: &File,
    start: u64,
    end: u64,
    cancelled: &AtomicBool,
    timing: Timing,
    received: &AtomicU64,
    on_progress: &(dyn Fn(u64, u64) + Sync),
) -> Result<(), RangeFailure> {
    let expected = end - start + 1;
    let mut written = 0u64;
    let mut attempt = 0u32;

    loop {
        attempt += 1;
        check_cancelled(cancelled)?;
        let url = crate::audio_url_with_range(source.url, start + written, end);
        match stream_range(source, &url, file, start + written, expected - written, cancelled, timing)
            .await
        {
            Ok(step) => {
                written += step.written;
                received.fetch_add(step.written, Ordering::SeqCst);
                on_progress(received.load(Ordering::SeqCst), source.total);
                if step.overflowed {
                    return Err(RangeFailure::Ignored);
                }
                if written >= expected {
                    return Ok(());
                }
                // The response ended short. Resume from where it stopped; a server that keeps
                // doing it is sending the wrong thing rather than dropping the connection.
                if attempt >= timing.attempts {
                    return Err(RangeFailure::Error(DownloadError::new(
                        ErrorKind::Invalid,
                        format!("the server kept sending short responses ({written} of {expected} bytes)"),
                    )));
                }
            }
            Err(Partial { error, written: partial }) => {
                written += partial;
                received.fetch_add(partial, Ordering::SeqCst);
                if !is_retryable(&error) || attempt >= timing.attempts {
                    return Err(RangeFailure::Error(error));
                }
            }
        }
        unless_cancelled(cancelled, tokio::time::sleep(timing.backoff * attempt)).await?;
    }
}

struct Step {
    written: u64,
    /// The server sent more than was asked for.
    overflowed: bool,
}

struct Partial {
    error: DownloadError,
    written: u64,
}

/// One request for `url`, writing its body at `offset`. Never writes more than `limit` bytes.
async fn stream_range(
    source: &Source<'_>,
    url: &str,
    file: &File,
    offset: u64,
    limit: u64,
    cancelled: &AtomicBool,
    timing: Timing,
) -> Result<Step, Partial> {
    let fail = |error: DownloadError| Partial { error, written: 0 };
    let response = send(source, url, cancelled, timing).await.map_err(fail)?;
    let mut body = response.bytes_stream();
    let mut written = 0u64;

    loop {
        let next = match unless_cancelled(cancelled, tokio::time::timeout(timing.stall, body.next())).await {
            Ok(Ok(next)) => next,
            Ok(Err(_)) => {
                return Err(Partial {
                    error: DownloadError::new(ErrorKind::Network, "the connection stalled"),
                    written,
                })
            }
            Err(error) => return Err(Partial { error, written }),
        };
        let piece = match next {
            None => return Ok(Step { written, overflowed: false }),
            Some(Err(error)) => {
                return Err(Partial {
                    error: DownloadError::new(ErrorKind::Network, format!("download interrupted: {error}")),
                    written,
                })
            }
            Some(Ok(piece)) => piece,
        };
        let room = limit - written;
        let take = (piece.len() as u64).min(room) as usize;
        if take > 0 {
            write_at(file, &piece[..take], offset + written)
                .map_err(|error| Partial { error: storage_error(error), written })?;
            written += take as u64;
        }
        if (piece.len() as u64) > room {
            return Ok(Step { written, overflowed: true });
        }
    }
}

/// The whole file in one request, for servers that ignore ranges or files of unknown size.
async fn download_whole(
    source: &Source<'_>,
    dest: &Path,
    cancelled: &AtomicBool,
    timing: Timing,
    on_progress: &(dyn Fn(u64, u64) + Sync),
) -> Result<u64, DownloadError> {
    let mut attempt = 0u32;
    loop {
        attempt += 1;
        check_cancelled(cancelled)?;
        let result = download_whole_once(source, dest, cancelled, timing, on_progress).await;
        match result {
            Ok(bytes) => return Ok(bytes),
            Err(error) if is_retryable(&error) && attempt < timing.attempts => {
                unless_cancelled(cancelled, tokio::time::sleep(timing.backoff * attempt)).await?;
            }
            Err(error) => return Err(error),
        }
    }
}

async fn download_whole_once(
    source: &Source<'_>,
    dest: &Path,
    cancelled: &AtomicBool,
    timing: Timing,
    on_progress: &(dyn Fn(u64, u64) + Sync),
) -> Result<u64, DownloadError> {
    // Bounded the way the web player asks: `range=0-{clen-1}` in the query, never a Range header.
    let url = if source.total > 0 {
        crate::audio_url_with_range(source.url, 0, source.total - 1)
    } else {
        source.url.to_string()
    };
    let file = create_file(dest)?;
    let response = send(source, &url, cancelled, timing).await?;
    let mut body = response.bytes_stream();
    let mut written = 0u64;

    loop {
        let next = unless_cancelled(cancelled, tokio::time::timeout(timing.stall, body.next()))
            .await?
            .map_err(|_| DownloadError::new(ErrorKind::Network, "the connection stalled"))?;
        match next {
            None => break,
            Some(Err(error)) => {
                return Err(DownloadError::new(ErrorKind::Network, format!("download interrupted: {error}")))
            }
            Some(Ok(piece)) => {
                if source.total > 0 && written + piece.len() as u64 > source.total {
                    return Err(DownloadError::new(
                        ErrorKind::Invalid,
                        "the server sent more data than the file size",
                    ));
                }
                write_at(&file, &piece, written).map_err(storage_error)?;
                written += piece.len() as u64;
                on_progress(written, if source.total > 0 { source.total } else { written });
            }
        }
    }

    // The response ended cleanly, so a size mismatch is the server sending the wrong thing
    // (an error page, a truncated file), not a dropped connection.
    if source.total > 0 && written != source.total {
        return Err(DownloadError::new(
            ErrorKind::Invalid,
            format!("the server sent {written} bytes, expected {}", source.total),
        ));
    }
    if written == 0 {
        return Err(DownloadError::new(ErrorKind::Invalid, "the server sent an empty file"));
    }
    file.sync_all().map_err(storage_error)?;
    Ok(written)
}

/// Sends a request and turns the status into an error kind. Waits at most `stall` for headers.
async fn send(
    source: &Source<'_>,
    url: &str,
    cancelled: &AtomicBool,
    timing: Timing,
) -> Result<reqwest::Response, DownloadError> {
    let request = (source.dress)(source.client.get(url));
    let response = unless_cancelled(cancelled, tokio::time::timeout(timing.stall, request.send()))
        .await?
        .map_err(|_| DownloadError::new(ErrorKind::Network, "the server did not answer"))?
        .map_err(|error| DownloadError::new(ErrorKind::Network, format!("request failed: {error}")))?;

    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let kind = match status.as_u16() {
        403 | 410 => ErrorKind::Expired,
        408 | 425 | 429 | 500..=599 => ErrorKind::Network,
        _ => ErrorKind::Http,
    };
    Err(DownloadError::new(kind, format!("server answered {status}")))
}

fn is_retryable(error: &DownloadError) -> bool {
    error.kind == ErrorKind::Network
}

/// How often a wait looks at the cancel flag. Without it a cancel waited for the next piece of
/// data, which on a stalled connection meant the whole stall timeout.
const CANCEL_POLL: Duration = Duration::from_millis(250);

/// Awaits `future`, giving up with a cancellation error as soon as the download is cancelled.
async fn unless_cancelled<F: std::future::Future>(
    cancelled: &AtomicBool,
    future: F,
) -> Result<F::Output, DownloadError> {
    futures_util::pin_mut!(future);
    loop {
        check_cancelled(cancelled)?;
        if let Ok(output) = tokio::time::timeout(CANCEL_POLL, &mut future).await {
            return Ok(output);
        }
    }
}

fn check_cancelled(cancelled: &AtomicBool) -> Result<(), DownloadError> {
    if cancelled.load(Ordering::SeqCst) {
        Err(cancelled_error())
    } else {
        Ok(())
    }
}

fn cancelled_error() -> DownloadError {
    DownloadError::new(ErrorKind::Cancelled, "the download was cancelled")
}

fn storage_error(error: std::io::Error) -> DownloadError {
    DownloadError::new(ErrorKind::Storage, format!("could not write the file: {error}"))
}

fn create_file(path: &Path) -> Result<File, DownloadError> {
    OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
        .map_err(storage_error)
}

#[cfg(unix)]
fn write_at(file: &File, bytes: &[u8], offset: u64) -> std::io::Result<()> {
    use std::os::unix::fs::FileExt;
    file.write_all_at(bytes, offset)
}

#[cfg(windows)]
fn write_at(file: &File, mut bytes: &[u8], mut offset: u64) -> std::io::Result<()> {
    use std::os::windows::fs::FileExt;
    while !bytes.is_empty() {
        let written = file.seek_write(bytes, offset)?;
        if written == 0 {
            return Err(std::io::Error::new(std::io::ErrorKind::WriteZero, "write returned zero"));
        }
        bytes = &bytes[written..];
        offset += written as u64;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::atomic::AtomicUsize;

    /// How the fake server misbehaves.
    #[derive(Clone, Copy, PartialEq)]
    enum Mode {
        Normal,
        /// Answers every request with the whole file, ignoring `range=`.
        IgnoreRange,
        /// The first `n` requests get a 503.
        FailFirst(usize),
        /// Every request gets this status.
        Status(u16),
        /// The first request sends half its body, then goes silent.
        StallFirst,
        /// The first request sends half its body, then closes the connection.
        CloseEarlyFirst,
        /// Serves an HTML page instead of audio (whole-file requests only).
        Html,
    }

    struct Server {
        url: String,
        requests: Arc<AtomicUsize>,
    }

    fn body(len: usize) -> Vec<u8> {
        (0..len).map(|index| (index * 31 % 251) as u8).collect()
    }

    fn serve(len: usize, mode: Mode) -> Server {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/audio?clen={len}", listener.local_addr().unwrap());
        let requests = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&requests);
        let data = Arc::new(body(len));
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                let number = counter.fetch_add(1, Ordering::SeqCst);
                let data = Arc::clone(&data);
                std::thread::spawn(move || respond(stream, &data, mode, number));
            }
        });
        Server { url, requests }
    }

    fn respond(mut stream: TcpStream, data: &[u8], mode: Mode, number: usize) {
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut request_line = String::new();
        if reader.read_line(&mut request_line).is_err() {
            return;
        }
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).is_err() || line == "\r\n" || line.is_empty() {
                break;
            }
        }
        let path = request_line.split_whitespace().nth(1).unwrap_or("/");
        let range = path.split("range=").nth(1).and_then(|value| {
            let (start, end) = value.split('&').next()?.split_once('-')?;
            Some((start.parse::<usize>().ok()?, end.parse::<usize>().ok()?))
        });

        let status = match mode {
            Mode::Status(code) => Some(code),
            Mode::FailFirst(count) if number < count => Some(503),
            _ => None,
        };
        if let Some(code) = status {
            let _ = write!(stream, "HTTP/1.1 {code} Nope\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            return;
        }

        let payload: Vec<u8> = match (mode, range) {
            (Mode::Html, _) => b"<!doctype html><html>blocked</html>".to_vec(),
            (Mode::IgnoreRange, _) | (_, None) => data.to_vec(),
            (_, Some((start, end))) => data[start..=end.min(data.len() - 1)].to_vec(),
        };
        let _ = write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            payload.len()
        );
        match mode {
            Mode::StallFirst if number == 0 => {
                let _ = stream.write_all(&payload[..payload.len() / 2]);
                let _ = stream.flush();
                std::thread::sleep(Duration::from_secs(3));
            }
            Mode::CloseEarlyFirst if number == 0 => {
                let _ = stream.write_all(&payload[..payload.len() / 2]);
            }
            _ => {
                let _ = stream.write_all(&payload);
            }
        }
    }

    fn timing() -> Timing {
        Timing {
            stall: Duration::from_millis(400),
            backoff: Duration::from_millis(10),
            attempts: 3,
            concurrency: 4,
        }
    }

    fn small_chunks(total: u64) -> u64 {
        (total / 5).max(1)
    }

    fn plain(request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        request
    }

    fn run(
        server: &Server,
        total: u64,
        cancelled: &AtomicBool,
    ) -> (Result<u64, DownloadError>, Vec<u8>) {
        let dir = std::env::temp_dir().join(format!(
            "ytm-offline-download-{}-{}",
            std::process::id(),
            server.url.rsplit(':').next().unwrap().replace(['/', '?', '='], "_")
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("track.part");
        let client = reqwest::Client::new();
        let source = Source {
            client: &client,
            url: &server.url,
            total,
            dress: &plain,
            chunk_size: small_chunks,
        };
        let progress = |_: u64, _: u64| {};
        let result = tauri::async_runtime::block_on(download(&source, &dest, cancelled, timing(), &progress));
        let bytes = std::fs::read(&dest).unwrap_or_default();
        let _ = std::fs::remove_dir_all(&dir);
        (result, bytes)
    }

    const LEN: usize = 100_000;

    #[test]
    fn downloads_in_ranges_and_reassembles_in_order() {
        let server = serve(LEN, Mode::Normal);
        let (result, bytes) = run(&server, LEN as u64, &AtomicBool::new(false));
        assert_eq!(result.unwrap(), LEN as u64);
        assert_eq!(bytes, body(LEN));
        assert!(server.requests.load(Ordering::SeqCst) >= 5, "should use several ranges");
    }

    #[test]
    fn falls_back_to_one_request_when_ranges_are_ignored() {
        let server = serve(LEN, Mode::IgnoreRange);
        let (result, bytes) = run(&server, LEN as u64, &AtomicBool::new(false));
        assert_eq!(result.unwrap(), LEN as u64);
        assert_eq!(bytes, body(LEN));
    }

    #[test]
    fn retries_server_errors() {
        let server = serve(LEN, Mode::FailFirst(2));
        let (result, bytes) = run(&server, LEN as u64, &AtomicBool::new(false));
        assert_eq!(result.unwrap(), LEN as u64);
        assert_eq!(bytes, body(LEN));
    }

    #[test]
    fn a_stalled_connection_times_out_and_resumes() {
        let server = serve(LEN, Mode::StallFirst);
        let (result, bytes) = run(&server, LEN as u64, &AtomicBool::new(false));
        assert_eq!(result.unwrap(), LEN as u64);
        assert_eq!(bytes, body(LEN));
    }

    #[test]
    fn a_connection_closed_early_resumes_where_it_stopped() {
        let server = serve(LEN, Mode::CloseEarlyFirst);
        let (result, bytes) = run(&server, LEN as u64, &AtomicBool::new(false));
        assert_eq!(result.unwrap(), LEN as u64);
        assert_eq!(bytes, body(LEN));
    }

    #[test]
    fn a_refused_url_is_reported_as_expired_without_retrying() {
        let server = serve(LEN, Mode::Status(403));
        let (result, _) = run(&server, LEN as u64, &AtomicBool::new(false));
        assert_eq!(result.unwrap_err().kind, ErrorKind::Expired);
        // Without retries there is at most one request per range (five here); retrying would
        // have made up to fifteen.
        assert!(server.requests.load(Ordering::SeqCst) <= 5, "a refused URL must not be retried");
    }

    #[test]
    fn a_missing_file_is_an_http_error() {
        let server = serve(LEN, Mode::Status(404));
        let (result, _) = run(&server, LEN as u64, &AtomicBool::new(false));
        assert_eq!(result.unwrap_err().kind, ErrorKind::Http);
    }

    #[test]
    fn an_unreachable_server_is_a_network_error() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/audio?clen=10", listener.local_addr().unwrap());
        drop(listener);
        let server = Server { url, requests: Arc::new(AtomicUsize::new(0)) };
        let (result, _) = run(&server, 10, &AtomicBool::new(false));
        assert_eq!(result.unwrap_err().kind, ErrorKind::Network);
    }

    #[test]
    fn a_cancelled_download_stops() {
        let server = serve(LEN, Mode::Normal);
        let (result, _) = run(&server, LEN as u64, &AtomicBool::new(true));
        assert_eq!(result.unwrap_err().kind, ErrorKind::Cancelled);
    }

    #[test]
    fn a_cancel_is_felt_during_a_stall() {
        // The first range goes silent for 3 s and the stall timeout is 10 s away; the cancel
        // after 300 ms must not wait for either.
        let server = serve(LEN, Mode::StallFirst);
        let cancelled = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&cancelled);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            flag.store(true, Ordering::SeqCst);
        });
        let client = reqwest::Client::new();
        let source = Source {
            client: &client,
            url: &server.url,
            total: LEN as u64,
            dress: &plain,
            chunk_size: small_chunks,
        };
        let dest = std::env::temp_dir().join(format!("ytm-offline-cancel-{}.part", std::process::id()));
        let slow = Timing { stall: Duration::from_secs(10), ..timing() };
        let started = std::time::Instant::now();
        let result = tauri::async_runtime::block_on(download(&source, &dest, &cancelled, slow, &|_, _| {}));
        let _ = std::fs::remove_file(&dest);
        assert_eq!(result.unwrap_err().kind, ErrorKind::Cancelled);
        assert!(started.elapsed() < Duration::from_secs(2), "took {:?}", started.elapsed());
    }

    #[test]
    fn an_unknown_size_downloads_whole() {
        let server = serve(LEN, Mode::Normal);
        let (result, bytes) = run(&server, 0, &AtomicBool::new(false));
        assert_eq!(result.unwrap(), LEN as u64);
        assert_eq!(bytes, body(LEN));
    }

    #[test]
    fn a_body_of_the_wrong_size_is_rejected() {
        // The HTML page is shorter than `clen`, so the length check catches it.
        let server = serve(LEN, Mode::Html);
        let (result, _) = run(&server, 0, &AtomicBool::new(false));
        assert!(result.is_ok(), "size unknown: the caller's audio check has to catch this one");
        let (result, _) = run(&serve(LEN, Mode::Html), LEN as u64, &AtomicBool::new(false));
        assert!(result.is_err(), "a body shorter than the declared size must fail");
    }

    #[test]
    fn registration_is_exclusive_and_cancel_reaches_it() {
        let first = register("abc").unwrap();
        assert!(register("abc").is_none());
        assert!(is_active("abc"));
        assert!(cancel("abc"));
        assert!(first.cancelled.load(Ordering::SeqCst));
        drop(first);
        assert!(!is_active("abc"));
        assert!(!cancel("abc"));
        assert!(register("abc").is_some());
    }
}
