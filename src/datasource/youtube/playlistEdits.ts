import type { Playlist } from "../types";

/** An edit made in the app that YouTube's own playlist listing may not show yet. */
export type PlaylistEdit =
  | { kind: "created"; playlist: Playlist }
  | { kind: "renamed"; title: string }
  | { kind: "deleted" };

export interface PendingPlaylistEdit {
  edit: PlaylistEdit;
  at: number;
}

/** A playlist's id without the `VL` prefix the library listing adds. */
export function barePlaylistId(playlistId: string): string {
  return playlistId.startsWith("VL") ? playlistId.slice(2) : playlistId;
}

/**
 * The listing with recent edits laid over it, and which edits are settled: already shown by the
 * listing, or older than `maxAgeMs`. The listing lags an edit by seconds to minutes, so without
 * this a playlist just created vanished on the next refresh and a rename or a delete came back.
 *
 * `edits` is keyed by `barePlaylistId`.
 */
export function applyPlaylistEdits(
  playlists: readonly Playlist[],
  edits: ReadonlyMap<string, PendingPlaylistEdit>,
  now: number,
  maxAgeMs: number,
): { playlists: Playlist[]; settled: string[] } {
  let result = [...playlists];
  const settled: string[] = [];
  for (const [id, { edit, at }] of edits) {
    if (now - at > maxAgeMs) {
      settled.push(id);
      continue;
    }
    const isThis = (playlist: Playlist) => barePlaylistId(playlist.id) === id;
    const listed = result.find(isThis);
    if (edit.kind === "created") {
      if (listed) settled.push(id);
      else result = [edit.playlist, ...result];
    } else if (edit.kind === "renamed") {
      if (!listed || listed.title === edit.title) settled.push(id);
      else result = result.map((playlist) => isThis(playlist) ? { ...playlist, title: edit.title } : playlist);
    } else if (listed) {
      result = result.filter((playlist) => !isThis(playlist));
    } else {
      settled.push(id);
    }
  }
  return { playlists: result, settled };
}
