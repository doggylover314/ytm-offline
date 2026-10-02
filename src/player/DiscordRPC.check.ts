/**
 * Self-check for the presence dedupe key.
 *
 * `PlayerController.emit()` fires on every state change, most of which have nothing to do with
 * Discord. Getting the key wrong in either direction fails quietly: too narrow and a real track
 * change stops updating Discord, too wide and every queue reorder goes back to spamming an IPC
 * call for a payload that already matches what is showing.
 */
export {};

import { presenceDedupeKey, presenceNeedsSending, type DiscordPresenceData } from "./DiscordRPC";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

const base: DiscordPresenceData = {
  title: "Song",
  artist: "Artist",
  album: "Album",
  duration: 200,
  currentTime: 10,
  isPlaying: true,
};

// The whole point: currentTime alone must not change the key.
check(
  presenceDedupeKey(base) === presenceDedupeKey({ ...base, currentTime: 45 }),
  "currentTime is excluded from the key",
);

// Anything else changing has to produce a different key, or Discord never hears about it.
check(
  presenceDedupeKey(base) !== presenceDedupeKey({ ...base, title: "Other song" }),
  "title change is not deduped away",
);
check(
  presenceDedupeKey(base) !== presenceDedupeKey({ ...base, isPlaying: false }),
  "play/pause change is not deduped away",
);

// A seek has to be sent: Discord runs its own clock from the start time it was given.
const NOW = 10_000;
const sent = { key: presenceDedupeKey(base), startedAt: NOW - base.currentTime };
check(!presenceNeedsSending(sent, { ...base, currentTime: base.currentTime + 1 }, NOW + 1), "playing on is not resent");
check(presenceNeedsSending(sent, { ...base, currentTime: 120 }, NOW + 1), "a seek is resent");
check(presenceNeedsSending(sent, { ...base, isPlaying: false }, NOW), "a pause is resent");
check(
  !presenceNeedsSending({ key: presenceDedupeKey({ ...base, isPlaying: false }), startedAt: null }, { ...base, isPlaying: false, currentTime: 50 }, NOW),
  "a paused song is not resent as time passes",
);
check(presenceNeedsSending(null, base, NOW), "after a failed send, the same presence goes out again");

console.log("DiscordRPC.check.ts passed");
