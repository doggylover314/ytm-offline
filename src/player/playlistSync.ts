import { useSyncExternalStore } from "react";
import type { Playlist, Track } from "../datasource/types";
import { getAppSetting, setAppSetting } from "../internal/appSettings";
import type { LibraryController } from "./LibraryController";
import { queuePlaylistDownloads, releasePlaylistDownload } from "./offlineStore";

const KEY = "ytm-offline:synced-playlists:v1";

export interface SyncedPlaylist {
  playlist: Playlist;
  trackIds: string[];
  lastSyncedAt: number | null;
  error: string | null;
  syncing: boolean;
}

type Snapshot = Record<string, SyncedPlaylist>;
let snapshot: Snapshot = {};
let hydrated = false;
const listeners = new Set<() => void>();
const inFlight = new Map<string, Promise<void>>();

function read(value: unknown): Snapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, item]) => {
    const entry = item as Partial<SyncedPlaylist> | null;
    return Boolean(entry?.playlist?.id && Array.isArray(entry.trackIds));
  }).map(([id, item]) => {
    const entry = item as SyncedPlaylist;
    return [id, { ...entry, syncing: false, error: null }];
  }));
}

function publish(next: Snapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function persist(): void {
  const saved = Object.fromEntries(Object.entries(snapshot).map(([id, entry]) => [id, {
    ...entry, syncing: false,
  }]));
  localStorage.setItem(KEY, JSON.stringify(saved));
  void setAppSetting(KEY, saved);
}

export async function hydrateSyncedPlaylists(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  let local: Snapshot = {};
  try { local = read(JSON.parse(localStorage.getItem(KEY) ?? "{}")); } catch { /* Use durable copy. */ }
  const durable = read(await getAppSetting<unknown>(KEY));
  publish({ ...durable, ...local });
}

export function getSyncedPlaylists(): Snapshot { return snapshot; }
export function useSyncedPlaylists(): Snapshot {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSyncedPlaylists,
    getSyncedPlaylists,
  );
}

async function fetchAllTracks(playlist: Playlist, library: LibraryController): Promise<Track[]> {
  const tracks: Track[] = [];
  const seenTracks = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await library.getPlaylistTrackPage(playlist, cursor, undefined, true);
    for (const track of page.tracks) {
      if (track.source === "local" || seenTracks.has(track.id)) continue;
      seenTracks.add(track.id);
      tracks.push(track);
    }
    if (!page.hasMore) return tracks;
    if (!page.nextPageKey || seenCursors.has(page.nextPageKey)) {
      throw new Error("Playlist pagination stopped before the final page.");
    }
    seenCursors.add(page.nextPageKey);
    cursor = page.nextPageKey;
  }
}

export function syncPlaylist(playlist: Playlist, library: LibraryController): Promise<void> {
  const running = inFlight.get(playlist.id);
  if (running) return running;
  const task = (async () => {
    const previous = snapshot[playlist.id];
    if (!previous) return;
    publish({ ...snapshot, [playlist.id]: { ...previous, playlist, syncing: true, error: null } });
    try {
      let tracks = await fetchAllTracks(playlist, library);
      // A transient empty API response must not erase a formerly populated playlist.
      if (tracks.length === 0 && previous.trackIds.length > 0) {
        tracks = await fetchAllTracks(playlist, library);
      }
      if (!snapshot[playlist.id]) return;
      const nextIds = new Set(tracks.map((track) => track.id));
      queuePlaylistDownloads(playlist.id, tracks);
      for (const id of previous.trackIds) {
        if (!nextIds.has(id)) await releasePlaylistDownload(playlist.id, id);
      }
      publish({ ...snapshot, [playlist.id]: {
        playlist, trackIds: [...nextIds], lastSyncedAt: Date.now(), error: null, syncing: false,
      } });
      persist();
    } catch (error) {
      const current = snapshot[playlist.id];
      if (!current) return;
      publish({ ...snapshot, [playlist.id]: {
        ...current, syncing: false, error: error instanceof Error ? error.message : String(error),
      } });
    }
  })().finally(() => inFlight.delete(playlist.id));
  inFlight.set(playlist.id, task);
  return task;
}

export async function enablePlaylistSync(playlist: Playlist, library: LibraryController): Promise<void> {
  await hydrateSyncedPlaylists();
  if (!snapshot[playlist.id]) {
    publish({ ...snapshot, [playlist.id]: {
      playlist, trackIds: [], lastSyncedAt: null, error: null, syncing: false,
    } });
    persist();
  }
  await syncPlaylist(playlist, library);
}

export async function disablePlaylistSync(playlistId: string): Promise<void> {
  const entry = snapshot[playlistId];
  if (!entry) return;
  const next = { ...snapshot };
  delete next[playlistId];
  publish(next);
  persist();
  for (const id of entry.trackIds) await releasePlaylistDownload(playlistId, id);
}

export async function syncAllPlaylists(library: LibraryController): Promise<void> {
  await hydrateSyncedPlaylists();
  for (const entry of Object.values(snapshot)) await syncPlaylist(entry.playlist, library);
}
