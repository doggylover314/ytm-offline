import { useEffect, useState } from "react";
import { VolumeLoudIcon, VolumeMutedIcon, VolumeSmallIcon } from "@/ui/icons";
import { playerController, shallowEqual, usePlayerSelector } from "../../../player/playerStore";
import { PLAYER_ICON_BUTTON } from "./playerButton";

/** Scroll step over the icon or the bar. */
const WHEEL_STEP_PERCENT = 5;

/**
 * Mute toggle plus a short volume bar. The native range input sits invisibly over the drawn
 * bar, so dragging and arrow keys behave as a slider should. Scrolling over either steps it.
 */
export function VolumeControl() {
  /* This component writes volume on every pointer move of the slider, so it is the last one
     that should be subscribed to fields it does not read. */
  const playerState = usePlayerSelector(
    (state) => ({ volume: state.volume, muted: state.muted }),
    shallowEqual,
  );
  const [volume, setVolume] = useState(() => playerController.getVolume());
  const [isMuted, setIsMuted] = useState(() => playerController.isMuted());

  // The engine is the source of truth: the tray menu and OS media keys change it too.
  useEffect(() => {
    setVolume(playerState.volume);
    setIsMuted(playerState.muted);
  }, [playerState.muted, playerState.volume]);

  const displayedVolume = isMuted ? 0 : volume;
  const percent = Math.round(displayedVolume * 100);

  const applyVolume = (nextPercent: number) => {
    const next = Math.min(1, Math.max(0, nextPercent / 100));
    setVolume(next);
    // Dragging to a level is itself an unmute; dragging to zero is a mute.
    setIsMuted(next === 0);
    void playerController.setVolume(next);
  };

  const toggleMute = () => {
    setIsMuted((muted) => !muted);
    void playerController.toggleMute();
  };

  const VolumeGlyph = isMuted
    ? VolumeMutedIcon
    : displayedVolume < 0.5
      ? VolumeSmallIcon
      : VolumeLoudIcon;

  return (
    <div
      className="ml-1 flex shrink-0 items-center gap-1"
      onWheel={(event) => {
        const delta = event.deltaY || event.deltaX;
        if (delta === 0) return;
        applyVolume(percent + (delta < 0 ? 1 : -1) * WHEEL_STEP_PERCENT);
      }}
    >
      <button
        type="button"
        onClick={toggleMute}
        aria-label={isMuted ? `Unmute (volume ${percent}%)` : `Mute (volume ${percent}%)`}
        title={isMuted ? "Unmute" : "Mute"}
        className={PLAYER_ICON_BUTTON}
      >
        <VolumeGlyph size={20} aria-hidden="true" />
      </button>

      <div className="relative h-1 w-[88px]">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={percent}
          onChange={(event) => applyVolume(Number(event.currentTarget.value))}
          aria-label="Volume"
          aria-valuetext={isMuted ? "Muted" : `${percent}%`}
          className="peer absolute inset-x-0 top-1/2 z-10 m-0 h-4 w-full -translate-y-1/2 cursor-pointer appearance-none bg-transparent opacity-0 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-px [&::-moz-range-thumb]:border-0 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-px [&::-webkit-slider-thumb]:appearance-none"
        />
        <div
          className="h-full w-full overflow-hidden rounded-[1px] bg-border peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
          aria-hidden="true"
        >
          <div className="h-full rounded-[1px] bg-foreground" style={{ width: `${percent}%` }} />
        </div>
      </div>
    </div>
  );
}
