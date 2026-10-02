import { useSyncExternalStore } from "react";
import type { Playlist, Track } from "../datasource/types";
import { getAppSetting, removeAppSetting } from "../internal/appSettings";
import { isOnline } from "../internal/connectivity";
import { readDocument, saveDocument, saveDocumentNow } from "../internal/documentStore";
import { errorMessage, isNetworkError } from "../internal/errors";
import { logInternalInfo, logInternalWarn } from "../internal/logging";
import type { LibraryController } from "./LibraryController";
import {
  collectionDownloadState,
  hydrateOfflineStore,
  queuePlaylistDownloads,
  releasePlaylistDownloads,
  removeAllDownloads,
  type CollectionDownloadState,
  type OfflineState,
} from "./offlineStore";

/*
 * Synced playlists: a downloaded playlist keeps matching the playlist on YouTube Music. Each
 * sync reads every page of it, downloads songs that were added and releases songs that were
 * removed (a released song is deleted unless another synced playlist, or the user, wants it).
 */

const DOCUMENT = "synced-playlists";
/** Where the list lived before it had its own file. Read once, to migrate. */
const LEGACY_KEY = "ytm-offline:synced-playlists:v1";
/** A playlist this long is almost certainly a pagination loop, not a real playlist. */
const MAX_TRACKS = 20_000;

export interface SyncedPlaylist {
  playlist: Playlist;
  /** Every song the playlist had at the last sync, in playlist order. */
  trackIds: string[];
  lastSyncedAt: number | null;
  error: string | null;
  syncing: boolean;
}

type Snapshot = Record<string, SyncedPlaylist>;
let snapshot: Snapshot = {};
let hydration: Promise<void> | null = null;
const listeners = new Set<() => void>();
const inFlight = new Map<string, Promise<void>>();

function read(value: unknown): Snapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Snapshot = {};
  for (const [id, item] of Object.entries(value)) {
    const entry = item as Partial<SyncedPlaylist> | null;
    if (!entry?.playlist?.id || !Array.isArray(entry.trackIds)) continue;
    result[id] = {
      playlist: entry.playlist,
      trackIds: entry.trackIds.filter((trackId): trackId is string => typeof trackId === "string"),
      lastSyncedAt: typeof entry.lastSyncedAt === "number" ? entry.lastSyncedAt : null,
      error: typeof entry.error === "string" ? entry.error : null,
      syncing: false,
    };
  }
  return result;
}

function publish(next: Snapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function persist(): void {
  const saved = Object.fromEntries(
    Object.entries(snapshot).map(([id, entry]) => [id, { ...entry, syncing: false }]),
  );
  saveDocument(DOCUMENT, { version: 2, playlists: saved });
}

function update(playlistId: string, patch: Partial<SyncedPlaylist>): void {
  const current = snapshot[playlistId];
  if (!current) return;
  publish({ ...snapshot, [playlistId]: { ...current, ...patch } });
}

export function hydrateSyncedPlaylists(): Promise<void> {
  hydration ??= (async () => {
    const document = await readDocument<{ playlists?: unknown }>(DOCUMENT);
    if (document) {
      publish(read(document.playlists));
      return;
    }
    // Before 1.0 the list lived in the settings file and local storage.
    let local: Snapshot = {};
    try {
      local = read(JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "{}"));
    } catch {
      // The settings copy below is enough.
    }
    const legacy = { ...read(await getAppSetting<unknown>(LEGACY_KEY)), ...local };
    publish(legacy);
    if (Object.keys(legacy).length > 0 && !await saveDocumentNow(DOCUMENT, { version: 2, playlists: legacy })) {
      return;
    }
    void removeAppSetting(LEGACY_KEY);
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      // Nothing to clean up.
    }
  })();
  return hydration;
}

export function getSyncedPlaylists(): Snapshot {
  return snapshot;
}

export function useSyncedPlaylists(): Snapshot {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSyncedPlaylists,
    getSyncedPlaylists,
  );
}

/**
 * Where a playlist's downloads stand. Its Download button and its row on the Downloads page
 * both read this, so the two always agree.
 */
export function syncedPlaylistDownloadState(
  entry: SyncedPlaylist | undefined,
  offline: OfflineState,
  online = isOnline(),
): CollectionDownloadState {
  if (!entry) return { kind: "none" };
  // No song list until the first sync finishes; a later sync keeps the last one meanwhile.
  const preparing = entry.trackIds.length === 0 && (entry.syncing || entry.lastSyncedAt === null);
  return collectionDownloadState(entry.trackIds, { tracked: true, preparing, online }, offline);
}

/**
 * Every song in the playlist, across all its pages.
 *
 * Stops with an error, rather than keeping what it has, when the pages stop making sense: a
 * repeated continuation token or an absurd length both mean the paging has gone wrong, and a
 * partial list would release every song after the break.
 */
export async function fetchAllTracks(playlist: Playlist, library: LibraryController): Promise<Track[]> {
  const tracks: Track[] = [];
  const seenTracks = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await library.getPlaylistTrackPage(playlist, cursor, undefined, true);
    for (const track of page.tracks) {
      if (!track?.id || track.source === "local" || seenTracks.has(track.id)) continue;
      seenTracks.add(track.id);
      tracks.push(track);
    }
    if (tracks.length > MAX_TRACKS) throw new Error("The playlist kept returning more pages than it could have.");
    if (!page.hasMore) return tracks;
    if (!page.nextPageKey || seenCursors.has(page.nextPageKey)) {
      throw new Error("The playlist's pages stopped before the last one.");
    }
    seenCursors.add(page.nextPageKey);
    cursor = page.nextPageKey;
  }
}

/**
 * Brings one synced playlist up to date. Concurrent calls for the same playlist share one run.
 *
 * Offline it does nothing and records nothing: a sync that cannot reach YouTube has learned
 * nothing about the playlist, and saying it failed would only alarm.
 */
export function syncPlaylist(playlist: Playlist, library: LibraryController): Promise<void> {
  const running = inFlight.get(playlist.id);
  if (running) return running;
  const task = (async () => {
    await Promise.all([hydrateSyncedPlaylists(), hydrateOfflineStore()]);
    const previous = snapshot[playlist.id];
    if (!previous || !isOnline()) return;
    update(playlist.id, { playlist, syncing: true });
    try {
      let tracks = await fetchAllTracks(playlist, library);
      // A transient empty response must not erase a playlist that had songs.
      if (tracks.length === 0 && previous.trackIds.length > 0) {
        tracks = await fetchAllTracks(playlist, library);
      }
      const current = snapshot[playlist.id];
      if (!current) return; // Stopped syncing while this ran.

      const nextIds = tracks.map((track) => track.id);
      const keep = new Set(nextIds);
      const removed = current.trackIds.filter((id) => !keep.has(id));
      queuePlaylistDownloads(playlist.id, tracks);
      update(playlist.id, {
        playlist,
        trackIds: nextIds,
        lastSyncedAt: Date.now(),
        error: null,
        syncing: false,
      });
      persist();
      if (removed.length > 0) await releasePlaylistDownloads(playlist.id, removed);
      logInternalInfo("playlistSync synced", {
        playlistId: playlist.id,
        tracks: nextIds.length,
        removed: removed.length,
      });
    } catch (error) {
      const network = isNetworkError(error);
      logInternalWarn("playlistSync failed", { playlistId: playlist.id, network, error: errorMessage(error) });
      update(playlist.id, { syncing: false, error: network ? null : errorMessage(error) });
      persist();
    }
  })().finally(() => inFlight.delete(playlist.id));
  inFlight.set(playlist.id, task);
  return task;
}

/** Starts syncing a playlist and downloads everything in it. */
export async function enablePlaylistSync(playlist: Playlist, library: LibraryController): Promise<void> {
  await hydrateSyncedPlaylists();
  if (!snapshot[playlist.id]) {
    publish({
      ...snapshot,
      [playlist.id]: { playlist, trackIds: [], lastSyncedAt: null, error: null, syncing: false },
    });
    persist();
  }
  await syncPlaylist(playlist, library);
}

/** Stops syncing a playlist and deletes its songs, except those something else still wants. */
export async function disablePlaylistSync(playlistId: string): Promise<void> {
  await hydrateSyncedPlaylists();
  const entry = snapshot[playlistId];
  if (!entry) return;
  const next = { ...snapshot };
  delete next[playlistId];
  publish(next);
  persist();
  await releasePlaylistDownloads(playlistId, entry.trackIds);
}

export async function syncAllPlaylists(library: LibraryController): Promise<void> {
  await hydrateSyncedPlaylists();
  for (const entry of Object.values(snapshot)) {
    if (!isOnline()) return;
    await syncPlaylist(entry.playlist, library);
  }
}

/**
 * Deletes every download and stops syncing every playlist. Both at once: removing the files
 * alone would only last until the next sync downloaded them all again.
 */
export async function removeAllDownloadsAndStopSyncing(): Promise<void> {
  await hydrateSyncedPlaylists();
  publish({});
  persist();
  await removeAllDownloads();
}
