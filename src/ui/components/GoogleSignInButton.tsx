import { cn } from "@/lib/utils";
import { GoogleIcon } from "@/ui/icons";
import { SpinnerSteps } from "@/components/motion/loader";

interface GoogleSignInButtonProps {
  onClick: () => void;
  /** Shows a spinner and blocks re-entry while a sign-in is already running. */
  isBusy?: boolean;
  disabled?: boolean;
  /** Stretches to the container — for the title-bar panel and the sidebar's empty state. */
  fullWidth?: boolean;
  /**
   * Drops the label for the collapsed sidebar rail, which is 72px wide.
   *
   * The accessible name stays on the button either way, so this only removes the *visible*
   * text — a screen reader still announces "Sign in with Google", and the title attribute
   * gives sighted users the same on hover.
   */
  iconOnly?: boolean;
  /** `lg` is the 44px welcome-screen button. */
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * The one sign-in button, used everywhere signing in is offered.
 *
 * It was three separate buttons, which made the most consequential action in the app look like
 * three different actions. It is now the design's primary button (white, dark label) with
 * Google's four-colour G, which is specified against white and reads as the Google mark at 18px.
 */
export function GoogleSignInButton({
  onClick,
  isBusy = false,
  disabled = false,
  fullWidth = false,
  iconOnly = false,
  size = "md",
  className,
}: GoogleSignInButtonProps) {
  const glyphSize = size === "sm" ? 15 : 18;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isBusy}
      aria-busy={isBusy}
      aria-label="Sign in with Google"
      title="Sign in with Google"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded font-medium",
        "bg-foreground text-background transition-colors hover:bg-white",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-60",
        iconOnly
          ? (size === "sm" ? "size-8" : size === "lg" ? "size-11" : "size-9")
          : cn(
              "gap-2",
              size === "sm"
                ? "h-8 px-3 text-sm"
                : size === "lg"
                  ? "h-11 px-5 text-[15px]"
                  : "h-9 pl-3 pr-4 text-sm",
            ),
        fullWidth && !iconOnly && "w-full",
        className,
      )}
    >
      {isBusy ? <SpinnerSteps size={glyphSize} /> : <GoogleIcon size={glyphSize} />}
      {!iconOnly && (isBusy ? "Connecting…" : "Sign in with Google")}
    </button>
  );
}
