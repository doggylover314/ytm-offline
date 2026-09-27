import { useEffect, useState } from "react";
import { cn, formatMinutesSeconds } from "@/lib/utils";
import { Tooltip } from "@/components/motion/tooltip";
import { ClockIcon, SpeedIcon } from "@/ui/icons";
import { playerController } from "../../../player/playerStore";
import { FloatingPanel } from "../FloatingPanel";
import { MiniEqualizer } from "./MiniEqualizer";
import { PLAYER_ICON_BUTTON } from "./playerButton";
import { isEqualizerFlat, useEqualizer, useEqualizerEnabled } from "../../settings/equalizer";

/** Offered speeds. Wider than a podcast app needs, narrow enough to stay a single row. */
const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

/** Sleep durations, plus "end of track" which is handled separately. */
const SLEEP_MINUTES = [15, 30, 45, 60, 90] as const;

// Ceil, not floor: a countdown showing 0:00 while a second is still running reads as stuck.
const formatCountdown = (remainingMs: number) => formatMinutesSeconds(Math.ceil(remainingMs / 1000));

/**
 * Playback speed, sleep timer and a mini equaliser, behind one control.
 *
 * They share a panel because they are the "how this plays" settings that belong next to the
 * transport rather than buried in Settings — a sleep timer you cannot see counting down is a
 * sleep timer you do not trust, and an equaliser you have to leave the song for to adjust gets
 * adjusted a lot less often than one sitting where you already are.
 */
export function PlaybackOptions() {
  const [isOpen, setIsOpen] = useState(false);
  const [rate, setRate] = useState(() => playerController.getPlaybackRate());
  const [remainingMs, setRemainingMs] = useState<number | null>(
    () => playerController.getSleepTimerRemainingMs(),
  );

  const isSleeping = remainingMs !== null;
  const equalizer = useEqualizer();
  const equalizerEnabled = useEqualizerEnabled();
  const equalizerActive = equalizerEnabled && !isEqualizerFlat(equalizer);

  /*
   * Polled once a second rather than driven by player state: the deadline is wall-clock, so
   * nothing in the store changes as it counts down and there is no event to subscribe to.
   *
   * Only while a timer is set. This component lives in the player bar, so it is mounted for
   * the entire session — the comment here used to claim the interval was conditional while the
   * effect ran on `[]`, ticking once a second, forever, for a countdown almost nobody has
   * started. `applySleep` seeds `remainingMs` itself, which is what starts this.
   */
  useEffect(() => {
    if (!isSleeping) return;
    const tick = () => setRemainingMs(playerController.getSleepTimerRemainingMs());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [isSleeping]);

  const applyRate = (next: number) => {
    playerController.setPlaybackRate(next);
    setRate(playerController.getPlaybackRate());
  };

  const applySleep = (minutes: number | null) => {
    playerController.setSleepTimer(minutes);
    setRemainingMs(playerController.getSleepTimerRemainingMs());
  };

  return (
    <FloatingPanel
      open={isOpen}
      onOpenChange={setIsOpen}
      side="top"
      triggerClassName="shrink-0"
      className="w-64"
      trigger={
        <Tooltip content="Speed, sleep timer and equaliser">
          <button
            type="button"
            onClick={() => setIsOpen((open) => !open)}
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            aria-label="Playback options"
            className={cn(
              PLAYER_ICON_BUTTON,
              "w-auto min-w-9 gap-1 px-2",
              // Something here is changing playback, so the control reads as switched on.
              (isSleeping || rate !== 1 || equalizerActive) && "bg-muted hover:bg-border",
            )}
          >
            {isSleeping ? (
              <>
                <ClockIcon size={18} aria-hidden="true" />
                <span className="text-[11px] tabular-nums">{formatCountdown(remainingMs)}</span>
              </>
            ) : rate !== 1 ? (
              <span className="text-[11px] font-semibold tabular-nums">{rate}&times;</span>
            ) : (
              <SpeedIcon size={20} aria-hidden="true" />
            )}
          </button>
        </Tooltip>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground">Playback speed</span>
          <div className="flex gap-0.5" role="radiogroup" aria-label="Playback speed">
            {SPEEDS.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rate === value}
                onClick={() => applyRate(value)}
                className={cn(
                  "h-7 flex-1 rounded px-1 text-xs font-medium tabular-nums transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  rate === value
                    ? "bg-foreground text-background"
                    : "bg-muted text-foreground hover:bg-border",
                )}
              >
                {value}&times;
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-foreground">Sleep timer</span>
            {isSleeping && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatCountdown(remainingMs)} left
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {SLEEP_MINUTES.map((minutes) => (
              <button
                key={minutes}
                type="button"
                onClick={() => applySleep(minutes)}
                className="h-7 rounded bg-muted px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {minutes} min
              </button>
            ))}
            {isSleeping && (
              <button
                type="button"
                onClick={() => applySleep(null)}
                className="h-7 rounded px-2.5 text-xs font-medium text-destructive transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cancel
              </button>
            )}
          </div>
          <span className="text-[11px] text-muted-foreground">
            Fades out over the last 20 seconds.
          </span>
        </div>

        <MiniEqualizer />
      </div>
    </FloatingPanel>
  );
}
