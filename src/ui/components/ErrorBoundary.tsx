import { Component, type ErrorInfo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { RefreshIcon } from "@/ui/icons";
import { logInternalError } from "../../internal/logging";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Names the region in the log and in the message, e.g. "Library". */
  label: string;
  /**
   * Offered as the recovery action when the region can be left rather than only retried —
   * a page can send you home, the app shell has nowhere to send you.
   */
  onDismiss?: () => void;
  dismissLabel?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Stops one broken subtree from taking the window with it.
 *
 * React unmounts the entire tree on an unhandled render error. In a browser that is a blank
 * tab and a reload button; in a desktop shell it is a permanently blank window with no way
 * back short of quitting, which is what a stale context or a bad API response used to cost.
 *
 * A class because this is the one thing hooks still cannot do — there is no
 * `useErrorBoundary`.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logInternalError("ErrorBoundary caught a render error", {
      label: this.props.label,
      error: error.message,
      stack: error.stack?.slice(0, 2000),
      componentStack: info.componentStack?.slice(0, 2000),
    });
  }

  /*
   * Remounting the subtree is the retry: clearing the error re-renders the children from
   * scratch. It genuinely fixes the common causes — a response that arrived malformed once,
   * a store read during a torn update — and costs nothing when it does not.
   */
  private retry = () => this.setState({ error: null });

  private dismiss = () => {
    this.setState({ error: null });
    this.props.onDismiss?.();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { label, onDismiss, dismissLabel = "Go back" } = this.props;

    return (
      <div
        role="alert"
        className="flex h-full min-h-0 flex-col items-center justify-center gap-4 bg-background p-8 text-center"
      >
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold text-foreground">{label} stopped working</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            The rest of YTM Offline is still running. Try again, and if it keeps happening the details
            are in the internal log.
          </p>
        </div>

        {/* The message, not the stack: a stack in the UI is noise to the person reading it
            and is already in the log for the person debugging it. */}
        <p className="max-w-md break-words rounded bg-card px-3 py-2 font-mono text-xs text-muted-foreground">
          {error.message || "No error message was provided."}
        </p>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className={cn(
              "flex h-9 items-center gap-1.5 rounded bg-foreground pl-3 pr-4 text-sm font-medium text-background",
              "transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
            onClick={this.retry}
          >
            <RefreshIcon size={18} aria-hidden="true" />
            Try again
          </button>
          {onDismiss && (
            <button
              type="button"
              className="h-9 rounded bg-muted px-4 text-sm font-medium text-foreground transition-colors hover:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={this.dismiss}
            >
              {dismissLabel}
            </button>
          )}
        </div>
      </div>
    );
  }
}
