import { SpinnerSteps } from "@/components/motion/loader";
import { cn } from "@/lib/utils";
import {
  PauseActiveIcon,
  PlayActiveIcon,
  RepeatActiveIcon,
  RepeatIcon,
  RepeatOneActiveIcon,
  ShuffleActiveIcon,
  ShuffleIcon,
  SkipNextIcon,
  SkipPreviousIcon,
} from "@/ui/icons";
import { shallowEqual, usePlayerSelector } from "../../../player/playerStore";
import { playerController } from "../../../player/playerStore";
import { SeekTime } from "./SeekBar";
import { PLAYER_ICON_BUTTON } from "./playerButton";

interface PlaybackControlsProps {
  extraControlsAlwaysVisible?: boolean;
}

export function PlaybackControls({ extraControlsAlwaysVisible = true }: PlaybackControlsProps) {
  const state = usePlayerSelector(
    (player) => ({
      currentTrack: player.currentTrack,
      status: player.status,
      playbackOrderMode: player.playbackOrderMode,
      shuffleEnabled: player.shuffleEnabled,
    }),
    shallowEqual,
  );
  const isBusy = state.status === "loading";
  const isPlaying = state.status === "playing";
  const hasCurrentTrack = Boolean(state.currentTrack);

  const handlePlayPause = () => {
    void playerController.togglePlayPause();
  };

  const handleSkipNext = () => {
    void playerController.skipToNext();
  };

  const handleSkipPrevious = () => {
    void playerController.skipToPrevious();
  };

  const handlePlaybackOrderCycle = () => {
    playerController.cyclePlaybackOrderMode();
  };

  const handleShuffleToggle = () => {
    playerController.toggleShuffle();
  };

  const orderLabel =
    state.playbackOrderMode === "repeat-one"
      ? "Loop current song"
      : state.playbackOrderMode === "repeat-all"
        ? "Loop the queue"
        : "Play in order";

  const isShuffled = state.shuffleEnabled;

  return (
    <div className="flex items-center gap-2">
      <SeekTime kind="elapsed" />

      {/*
        Shuffle sits opposite repeat, the arrangement every player shares — and it is what the
        spacer here used to stand in for, so the previous/play/next trio stays centred without
        a placeholder. Both fade together when the extra controls are set to appear on hover.
      */}
      <div
        className={cn(
          "size-9 shrink-0 transition-opacity",
          !extraControlsAlwaysVisible &&
            "opacity-0 focus-within:opacity-100 group-hover/playerbar:opacity-100",
        )}
      >
        <button
          type="button"
          className={PLAYER_ICON_BUTTON}
          onClick={handleShuffleToggle}
          aria-pressed={isShuffled}
          aria-label={isShuffled ? "Turn off shuffle" : "Shuffle"}
          title={isShuffled ? "Shuffle is on" : "Shuffle"}
        >
          {isShuffled ? <ShuffleActiveIcon size={20} /> : <ShuffleIcon size={20} />}
        </button>
      </div>

      <button
        type="button"
        className={PLAYER_ICON_BUTTON}
        onClick={handleSkipPrevious}
        disabled={!hasCurrentTrack}
        aria-label="Previous track"
      >
        <SkipPreviousIcon size={22} />
      </button>

      <button
        type="button"
        className="flex size-10 items-center justify-center rounded bg-foreground text-background disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-chrome"
        onClick={handlePlayPause}
        disabled={isBusy || !hasCurrentTrack}
        aria-label={isBusy ? "Loading song" : isPlaying ? "Pause" : "Play"}
      >
        {isBusy ? (
          <SpinnerSteps size={22} />
        ) : isPlaying ? (
          <PauseActiveIcon size={22} aria-hidden="true" />
        ) : (
          <PlayActiveIcon size={22} aria-hidden="true" />
        )}
      </button>

      <button
        type="button"
        className={PLAYER_ICON_BUTTON}
        onClick={handleSkipNext}
        disabled={!hasCurrentTrack}
        aria-label="Next track"
      >
        <SkipNextIcon size={22} />
      </button>

      <div
        className={cn(
          "size-9 shrink-0 transition-opacity",
          !extraControlsAlwaysVisible &&
            "opacity-0 focus-within:opacity-100 group-hover/playerbar:opacity-100",
        )}
      >
        <button
          type="button"
          className={PLAYER_ICON_BUTTON}
          onClick={handlePlaybackOrderCycle}
          aria-label={orderLabel}
          title={orderLabel}
        >
          {state.playbackOrderMode === "repeat-one" ? (
            <RepeatOneActiveIcon size={20} />
          ) : state.playbackOrderMode === "repeat-all" ? (
            <RepeatActiveIcon size={20} />
          ) : (
            <RepeatIcon size={20} />
          )}
        </button>
      </div>

      <SeekTime kind="total" />
    </div>
  );
}
