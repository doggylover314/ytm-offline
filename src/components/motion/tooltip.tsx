"use client";

import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";
import { cn } from "@/lib/utils";

type Side = "top" | "right" | "bottom" | "left";

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: Side;
  /** Delay before showing (ms). Default 120. */
  delay?: number;
  className?: string;
  /** Classes for the outer wrapper span. Use to fix baseline / fill parent. */
  wrapperClassName?: string;
}

// Gap between trigger and tooltip, in px.
const GAP = 8;

// Centering transform for the fixed-positioned anchor point, per side.
const anchorTransform: Record<Side, string> = {
  top: "translate(-50%, -100%)",
  bottom: "translate(-50%, 0)",
  left: "translate(-100%, -50%)",
  right: "translate(0, -50%)",
};

// Once any tooltip has just closed, neighbouring tooltips open without the
// initial delay — moving along a toolbar feels instant after the first one.
const WARM_WINDOW_MS = 300;
let lastHiddenAt = 0;

export function Tooltip({
  content,
  children,
  side = "top",
  delay = 120,
  className,
  wrapperClassName,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const canHover = useHoverCapable();

  // Anchor point in viewport coords, on the edge of the trigger facing `side`.
  // Position:fixed means these viewport coords place the tooltip directly, so
  // it escapes every ancestor's stacking context and overflow.
  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const point: Record<Side, { top: number; left: number }> = {
      top: { top: r.top - GAP, left: cx },
      bottom: { top: r.bottom + GAP, left: cx },
      left: { top: cy, left: r.left - GAP },
      right: { top: cy, left: r.right + GAP },
    };
    setCoords(point[side]);
  }, [side]);

  const show = useCallback(() => {
    if (!canHover) return;
    if (timer.current) clearTimeout(timer.current);
    const warm = Date.now() - lastHiddenAt < WARM_WINDOW_MS;
    timer.current = setTimeout(
      () => {
        place();
        setOpen(true);
      },
      warm ? 0 : delay,
    );
  }, [canHover, delay, place]);

  const hide = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (open) lastHiddenAt = Date.now();
    setOpen(false);
  }, [open]);

  // Keep the tooltip pinned to the trigger while it's open and the page scrolls
  // or resizes (fixed coords are viewport-relative).
  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, place]);

  if (!isValidElement(children)) return children;

  const trigger = cloneElement(
    children as ReactElement<Record<string, unknown>>,
    {
      onMouseEnter: show,
      onMouseLeave: hide,
      onFocus: show,
      onBlur: hide,
      "aria-describedby": id,
    },
  );

  return (
    <>
      <span
        ref={anchorRef}
        className={cn("relative inline-flex align-middle", wrapperClassName)}
      >
        {trigger}
      </span>
      {typeof document !== "undefined"
        ? createPortal(
            open && coords ? (
              <span
                aria-hidden
                className="pointer-events-none fixed z-[9999]"
                style={{
                  top: coords.top,
                  left: coords.left,
                  transform: anchorTransform[side],
                }}
              >
                <span
                  id={id}
                  role="tooltip"
                  className={cn(
                    "block whitespace-nowrap rounded-[4px] bg-foreground px-2 py-1.5 text-xs font-medium text-background",
                    className,
                  )}
                >
                  {content}
                </span>
              </span>
            ) : null,
            document.body,
          )
        : null}
    </>
  );
}
