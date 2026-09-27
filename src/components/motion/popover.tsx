"use client";

import {
  cloneElement,
  createContext,
  isValidElement,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

type Side = "top" | "bottom" | "left" | "right";
type Align = "start" | "center" | "end";
type TriggerMode = "click" | "hover";

const HOVER_CLOSE_DELAY = 120;

interface PopoverContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  openHover: () => void;
  scheduleClose: () => void;
  triggerMode: TriggerMode;
  side: Side;
  align: Align;
  gap: number;
  panelRadius: number;
  contentId: string;
}

const PopoverContext = createContext<PopoverContextValue | null>(null);

function usePopoverContext(component: string) {
  const ctx = useContext(PopoverContext);
  if (!ctx) throw new Error(`${component} must be used within <Popover>`);
  return ctx;
}

export interface PopoverProps {
  children: ReactNode;
  /** Controlled open state. */
  open?: boolean;
  /** Uncontrolled initial open state. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** How the popover is summoned. Default "click". */
  trigger?: TriggerMode;
  /** Which side of the trigger the panel opens on. Default "bottom". */
  side?: Side;
  /** Alignment along the trigger's edge. Default "center". */
  align?: Align;
  /** Gap between trigger and panel, in px. Default 4. */
  sideOffset?: number;
  /** Corner radius of the panel, in px. Default 6. */
  panelRadius?: number;
  /** No-op; kept so existing callers compile. */
  gooStrength?: number;
  className?: string;
}

export function Popover({
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  trigger = "click",
  side = "bottom",
  align = "center",
  sideOffset = 4,
  panelRadius = 6,
  className,
}: PopoverProps) {
  const contentId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const openHover = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose, setOpen]);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY);
  }, [cancelClose, setOpen]);

  const toggle = useCallback(() => setOpen(!open), [setOpen, open]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    // Trigger and panel share rootRef, so moving between them isn't "outside".
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    if (trigger === "click") window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open, setOpen, trigger]);

  const ctx = useMemo<PopoverContextValue>(
    () => ({
      open,
      setOpen,
      toggle,
      openHover,
      scheduleClose,
      triggerMode: trigger,
      side,
      align,
      gap: sideOffset,
      panelRadius,
      contentId,
    }),
    [open, setOpen, toggle, openHover, scheduleClose, trigger, side, align, sideOffset, panelRadius, contentId],
  );

  const hoverHandlers =
    trigger === "hover"
      ? { onMouseEnter: openHover, onMouseLeave: scheduleClose }
      : {};

  return (
    <PopoverContext.Provider value={ctx}>
      <div
        ref={rootRef}
        className={cn("relative inline-flex", className)}
        {...hoverHandlers}
      >
        {children}
      </div>
    </PopoverContext.Provider>
  );
}

export interface PopoverTriggerProps {
  /** A single focusable element (e.g. a Button) that opens the popover. */
  children: ReactElement;
}

export function PopoverTrigger({ children }: PopoverTriggerProps) {
  const ctx = usePopoverContext("PopoverTrigger");

  if (!isValidElement(children)) return children;

  const child = children as ReactElement<Record<string, unknown>>;
  const childProps = child.props;

  const compose =
    (name: string, handler: () => void) =>
    (event: { defaultPrevented?: boolean }) => {
      (childProps[name] as ((e: unknown) => void) | undefined)?.(event);
      if (!event.defaultPrevented) handler();
    };

  const handlers: Record<string, unknown> =
    ctx.triggerMode === "hover"
      ? {
          onFocus: compose("onFocus", ctx.openHover),
          onBlur: compose("onBlur", ctx.scheduleClose),
        }
      : { onClick: compose("onClick", ctx.toggle) };

  return cloneElement(child, {
    ...handlers,
    "aria-haspopup": "dialog",
    "aria-expanded": ctx.open,
    "aria-controls": ctx.open ? ctx.contentId : undefined,
    "data-state": ctx.open ? "open" : "closed",
  });
}

const SIDE_CLASS: Record<Side, string> = {
  bottom: "top-full",
  top: "bottom-full",
  left: "right-full",
  right: "left-full",
};

const ALIGN_CLASS: Record<"vertical" | "horizontal", Record<Align, string>> = {
  vertical: {
    start: "left-0",
    center: "left-1/2 -translate-x-1/2",
    end: "right-0",
  },
  horizontal: {
    start: "top-0",
    center: "top-1/2 -translate-y-1/2",
    end: "bottom-0",
  },
};

const GAP_PROPERTY: Record<Side, keyof CSSProperties> = {
  bottom: "marginTop",
  top: "marginBottom",
  left: "marginRight",
  right: "marginLeft",
};

export interface PopoverContentProps {
  children: ReactNode;
  className?: string;
}

/** A solid panel on the chosen side of the trigger. Stays mounted while closed, just hidden. */
export function PopoverContent({ children, className }: PopoverContentProps) {
  const ctx = usePopoverContext("PopoverContent");
  const { side, align, gap, panelRadius, contentId, open, triggerMode, openHover, scheduleClose } = ctx;
  const axis = side === "left" || side === "right" ? "horizontal" : "vertical";

  const hoverHandlers =
    triggerMode === "hover"
      ? { onMouseEnter: openHover, onMouseLeave: scheduleClose }
      : {};

  return (
    <div
      id={contentId}
      role="dialog"
      hidden={!open}
      {...hoverHandlers}
      style={{ [GAP_PROPERTY[side]]: gap, borderRadius: panelRadius }}
      className={cn(
        "absolute z-50 w-max max-w-[min(92vw,20rem)] bg-card p-4 text-popover-foreground shadow-[inset_0_0_0_1px_var(--color-border)] outline-none",
        SIDE_CLASS[side],
        ALIGN_CLASS[axis][align],
        className,
      )}
    >
      {children}
    </div>
  );
}
