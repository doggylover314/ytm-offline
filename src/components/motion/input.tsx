"use client";

import { CheckIcon } from "@/ui/icons";
import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export type InputClassNames = {
  root?: string;
  label?: string;
  field?: string;
  input?: string;
  leftIcon?: string;
  rightIcon?: string;
  successIcon?: string;
  errorMessage?: string;
};

export interface InputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange"
> {
  label?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Truthy error draws a red edge and (if a string) a message. */
  error?: string | boolean;
  success?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  className?: string;
  classNames?: InputClassNames;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    value: valueProp,
    defaultValue,
    onChange,
    onFocus,
    onBlur,
    error,
    success,
    leftIcon,
    rightIcon,
    className,
    classNames,
    disabled,
    id: idProp,
    type,
    ...rest
  },
  ref,
) {
  const reactId = useId();
  const id = idProp ?? reactId;

  const controlled = valueProp !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? "");
  const value = controlled ? (valueProp ?? "") : internal;

  const [focused, setFocused] = useState(false);

  const hasError = Boolean(error);
  const errorMessage = typeof error === "string" ? error : null;

  // Right edge shows the success check, otherwise the caller's right icon.
  const rightSlot = success ? null : rightIcon;

  const handleChange = (next: string) => {
    if (!controlled) setInternal(next);
    onChange?.(next);
  };

  return (
    <div
      className={cn("flex flex-col gap-1.5", className, classNames?.root)}
    >
      {label ? (
        <label
          htmlFor={id}
          className={cn(
            "px-1 text-sm font-medium text-foreground",
            classNames?.label,
          )}
        >
          {label}
        </label>
      ) : null}

      <div
        data-state={
          hasError
            ? "error"
            : success
              ? "success"
              : focused
                ? "focused"
                : "idle"
        }
        className={cn(
          "relative h-10 overflow-hidden rounded-[4px] bg-card",
          focused && !hasError && "shadow-[inset_0_0_0_2px_var(--color-foreground)]",
          hasError && "shadow-[inset_0_0_0_2px_var(--color-destructive)]",
          disabled && "opacity-50",
          classNames?.field,
        )}
      >
        {leftIcon ? (
          <span
            className={cn(
              "pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 items-center text-muted-foreground [&_svg]:size-[18px]",
              classNames?.leftIcon,
            )}
          >
            {leftIcon}
          </span>
        ) : null}

        <input
          ref={ref}
          id={id}
          type={type}
          value={value}
          disabled={disabled}
          aria-invalid={hasError || undefined}
          aria-describedby={errorMessage ? `${id}-error` : undefined}
          {...rest}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          className={cn(
            "peer h-full w-full bg-transparent text-sm text-foreground caret-foreground outline-none",
            "placeholder:text-muted-foreground",
            leftIcon ? "pl-10" : "pl-3",
            rightSlot || success ? "pr-10" : "pr-3",
            disabled && "cursor-not-allowed",
            classNames?.input,
          )}
        />

        {success ? (
          <CheckIcon
            size={18}
            aria-hidden="true"
            className={cn(
              "absolute right-3 top-1/2 -translate-y-1/2 text-foreground",
              classNames?.successIcon,
            )}
          />
        ) : rightSlot ? (
          <span
            className={cn(
              "absolute right-3 top-1/2 flex -translate-y-1/2 items-center text-muted-foreground [&_svg]:size-[18px]",
              classNames?.rightIcon,
            )}
          >
            {rightSlot}
          </span>
        ) : null}
      </div>

      {errorMessage ? (
        <p
          id={`${id}-error`}
          role="alert"
          className={cn("px-1 text-xs text-destructive", classNames?.errorMessage)}
        >
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
});
