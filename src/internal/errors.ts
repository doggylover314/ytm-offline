/**
 * Error kinds shared by the download queue, playlist sync and the library.
 *
 * The backend reports download failures as `{ kind, message }` (see offline_download.rs); errors
 * raised in the frontend carry a kind through `KindedError`. Anything else is classified from its
 * message, which is how network failures from `tauriFetch` and youtubei.js are recognised.
 */
export type ErrorKind =
  /** Stopped on request. Not a failure. */
  | "cancelled"
  /** No connection, a stall, or a server hiccup. Retry once the network is back. */
  | "network"
  /** A signed URL was refused. A fresh one usually works. */
  | "expired"
  /** Any other server refusal. */
  | "http"
  /** The download folder could not be written. */
  | "storage"
  /** The server sent something other than what was asked for. */
  | "invalid"
  /** YouTube will not play this track (removed, region-locked, age-gated). */
  | "unavailable"
  | "unknown";

const KINDS: ReadonlySet<string> = new Set<ErrorKind>([
  "cancelled", "network", "expired", "http", "storage", "invalid", "unavailable", "unknown",
]);

export class KindedError extends Error {
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.name = "KindedError";
    this.kind = kind;
  }
}

/*
 * Messages that mean "the network is not there": reqwest's connect and DNS failures as the
 * proxy reports them, a fetch that never got an answer, and the timeouts around both.
 */
const NETWORK_PATTERN =
  /error sending request|dns error|failed to lookup|connection (refused|reset|closed|aborted)|network ?error|networkerror|timed? ?out|the connection stalled|did not answer|failed to fetch|load failed|offline|unreachable|no route to host|temporary failure in name resolution/i;

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

export function errorKind(error: unknown): ErrorKind {
  if (error && typeof error === "object" && "kind" in error) {
    const kind = (error as { kind: unknown }).kind;
    if (typeof kind === "string" && KINDS.has(kind)) return kind as ErrorKind;
  }
  return NETWORK_PATTERN.test(errorMessage(error)) ? "network" : "unknown";
}

export function isNetworkError(error: unknown): boolean {
  return errorKind(error) === "network";
}
