import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Lyrics, Track } from "../datasource/types";
import { tauriFetch } from "../datasource/youtube/tauriFetch";
import { toBase64 } from "../internal/base64";
import { logInternalInfo, logInternalWarn } from "../internal/logging";
import { getAppSetting, removeAppSetting } from "../internal/appSettings";
import { getDownloadQuality, type AudioQuality } from "../internal/audioQuality";
import { errorKind, errorMessage, type ErrorKind } from "../internal/errors";
import { isOnline, reportNetworkFailure, subscribeConnectivity, whenOnline } from "../internal/connectivity";
import { readDocument, saveDocument, saveDocumentNow } from "../internal/documentStore";

/*
 * The offline store: which songs are downloaded, and the queue of songs still to download.
 *
 * Both are kept in their own documents on disk (see documentStore.ts), so the queue survives the
 * app quitting, the webview reloading after the machine wakes, and anything else short of the
 * user deleting it. The backend does the transfers (offline_download.rs); this module decides
 * what to download next and what to do when a download fails.
 */

const MANIFEST_DOCUMENT = "offline-manifest";
const QUEUE_DOCUMENT = "offline-queue";
/** Where the manifest lived before it had its own file. Read once, to migrate. */
const LEGACY_MANIFEST_KEY = "ytm-offline.offline-manifest.v1";
/** Songs a "start fresh" folder change still had to download, before the queue was durable. */
const LEGACY_REDOWNLOAD_KEY = "ytm-offline.offline-redownload.v1";
const MAX_BYTES_KEY = "ytm-offline.offline-max-bytes.v1";
export const OFFLINE_ARTWORK_PREFIX = "ytm-offline-artwork:";

/** No limit unless the user sets one. */
export const DEFAULT_OFFLINE_MAX_BYTES = Number.POSITIVE_INFINITY;

/** Attempts before a song is marked as failed. */
export const MAX_ATTEMPTS = 3;
/** Wait before the next attempt, multiplied by the attempt number. */
const RETRY_DELAY_MS = 30_000;
/** Wait after a network failure, multiplied by how many there have been in a row. */
const NETWORK_RETRY_DELAY_MS = 5_000;
/**
 * Network failures in a row that count as one attempt. The connectivity check usually pauses
 * the queue long before this; it only matters when the network looks fine but one server keeps
 * failing, which must not retry forever.
 */
const NETWORK_FAILURES_PER_ATTEMPT = 4;
/** Fresh URLs to try after a refused one before that counts as an attempt. */
const EXPIRED_RETRIES = 2;
/** A failed song is tried again by a sync this long after it failed (unless it is unplayable). */
const FAILED_RETRY_AFTER_MS = 30 * 60_000;
/** While downloads are paused for storage, how often to check whether the folder is back. */
const STORAGE_RECHECK_MS = 60_000;
const LYRICS_TIMEOUT_MS = 20_000;
/** How long before a song still without synced lyrics is looked up again. */
const LYRICS_RECHECK_MS = 30 * 24 * 60 * 60_000;
/** Pause between background lyrics lookups. */
const LYRICS_LOOKUP_GAP_MS = 1_500;
const MAX_ARTWORK_BYTES = 12 * 1024 * 1024;

export type OfflineStatus = "absent" | "queued" | "downloading" | "ready" | "failed";
export type PauseReason =
  /** No internet connection. Resumes by itself. */
  | "offline"
  /** The download folder could not be written. Checked again every minute. */
  | "storage"
  /** The storage limit in Settings is reached. */
  | "limit"
  /** The download folder is being changed. */
  | "moving";

export interface OfflineEntry {
  track: Track;
  byteLength: number;
  downloadedAt: number;
  /** Older manifests have neither field and are treated as individually saved. */
  savedIndividually?: boolean;
  playlistIds?: string[];
  lyrics?: Lyrics;
  /** The artwork's web address, kept so the local copy can be fetched again. */
  remoteArtworkUrl?: string;
  /** Artwork and lyrics are still to be fetched. */
  metadataPending?: boolean;
  /** When lyrics were last looked up. Songs without synced lyrics are looked up again later. */
  lyricsCheckedAt?: number;
}

/** Who wants a song downloaded. It stays while anyone does. */
export interface DownloadOwners {
  /** Saved on its own, from a download button. */
  manual: boolean;
  /** Synced playlists that contain it. */
  playlists: string[];
}

export interface DownloadJob {
  track: Track;
  owners: DownloadOwners;
  attempts: number;
  networkFailures: number;
  expiredRetries: number;
  /** Not to be tried before this time (ms). */
  notBefore: number;
  failed: boolean;
  failureKind: ErrorKind | null;
  failedAt: number | null;
  lastError: string | null;
  /**
   * A failed song the user chose to stop trying. Kept so a sync does not queue it again; asking
   * for it from a download button tries it again.
   */
  dismissed?: boolean;
  /** Kept from an earlier copy of the song, when it is downloaded again. */
  keep?: { lyrics?: Lyrics; remoteArtworkUrl?: string };
}

export interface DownloadFailure {
  track: Track;
  message: string;
  kind: ErrorKind | null;
}

export interface OfflineState {
  entries: Record<string, OfflineEntry>;
  /** 0-100 for the song downloading now. Null before the size is known. */
  progress: number | null;
  /** Songs waiting their turn, in order. */
  queued: string[];
  /** Everything queued or downloading, for lists that need to show a song with no file yet. */
  pending: Record<string, Track>;
  downloadingId: string | null;
  /** Songs that gave up, with the reason. */
  failed: Record<string, string>;
  /** The same songs with their details, for the "Couldn't download" list. */
  failures: Record<string, DownloadFailure>;
  /** Failed songs the user stopped trying; they no longer count against a playlist. */
  skipped: Record<string, true>;
  usedBytes: number;
  paused: PauseReason | null;
  /** What went wrong, for the storage pause. */
  pauseMessage: string | null;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let entries: Record<string, OfflineEntry> = {};
let usedBytes = 0;
/** Insertion order is queue order. */
const jobs = new Map<string, DownloadJob>();
let downloadingId: string | null = null;
let progress: number | null = null;
let pause: { reason: PauseReason; message: string | null } | null = null;
let state: OfflineState = derive();

let hydration: Promise<void> | null = null;
let hydrated = false;
const afterHydration: Array<() => void> = [];
let pumping = false;
let moving = false;
let idleWaiters: Array<() => void> = [];
let wakeTimer: number | null = null;
let storageTimer: number | null = null;

/* ── State ───────────────────────────────────────────────────────────────────────────────── */

function derive(): OfflineState {
  const queued: string[] = [];
  const pending: Record<string, Track> = {};
  const failed: Record<string, string> = {};
  const failures: Record<string, DownloadFailure> = {};
  const skipped: Record<string, true> = {};
  for (const [id, job] of jobs) {
    if (job.dismissed) {
      skipped[id] = true;
      continue;
    }
    if (job.failed) {
      failed[id] = job.lastError ?? "Download failed";
      failures[id] = { track: job.track, message: failed[id], kind: job.failureKind };
      continue;
    }
    pending[id] = job.track;
    if (id !== downloadingId) queued.push(id);
  }
  // A pause only means something while songs are waiting on it; once the last one is cancelled
  // or released there is nothing paused to talk about.
  const paused = Object.keys(pending).length > 0 ? pause : null;
  return {
    entries,
    progress,
    queued,
    pending,
    downloadingId,
    failed,
    failures,
    skipped,
    usedBytes,
    paused: paused?.reason ?? null,
    pauseMessage: paused?.message ?? null,
  };
}

function publish(): void {
  state = derive();
  for (const listener of listeners) listener();
}

function setEntries(next: Record<string, OfflineEntry>): void {
  entries = next;
  usedBytes = Object.values(next).reduce((total, entry) => total + (entry.byteLength || 0), 0);
  saveDocument(MANIFEST_DOCUMENT, { version: 2, entries });
  publish();
}

function saveQueue(): void {
  saveDocument(QUEUE_DOCUMENT, { version: 2, jobs: [...jobs.values()] });
}

function setPause(reason: PauseReason | null, message: string | null = null): void {
  if (pause?.reason === reason && pause?.message === message) return;
  if (reason !== pause?.reason) logInternalInfo("offlineStore.pause", { reason, message });
  pause = reason ? { reason, message } : null;
  if (reason === "storage") {
    storageTimer ??= window.setInterval(() => {
      if (pause?.reason !== "storage") return;
      setPause(null);
      void pump();
    }, STORAGE_RECHECK_MS);
  } else if (storageTimer !== null) {
    window.clearInterval(storageTimer);
    storageTimer = null;
  }
  publish();
}

/* ── Owners ──────────────────────────────────────────────────────────────────────────────── */

function withOwner(owners: DownloadOwners, playlistId?: string): DownloadOwners {
  if (!playlistId) return owners.manual ? owners : { ...owners, manual: true };
  return owners.playlists.includes(playlistId)
    ? owners
    : { ...owners, playlists: [...owners.playlists, playlistId] };
}

function hasOwners(owners: DownloadOwners): boolean {
  return owners.manual || owners.playlists.length > 0;
}

function entryOwners(entry: OfflineEntry): DownloadOwners {
  return { manual: entry.savedIndividually !== false, playlists: entry.playlistIds ?? [] };
}

function entryWithOwner(entry: OfflineEntry, playlistId?: string): OfflineEntry {
  const owners = entryOwners(entry);
  const next = withOwner(owners, playlistId);
  if (next === owners && entry.savedIndividually !== undefined) return entry;
  return { ...entry, savedIndividually: next.manual, playlistIds: next.playlists };
}

function newJob(track: Track, owners: DownloadOwners): DownloadJob {
  return {
    track,
    owners,
    attempts: 0,
    networkFailures: 0,
    expiredRetries: 0,
    notBefore: 0,
    failed: false,
    failureKind: null,
    failedAt: null,
    lastError: null,
  };
}

function resetJob(job: DownloadJob): DownloadJob {
  return { ...newJob(job.track, job.owners), keep: job.keep };
}

function jobFromEntry(entry: OfflineEntry): DownloadJob {
  return {
    ...newJob(entry.track, entryOwners(entry)),
    keep: { lyrics: entry.lyrics, remoteArtworkUrl: entry.remoteArtworkUrl },
  };
}

/* ── Retry policy ────────────────────────────────────────────────────────────────────────── */

export interface RetryPlan {
  job: DownloadJob;
  /** Stop the whole queue for this reason. */
  pause?: PauseReason;
  /** Let the songs behind it go first. */
  moveToBack: boolean;
}

/** What to do with a job whose download just failed. Pure, so it can be checked. */
export function planRetry(job: DownloadJob, kind: ErrorKind, message: string, now: number): RetryPlan {
  switch (kind) {
    case "network": {
      const networkFailures = job.networkFailures + 1;
      if (networkFailures < NETWORK_FAILURES_PER_ATTEMPT) {
        return {
          job: { ...job, networkFailures, lastError: message, notBefore: now + NETWORK_RETRY_DELAY_MS * networkFailures },
          moveToBack: false,
        };
      }
      return countAttempt({ ...job, networkFailures: 0 }, kind, message, now);
    }
    case "expired": {
      const expiredRetries = job.expiredRetries + 1;
      if (expiredRetries <= EXPIRED_RETRIES) {
        return { job: { ...job, expiredRetries, lastError: message, notBefore: now }, moveToBack: false };
      }
      return countAttempt({ ...job, expiredRetries: 0 }, kind, message, now);
    }
    case "storage":
      return { job: { ...job, lastError: message, notBefore: now }, pause: "storage", moveToBack: false };
    case "unavailable":
      return {
        job: { ...job, attempts: MAX_ATTEMPTS, failed: true, failureKind: kind, failedAt: now, lastError: message },
        moveToBack: true,
      };
    default:
      return countAttempt(job, kind, message, now);
  }
}

function countAttempt(job: DownloadJob, kind: ErrorKind, message: string, now: number): RetryPlan {
  const attempts = job.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    return {
      job: { ...job, attempts, failed: true, failureKind: kind, failedAt: now, lastError: message },
      moveToBack: true,
    };
  }
  return { job: { ...job, attempts, lastError: message, notBefore: now + RETRY_DELAY_MS * attempts }, moveToBack: true };
}

/** Whether a sync should try a failed song again. Unplayable songs only retry on request. */
export function shouldRetryOnSync(job: DownloadJob, now: number): boolean {
  if (!job.failed || job.dismissed || job.failureKind === "unavailable") return false;
  return now - (job.failedAt ?? 0) >= FAILED_RETRY_AFTER_MS;
}

/* ── Manifest reconciliation ─────────────────────────────────────────────────────────────── */

/**
 * Matches the manifest against what is actually on disk.
 *
 * Disk decides availability; the manifest decides what is known. An entry with no file is
 * `missing` (to be downloaded again for whoever wanted it). A file with no entry is an orphan
 * only when there was a manifest to be absent from: no manifest at all reads as a lost manifest
 * rather than an empty library, and deleting the user's downloads on that guess cannot be undone.
 */
export function reconcileManifest(
  manifest: Record<string, OfflineEntry>,
  onDisk: ReadonlyArray<{ trackId: string; byteLength: number }>,
): { entries: Record<string, OfflineEntry>; orphans: string[]; missing: OfflineEntry[] } {
  const byId = new Map(onDisk.map((entry) => [entry.trackId, entry.byteLength]));
  const present: Record<string, OfflineEntry> = {};
  const missing: OfflineEntry[] = [];

  for (const [trackId, entry] of Object.entries(manifest)) {
    const byteLength = byId.get(trackId);
    if (byteLength === undefined) {
      missing.push(entry);
      continue;
    }
    present[trackId] = { ...entry, byteLength };
  }

  const orphans = Object.keys(manifest).length === 0
    ? []
    : [...byId.keys()].filter((trackId) => !present[trackId]);
  return { entries: present, orphans, missing };
}

/* ── Loading ─────────────────────────────────────────────────────────────────────────────── */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readLocalJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function isTrack(value: unknown): value is Track {
  const track = asRecord(value);
  return Boolean(track && typeof track.id === "string" && track.id && typeof track.title === "string");
}

function sanitizeEntries(value: unknown): Record<string, OfflineEntry> {
  const result: Record<string, OfflineEntry> = {};
  for (const [id, raw] of Object.entries(asRecord(value) ?? {})) {
    const entry = asRecord(raw);
    if (!entry || !isTrack(entry.track) || entry.track.id !== id) continue;
    result[id] = raw as OfflineEntry;
  }
  return result;
}

function sanitizeJob(raw: unknown): DownloadJob | null {
  const job = asRecord(raw);
  if (!job || !isTrack(job.track)) return null;
  const owners = asRecord(job.owners);
  const playlists = Array.isArray(owners?.playlists)
    ? owners.playlists.filter((id): id is string => typeof id === "string")
    : [];
  const restored: DownloadJob = {
    ...newJob(job.track, { manual: owners?.manual === true, playlists }),
    attempts: typeof job.attempts === "number" ? job.attempts : 0,
    failed: job.failed === true,
    failureKind: typeof job.failureKind === "string" ? job.failureKind as ErrorKind : null,
    failedAt: typeof job.failedAt === "number" ? job.failedAt : null,
    lastError: typeof job.lastError === "string" ? job.lastError : null,
    dismissed: job.dismissed === true && job.failed === true,
    keep: asRecord(job.keep) ? job.keep as DownloadJob["keep"] : undefined,
  };
  // Waits and network counts belong to the run that set them; a new run starts clean.
  return hasOwners(restored.owners) ? restored : null;
}

async function loadManifest(): Promise<Record<string, OfflineEntry>> {
  const document = asRecord(await readDocument<unknown>(MANIFEST_DOCUMENT));
  if (document) return sanitizeEntries(document.entries);

  // Before 1.0 the manifest lived in the settings file and local storage. Either copy can be
  // the survivor, so both are merged, then moved to the document and removed.
  const legacy = {
    ...sanitizeEntries(await getAppSetting<unknown>(LEGACY_MANIFEST_KEY)),
    ...sanitizeEntries(readLocalJson(LEGACY_MANIFEST_KEY)),
  };
  if (Object.keys(legacy).length > 0) {
    // Keep the old copies until the new one is safely written.
    if (!await saveDocumentNow(MANIFEST_DOCUMENT, { version: 2, entries: legacy })) return legacy;
  }
  void removeAppSetting(LEGACY_MANIFEST_KEY);
  try {
    localStorage.removeItem(LEGACY_MANIFEST_KEY);
  } catch {
    // Nothing to clean up.
  }
  return legacy;
}

async function loadQueue(): Promise<DownloadJob[]> {
  const document = asRecord(await readDocument<unknown>(QUEUE_DOCUMENT));
  const stored = Array.isArray(document?.jobs) ? document.jobs : [];
  const loaded = stored.map(sanitizeJob).filter((job): job is DownloadJob => job !== null);

  const legacy = {
    ...sanitizeEntries(await getAppSetting<unknown>(LEGACY_REDOWNLOAD_KEY)),
    ...sanitizeEntries(readLocalJson(LEGACY_REDOWNLOAD_KEY)),
  };
  loaded.push(...Object.values(legacy).map(jobFromEntry));
  if (Object.keys(legacy).length > 0 || document === null) {
    void removeAppSetting(LEGACY_REDOWNLOAD_KEY);
    try {
      localStorage.removeItem(LEGACY_REDOWNLOAD_KEY);
    } catch {
      // Nothing to clean up.
    }
  }
  return loaded;
}

/**
 * Loads the manifest and the queue and starts downloading. Safe to call more than once.
 *
 * Changes requested before this finishes (a sync at launch, a click) wait for it, so they are
 * applied on top of what was saved rather than being overwritten by it.
 */
export function hydrateOfflineStore(): Promise<void> {
  hydration ??= hydrate();
  return hydration;
}

async function hydrate(): Promise<void> {
  const [manifest, storedJobs] = await Promise.all([loadManifest(), loadQueue()]);

  let restored = manifest;
  try {
    const onDisk = await invoke<Array<{ trackId: string; byteLength: number }>>("offline_audio_list");
    const reconciled = reconcileManifest(manifest, onDisk);
    for (const trackId of reconciled.orphans) {
      void invoke("offline_audio_remove", { trackId }).catch(() => {});
    }
    restored = reconciled.entries;
    // A file that vanished is downloaded again for whoever wanted it.
    storedJobs.push(...reconciled.missing.map(jobFromEntry));
    if (reconciled.missing.length > 0) {
      logInternalWarn("offlineStore.hydrate files missing, downloading again", {
        count: reconciled.missing.length,
      });
    }
  } catch (error) {
    // The folder is unavailable (an unplugged drive): keep the manifest as it is rather than
    // conclude every song is gone.
    logInternalWarn("offlineStore.hydrate could not list downloads", { error: errorMessage(error) });
  }

  for (const job of storedJobs) {
    const id = job.track.id;
    const entry = restored[id];
    if (entry) {
      // Already on disk: whoever queued it now owns the downloaded copy instead.
      let merged = entry;
      if (job.owners.manual) merged = entryWithOwner(merged);
      for (const playlistId of job.owners.playlists) merged = entryWithOwner(merged, playlistId);
      restored = { ...restored, [id]: merged };
    } else if (!jobs.has(id)) {
      jobs.set(id, job);
    }
  }

  hydrated = true;
  setEntries(restored);
  saveQueue();
  for (const apply of afterHydration.splice(0)) apply();

  const now = Date.now();
  for (const [id, entry] of Object.entries(entries)) {
    if (entry.metadataPending || needsLyricsCheck(entry, now)) queueMetadata(id);
  }
  subscribeConnectivity(() => {
    if (isOnline()) void pump();
  });
  logInternalInfo("offlineStore.hydrate", { count: Object.keys(entries).length, queued: jobs.size });
  void pump();
}

function whenHydrated(apply: () => void): void {
  if (hydrated) apply();
  else afterHydration.push(apply);
}

/* ── Progress ────────────────────────────────────────────────────────────────────────────── */

/** Real transfer progress, streamed from the backend for the song downloading now. */
export function startOfflineProgressFeed(): void {
  void listen<{ trackId: string; percent: number }>("offline-download-progress", (event) => {
    if (event.payload.trackId !== downloadingId) return;
    progress = event.payload.percent;
    publish();
  });
}

/* ── Queries ─────────────────────────────────────────────────────────────────────────────── */

export function getOfflineStatus(trackId: string): OfflineStatus {
  if (entries[trackId]) return "ready";
  if (downloadingId === trackId) return "downloading";
  const job = jobs.get(trackId);
  if (!job) return "absent";
  return job.failed ? "failed" : "queued";
}

export function isTrackDownloaded(trackId: string): boolean {
  return Boolean(entries[trackId]);
}

/**
 * The stored metadata for a downloaded song, or undefined. The manifest keeps the whole Track so
 * playback can name a song with no network.
 */
export function getOfflineTrack(trackId: string): Track | undefined {
  return entries[trackId]?.track;
}

export function getOfflineLyrics(trackId: string): Lyrics | undefined {
  return entries[trackId]?.lyrics;
}

export interface DownloadSummary {
  total: number;
  downloaded: number;
  /** Queued or downloading. */
  pending: number;
  failed: number;
}

/** How far along a set of songs is, for a playlist's download button and the Downloads page. */
export function summarizeDownloads(trackIds: readonly string[], snapshot: OfflineState = state): DownloadSummary {
  let downloaded = 0;
  let pending = 0;
  let failed = 0;
  let total = 0;
  for (const id of trackIds) {
    if (snapshot.skipped?.[id] && !snapshot.entries[id]) continue;
    total += 1;
    if (snapshot.entries[id]) downloaded += 1;
    else if (snapshot.failed[id]) failed += 1;
    else if (snapshot.pending[id]) pending += 1;
  }
  return { total, downloaded, pending, failed };
}

/** Where a playlist's or album's downloads stand, for its Download button. */
export type CollectionDownloadState =
  | { kind: "none" }
  /** Reading the playlist before anything can be queued. */
  | { kind: "preparing" }
  | { kind: "downloading" | "waiting" | "paused"; downloaded: number; total: number }
  | { kind: "incomplete"; downloaded: number; total: number; failedIds: string[] }
  | { kind: "done"; total: number };

/**
 * The Download button's state for a set of songs.
 *
 * `tracked` is a synced playlist: it stays in a download state even before its songs are
 * queued, and songs not queued yet count as still to come (the next sync queues them). An album
 * or an unsynced playlist is judged only by what is actually downloaded or queued.
 *
 * `preparing` is a synced playlist whose song list has not arrived yet. Offline it cannot
 * arrive, so that reads as waiting (with nothing counted) rather than as downloading.
 */
export function collectionDownloadState(
  trackIds: readonly string[],
  options: { tracked: boolean; preparing: boolean; online?: boolean },
  snapshot: OfflineState = state,
): CollectionDownloadState {
  if (options.tracked && options.preparing) {
    return options.online ?? isOnline()
      ? { kind: "preparing" }
      : { kind: "waiting", downloaded: 0, total: 0 };
  }
  const summary = summarizeDownloads(trackIds, snapshot);
  // A synced playlist that is empty has nothing left to download.
  if (summary.total === 0) return options.tracked ? { kind: "done", total: 0 } : { kind: "none" };
  if (summary.downloaded === summary.total) return { kind: "done", total: summary.total };

  const failedIds = trackIds.filter((id) => !snapshot.entries[id] && snapshot.failed[id] && !snapshot.skipped?.[id]);
  const waiting = summary.pending > 0 || (options.tracked && summary.downloaded + summary.failed < summary.total);
  if (!waiting) {
    if (failedIds.length > 0) {
      return { kind: "incomplete", downloaded: summary.downloaded, total: summary.total, failedIds };
    }
    return { kind: "none" };
  }
  const kind = snapshot.paused === "offline"
    ? "waiting"
    : snapshot.paused
      ? "paused"
      : "downloading";
  return { kind, downloaded: summary.downloaded, total: summary.total };
}

/* ── Changes ─────────────────────────────────────────────────────────────────────────────── */

type RetryFailed = "always" | "stale";

function queueTracks(tracks: readonly Track[], playlistId: string | undefined, retryFailed: RetryFailed): void {
  whenHydrated(() => {
    const now = Date.now();
    let nextEntries = entries;
    let queueChanged = false;

    for (const track of tracks) {
      if (!track?.id || track.source === "local") continue;
      const entry = nextEntries[track.id];
      if (entry) {
        let merged = entryWithOwner(entry, playlistId);
        // Songs downloaded before durations were read have none, and LRCLIB needs one.
        if (!merged.track.durationSec && track.durationSec) {
          merged = { ...merged, track: { ...merged.track, durationSec: track.durationSec } };
          if (needsLyricsCheck(merged, now)) queueMetadata(track.id);
        }
        if (merged !== entry) nextEntries = { ...nextEntries, [track.id]: merged };
        continue;
      }
      const job = jobs.get(track.id);
      if (job) {
        const owners = withOwner(job.owners, playlistId);
        const retry = job.failed && (retryFailed === "always" || shouldRetryOnSync(job, now));
        if (owners !== job.owners || retry) {
          jobs.set(track.id, retry ? resetJob({ ...job, owners }) : { ...job, owners });
          queueChanged = true;
        }
        continue;
      }
      jobs.set(track.id, newJob(track, withOwner({ manual: false, playlists: [] }, playlistId)));
      queueChanged = true;
    }

    if (nextEntries !== entries) setEntries(nextEntries);
    if (queueChanged) {
      saveQueue();
      publish();
      void pump();
    }
  });
}

/** Saves a song on its own. Asking again retries one that failed. */
export function queueDownload(track: Track, playlistId?: string): void {
  queueTracks([track], playlistId, "always");
}

export function queueDownloads(tracks: Track[]): void {
  queueTracks(tracks, undefined, "always");
}

/**
 * Makes a synced playlist an owner of these songs. Failed songs are retried only once enough
 * time has passed, so a playlist with an unplayable song does not retry it on every sync.
 */
export function queuePlaylistDownloads(playlistId: string, tracks: Track[]): void {
  queueTracks(tracks, playlistId, "stale");
}

function dropJob(trackId: string): void {
  jobs.delete(trackId);
  if (downloadingId === trackId) void invoke("offline_audio_cancel", { trackId }).catch(() => {});
}

/** Takes a song out of the queue, stopping it if it is downloading now. */
export function cancelDownload(trackId: string): void {
  whenHydrated(() => {
    if (!jobs.has(trackId)) return;
    dropJob(trackId);
    saveQueue();
    publish();
  });
}

async function deleteFiles(trackIds: readonly string[]): Promise<void> {
  for (const trackId of trackIds) {
    await invoke("offline_audio_remove", { trackId }).catch((error) => {
      logInternalWarn("offlineStore.remove failed", { trackId, error: errorMessage(error) });
    });
  }
}

/**
 * Un-saves a song that was saved on its own. A song that a synced playlist also wants stays
 * downloaded for that playlist.
 */
export async function removeDownload(trackId: string): Promise<void> {
  await hydrateOfflineStore();
  const entry = entries[trackId];
  if (entry) {
    if (entry.playlistIds?.length) {
      setEntries({ ...entries, [trackId]: { ...entry, savedIndividually: false } });
    } else {
      const { [trackId]: _removed, ...rest } = entries;
      setEntries(rest);
      await deleteFiles([trackId]);
    }
  }
  const job = jobs.get(trackId);
  if (job) {
    const owners = { ...job.owners, manual: false };
    if (hasOwners(owners)) jobs.set(trackId, { ...job, owners });
    else dropJob(trackId);
    saveQueue();
    publish();
  }
}

/**
 * A synced playlist no longer wants these songs (it stopped syncing, or they left it). Each is
 * deleted unless something else still wants it.
 */
export async function releasePlaylistDownloads(playlistId: string, trackIds: readonly string[]): Promise<void> {
  await hydrateOfflineStore();
  let nextEntries = entries;
  const toDelete: string[] = [];
  let queueChanged = false;

  for (const trackId of trackIds) {
    const entry = nextEntries[trackId];
    if (entry) {
      const playlistIds = (entry.playlistIds ?? []).filter((id) => id !== playlistId);
      if (playlistIds.length === 0 && entry.savedIndividually === false) {
        const { [trackId]: _removed, ...rest } = nextEntries;
        nextEntries = rest;
        toDelete.push(trackId);
      } else if (playlistIds.length !== (entry.playlistIds ?? []).length) {
        nextEntries = { ...nextEntries, [trackId]: { ...entry, playlistIds } };
      }
      continue;
    }
    const job = jobs.get(trackId);
    if (!job || !job.owners.playlists.includes(playlistId)) continue;
    const owners = { ...job.owners, playlists: job.owners.playlists.filter((id) => id !== playlistId) };
    if (hasOwners(owners)) jobs.set(trackId, { ...job, owners });
    else dropJob(trackId);
    queueChanged = true;
  }

  if (nextEntries !== entries) setEntries(nextEntries);
  if (queueChanged) {
    saveQueue();
    publish();
  }
  await deleteFiles(toDelete);
}

export async function releasePlaylistDownload(playlistId: string, trackId: string): Promise<void> {
  await releasePlaylistDownloads(playlistId, [trackId]);
}

/** Deletes every download and empties the queue. */
export async function removeAllDownloads(): Promise<void> {
  await hydrateOfflineStore();
  const active = downloadingId;
  jobs.clear();
  if (active) void invoke("offline_audio_cancel", { trackId: active }).catch(() => {});
  saveQueue();
  const ids = Object.keys(entries);
  setEntries({});
  await deleteFiles(ids);
}

/** Tries failed songs again: the given ones, or every failure still on the list. */
export function retryFailedDownloads(trackIds?: readonly string[]): void {
  whenHydrated(() => {
    let changed = false;
    for (const [id, job] of jobs) {
      if (!job.failed) continue;
      if (trackIds ? !trackIds.includes(id) : job.dismissed) continue;
      jobs.set(id, resetJob(job));
      changed = true;
    }
    if (!changed) return;
    saveQueue();
    publish();
    void pump();
  });
}

/** Stops trying a failed song: it leaves the "Couldn't download" list and no sync retries it. */
export function dismissFailedDownload(trackId: string): void {
  whenHydrated(() => {
    const job = jobs.get(trackId);
    if (!job?.failed || job.dismissed) return;
    jobs.set(trackId, { ...job, dismissed: true });
    saveQueue();
    publish();
  });
}

/** Clears a storage pause and tries again now, for a "Try again" button. */
export function resumeDownloads(): void {
  if (pause?.reason === "storage") setPause(null);
  void pump();
}

/* ── Storage limit ───────────────────────────────────────────────────────────────────────── */

export function getOfflineMaxBytes(): number {
  const raw = Number(localStorage.getItem(MAX_BYTES_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_OFFLINE_MAX_BYTES;
}

/**
 * Sets the storage limit. Reaching it pauses new downloads; nothing already downloaded is
 * deleted to make room, because every download is something the user asked to keep.
 */
export function setOfflineMaxBytes(maxBytes: number): void {
  localStorage.setItem(MAX_BYTES_KEY, String(Math.max(0, maxBytes)));
  if (pause?.reason === "limit") setPause(null);
  void pump();
}

/* ── The worker ──────────────────────────────────────────────────────────────────────────── */

/** Resolves the stream URL for a track. Injected so the store stays independent of the source. */
type StreamUrlResolver = (
  track: Track,
  quality: AudioQuality,
) => Promise<{ url: string; mimeType: string; cookie?: string }>;

let resolveStreamUrl: StreamUrlResolver | null = null;
let resolveLyrics: ((track: Track) => Promise<Lyrics>) | null = null;

export function setOfflineStreamResolver(resolver: StreamUrlResolver): void {
  resolveStreamUrl = resolver;
  void pump();
}

export function setOfflineLyricsResolver(resolver: (track: Track) => Promise<Lyrics>): void {
  resolveLyrics = resolver;
}

function nextDueJob(now: number): DownloadJob | null {
  for (const job of jobs.values()) {
    if (!job.failed && job.notBefore <= now) return job;
  }
  return null;
}

function scheduleWake(now: number): void {
  if (wakeTimer !== null) window.clearTimeout(wakeTimer);
  wakeTimer = null;
  let soonest = Number.POSITIVE_INFINITY;
  for (const job of jobs.values()) {
    if (!job.failed) soonest = Math.min(soonest, job.notBefore);
  }
  if (!Number.isFinite(soonest)) return;
  wakeTimer = window.setTimeout(() => {
    wakeTimer = null;
    void pump();
  }, Math.max(250, soonest - now));
}

async function pump(): Promise<void> {
  if (!hydrated || pumping || moving || !resolveStreamUrl) return;
  pumping = true;
  try {
    for (;;) {
      if (moving || pause?.reason === "storage") break;
      // Paused only while something is waiting; failed songs alone are not held up by anything.
      const waiting = nextDueJob(Number.POSITIVE_INFINITY) !== null;
      if (usedBytes >= getOfflineMaxBytes()) {
        setPause(waiting ? "limit" : null);
        break;
      }
      if (!isOnline()) {
        setPause(waiting ? "offline" : null);
        break;
      }
      if (pause) setPause(null);

      const now = Date.now();
      const job = nextDueJob(now);
      if (!job) {
        scheduleWake(now);
        break;
      }
      await runJob(job);
    }
  } finally {
    pumping = false;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}

async function runJob(job: DownloadJob): Promise<void> {
  const trackId = job.track.id;
  downloadingId = trackId;
  progress = null;
  publish();
  logInternalInfo("offlineStore.download start", {
    trackId,
    title: job.track.title,
    attempt: job.attempts + 1,
  });

  try {
    const stream = await resolveStreamUrl!(job.track, getDownloadQuality());
    const result = await invoke<{ byteLength: number; mimeType: string }>("offline_audio_save", {
      url: stream.url,
      trackId,
      cookie: stream.cookie,
    });
    await onDownloaded(trackId, result.byteLength, result.mimeType || stream.mimeType);
  } catch (error) {
    onFailed(trackId, error);
  } finally {
    downloadingId = null;
    progress = null;
    publish();
  }
}

async function onDownloaded(trackId: string, byteLength: number, mimeType: string): Promise<void> {
  const job = jobs.get(trackId);
  jobs.delete(trackId);

  // Cancelled, or every owner let go, while the last bytes were arriving.
  if (!job || !hasOwners(job.owners)) {
    saveQueue();
    void deleteFiles([trackId]);
    logInternalInfo("offlineStore.download discarded", { trackId });
    return;
  }

  const artworkUrl = job.track.artworkUrl;
  const entry: OfflineEntry = {
    track: { ...job.track, mimeType },
    byteLength,
    downloadedAt: Date.now(),
    savedIndividually: job.owners.manual,
    playlistIds: job.owners.playlists,
    lyrics: job.keep?.lyrics,
    remoteArtworkUrl: job.keep?.remoteArtworkUrl
      ?? (artworkUrl && !artworkUrl.startsWith(OFFLINE_ARTWORK_PREFIX) ? artworkUrl : undefined),
    metadataPending: true,
  };
  setEntries({ ...entries, [trackId]: entry });
  /*
   * The song is recorded on disk before the queue lets go of it. In the other order, quitting
   * between the two writes left a file that nothing recorded and no job to bring it back, and
   * the next launch deleted it as a stray: a song saved on its own quietly vanished. This way
   * the worst case is a job for a song already recorded, which the next launch drops.
   */
  if (!await saveDocumentNow(MANIFEST_DOCUMENT, { version: 2, entries })) {
    logInternalWarn("offlineStore.download manifest not saved", { trackId });
  }
  saveQueue();
  queueMetadata(trackId);
  logInternalInfo("offlineStore.download complete", { trackId, byteLength });
}

function onFailed(trackId: string, error: unknown): void {
  const job = jobs.get(trackId);
  const kind = errorKind(error);
  const message = errorMessage(error);
  // Removed while running (cancelled on purpose), or stopped for a folder move: nothing to do.
  if (!job || kind === "cancelled") return;

  logInternalWarn("offlineStore.download failed", { trackId, kind, error: message, attempt: job.attempts + 1 });
  if (kind === "network") reportNetworkFailure();

  const plan = planRetry(job, kind, message, Date.now());
  if (plan.moveToBack) jobs.delete(trackId);
  jobs.set(trackId, plan.job);
  saveQueue();
  if (plan.pause) setPause(plan.pause, message);
  else publish();
}

/* ── Artwork and lyrics, fetched after the audio so they never hold up the queue ─────────── */

const metadataQueue = new Set<string>();
let metadataRunning = false;

function queueMetadata(trackId: string): void {
  metadataQueue.add(trackId);
  void runMetadata();
}

async function runMetadata(): Promise<void> {
  if (metadataRunning) return;
  metadataRunning = true;
  try {
    while (metadataQueue.size > 0) {
      await whenOnline();
      const [trackId] = metadataQueue;
      metadataQueue.delete(trackId);
      const entry = entries[trackId];
      if (!entry || !(entry.metadataPending || needsLyricsCheck(entry, Date.now()))) continue;

      const [artwork, lyrics] = await Promise.allSettled([saveArtwork(entry), fetchLyrics(entry)]);
      const current = entries[trackId];
      if (!current) continue;
      const artworkSaved = artwork.status === "fulfilled" && artwork.value;
      const looked = lyrics.status === "fulfilled" ? lyrics.value : null;
      setEntries({
        ...entries,
        [trackId]: {
          ...current,
          track: artworkSaved
            ? { ...current.track, artworkUrl: `${OFFLINE_ARTWORK_PREFIX}${trackId}` }
            : current.track,
          lyrics: looked && lyricsRank(looked.lyrics) > lyricsRank(current.lyrics) ? looked.lyrics : current.lyrics,
          // A lookup a source failed to answer is tried again on the next launch.
          lyricsCheckedAt: looked && !looked.lyrics.incomplete ? Date.now() : current.lyricsCheckedAt,
          metadataPending: false,
        },
      });
      // LRCLIB turns bursts away as overloaded; a whole playlist's worth goes at a gentler pace.
      if (looked) await new Promise((resolve) => window.setTimeout(resolve, LYRICS_LOOKUP_GAP_MS));
    }
  } finally {
    metadataRunning = false;
  }
}

/** Saves the cover beside the audio. Resolves true once there is a local copy. */
async function saveArtwork(entry: OfflineEntry): Promise<boolean> {
  const current = entry.track.artworkUrl;
  if (current?.startsWith(OFFLINE_ARTWORK_PREFIX)) return true;
  const remote = entry.remoteArtworkUrl ?? current;
  if (!remote) return false;
  const response = await tauriFetch(remote);
  if (!response.ok) throw new Error(`Artwork returned HTTP ${response.status}`);
  const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "";
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) return false;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_ARTWORK_BYTES) return false;
  await invoke("offline_artwork_save", { trackId: entry.track.id, mimeType, dataBase64: toBase64(bytes) });
  return true;
}

/** How lyrics rank for keeping: synced lines, then plain lines, then nothing. */
function lyricsRank(lyrics: Lyrics | undefined): number {
  if (!Array.isArray(lyrics?.lines) || lyrics.lines.length === 0) return 0;
  return lyrics.timing === "synced" ? 2 : 1;
}

/*
 * A song without synced lyrics is looked up again now and then: the usual reason is that
 * nobody had contributed them yet. It waits for a duration, which the synced sources match on.
 */
export function needsLyricsCheck(entry: OfflineEntry, now: number): boolean {
  if (lyricsRank(entry.lyrics) === 2 || !entry.track.durationSec) return false;
  return !entry.lyricsCheckedAt || now - entry.lyricsCheckedAt > LYRICS_RECHECK_MS;
}

/** Looks the lyrics up. Null when the lookup did not finish, so it is tried again. */
async function fetchLyrics(entry: OfflineEntry): Promise<{ lyrics: Lyrics } | null> {
  if (!resolveLyrics || lyricsRank(entry.lyrics) === 2) return null;
  let timer: number | undefined;
  try {
    const lyrics = await Promise.race([
      resolveLyrics(entry.track),
      new Promise<undefined>((resolve) => {
        timer = window.setTimeout(() => resolve(undefined), LYRICS_TIMEOUT_MS);
      }),
    ]);
    return lyrics ? { lyrics } : null;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Keeps better lyrics found while the song was open, so the downloaded copy has them offline
 * too. Ignored unless they beat what is stored.
 */
export function improveOfflineLyrics(trackId: string, lyrics: Lyrics): void {
  const entry = entries[trackId];
  if (!entry || lyricsRank(lyrics) <= lyricsRank(entry.lyrics)) return;
  setEntries({ ...entries, [trackId]: { ...entry, lyrics, lyricsCheckedAt: Date.now() } });
}

/* ── Download folder ─────────────────────────────────────────────────────────────────────── */

export type OfflineMigrationMode = "move" | "copy" | "fresh";

export interface OfflineLocation {
  /** The full directory downloads live in, including the "YTM Offline" subfolder. */
  path: string;
  isDefault: boolean;
  /** False when a chosen folder is missing, such as an unplugged drive. */
  available: boolean;
}

export function getOfflineLocation(): Promise<OfflineLocation> {
  return invoke<OfflineLocation>("offline_location_get");
}

function waitForIdle(): Promise<void> {
  if (!pumping) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

/**
 * Moves the download store to `folder` (a "YTM Offline" subfolder is made inside it), or back
 * to the default location when `folder` is null.
 *
 * The download running now is stopped and stays queued, so nothing is written into a folder
 * that is being emptied. "fresh" deletes the old audio and queues every song again, keeping its
 * cover and lyrics.
 */
export async function changeOfflineLocation(
  folder: string | null,
  mode: OfflineMigrationMode,
  onProgress?: (done: number, total: number) => void,
): Promise<OfflineLocation> {
  await hydrateOfflineStore();
  moving = true;
  setPause("moving");
  if (downloadingId) void invoke("offline_audio_cancel", { trackId: downloadingId }).catch(() => {});
  const unlisten = await listen<{ done: number; total: number }>(
    "offline-location-progress",
    (event) => onProgress?.(event.payload.done, event.payload.total),
  );
  try {
    await waitForIdle();
    const location = await invoke<OfflineLocation>("offline_location_set", { folder, mode });
    logInternalInfo("offlineStore.location changed", { mode, isDefault: location.isDefault });

    if (mode === "fresh") {
      for (const entry of Object.values(entries)) {
        if (!jobs.has(entry.track.id)) jobs.set(entry.track.id, jobFromEntry(entry));
      }
      saveQueue();
      setEntries({});
    }
    return location;
  } finally {
    unlisten();
    moving = false;
    setPause(null);
    void pump();
  }
}

/* ── Subscription ────────────────────────────────────────────────────────────────────────── */

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOfflineState(): OfflineState {
  return state;
}

export function useOfflineState(): OfflineState {
  return useSyncExternalStore(subscribe, getOfflineState, getOfflineState);
}
