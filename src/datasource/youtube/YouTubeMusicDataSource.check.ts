/**
 * Self-check for `removeAccountOutcome`, the one piece of the multi-account switch/remove flow
 * that lives on the TypeScript side rather than in Rust's `YoutubeAccountStore` (see its own
 * tests in src-tauri/src/lib.rs). It decides what `LibraryController.removeGoogleAccount` shows
 * the user: nothing, a fallback account's library, or signed-out.
 */
export {};

import { removeAccountOutcome } from "./YouTubeMusicDataSource";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

// Removing an account that was not active must not disturb the current session at all, even
// when the active account's cookie was rotated in the meantime.
check(
  removeAccountOutcome({ cookie: "cookie-a2", wasActive: false }) === "unchanged",
  "removing another account changes nothing, whatever the cookie now reads",
);

// Removing the active account with another stored one falls back to it.
check(
  removeAccountOutcome({ cookie: "cookie-b", wasActive: true }) === "switched",
  "removing the active account switches to the one left",
);

// Removing the last account signs out.
check(
  removeAccountOutcome({ cookie: null, wasActive: true }) === "signed-out",
  "removing the only account signs out",
);

console.log("removeAccountOutcome: ok");
