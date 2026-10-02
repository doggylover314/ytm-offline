import { invoke } from "@tauri-apps/api/core";
import { logInternalDebug, logInternalWarn } from "../internal/logging";
import {
  getDiscordPresenceEnabled,
  setDiscordPresenceEnabled,
} from "../ui/settings/discord";

export interface DiscordPresenceData {
  title: string;
  artist: string;
  album: string;
  artworkUrl?: string;
  songUrl?: string;
  artistUrl?: string;
  albumUrl?: string;
  duration: number; // in seconds
  currentTime: number; // in seconds
  isPlaying: boolean;
}

const DISCORD_TEXT_LIMIT = 128;
const DISCORD_ASSET_URL_LIMIT = 256;
const TRUSTED_ARTWORK_HOSTS = new Set([
  "i.ytimg.com",
  "lh3.googleusercontent.com",
  "yt3.ggpht.com",
]);
const TRUSTED_PRESENCE_LINK_HOSTS = new Set([
  "music.youtube.com",
  "youtube.com",
  "www.youtube.com",
]);

function sanitizeDiscordText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= DISCORD_TEXT_LIMIT) return text;
  return `${text.slice(0, DISCORD_TEXT_LIMIT - 3)}...`;
}

function sanitizeArtworkUrl(value?: string): string | undefined {
  if (!value) return undefined;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return undefined;
    if (!TRUSTED_ARTWORK_HOSTS.has(parsed.hostname)) return undefined;
    const url = parsed.toString();
    if (url.length > DISCORD_ASSET_URL_LIMIT) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function sanitizePresenceLink(value?: string): string | undefined {
  if (!value) return undefined;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return undefined;
    if (!TRUSTED_PRESENCE_LINK_HOSTS.has(parsed.hostname)) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

/** Identity of a presence payload for dedupe purposes — everything but `currentTime`. */
export function presenceDedupeKey(data: DiscordPresenceData): string {
  const { currentTime: _currentTime, ...rest } = data;
  return JSON.stringify(rest);
}

/** A seek further than this from where Discord's clock says the song is gets sent. */
const SEEK_TOLERANCE_SEC = 2;
/** How often a presence that could not be delivered (Discord closed, say) is tried again. */
const RETRY_MS = 15_000;

export interface SentPresence {
  key: string;
  /** When the song started by the wall clock, in seconds; null while paused. */
  startedAt: number | null;
}

/**
 * Whether `next` differs from what Discord shows. Discord runs the clock itself from a start
 * time, so the position only matters when it no longer agrees with that clock: after a seek.
 */
export function presenceNeedsSending(
  sent: SentPresence | null,
  next: DiscordPresenceData,
  nowSec: number,
): boolean {
  if (!sent || sent.key !== presenceDedupeKey(next)) return true;
  if (!next.isPlaying || sent.startedAt === null) return false;
  return Math.abs(nowSec - next.currentTime - sent.startedAt) > SEEK_TOLERANCE_SEC;
}

function sanitizePresenceData(data: DiscordPresenceData): DiscordPresenceData {
  return {
    title: sanitizeDiscordText(data.title),
    artist: sanitizeDiscordText(data.artist),
    album: sanitizeDiscordText(data.album),
    artworkUrl: sanitizeArtworkUrl(data.artworkUrl),
    songUrl: sanitizePresenceLink(data.songUrl),
    artistUrl: sanitizePresenceLink(data.artistUrl),
    albumUrl: sanitizePresenceLink(data.albumUrl),
    duration: Math.max(0, Math.floor(Number.isFinite(data.duration) ? data.duration : 0)),
    currentTime: Math.max(0, Math.floor(Number.isFinite(data.currentTime) ? data.currentTime : 0)),
    isPlaying: data.isPlaying,
  };
}

/**
 * Manages Discord Rich Presence integration
 * Calls Tauri commands that handle the actual Discord connection in Rust
 */
export class DiscordRpcService {
  /**
   * Read per call rather than cached, so toggling the setting takes effect on the next track
   * update without anything having to notify this service.
   */
  private static get isEnabled(): boolean {
    return getDiscordPresenceEnabled();
  }

  /**
   * The last payload actually sent, everything but `currentTime`.
   *
   * `PlayerController.emit()` fires on every state change — a queue reorder, a rate change, a
   * sleep timer — most of which leave the track and play state untouched. Discord runs its own
   * clock off the timestamps `discord_rpc.rs` derives from `currentTime`, so it never needed
   * repolling either; comparing on everything else and always excluding `currentTime` is what
   * turns those into no-ops instead of a fresh IPC round trip (and a jittered progress bar) on
   * every unrelated change.
   */
  private static lastSent: SentPresence | null = null;

  /**
   * What should be showing, kept so a send that failed can be repeated: Discord starting or
   * restarting mid-song used to leave presence empty until the next song.
   */
  private static wanted: { data: DiscordPresenceData; at: number } | null = null;
  private static retryTimer: number | null = null;

  private static cancelRetry(): void {
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private static scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      const wanted = this.wanted;
      if (!wanted || !this.isEnabled) return;
      // Where the song is now, not where it was when the first attempt failed.
      const elapsed = wanted.data.isPlaying ? (Date.now() - wanted.at) / 1000 : 0;
      void this.updatePresence({ ...wanted.data, currentTime: wanted.data.currentTime + elapsed });
    }, RETRY_MS);
  }

  /**
   * Initialize Discord RPC
   * The actual connection happens on the Rust backend
   */
  static async init(): Promise<void> {
    logInternalDebug("Discord.init", { message: "Rust backend will handle connection" });
  }

  /**
   * Stops publishing presence and wipes whatever is already showing.
   *
   * Turning the setting off has to clear as well as stop: presence persists on Discord's side
   * until something replaces it, so without this the last track stays on the user's profile
   * indefinitely — the opposite of what switching it off is asking for.
   */
  static async setEnabled(enabled: boolean): Promise<void> {
    setDiscordPresenceEnabled(enabled);
    if (enabled) return;

    this.wanted = null;
    this.cancelRetry();
    try {
      await invoke("discord_rpc_clear");
      this.lastSent = null;
      logInternalDebug("Discord.setEnabled cleared presence", {});
    } catch (error) {
      logInternalWarn("Discord.setEnabled.clearFailed", error as Record<string, unknown>);
    }
  }

  /**
   * Update Discord presence with current track information
   * @param data The current track and playback information
   */
  static async updatePresence(data: DiscordPresenceData): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    const safeData = sanitizePresenceData(data);
    const nowSec = Date.now() / 1000;
    this.wanted = { data: safeData, at: Date.now() };
    if (!presenceNeedsSending(this.lastSent, safeData, nowSec)) return;

    try {
      logInternalDebug("Discord.updatePresence", {
        title: safeData.title,
        artist: safeData.artist,
        isPlaying: safeData.isPlaying,
      });

      // Call Tauri command to update presence in Rust backend
      await invoke("discord_rpc_update", {
        title: safeData.title,
        artist: safeData.artist,
        album: safeData.album,
        artworkUrl: safeData.artworkUrl,
        songUrl: safeData.songUrl,
        artistUrl: safeData.artistUrl,
        albumUrl: safeData.albumUrl,
        duration: safeData.duration,
        currentTime: safeData.currentTime,
        isPlaying: safeData.isPlaying,
      });

      this.lastSent = {
        key: presenceDedupeKey(safeData),
        startedAt: safeData.isPlaying ? nowSec - safeData.currentTime : null,
      };
      this.cancelRetry();
      logInternalDebug("Discord.updatePresence.success", {});
    } catch (error) {
      // Not running, restarting or busy: nothing is showing, so it is tried again shortly.
      this.lastSent = null;
      this.scheduleRetry();
      logInternalDebug("Discord.updatePresence.failed", { error: String((error as { message?: string })?.message ?? error) });
    }
  }
  /**
   * Clear Discord presence (show as idle)
   */
  static async clearPresence(): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    this.wanted = null;
    this.cancelRetry();
    try {
      logInternalDebug("Discord.clearPresence", {});
      await invoke("discord_rpc_clear");
      // The next real track has to go out even if it matches whatever was showing before
      // the clear.
      this.lastSent = null;
      logInternalDebug("Discord.clearPresence.success", {});
    } catch (error) {
      logInternalWarn("Discord.clearPresence.failed", error as Record<string, unknown>);
    }
  }
}

export default DiscordRpcService;
