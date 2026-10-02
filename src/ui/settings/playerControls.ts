import { useSyncExternalStore } from "react";
import {
  hydrateLocalBooleanSetting,
  readLocalBooleanSetting,
  writeLocalBooleanSetting,
} from "../../internal/durableLocalSetting";

/** Compact puts the seek bar under the controls; expanded keeps it as a full-width rail on top. */
const COMPACT_PLAYER_BAR_STORAGE_KEY = "compact-player-bar";
const CHANGE_EVENT = "player-controls-change";

function readCompactPlayerBar() {
  return readLocalBooleanSetting(COMPACT_PLAYER_BAR_STORAGE_KEY, false);
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);

  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function setCompactPlayerBar(enabled: boolean) {
  writeLocalBooleanSetting(COMPACT_PLAYER_BAR_STORAGE_KEY, enabled, CHANGE_EVENT);
}

export async function hydratePlayerControlSettings() {
  await hydrateLocalBooleanSetting(COMPACT_PLAYER_BAR_STORAGE_KEY, false, CHANGE_EVENT);
}

export function useCompactPlayerBar() {
  return useSyncExternalStore(subscribe, readCompactPlayerBar, () => false);
}
