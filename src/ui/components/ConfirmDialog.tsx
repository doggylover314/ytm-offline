import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** Red confirm button, for actions that delete something. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A yes/no question before something that cannot be undone, in the approved dialog style:
 * solid, with no dimming behind it. Escape and clicking outside cancel; the safe choice has
 * focus so Enter never deletes anything by accident.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center p-6"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-card p-6 text-card-foreground"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <div className="text-sm leading-relaxed text-muted-foreground">{children}</div>
        <div className="mt-2 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            className="h-9 rounded px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={cn(
              "h-9 rounded px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-card",
              destructive
                ? "bg-destructive text-destructive-foreground focus-visible:ring-destructive"
                : "bg-foreground text-background focus-visible:ring-foreground",
            )}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
