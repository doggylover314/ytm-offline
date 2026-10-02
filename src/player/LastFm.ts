import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Track } from "../datasource/types";
import { logInternalDebug, logInternalWarn } from "../internal/logging";

export interface LastFmAuthStart {
  token: string;
  authUrl: string;
}

export interface LastFmSessionStatus {
  username: string;
}

interface LastFmTrackPayload {
  artist: string;
  track: string;
  album?: string;
  duration?: number;
}

interface LastFmScrobblePayload extends LastFmTrackPayload {
  timestamp: number;
}

type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "error";

interface PlaybackUpdate {
  track: Track | null;
  status: PlaybackStatus;
  currentTime: number;
  duration: number;
  enabled: boolean;
}

interface TrackedTrackState {
  key: string;
  payload: LastFmTrackPayload;
  startTimestamp: number;
  listenedSec: number;
  lastObservedAtMs: number | null;
  nowPlayingSent: boolean;
  scrobbled: boolean;
}

const MIN_SCROBBLE_DURATION_SEC = 31;
const MAX_THRESHOLD_SEC = 240;
/** How soon a session check that failed (the keyring busy, say) is made again. */
const SESSION_RECHECK_MS = 60_000;
/** A song back this close to its start after being scrobbled is being played again. */
const REPLAY_START_SEC = 5;

/*
 * The last thing that went wrong with scrobbling, for Settings to show. Failures used to go to
 * the log only, so a revoked session looked exactly like scrobbling working.
 */
let problem: string | null = null;
const problemListeners = new Set<() => void>();

function setProblem(next: string | null): void {
  if (problem === next) return;
  problem = next;
  for (const listener of problemListeners) listener();
}

export function useLastFmProblem(): string | null {
  return useSyncExternalStore(
    (listener) => {
      problemListeners.add(listener);
      return () => {
        problemListeners.delete(listener);
      };
    },
    () => problem,
    () => null,
  );
}

function cleanText(value?: string): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function createPayload(track: Track, duration: number): LastFmTrackPayload | null {
  const artist = cleanText(track.artist || track.artists?.map((item) => item.name).join(", "));
  const title = cleanText(track.title);
  if (!artist || !title) return null;

  const safeDuration = Number.isFinite(duration) && duration > 0
    ? Math.round(duration)
    : track.durationSec
      ? Math.round(track.durationSec)
      : undefined;

  return {
    artist,
    track: title,
    album: cleanText(track.album) || undefined,
    duration: safeDuration,
  };
}

function trackKey(track: Track, payload: LastFmTrackPayload) {
  return [
    track.source,
    track.id,
    payload.artist.toLowerCase(),
    payload.track.toLowerCase(),
  ].join(":");
}

function scrobbleThreshold(duration?: number): number | null {
  if (!duration || duration < MIN_SCROBBLE_DURATION_SEC) return null;
  return Math.min(MAX_THRESHOLD_SEC, duration / 2);
}

export class LastFmService {
  private static tracked: TrackedTrackState | null = null;
  private static sessionChecked = false;
  private static sessionCheckFailedAt = 0;
  private static hasSession = false;

  static async startAuth(): Promise<LastFmAuthStart> {
    const auth = await invoke<LastFmAuthStart>("lastfm_auth_token");
    await openUrl(auth.authUrl);
    return auth;
  }

  static async completeAuth(token: string): Promise<LastFmSessionStatus> {
    const session = await invoke<LastFmSessionStatus>("lastfm_complete_auth", { token });
    this.sessionChecked = true;
    this.hasSession = true;
    setProblem(null);
    return session;
  }

  static async getSession(): Promise<LastFmSessionStatus | null> {
    const session = await invoke<LastFmSessionStatus | null>("lastfm_get_session");
    this.sessionChecked = true;
    this.hasSession = Boolean(session);
    return session;
  }

  static async disconnect(): Promise<void> {
    await invoke("lastfm_disconnect");
    this.sessionChecked = true;
    this.hasSession = false;
    this.tracked = null;
    setProblem(null);
  }

  static updatePlayback(update: PlaybackUpdate): void {
    if (!update.enabled || !update.track || update.status === "idle" || update.status === "error") {
      this.tracked = null;
      return;
    }

    const payload = createPayload(update.track, update.duration);
    if (!payload) {
      this.tracked = null;
      return;
    }

    const key = trackKey(update.track, payload);
    const nowMs = Date.now();
    // The same song again (repeat one, or played over): a new play to scrobble, not the old one.
    const replayed = this.tracked?.key === key
      && this.tracked.scrobbled
      && update.currentTime < REPLAY_START_SEC;
    if (!this.tracked || this.tracked.key !== key || replayed) {
      this.tracked = {
        key,
        payload,
        startTimestamp: Math.max(0, Math.floor(nowMs / 1000 - Math.max(0, update.currentTime))),
        listenedSec: 0,
        lastObservedAtMs: update.status === "playing" ? nowMs : null,
        nowPlayingSent: false,
        scrobbled: false,
      };
    }

    if (update.status !== "playing") {
      this.tracked.lastObservedAtMs = null;
      return;
    }

    if (this.tracked.lastObservedAtMs !== null) {
      const deltaSec = Math.max(0, Math.min(5, (nowMs - this.tracked.lastObservedAtMs) / 1000));
      this.tracked.listenedSec += deltaSec;
    }
    this.tracked.lastObservedAtMs = nowMs;

    if (!this.tracked.nowPlayingSent) {
      this.tracked.nowPlayingSent = true;
      void this.updateNowPlaying(this.tracked.payload);
    }

    const threshold = scrobbleThreshold(this.tracked.payload.duration);
    if (!threshold || this.tracked.scrobbled || this.tracked.listenedSec < threshold) return;

    this.tracked.scrobbled = true;
    void this.scrobble({
      ...this.tracked.payload,
      timestamp: this.tracked.startTimestamp,
    });
  }

  private static async ensureSession(): Promise<boolean> {
    if (this.sessionChecked) return this.hasSession;
    // A failed check is tried again later, not taken as "not connected" for the rest of the run.
    if (Date.now() - this.sessionCheckFailedAt < SESSION_RECHECK_MS) return false;
    try {
      await this.getSession();
    } catch (error) {
      logInternalWarn("LastFm.sessionCheck.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.sessionCheckFailedAt = Date.now();
      return false;
    }
    return this.hasSession;
  }

  /** Records a failed request; a session Last.fm no longer accepts stops scrobbling. */
  private static reportFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
    if (/invalid session|re-?authenticate/i.test(message)) {
      this.hasSession = false;
      setProblem("Last.fm no longer accepts this connection. Connect again to keep scrobbling.");
      return;
    }
    setProblem(`Scrobbling to Last.fm failed: ${message}`);
  }

  private static async updateNowPlaying(payload: LastFmTrackPayload): Promise<void> {
    if (!await this.ensureSession()) return;
    try {
      await invoke("lastfm_update_now_playing", { input: payload });
      logInternalDebug("LastFm.nowPlaying.success", {
        artist: payload.artist,
        track: payload.track,
      });
    } catch (error) {
      logInternalWarn("LastFm.nowPlaying.failed", {
        error: error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error),
      });
      this.reportFailure(error);
    }
  }

  private static async scrobble(payload: LastFmScrobblePayload): Promise<void> {
    if (!await this.ensureSession()) return;
    try {
      await invoke("lastfm_scrobble", { input: payload });
      setProblem(null);
      logInternalDebug("LastFm.scrobble.success", {
        artist: payload.artist,
        track: payload.track,
      });
    } catch (error) {
      logInternalWarn("LastFm.scrobble.failed", {
        error: error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error),
      });
      this.reportFailure(error);
    }
  }
}
