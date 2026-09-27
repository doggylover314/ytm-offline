"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
  /** Associates the control with descriptive text elsewhere in the row. */
  "aria-labelledby"?: string;
}

/** 36x20 track with a 14px square knob: grey and left when off, accent and right when on. */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
  className,
  "aria-labelledby": ariaLabelledBy,
}: SwitchProps) {
  const id = useId();

  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={ariaLabelledBy}
        disabled={disabled}
        onClick={() => !disabled && onCheckedChange(!checked)}
        data-state={checked ? "checked" : "unchecked"}
        className={cn(
          "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-[3px] p-[3px] outline-none transition-colors duration-150",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
          "disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-primary" : "bg-[#333333]",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none block size-3.5 rounded-[2px] transition-[transform,background-color] duration-150",
            checked ? "translate-x-4 bg-white" : "translate-x-0 bg-foreground",
          )}
        />
      </button>
      {label ? (
        <label htmlFor={id} className="cursor-pointer text-sm text-foreground">
          {label}
        </label>
      ) : null}
    </span>
  );
}
