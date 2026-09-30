import { useSyncExternalStore } from "react";
import { tauriFetch } from "../datasource/youtube/tauriFetch";
import { logInternalInfo } from "./logging";

/**
 * Whether the app can reach the internet, shared by the player bar, the download queue,
 * playlist sync and the library.
 *
 * `navigator.onLine` alone is not enough: it only knows whether a network interface is up, so
 * it says "online" on a captive portal, a dead router, or for the first seconds after waking
 * from sleep. A real request decides. Two endpoints so one being blocked does not read as
 * offline; both answer 204 with an empty body.
 */
const CHECK_URLS = ["https://www.gstatic.com/generate_204", "https://cp.cloudflare.com/generate_204"];
/** While offline, how often to look again. */
const OFFLINE_RECHECK_MS = 5_000;
/** Consecutive failed checks before believing the network is gone; one can be a blip. */
const FAILURES_BEFORE_OFFLINE = 2;

// Unknown counts as online: only an explicit "no network" should stop anything.
let online = typeof navigator === "undefined" || navigator.onLine !== false;
let failedChecks = 0;
let running: Promise<boolean> | null = null;
let recheckTimer: number | null = null;
let started = false;
const listeners = new Set<() => void>();

function setOnline(next: boolean): void {
  if (next) failedChecks = 0;
  if (online === next) return;
  online = next;
  logInternalInfo("connectivity changed", { online });
  if (next) {
    if (recheckTimer !== null) window.clearInterval(recheckTimer);
    recheckTimer = null;
  } else if (recheckTimer === null) {
    recheckTimer = window.setInterval(() => void checkConnectivity(), OFFLINE_RECHECK_MS);
  }
  for (const listener of listeners) listener();
}

/** Probes the network now. Concurrent calls share one probe. */
export function checkConnectivity(): Promise<boolean> {
  if (running) return running;
  running = (async () => {
    let reachable = false;
    if (navigator.onLine !== false) {
      const results = await Promise.allSettled(
        CHECK_URLS.map((url) => tauriFetch(url, { cache: "no-store", method: "GET" })),
      );
      reachable = results.some((result) => result.status === "fulfilled");
    }
    if (reachable) {
      setOnline(true);
    } else {
      failedChecks += 1;
      if (failedChecks >= FAILURES_BEFORE_OFFLINE || navigator.onLine === false) {
        setOnline(false);
      } else {
        window.setTimeout(() => void checkConnectivity(), 1_500);
      }
    }
    return reachable;
  })().finally(() => {
    running = null;
  });
  return running;
}

/**
 * Something failed with a network error. The network may be gone, or that one server may be;
 * a probe tells which.
 */
export function reportNetworkFailure(): void {
  void checkConnectivity();
}

export function isOnline(): boolean {
  return online;
}

/** Calls `listener` whenever the answer changes. */
export function subscribeConnectivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Resolves the next time the app is online, or at once if it already is. */
export function whenOnline(): Promise<void> {
  if (online) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = subscribeConnectivity(() => {
      if (!online) return;
      unsubscribe();
      resolve();
    });
  });
}

export function useIsOnline(): boolean {
  return useSyncExternalStore(subscribeConnectivity, isOnline, isOnline);
}

/** Starts watching. Safe to call more than once. */
export function startConnectivityMonitor(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const check = () => void checkConnectivity();
  window.addEventListener("online", check);
  window.addEventListener("offline", check);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
  check();
}
