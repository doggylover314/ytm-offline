"use client";

import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

export interface RangeSliderProps {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Render a tick mark at each step. */
  showTicks?: boolean;
  /**
   * Fill colour. "foreground" (default) for levels such as volume; "primary" where the fill
   * represents playback progress.
   */
  tone?: "foreground" | "primary";
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function RangeSlider({
  value,
  defaultValue = 0,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  showTicks = true,
  tone = "foreground",
  disabled = false,
  className,
  "aria-label": ariaLabel,
}: RangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [internal, setInternal] = useState(defaultValue);
  const [active, setActive] = useState(false);
  const controlled = value !== undefined;
  const current = clamp(controlled ? value : internal, min, max);
  const percent = ((current - min) / (max - min)) * 100;

  const steps = Math.floor((max - min) / step);
  const ticks =
    showTicks && steps > 0 && steps <= 50
      ? Array.from({ length: steps + 1 }, (_, i) => min + i * step)
      : [];

  const commit = useCallback(
    (next: number) => {
      const snapped = clamp(Math.round((next - min) / step) * step + min, min, max);
      if (!controlled) setInternal(snapped);
      onValueChange?.(snapped);
    },
    [controlled, onValueChange, min, max, step],
  );

  const valueFromX = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return current;
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      return min + ratio * (max - min);
    },
    [current, min, max],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setActive(true);
      commit(valueFromX(event.clientX));
    },
    [disabled, commit, valueFromX],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!active || disabled) return;
      commit(valueFromX(event.clientX));
    },
    [active, disabled, commit, valueFromX],
  );

  const endDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setActive(false);
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      const map: Record<string, number> = {
        ArrowRight: current + step,
        ArrowUp: current + step,
        ArrowLeft: current - step,
        ArrowDown: current - step,
        Home: min,
        End: max,
      };
      if (event.key in map) {
        event.preventDefault();
        commit(map[event.key]);
      }
    },
    [disabled, current, step, min, max, commit],
  );

  return (
    <div
      ref={trackRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={cn(
        "relative flex h-5 w-full touch-none select-none items-center",
        disabled ? "pointer-events-none opacity-50" : "cursor-pointer",
        className,
      )}
    >
      {/* track */}
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-[1px] bg-border">
        <div
          className={cn(
            "h-full rounded-[1px]",
            tone === "primary" ? "bg-primary" : "bg-foreground",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>

      {ticks.length > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 inset-y-0">
          {ticks.map((t) => {
            const tp = ((t - min) / (max - min)) * 100;
            return (
              <span
                key={t}
                className="absolute top-1/2 h-2 w-px bg-muted-foreground"
                style={{ left: `${tp}%`, transform: `translate(-${tp}%, -50%)` }}
              />
            );
          })}
        </div>
      ) : null}

      {/* 4x14 bar thumb, self-offset by its own width so it stays inside the track at both ends */}
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={current}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        className="absolute top-1/2 h-3.5 w-1 rounded-[1px] bg-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        style={{ left: `${percent}%`, transform: `translate(-${percent}%, -50%)` }}
      />
    </div>
  );
}
