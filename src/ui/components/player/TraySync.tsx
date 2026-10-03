import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { shallowEqual, usePlayerSelector } from "../../../player/playerStore";

/** Dragging the volume slider writes on every move; the menu only needs where it settled. */
const TRAY_SYNC_DELAY_MS = 150;

/**
 * Keeps the tray menu in step with the player: the song, play or pause, and volume.
 *
 * A component rather than an effect in `App` so the subscription lives at a leaf. Volume is
 * the most frequently written field in the player state, and subscribing to it in `App`
 * re-rendered the whole tree on every move of the slider. Renders nothing.
 */
export function TraySync() {
  const state = usePlayerSelector(
    (player) => ({
      title: player.currentTrack?.title ?? null,
      artist: player.currentTrack?.artist ?? null,
      status: player.status,
      volume: player.volume,
      muted: player.muted,
    }),
    shallowEqual,
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void invoke("tray_update", { state }).catch(() => {
        // No tray on this desktop; the menu it would update does not exist.
      });
    }, TRAY_SYNC_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  return null;
}
