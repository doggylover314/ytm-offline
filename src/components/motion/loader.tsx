"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { useReduceMotion } from "@/ui/settings/renderEffects";

/**
 * Every name the loader used to accept, kept so callers compile. They all draw the same
 * indicator now — three short bars rising in turn — except "percent", which shows real
 * progress on a thin bar.
 */
export type LoaderVariant =
  | "spinner"
  | "dots"
  | "bars"
  | "dot-matrix"
  | "dither"
  | "ascii"
  | "ascii-line"
  | "ascii-braille"
  | "ascii-blocks"
  | "ascii-bounce"
  | "morph"
  | "comet"
  | "music"
  | "scramble"
  | "metaballs"
  | "newton"
  | "helix"
  | "percent";

export interface LoaderProps {
  /** Which indicator to render; everything except "percent" is the bar indicator. */
  variant?: LoaderVariant;
  /** Square size in px. */
  size?: number;
  /** Seconds per animation cycle. */
  speed?: number;
  /** Accessible label announced to screen readers. */
  label?: string;
  /**
   * Drives the "percent" variant from real progress (0-100). Left undefined, "percent" falls
   * back to the bar indicator rather than inventing a number.
   */
  value?: number;
  className?: string;
}

export function Loader({
  variant = "spinner",
  size = 32,
  speed = 1,
  label = "Loading",
  value,
  className,
}: LoaderProps) {
  return (
    <span
      role="status"
      aria-label={label || undefined}
      className={cn("inline-flex items-center justify-center text-foreground", className)}
    >
      {variant === "percent" && value !== undefined ? (
        <Percent size={size} value={value} />
      ) : (
        <SpinnerSteps size={size} speed={speed} />
      )}
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

type SpinnerStepsProps = {
  size?: number;
  color?: string;
  speed?: number;
  className?: string;
  /** Forces the still version; reduced motion is otherwise read from the app settings. */
  reduce?: boolean;
};

const BAR_COUNT = 3;

/**
 * The app's busy indicator: three 3px bars in `size`x`size`, each rising to full height in
 * turn. Reduced motion keeps the bars still and pulses their opacity, so the UI never looks
 * hung.
 */
export function SpinnerSteps({
  size = 24,
  color = "currentColor",
  speed = 0.9,
  className,
  reduce: forceReduce = false,
}: SpinnerStepsProps) {
  const reduce = useReduceMotion() || forceReduce;
  const width = Math.max(2, Math.round(size / 8));
  const gap = Math.max(1, Math.round(width * 0.67));
  const height = Math.round(size * 0.66);

  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size, gap, color }}
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <motion.span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed bar slots.
          key={i}
          className="block rounded-[1px] bg-current"
          style={{ width, height }}
          initial={false}
          animate={
            reduce ? { opacity: [1, 0.4, 1] } : { scaleY: [0.35, 1, 0.35] }
          }
          transition={{
            duration: reduce ? speed * 2 : speed,
            ease: "easeInOut",
            repeat: Infinity,
            delay: (i * speed) / (BAR_COUNT + 1),
          }}
        />
      ))}
    </span>
  );
}

function Percent({ size, value }: { size: number; value: number }) {
  const shown = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <span className="flex flex-col items-center" style={{ gap: size * 0.14, width: size * 1.4 }}>
      <span className="font-mono tabular-nums" style={{ fontSize: size * 0.42, lineHeight: 1 }}>
        {shown}%
      </span>
      <span className="block h-1 w-full rounded-[1px] bg-border">
        <span className="block h-full rounded-[1px] bg-current" style={{ width: `${shown}%` }} />
      </span>
    </span>
  );
}

/** Kept for API compatibility: the same bar indicator as every other loader variant. */
export function Music({ size, speed }: { size: number; speed: number; reduce?: boolean }) {
  return <SpinnerSteps size={size} speed={speed} />;
}

interface MusicVisualizerProps {
  /** Odd counts keep a single bar exactly on the centre, which the timing ramp is built on. */
  bars?: number;
  className?: string;
}

/**
 * Equaliser bars in the accent, for the playing row. Solid bars with 1px corners; only the
 * timing varies across them — the centre leads and the edges trail, so the motion reads as
 * coming from the middle out rather than as bars bouncing independently.
 */
export function MusicVisualizer({ bars = 15, className }: MusicVisualizerProps) {
  const centre = (bars - 1) / 2;

  return (
    <div className={cn("music", className)} aria-hidden="true">
      {Array.from({ length: bars }, (_, index) => {
        // 0 in the middle, 1 at either edge.
        const distance = centre === 0 ? 0 : Math.abs(index - centre) / centre;

        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed bar slots.
            key={index}
            className="music-bar"
            style={{
              background: "var(--color-primary)",
              borderRadius: 1,
              animationDelay: `${(0.1 + distance * 0.4).toFixed(2)}s`,
            }}
          />
        );
      })}
    </div>
  );
}
