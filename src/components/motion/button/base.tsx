"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "plain"
  | "outline"
  | "destructive";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends Omit<
  HTMLMotionProps<"button">,
  "children"
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** No-op; kept so existing callers compile. Buttons have no press scaling. */
  pressScale?: number;
  /** No-op; kept so existing callers compile. Buttons have no ripple. */
  ripple?: boolean;
  children?: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-foreground text-background hover:bg-white",
  secondary: "bg-muted text-foreground hover:bg-border",
  ghost: "bg-transparent text-foreground hover:bg-card",
  plain: "bg-transparent text-foreground hover:bg-card",
  outline: "bg-transparent text-foreground hover:bg-card",
  destructive: "bg-muted text-destructive hover:bg-border",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-9 px-4 text-sm gap-1.5",
  lg: "h-10 px-5 text-sm gap-2",
  icon: "size-9 p-0",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      pressScale: _pressScale,
      ripple: _ripple,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <motion.button
        ref={ref}
        type="button"
        className={cn(
          "inline-flex shrink-0 select-none items-center justify-center rounded-[4px] font-medium outline-none transition-colors duration-150",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
          "disabled:pointer-events-none disabled:opacity-50",
          VARIANT_CLASS[variant],
          SIZE_CLASS[size],
          className,
        )}
        {...rest}
      >
        {children}
      </motion.button>
    );
  },
);
