"use client";

import { CheckIcon, ChevronDownIcon } from "@/ui/icons";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

type Placement = "bottom" | "top";

/**
 * How tall the option list may get before it scrolls: about six and a half rows.
 *
 * Half a row on purpose — a list cut mid-item reads as "there is more below" without needing a
 * scrollbar to say so.
 */
const MAX_LIST_HEIGHT = 240;

interface SelectContextValue {
  value: string | undefined;
  open: boolean;
  setOpen: (open: boolean) => void;
  select: (value: string) => void;
  register: (value: string, label: string) => void;
  unregister: (value: string) => void;
  labelFor: (value: string | undefined) => string | undefined;
  triggerId: string;
  listId: string;
  disabled: boolean;
  placement: Placement;
  setPlacement: (p: Placement) => void;
}

const SelectContext = createContext<SelectContextValue | null>(null);

function useSelectContext(component: string) {
  const ctx = useContext(SelectContext);
  if (!ctx) throw new Error(`${component} must be used within <Select>`);
  return ctx;
}

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export function Select({
  value,
  defaultValue,
  onValueChange,
  disabled = false,
  className,
  children,
}: SelectProps) {
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [internal, setInternal] = useState(defaultValue);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const [placement, setPlacement] = useState<Placement>("bottom");

  const controlled = value !== undefined;
  const current = controlled ? value : internal;

  const select = useCallback(
    (next: string) => {
      if (!controlled) setInternal(next);
      onValueChange?.(next);
      setOpen(false);
    },
    [controlled, onValueChange],
  );

  const register = useCallback((v: string, label: string) => {
    setLabels((m) => (m.get(v) === label ? m : new Map(m).set(v, label)));
  }, []);
  const unregister = useCallback((v: string) => {
    setLabels((m) => {
      if (!m.has(v)) return m;
      const next = new Map(m);
      next.delete(v);
      return next;
    });
  }, []);

  // close on outside pointer / escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const ctx = useMemo<SelectContextValue>(
    () => ({
      value: current,
      open,
      setOpen,
      select,
      register,
      unregister,
      labelFor: (v) => (v === undefined ? undefined : labels.get(v)),
      triggerId: `${baseId}-trigger`,
      listId: `${baseId}-list`,
      disabled,
      placement,
      setPlacement,
    }),
    [current, open, select, register, unregister, labels, baseId, disabled, placement],
  );

  return (
    <SelectContext.Provider value={ctx}>
      <div ref={rootRef} className={cn("relative", className)}>
        {children}
      </div>
    </SelectContext.Provider>
  );
}

export interface SelectTriggerProps {
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export function SelectTrigger({
  className,
  children,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: SelectTriggerProps) {
  const ctx = useSelectContext("SelectTrigger");
  return (
    <button
      type="button"
      id={ctx.triggerId}
      disabled={ctx.disabled}
      aria-haspopup="listbox"
      aria-expanded={ctx.open}
      aria-controls={ctx.listId}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      onClick={() => ctx.setOpen(!ctx.open)}
      className={cn(
        "flex h-9 w-full items-center justify-between gap-2 rounded-[4px] bg-muted pl-3 pr-2 text-sm text-foreground outline-none transition-colors duration-150",
        "hover:bg-border focus-visible:shadow-[inset_0_0_0_2px_var(--color-foreground)]",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      {children}
      <ChevronDownIcon size={18} aria-hidden="true" className="shrink-0 text-muted-foreground" />
    </button>
  );
}

export interface SelectValueProps {
  placeholder?: string;
  className?: string;
}

export function SelectValue({ placeholder, className }: SelectValueProps) {
  const ctx = useSelectContext("SelectValue");
  const label = ctx.labelFor(ctx.value);
  return (
    <span
      className={cn(
        "min-w-0 truncate",
        label ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      {label ?? placeholder ?? "Select"}
    </span>
  );
}

export interface SelectContentProps {
  className?: string;
  children: ReactNode;
}

export function SelectContent({ className, children }: SelectContentProps) {
  const ctx = useSelectContext("SelectContent");
  const listRef = useRef<HTMLDivElement>(null);
  const { open, setPlacement, triggerId } = ctx;

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = document.getElementById(triggerId);
    const node = listRef.current;
    if (!trigger || !node) return;

    // Flip upward when there isn't room below and there's more above.
    const rect = trigger.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const above = rect.top;
    setPlacement(below < node.offsetHeight + 16 && above > below ? "top" : "bottom");

    // Opening onto the top of a capped list hides the current choice; this scrolls it into
    // view. Measured against the list itself rather than via offsetTop, which answers relative
    // to the positioned root and would count the trigger as part of the scroll offset.
    const selected = node.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!selected) return;
    const offset = selected.getBoundingClientRect().top - node.getBoundingClientRect().top;
    node.scrollTop += offset - (node.clientHeight - selected.offsetHeight) / 2;
  }, [open, triggerId, setPlacement]);

  // Items stay mounted while closed so each item's label registration persists — otherwise
  // the trigger would fall back to the placeholder the moment the menu closes.
  return (
    <div
      ref={listRef}
      id={ctx.listId}
      role="listbox"
      aria-labelledby={ctx.triggerId}
      hidden={!open}
      // overscroll-contain: a list at its end must not hand the wheel to the page behind it.
      style={{ maxHeight: MAX_LIST_HEIGHT }}
      className={cn(
        "absolute left-0 right-0 z-20 flex flex-col overflow-y-auto overscroll-contain rounded-[6px] bg-card p-1.5 shadow-[inset_0_0_0_1px_var(--color-border)]",
        ctx.placement === "top" ? "bottom-full mb-1" : "top-full mt-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface SelectItemProps {
  value: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export function SelectItem({
  value,
  disabled = false,
  className,
  children,
}: SelectItemProps) {
  const ctx = useSelectContext("SelectItem");
  const selected = ctx.value === value;
  const label = typeof children === "string" ? children : value;

  useLayoutEffect(() => {
    ctx.register(value, label);
    return () => ctx.unregister(value);
  }, [ctx.register, ctx.unregister, value, label]);

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      onClick={() => ctx.select(value)}
      className={cn(
        "flex h-9 w-full shrink-0 items-center justify-between gap-2 rounded-[4px] px-2.5 text-left text-sm text-foreground outline-none transition-colors duration-150",
        "hover:bg-muted focus-visible:bg-muted",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      {selected ? <CheckIcon size={16} aria-hidden="true" className="shrink-0" /> : null}
    </button>
  );
}
