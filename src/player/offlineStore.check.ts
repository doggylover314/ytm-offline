/**
 * Self-check for the offline store's decisions: reconciling the manifest with the disk, and
 * what the queue does after each kind of failure. Run by `pnpm run check`.
 *
 * The branch worth pinning hardest is the orphan sweep, because it deletes files and nothing
 * undoes it. A cleared manifest against a full disk has to be treated as a lost manifest, not
 * as proof that the user has no downloads.
 */
export {};

import {
  collectionDownloadState,
  MAX_ATTEMPTS,
  needsLyricsCheck,
  planRetry,
  reconcileManifest,
  shouldRetryOnSync,
  summarizeDownloads,
  type DownloadJob,
  type OfflineEntry,
  type OfflineState,
} from "./offlineStore";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

const entry = (id: string, byteLength: number): OfflineEntry => ({
  track: { id, title: id, artists: [], source: "youtube" } as unknown as OfflineEntry["track"],
  byteLength,
  downloadedAt: 1,
});

const manifest = { a: entry("a", 100), b: entry("b", 200) };

// Disk is the authority on size: a stale manifest length is corrected, not trusted.
const matched = reconcileManifest(manifest, [
  { trackId: "a", byteLength: 111 },
  { trackId: "b", byteLength: 200 },
]);
equal(Object.keys(matched.entries), ["a", "b"], "every downloaded track survives");
equal(matched.entries.a.byteLength, 111, "byte length comes from disk");
equal(matched.orphans, [], "nothing to sweep when the two agree");

// A file that vanished cannot be offered for playback, but it is not forgotten either: it is
// handed back to be downloaded again for whoever wanted it.
const missingFile = reconcileManifest(manifest, [{ trackId: "a", byteLength: 100 }]);
equal(Object.keys(missingFile.entries), ["a"], "an entry with no file is not playable");
equal(missingFile.missing.map((item) => item.track.id), ["b"], "and is reported as missing");
equal(missingFile.orphans, [], "and dropping it does not make the survivor an orphan");

// A file nobody tracks is unplayable — no title, no artist — so it goes.
const extraFile = reconcileManifest({ a: entry("a", 100) }, [
  { trackId: "a", byteLength: 100 },
  { trackId: "ghost", byteLength: 999 },
]);
equal(extraFile.orphans, ["ghost"], "an untracked file is swept when a manifest exists");

// The regression this exists for: local storage cleared, gigabytes still on disk. Sweeping
// here is what used to make a wiped manifest permanent.
const lostManifest = reconcileManifest({}, [
  { trackId: "a", byteLength: 100 },
  { trackId: "b", byteLength: 200 },
]);
equal(lostManifest.entries, {}, "no manifest means nothing is playable yet");
equal(lostManifest.orphans, [], "but the files are left alone to be recovered");

/* ── Retry policy ─────────────────────────────────────────────────────────────────────── */

const job = (overrides: Partial<DownloadJob> = {}): DownloadJob => ({
  track: entry("t", 0).track,
  owners: { manual: true, playlists: [] },
  attempts: 0,
  networkFailures: 0,
  expiredRetries: 0,
  notBefore: 0,
  failed: false,
  failureKind: null,
  failedAt: null,
  lastError: null,
  ...overrides,
});
const NOW = 1_000_000;

// No connection: wait a little and try again, without spending an attempt.
const network = planRetry(job(), "network", "offline", NOW);
check(!network.job.failed && network.job.attempts === 0, "a network failure does not use an attempt");
check(network.job.notBefore > NOW, "and waits before trying again");
check(!network.moveToBack, "and keeps its place in the queue");

// But a server that keeps failing while the network looks fine cannot retry forever.
let repeated = job();
for (let index = 0; index < 20; index += 1) repeated = planRetry(repeated, "network", "reset", NOW).job;
check(repeated.failed, "endless network failures eventually give up");

// A refused URL is retried straight away with a fresh one, a couple of times.
const expired = planRetry(job(), "expired", "403", NOW);
check(expired.job.notBefore === NOW && expired.job.attempts === 0, "a refused URL retries at once");
let refused = job();
for (let index = 0; index < 3; index += 1) refused = planRetry(refused, "expired", "403", NOW).job;
check(refused.attempts === 1, "a URL refused again and again counts as an attempt");

// A full disk or missing folder stops the queue instead of failing every song in it.
const storage = planRetry(job(), "storage", "disk full", NOW);
check(storage.pause === "storage" && !storage.job.failed, "a storage error pauses everything");

// A song YouTube will not play is not retried.
const unavailable = planRetry(job(), "unavailable", "removed", NOW);
check(unavailable.job.failed && unavailable.job.failureKind === "unavailable", "an unplayable song fails at once");
check(!shouldRetryOnSync(unavailable.job, NOW + 10 * 60 * 60_000), "and a sync never retries it on its own");

// Anything else: a few attempts with growing waits, then it is marked as failed.
let flaky = job();
for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
  const plan = planRetry(flaky, "http", "404", NOW);
  check(!plan.job.failed && plan.job.attempts === attempt, `attempt ${attempt} is retried`);
  check(plan.job.notBefore > NOW && plan.moveToBack, "after a wait, behind the other songs");
  flaky = plan.job;
}
const gaveUp = planRetry(flaky, "http", "404", NOW).job;
check(gaveUp.failed && gaveUp.attempts === MAX_ATTEMPTS, "the last attempt marks the song as failed");
check(!shouldRetryOnSync(gaveUp, NOW + 60_000), "a sync right after does not retry it");
check(shouldRetryOnSync(gaveUp, NOW + 60 * 60_000), "a sync much later does");

/* ── Playlist progress ────────────────────────────────────────────────────────────────── */

const snapshot = {
  entries: { a: entry("a", 1), b: entry("b", 1) },
  pending: { c: entry("c", 0).track },
  failed: { d: "removed" },
} as unknown as OfflineState;
equal(
  summarizeDownloads(["a", "b", "c", "d", "e"], snapshot),
  { total: 5, downloaded: 2, pending: 1, failed: 1 },
  "a playlist counts downloaded, pending and failed songs; one not queued yet is none of these",
);

/* ── The Download button ──────────────────────────────────────────────────────────────── */

const view = (overrides: Partial<OfflineState>) => ({
  entries: {}, pending: {}, failed: {}, paused: null, ...overrides,
}) as unknown as OfflineState;
const ids = ["a", "b", "c"];
const synced = { tracked: true, preparing: false };
const album = { tracked: false, preparing: false };

equal(collectionDownloadState(ids, { tracked: true, preparing: true, online: true }, view({})).kind, "preparing",
  "a playlist being read for the first time is preparing");
equal(
  collectionDownloadState([], { tracked: true, preparing: true, online: false }, view({})),
  { kind: "waiting", downloaded: 0, total: 0 },
  "a playlist that cannot be read offline is waiting, not downloading",
);
equal(collectionDownloadState([], synced, view({})), { kind: "done", total: 0 },
  "a synced playlist that is empty has nothing left to download");
equal(collectionDownloadState(ids, album, view({})).kind, "none", "an album nobody downloaded is not downloaded");
equal(
  collectionDownloadState(ids, synced, view({ entries: { a: entry("a", 1) }, pending: { b: entry("b", 0).track } })),
  { kind: "downloading", downloaded: 1, total: 3 },
  "songs still queued mean downloading, counted against the whole playlist",
);
equal(
  collectionDownloadState(ids, synced, view({ entries: { a: entry("a", 1) } })).kind,
  "downloading",
  "a synced playlist with songs not queued yet is still downloading, not done",
);
equal(
  collectionDownloadState(ids, synced, view({ pending: { a: entry("a", 0).track }, paused: "offline" })).kind,
  "waiting",
  "no connection reads as waiting",
);
equal(
  collectionDownloadState(ids, synced, view({ pending: { a: entry("a", 0).track }, paused: "storage" })).kind,
  "paused",
  "a storage problem reads as paused",
);
equal(
  collectionDownloadState(ids, synced, view({ entries: { a: entry("a", 1), b: entry("b", 1) }, failed: { c: "gone" } })),
  { kind: "incomplete", downloaded: 2, total: 3, failedIds: ["c"] },
  "nothing left to do but failures is incomplete, with the failures to retry",
);
equal(
  collectionDownloadState(ids, synced, view({ entries: { a: entry("a", 1), b: entry("b", 1), c: entry("c", 1) } })),
  { kind: "done", total: 3 },
  "only every song downloaded is done",
);

/* Lyrics re-checks: only songs without synced lyrics, only with a duration, not too often. */

const DAY = 24 * 60 * 60_000;
const LATER = 100 * DAY;
const withLyrics = (timing: "synced" | "none", lines: number, extra: Partial<OfflineEntry> = {}): OfflineEntry => ({
  ...entry("l", 1),
  track: { ...entry("l", 1).track, durationSec: 200 },
  lyrics: { timing, lines: Array.from({ length: lines }, (_, index) => ({ text: `line ${index}`, startTimeSec: index })) },
  ...extra,
});
equal(needsLyricsCheck(withLyrics("synced", 3), LATER), false, "synced lyrics are kept for good");
equal(needsLyricsCheck(withLyrics("none", 3), LATER), true, "plain lyrics are looked up again");
equal(needsLyricsCheck(withLyrics("none", 0), LATER), true, "and so is a lookup that found nothing");
equal(
  needsLyricsCheck({ ...withLyrics("none", 3), track: entry("l", 1).track }, LATER),
  false,
  "not without a duration, which the synced sources match on",
);
equal(needsLyricsCheck(withLyrics("none", 3, { lyricsCheckedAt: LATER - DAY }), LATER), false, "not again the next day");
equal(needsLyricsCheck(withLyrics("none", 3, { lyricsCheckedAt: LATER - 31 * DAY }), LATER), true, "but after a month");

console.log("offlineStore.check passed");
