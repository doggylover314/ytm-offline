/**
 * Self-check for laying recent playlist edits over YouTube's lagging library listing.
 *
 * The failure it guards against is silent: a playlist made in the app vanishing on the next
 * refresh, or a rename or delete coming back, because the listing had not caught up yet.
 */
export {};

import type { Playlist } from "../types";
import { applyPlaylistEdits, barePlaylistId, type PendingPlaylistEdit } from "./playlistEdits";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

const MINUTE = 60_000;
const NOW = 1_000 * MINUTE;
const MAX_AGE = 10 * MINUTE;
const playlist = (id: string, title: string): Playlist => ({ id, title, owner: "Sam" });
const listing = [playlist("VLPLone", "One"), playlist("VLPLtwo", "Two")];
const run = (edits: Array<[string, PendingPlaylistEdit]>, playlists = listing) =>
  applyPlaylistEdits(playlists, new Map(edits), NOW, MAX_AGE);
const titles = (playlists: Playlist[]) => playlists.map((item) => item.title).join(",");

check(barePlaylistId("VLPLabc") === "PLabc" && barePlaylistId("PLabc") === "PLabc", "the VL prefix is dropped");

const created = { edit: { kind: "created" as const, playlist: playlist("VLPLnew", "New") }, at: NOW - MINUTE };
let result = run([["PLnew", created]]);
check(titles(result.playlists) === "New,One,Two", "a new playlist shows before the listing has it");
check(result.settled.length === 0, "and is kept until it does");
result = run([["PLnew", created]], [...listing, playlist("VLPLnew", "New")]);
check(titles(result.playlists) === "One,Two,New" && result.settled[0] === "PLnew", "once listed, the listing's copy wins");

const renamed = { edit: { kind: "renamed" as const, title: "Uno" }, at: NOW - MINUTE };
result = run([["PLone", renamed]]);
check(titles(result.playlists) === "Uno,Two", "a rename shows before the listing has it");
result = run([["PLone", renamed]], [playlist("VLPLone", "Uno"), listing[1]]);
check(result.settled[0] === "PLone", "and settles once it does");

const deleted = { edit: { kind: "deleted" as const }, at: NOW - MINUTE };
result = run([["PLtwo", deleted]]);
check(titles(result.playlists) === "One", "a deleted playlist stays gone while the listing lags");
result = run([["PLtwo", deleted]], [listing[0]]);
check(result.settled[0] === "PLtwo", "and settles once the listing drops it");

result = run([["PLone", { ...renamed, at: NOW - 11 * MINUTE }]]);
check(titles(result.playlists) === "One,Two" && result.settled[0] === "PLone", "an old edit gives way to the listing");

console.log("playlistEdits self-check passed");
