"use client";

import { CheckIcon, CloseIcon } from "@/ui/icons";
import { Loader } from "@/components/motion/loader";
import { forwardRef, type ReactNode } from "react";
import { Button, type ButtonProps } from "./base";

export type ButtonState = "idle" | "loading" | "success" | "error";

export interface StatefulButtonProps extends Omit<ButtonProps, "children"> {
  state?: ButtonState;
  children: ReactNode;
  loadingText?: ReactNode;
  successText?: ReactNode;
  errorText?: ReactNode;
  icon?: ReactNode;
}

/** A button whose label and leading icon follow an async action: idle, loading, success, error. */
export const StatefulButton = forwardRef<HTMLButtonElement, StatefulButtonProps>(function StatefulButton(
  {
    state = "idle",
    children,
    loadingText = "Loading",
    successText = "Done",
    errorText = "Try again",
    icon,
    disabled,
    ...rest
  },
  ref,
) {
  const isBusy = state === "loading";
  const stateText =
    state === "loading"
      ? loadingText
      : state === "success"
        ? successText
        : state === "error"
          ? errorText
          : children;

  const stateIcon =
    state === "loading" ? (
      <Loader variant="spinner" size={16} label="" />
    ) : state === "success" ? (
      <CheckIcon size={16} aria-hidden="true" />
    ) : state === "error" ? (
      <CloseIcon size={16} aria-hidden="true" />
    ) : null;

  return (
    <Button ref={ref} disabled={disabled || isBusy} aria-busy={isBusy} {...rest}>
      <span aria-live="polite" className="inline-flex items-center justify-center gap-1.5">
        {stateIcon ? <span className="inline-grid shrink-0 place-items-center">{stateIcon}</span> : null}
        <span className="whitespace-nowrap">{stateText}</span>
        {state === "idle" && icon ? (
          <span className="inline-grid shrink-0 place-items-center">{icon}</span>
        ) : null}
      </span>
    </Button>
  );
});
