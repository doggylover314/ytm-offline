"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

/** Kept for API compatibility; every variant renders the same rectangular chips. */
type Variant = "pill" | "underline" | "segment";

type Ctx = {
  value: string;
  setValue: (v: string) => void;
  variant: Variant;
};

const TabsCtx = createContext<Ctx | null>(null);

function useTabs() {
  const ctx = useContext(TabsCtx);
  if (!ctx) throw new Error("Tabs.* must be used inside <Tabs>");
  return ctx;
}

export function Tabs({
  defaultValue,
  value,
  onValueChange,
  variant = "pill",
  children,
  className,
}: {
  defaultValue?: string;
  value?: string;
  onValueChange?: (v: string) => void;
  variant?: Variant;
  children: ReactNode;
  className?: string;
}) {
  const [internal, setInternal] = useState(defaultValue ?? "");
  const controlled = value !== undefined;
  const current = controlled ? value : internal;
  const setValue = useCallback(
    (v: string) => {
      if (!controlled) setInternal(v);
      onValueChange?.(v);
    },
    [controlled, onValueChange],
  );
  const contextValue = useMemo(
    () => ({ value: current, setValue, variant }),
    [current, setValue, variant],
  );
  return (
    <TabsCtx.Provider value={contextValue}>
      <div className={className}>{children}</div>
    </TabsCtx.Provider>
  );
}

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="tablist" className={cn("inline-flex items-center gap-2", className)}>
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
  className,
  indicatorClassName,
}: {
  value: string;
  children: ReactNode;
  className?: string;
  /** Extra classes for the selected chip. */
  indicatorClassName?: string;
}) {
  const { value: current, setValue } = useTabs();
  const active = current === value;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => setValue(value)}
      className={cn(
        "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-[4px] px-3 text-[13px] font-medium outline-none transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
        active ? "bg-foreground text-background" : "bg-card text-foreground hover:bg-muted",
        active && indicatorClassName,
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  const { value: current } = useTabs();
  const active = current === value;
  // Inactive panels stay mounted but hidden, so their content stays in the DOM for
  // assistive tech instead of being dropped.
  return (
    <div role="tabpanel" hidden={!active} className={cn(active && "mt-4", className)}>
      {children}
    </div>
  );
}
