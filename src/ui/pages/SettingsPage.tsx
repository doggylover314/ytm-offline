import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
} from "react";
import { Switch } from "@/components/motion/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { RangeSlider } from "@/components/motion/range-slider";
import { setEqualizerEnabled, useEqualizerEnabled } from "../settings/equalizer";
import { EqualizerPanel } from "../components/Equalizer";
import {
  MAX_CROSSFADE_SEC,
  setCrossfadeSec,
  setGaplessEnabled,
  useCrossfadeSec,
  useGaplessEnabled,
} from "../settings/playbackTransitions";
import {
  setSessionRestoreEnabled,
  useSessionRestoreEnabled,
} from "../settings/sessionRestore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/motion/select";
import {
  BugIcon,
  FolderAddIcon,
  FolderIcon,
  FolderOpenIcon,
  LastFmIcon,
  LogFileIcon,
  LogoutIcon,
  RefreshIcon,
  StarIcon,
  TrashIcon,
} from "@/ui/icons";
import { ACCENT_PRESETS, setAccentColor, useAccentColor } from "../settings/accent";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  checkForUpdates,
  getUpdateFailureMessage,
  getInstalledVersion,
  type UpdateInfo,
} from "../../internal/updateChecker";
import {
  clearCache,
  DEFAULT_CACHE_SIZE_GB,
  getCacheStats,
  setCacheMaxBytes,
  type CacheStats,
} from "../../internal/cache";
import type { LibraryController, LibraryState } from "../../player/LibraryController";
import {
  getAutostartEnabled,
  setAutostartEnabled,
} from "../settings/autostart";
import {
  setCompactPlayerBar,
  useCompactPlayerBar,
} from "../settings/playerControls";
import {
  RENDER_EFFECTS,
  setEffectDisabled,
  setPotatoPcMode,
  useEffectDisabled,
  usePotatoPcMode,
} from "../settings/renderEffects";
import { GoogleSignInButton } from "../components/GoogleSignInButton";
import { DownloadLocationSetting } from "../components/DownloadLocationSetting";
import { ExternalLinkButton } from "../components/ExternalLinkButton";
import {
  AUTO_LYRICS_SOURCE,
  setPreferredLyricsSourceId,
  usePreferredLyricsSourceId,
} from "../../internal/lyricsSourcePreference";
import { LYRICS_SOURCES } from "../../datasource/youtube/lyricsSources";
import {
  LYRICS_FONT_SCALES,
  setLyricsFontScale,
  useLyricsFontScale,
} from "../settings/lyricsFontScale";
import {
  TRANSLATION_LANGUAGES,
  TRANSLATION_OFF,
  getLanguageLabel,
  setLyricsTranslationLang,
  useLyricsTranslationLang,
} from "../settings/lyricsTranslation";
import {
  setForceWindowControls,
  setNativeWindowControls,
  useForceWindowControls,
  useNativeWindowControls,
} from "../settings/windowControls";
import {
  setMainWindowGeometryPersistenceEnabled,
  useMainWindowGeometryPersistenceEnabled,
} from "../settings/mainWindowGeometry";
import {
  setLinuxMediaSession,
  useLinuxMediaSession,
} from "../settings/mediaSession";
import {
  setAuthenticatedStreaming,
  setYouTubeScrobbling,
  useAuthenticatedStreaming,
  useYouTubeScrobbling,
} from "../settings/youtubeAccount";
import {
  AUDIO_ENGINE_MODES,
  setAudioEngineMode,
  useAudioEngineMode,
  type AudioEngineMode,
} from "../settings/audioEngine";
import {
  listOutputDevices,
  setOutputDevice,
  SYSTEM_DEFAULT_DEVICE,
  useOutputDevice,
  type OutputDevice,
} from "../settings/audioOutputDevice";
import {
  captureKeyboardShortcut,
  formatKeyboardShortcut,
  KEYBOARD_SHORTCUT_ACTIONS,
  resetKeyboardShortcut,
  resetKeyboardShortcuts,
  setKeyboardShortcut,
  useKeyboardShortcuts,
  type KeyboardShortcutAction,
} from "../settings/keyboardShortcuts";
import {
  addLocalPlaylistPath,
  createLocalPlaylist,
  deleteLocalPlaylist,
  getLocalPlaylists,
  removeLocalPlaylistPath,
  subscribeToLocalPlaylists,
} from "../../player/localPlaylists";
import { LastFmService, useLastFmProblem, type LastFmAuthStart, type LastFmSessionStatus } from "../../player/LastFm";
import { DiscordRpcService } from "../../player/DiscordRPC";
import { useDiscordPresenceEnabled } from "../settings/discord";
import {
  setLastFmScrobblingEnabled,
  useLastFmScrobblingEnabled,
} from "../settings/lastfm";
import { isLinux, isTilingWindowManager, subscribeTilingWindowManager } from "../platform";
import { GITHUB_NEW_ISSUE_URL, GITHUB_REPOSITORY_URL } from "../links";
import { AccountAvatar, AccountSwitcher, AddGoogleAccountButton, GoogleAccountSwitcher } from "../components/AccountSwitcher";
import {
  AUDIO_QUALITY_LABELS,
  setDownloadQuality,
  setStreamingQuality,
  useDownloadQuality,
  useStreamingQuality,
  type AudioQuality,
} from "../../internal/audioQuality";
import {
  getOfflineMaxBytes,
  setOfflineMaxBytes,
  useOfflineState,
} from "../../player/offlineStore";
import { removeAllDownloadsAndStopSyncing } from "../../player/playlistSync";
import { formatBytes, formatSongCount } from "@/lib/format";
import { ConfirmDialog } from "../components/ConfirmDialog";

/*
 * Layout, from the approved design: each section is a title over a stack of rows, 2px apart,
 * in a 6px-cornered group. A row is chrome grey with its label on the left and control on the
 * right. The group does not clip (`overflow-hidden` would cut off Select menus, which drop
 * down inside the row), so its first and last rows round their own outer corners.
 */
const SETTINGS_GROUP =
  "flex flex-col gap-0.5 [&>*:first-child]:rounded-t-lg [&>*:last-child]:rounded-b-lg";
const SETTINGS_ROW = "flex flex-col gap-3 bg-chrome px-5 py-4";
const ROW_TITLE = "text-sm font-semibold text-foreground";
const ROW_DESCRIPTION = "text-[13px] text-muted-foreground";
const ROW_ERROR = "text-[13px] text-destructive";

const BUTTON_BASE =
  "flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-4 text-sm font-medium transition-colors has-[svg]:pl-3 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const BUTTON_PRIMARY = cn(BUTTON_BASE, "bg-foreground text-background hover:bg-white");
const BUTTON_SECONDARY = cn(BUTTON_BASE, "bg-muted text-foreground hover:bg-border");
const BUTTON_PLAIN = cn(BUTTON_BASE, "text-foreground hover:bg-card");
const BUTTON_DESTRUCTIVE = cn(BUTTON_BASE, "bg-muted text-destructive hover:bg-border");
const ICON_BUTTON =
  "grid size-9 shrink-0 place-items-center rounded text-foreground transition-colors hover:bg-card disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/**
 * How long ago YouTube last answered as this account, in words.
 *
 * Deliberately visible rather than internal: with no telemetry, this one line is what turns
 * "liking songs stopped working" into a report somebody can act on.
 */
function formatSessionAge(confirmedAt: number | null): string {
  if (confirmedAt === null) return "not yet";
  const minutes = Math.floor((Date.now() - confirmedAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

/** Text field, sunk into the row: page black on chrome grey. */
const SETTINGS_FIELD =
  "h-9 min-w-0 rounded bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-inset focus:ring-ring";

/** A number field with its unit, e.g. "GB", inside the same sunken box. */
const UNIT_FIELD =
  "flex h-9 w-[120px] items-center gap-1.5 rounded bg-background px-3 text-sm text-foreground focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring";

/**
 * One section: a title and its group of rows. The first section on a page carries the page's
 * 32px title; the rest are 24px.
 */
function SettingsSection({
  id,
  title,
  first = false,
  note,
  children,
}: {
  id: string;
  title: string;
  first?: boolean;
  /** A line under the group that applies to all of it. */
  note?: ReactNode;
  children: ReactNode;
}) {
  const Heading = first ? "h1" : "h2";
  return (
    <section className="flex flex-col gap-4" aria-labelledby={id}>
      <Heading
        id={id}
        className={cn(
          "font-semibold text-foreground",
          first ? "text-[32px] leading-tight" : "text-2xl",
        )}
      >
        {title}
      </Heading>
      <div className={SETTINGS_GROUP}>{children}</div>
      {note ? <p className={ROW_DESCRIPTION}>{note}</p> : null}
    </section>
  );
}

/** The equaliser row. The switch is a bypass: off dims the curve but leaves it editable. */
function EqualizerSettings({ engineMode }: { engineMode: AudioEngineMode }) {
  const enabled = useEqualizerEnabled();
  // Only the Rust engine has the samples; the YouTube fallback plays unequalised.
  const available = engineMode === "rust";

  return (
    <SettingRow
      title="Equaliser"
      description={
        available
          ? "Ten bands, shaped live on the track that is playing."
          : "Needs the Rust playback method."
      }
      below={<EqualizerPanel disabled={!available} />}
    >
      {(labelId) => (
        <Switch
          checked={enabled}
          onCheckedChange={setEqualizerEnabled}
          disabled={!available}
          aria-labelledby={labelId}
        />
      )}
    </SettingRow>
  );
}

/**
 * Which sound card the Rust engine writes to.
 *
 * Only the Rust engine opens one itself — the IFrame and native paths play through the webview
 * and follow whatever the OS default routes to, same as any other browser tab.
 */
function OutputDeviceSetting({ engineMode }: { engineMode: AudioEngineMode }) {
  const selected = useOutputDevice();
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  const available = engineMode === "rust";

  useEffect(() => {
    let cancelled = false;
    listOutputDevices()
      .then((found) => {
        if (!cancelled) setDevices(found);
      })
      // The row still works with an empty list — it just offers nothing but "System default".
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SettingRow
      title="Output device"
      description="Which sound card the Rust engine plays to."
      disabled={!available}
    >
      {(labelId) => (
        <Select
          className="w-52"
          value={selected ?? SYSTEM_DEFAULT_DEVICE}
          onValueChange={(value) => {
            setOutputDevice(value === SYSTEM_DEFAULT_DEVICE ? null : value);
          }}
        >
          <SelectTrigger aria-labelledby={labelId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SYSTEM_DEFAULT_DEVICE}>System default</SelectItem>
            {devices.map((device) => (
              <SelectItem key={device.id} value={device.id}>
                {device.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </SettingRow>
  );
}

/**
 * One settings row: label and description on the left, control on the right, and optionally
 * more content (an error, an expanded editor) underneath inside the same row.
 *
 * The wrapper is a `div`, not a `label`, because the controls are buttons (`role="switch"`,
 * `role="listbox"`) rather than native inputs — a button inside a label gets its activation
 * swallowed by the label's own click forwarding. The association is made explicitly instead,
 * via `aria-labelledby` on the control, so screen readers still announce the row title when
 * the control takes focus.
 */
function SettingRow({
  title,
  description,
  disabled,
  below,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  below?: ReactNode;
  /** Receives the id of the row title so the control can point `aria-labelledby` at it. */
  children?: (labelId: string) => ReactNode;
}) {
  const labelId = useId();
  return (
    <div className={cn(SETTINGS_ROW, disabled && "pointer-events-none opacity-50")}>
      <div className="flex items-center justify-between gap-4">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span id={labelId} className={ROW_TITLE}>
            {title}
          </span>
          {description ? <span className={ROW_DESCRIPTION}>{description}</span> : null}
        </span>
        {children ? (
          <span className="flex shrink-0 items-center gap-2">{children(labelId)}</span>
        ) : null}
      </div>
      {below}
    </div>
  );
}

/**
 * The Motion & performance rows.
 *
 * One switch for the blunt version, and a Manage disclosure for the eleven behind it. The
 * individual switches are a debugging instrument — you flip one, watch the GPU, flip it back —
 * and eleven of them sitting open in Settings read as eleven decisions the user has to make.
 */
function PotatoPcSettings() {
  const potatoPcMode = usePotatoPcMode();
  const [isManaging, setIsManaging] = useState(false);
  const panelId = useId();

  return (
    <>
      <SettingRow
        title="Potato PC"
        description="Turns off animations, blur, shadows and the ambient artwork, and switches to opaque surfaces. Manage picks them off one at a time."
      >
        {(labelId) => (
          <>
            <button
              type="button"
              onClick={() => setIsManaging((current) => !current)}
              aria-expanded={isManaging}
              aria-controls={panelId}
              className={BUTTON_PLAIN}
            >
              {isManaging ? "Done" : "Manage"}
            </button>
            <Switch
              checked={potatoPcMode}
              onCheckedChange={setPotatoPcMode}
              aria-labelledby={labelId}
            />
          </>
        )}
      </SettingRow>

      {isManaging && (
        <div id={panelId} className="flex flex-col gap-0.5 [&>*:last-child]:rounded-b-lg">
          <p className={cn(SETTINGS_ROW, ROW_DESCRIPTION)}>
            One switch per effect. Turn them off one at a time to find which one your machine is
            paying for.
          </p>
          {RENDER_EFFECTS.map((effect) => (
            <RenderEffectToggle key={effect.id} effect={effect} />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Its own component so each row holds its own subscription rather than one per effect here.
 *
 * The switch reads as "effect on", the store as "effect disabled" — inverted here rather than
 * in the store, because the attribute the CSS matches on is a list of what is *off*, and an
 * empty list has to mean "nothing disabled" for a fresh install to look normal.
 */
function RenderEffectToggle({ effect }: { effect: (typeof RENDER_EFFECTS)[number] }) {
  const disabled = useEffectDisabled(effect.id);
  return (
    <SettingToggle
      title={effect.label}
      description={effect.description}
      checked={!disabled}
      onCheckedChange={(checked) => setEffectDisabled(effect.id, !checked)}
    />
  );
}

/** The common case: a row whose only control is a switch. */
function SettingToggle({
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
  below,
}: {
  title: string;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  below?: ReactNode;
}) {
  return (
    <SettingRow title={title} description={description} disabled={disabled} below={below}>
      {(labelId) => (
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          aria-labelledby={labelId}
        />
      )}
    </SettingRow>
  );
}

/**
 * Accent colour: the design's seven swatches, plus a Custom button over the native colour
 * picker so a colour chosen before the swatches existed can still be kept or changed.
 */
function AccentColorSetting() {
  const accentColor = useAccentColor();
  const current = accentColor.toLowerCase();
  const isCustom = !ACCENT_PRESETS.some((preset) => preset.value === current);

  return (
    <SettingRow title="Accent colour" description="Used for progress bars and switches.">
      {(labelId) => (
        <>
          <div role="radiogroup" aria-labelledby={labelId} className="flex items-center">
            {ACCENT_PRESETS.map((preset) => {
              const selected = preset.value === current;
              return (
                /* The selected swatch gets a 2px page-black gap and a 2px white edge. Drawn with
                   a border and padding rather than a ring: rings are box-shadows, which the
                   Potato PC "shadows" switch removes. */
                <button
                  key={preset.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={preset.name}
                  title={preset.name}
                  onClick={() => setAccentColor(preset.value)}
                  className={cn(
                    "grid size-9 place-items-center rounded-lg border-2 p-[2px]",
                    selected ? "border-foreground bg-background" : "border-transparent",
                  )}
                >
                  <span className="size-7 rounded" style={{ background: preset.value }} />
                </button>
              );
            })}
          </div>
          <label
            className={cn(
              BUTTON_SECONDARY,
              "relative ml-2 cursor-pointer focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring",
            )}
            title="Pick any colour"
          >
            {isCustom && (
              <span
                className="size-3.5 rounded-[2px]"
                style={{ background: accentColor }}
                aria-hidden="true"
              />
            )}
            {isCustom ? accentColor.toUpperCase() : "Custom…"}
            <input
              type="color"
              value={accentColor}
              onChange={(event) => setAccentColor(event.target.value)}
              aria-label="Custom accent colour"
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
          </label>
        </>
      )}
    </SettingRow>
  );
}

type SettingsTab =
  | "account"
  | "playback"
  | "downloads"
  | "lyrics"
  | "library"
  | "appearance"
  | "window"
  | "shortcuts"
  | "integrations"
  | "about";

type WindowControlStyle = "app" | "native";

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "account", label: "Account" },
  { id: "playback", label: "Playback" },
  { id: "downloads", label: "Downloads" },
  { id: "lyrics", label: "Lyrics" },
  { id: "library", label: "Local files" },
  { id: "appearance", label: "Appearance" },
  { id: "window", label: "Window" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "integrations", label: "Integrations" },
  { id: "about", label: "About" },
];

interface SettingsPageProps {
  libraryController: LibraryController;
  libraryState: LibraryState;
  onSignIn: () => Promise<void>;
  onDeleteAllAppData: () => Promise<void>;
}

export function SettingsPage({
  libraryController,
  libraryState,
  onSignIn,
  onDeleteAllAppData,
}: SettingsPageProps) {
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [cacheSizeGb, setCacheSizeGb] = useState(DEFAULT_CACHE_SIZE_GB.toString());
  const [cacheBusy, setCacheBusy] = useState(false);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);
  const [updateResult, setUpdateResult] = useState<UpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "checking" | "current" | "error"
  >("idle");
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [autostartEnabled, setAutostartEnabledState] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(true);
  const [autostartError, setAutostartError] = useState<string | null>(null);
  const [logOpening, setLogOpening] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [isConfirmingDeleteAll, setIsConfirmingDeleteAll] = useState(false);
  const [resetSettingsBusy, setResetSettingsBusy] = useState(false);
  const [resetSettingsError, setResetSettingsError] = useState<string | null>(null);
  const [localPlaylistName, setLocalPlaylistName] = useState("");
  const [localPlaylistPathInputs, setLocalPlaylistPathInputs] = useState<Record<string, string>>({});
  const [localPlaylistError, setLocalPlaylistError] = useState<string | null>(null);
  const [localPlaylistBrowsingId, setLocalPlaylistBrowsingId] = useState<string | null>(null);
  const [lastFmSession, setLastFmSession] = useState<LastFmSessionStatus | null>(null);
  const [lastFmAuth, setLastFmAuth] = useState<LastFmAuthStart | null>(null);
  const [lastFmBusy, setLastFmBusy] = useState(false);
  const [lastFmError, setLastFmError] = useState<string | null>(null);
  const lastFmProblem = useLastFmProblem();
  const [activeTab, setActiveTab] = useState<SettingsTab>("account");
  const [listeningShortcut, setListeningShortcut] = useState<KeyboardShortcutAction | null>(null);
  const keyboardShortcuts = useKeyboardShortcuts();
  const audioEngineMode = useAudioEngineMode();
  const authenticatedStreaming = useAuthenticatedStreaming();
  const youtubeScrobbling = useYouTubeScrobbling();
  const preferredLyricsSource = usePreferredLyricsSourceId();
  const lyricsFontScale = useLyricsFontScale();
  const lyricsTranslationLang = useLyricsTranslationLang();
  const crossfadeSec = useCrossfadeSec();
  const gaplessEnabled = useGaplessEnabled();
  const sessionRestoreEnabled = useSessionRestoreEnabled();
  const compactPlayerBar = useCompactPlayerBar();
  const nativeWindowControls = useNativeWindowControls();
  const forceWindowControls = useForceWindowControls();
  const tilingWindowManager = useSyncExternalStore(
    subscribeTilingWindowManager,
    isTilingWindowManager,
    () => false,
  );
  const windowControlStyle: WindowControlStyle = nativeWindowControls ? "native" : "app";
  const handleWindowControlStyleChange = (style: WindowControlStyle) => {
    const goingNative = style === "native";
    if (goingNative === nativeWindowControls) return;
    setNativeWindowControls(goingNative);
    // GTK decorations don't reliably flip live on Linux, so this style needs a fresh window.
    if (isLinux) void relaunch().catch(() => window.location.reload());
  };
  const mainWindowGeometryPersistenceEnabled = useMainWindowGeometryPersistenceEnabled();
  const linuxMediaSession = useLinuxMediaSession();
  const offlineState = useOfflineState();
  const streamingQuality = useStreamingQuality();
  const downloadQuality = useDownloadQuality();
  const [offlineMaxGb, setOfflineMaxGb] = useState(
    () => Number.isFinite(getOfflineMaxBytes()) ? getOfflineMaxBytes() / 1024 ** 3 : 0,
  );
  const [clearingDownloads, setClearingDownloads] = useState(false);
  const [isConfirmingRemoveAll, setIsConfirmingRemoveAll] = useState(false);
  const lastFmScrobblingEnabled = useLastFmScrobblingEnabled();
  const discordPresenceEnabled = useDiscordPresenceEnabled();
  const localPlaylists = useSyncExternalStore(
    subscribeToLocalPlaylists,
    getLocalPlaylists,
    getLocalPlaylists,
  );
  const account = libraryState.library?.account;
  // Confirmed by YouTube rather than inferred from cached data — see LibraryState.
  const isSignedIn = libraryState.status === "ready"
    && account
    && libraryState.sessionConfirmedAt !== null;
  const authBusy = libraryState.status === "restoring"
    || libraryState.status === "authorizing"
    || libraryState.status === "loading";

  useEffect(() => {
    let active = true;
    void getCacheStats()
      .then((stats) => {
        if (!active) return;
        setCacheStats(stats);
        setCacheSizeGb((stats.maxBytes / 1024 ** 3).toString());
      })
      .catch(() => {
        if (active) setCacheError("Unable to load cache settings.");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void getInstalledVersion()
      .then((version) => {
        if (active) setInstalledVersion(version);
      })
      .catch(() => {
        if (active) setInstalledVersion("Unknown");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void LastFmService.getSession()
      .then((session) => {
        if (active) setLastFmSession(session);
      })
      .catch((error) => {
        if (active) {
          setLastFmError(error instanceof Error ? error.message : "Unable to load Last.fm connection.");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const handleCheckForUpdates = async () => {
    setUpdateStatus("checking");
    setUpdateResult(null);
    setUpdateError(null);
    try {
      const update = await checkForUpdates();
      setUpdateResult(update);
      setUpdateStatus(update ? "idle" : "current");
    } catch (error) {
      setUpdateError(getUpdateFailureMessage(error));
      setUpdateStatus("error");
    }
  };

  useEffect(() => {
    let active = true;
    void getAutostartEnabled()
      .then((enabled) => {
        if (active) setAutostartEnabledState(enabled);
      })
      .catch(() => {
        if (active) setAutostartError("Unable to load the startup setting.");
      })
      .finally(() => {
        if (active) setAutostartLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleAutostartChange = async (enabled: boolean) => {
    setAutostartLoading(true);
    setAutostartError(null);
    try {
      await setAutostartEnabled(enabled);
      setAutostartEnabledState(enabled);
    } catch {
      setAutostartError("Unable to update the startup setting.");
    } finally {
      setAutostartLoading(false);
    }
  };

  const handleOpenLog = async () => {
    setLogOpening(true);
    setLogError(null);
    try {
      await invoke("open_current_log");
    } catch {
      setLogError("Unable to open the log file.");
    } finally {
      setLogOpening(false);
    }
  };

  const saveCacheSize = async () => {
    const sizeGb = Number(cacheSizeGb);
    if (!Number.isFinite(sizeGb) || sizeGb < 0.25 || sizeGb > 64) {
      setCacheError("Cache size must be between 0.25 GB and 64 GB.");
      return;
    }

    setCacheBusy(true);
    setCacheError(null);
    try {
      setCacheStats(await setCacheMaxBytes(Math.round(sizeGb * 1024 ** 3)));
    } catch {
      setCacheError("Unable to save the cache size.");
    } finally {
      setCacheBusy(false);
    }
  };

  const handleClearCache = async () => {
    setCacheBusy(true);
    setCacheError(null);
    try {
      setCacheStats(await clearCache());
    } catch {
      setCacheError("Unable to clear cached content.");
    } finally {
      setCacheBusy(false);
    }
  };

  const handleClearAllSettings = async () => {
    setResetSettingsError(null);
    setIsConfirmingDeleteAll(false);
    setResetSettingsBusy(true);
    try {
      await onDeleteAllAppData();
      await relaunch().catch(() => {
        window.location.reload();
      });
    } catch {
      setResetSettingsError("Some app data couldn't be deleted. Restart the app and try again.");
      setResetSettingsBusy(false);
    }
  };

  const handleCreateLocalPlaylist = () => {
    setLocalPlaylistError(null);
    try {
      createLocalPlaylist(localPlaylistName);
      setLocalPlaylistName("");
    } catch (error) {
      setLocalPlaylistError(error instanceof Error ? error.message : "Unable to create local playlist.");
    }
  };

  const handleStartLastFmAuth = async () => {
    setLastFmBusy(true);
    setLastFmError(null);
    try {
      const auth = await LastFmService.startAuth();
      setLastFmAuth(auth);
    } catch (error) {
      setLastFmError(error instanceof Error ? error.message : "Unable to start Last.fm sign-in.");
    } finally {
      setLastFmBusy(false);
    }
  };

  const handleFinishLastFmAuth = async () => {
    if (!lastFmAuth) return;
    setLastFmBusy(true);
    setLastFmError(null);
    try {
      const session = await LastFmService.completeAuth(lastFmAuth.token);
      setLastFmSession(session);
      setLastFmAuth(null);
      setLastFmScrobblingEnabled(true);
    } catch (error) {
      setLastFmError(error instanceof Error ? error.message : "Unable to finish Last.fm sign-in.");
    } finally {
      setLastFmBusy(false);
    }
  };

  const handleDisconnectLastFm = async () => {
    setLastFmBusy(true);
    setLastFmError(null);
    try {
      await LastFmService.disconnect();
      setLastFmSession(null);
      setLastFmAuth(null);
    } catch (error) {
      setLastFmError(error instanceof Error ? error.message : "Unable to disconnect Last.fm.");
    } finally {
      setLastFmBusy(false);
    }
  };

  const handleAddLocalPlaylistPath = (playlistId: string) => {
    setLocalPlaylistError(null);
    const path = localPlaylistPathInputs[playlistId]?.trim() ?? "";
    if (!path) {
      setLocalPlaylistError("Enter a folder path before adding it.");
      return;
    }
    addLocalPlaylistPath(playlistId, path);
    setLocalPlaylistPathInputs((current) => ({ ...current, [playlistId]: "" }));
  };

  const handleBrowseLocalPlaylistPath = async (playlistId: string) => {
    setLocalPlaylistError(null);
    setLocalPlaylistBrowsingId(playlistId);
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "Choose music folder",
      });
      if (typeof selected !== "string") return;
      addLocalPlaylistPath(playlistId, selected);
      setLocalPlaylistPathInputs((current) => ({
        ...current,
        [playlistId]: "",
      }));
    } catch {
      setLocalPlaylistError("Unable to open the folder picker.");
    } finally {
      setLocalPlaylistBrowsingId(null);
    }
  };

  const handleShortcutCapture = (
    event: KeyboardEvent<HTMLButtonElement>,
    action: KeyboardShortcutAction,
  ) => {
    if (listeningShortcut !== action) return;

    event.preventDefault();
    event.stopPropagation();

    if (event.code === "Escape") {
      setListeningShortcut(null);
      return;
    }

    const shortcut = captureKeyboardShortcut(event.nativeEvent);
    if (!shortcut) return;

    setKeyboardShortcut(action, shortcut);
    setListeningShortcut(null);
  };

  useEffect(() => {
    if (!listeningShortcut) return undefined;

    const handleShortcutKeyDown = (event: globalThis.KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      if (event.code === "Escape") {
        setListeningShortcut(null);
        return;
      }

      const shortcut = captureKeyboardShortcut(event);
      if (!shortcut) return;

      setKeyboardShortcut(listeningShortcut, shortcut);
      setListeningShortcut(null);
    };

    window.addEventListener("keydown", handleShortcutKeyDown, true);
    return () => window.removeEventListener("keydown", handleShortcutKeyDown, true);
  }, [listeningShortcut]);

  const downloadedCount = Object.keys(offlineState.entries).length;
  const activeTabLabel = SETTINGS_TABS.find((tab) => tab.id === activeTab)?.label ?? "Settings";

  return (
    <main className="flex min-h-0 flex-1 items-start">
      {/* The nav sticks so the sections stay reachable while a long panel scrolls. */}
      <nav
        className="sticky top-0 flex w-[240px] shrink-0 flex-col gap-0.5 px-4 py-8"
        role="tablist"
        aria-label="Settings sections"
        aria-orientation="vertical"
      >
        {SETTINGS_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex h-9 shrink-0 items-center rounded px-3 text-left text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                isActive
                  ? "bg-card text-foreground"
                  : "text-muted-foreground hover:bg-card hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      <div
        className="flex min-w-0 max-w-[860px] flex-1 flex-col gap-10 py-8 pl-6 pr-12"
        role="tabpanel"
        aria-label={`${activeTabLabel} settings`}
      >
      {activeTab === "account" && (
        <SettingsSection id="account-settings-title" title="Account" first>
          <div className={SETTINGS_ROW}>
            {/* `min-w-0 flex-1` on the text column: without it a long channel name pushes the
                button off the right edge instead of truncating. */}
            <div className="flex items-center justify-between gap-4">
              <AccountAvatar artworkUrl={account?.artworkUrl} className="size-10" iconSize={22} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={cn(ROW_TITLE, "truncate")}>
                  {isSignedIn ? account?.name || "YouTube Music" : "Not signed in"}
                </span>
                <span className={cn(ROW_DESCRIPTION, "truncate")}>
                  {isSignedIn
                    ? `Signed in to YouTube Music. Session confirmed ${formatSessionAge(libraryState.sessionConfirmedAt)}.`
                    : "Sign in to load your library."}
                </span>
              </div>
              {isSignedIn ? (
                <button
                  className={BUTTON_SECONDARY}
                  type="button"
                  onClick={() => void libraryController.signOut()}
                >
                  <LogoutIcon size={18} />
                  Sign out
                </button>
              ) : (
                <GoogleSignInButton isBusy={authBusy} onClick={() => void onSignIn()} />
              )}
            </div>
            {libraryState.error && <p className={ROW_ERROR}>{libraryState.error}</p>}
          </div>

          {/* Separate Google logins, not channels — always shown once signed in, since this
              is where a second account gets added, not just switched to. */}
          {isSignedIn && (
            <SettingRow
              title="Accounts"
              below={
                <div className="-mx-2 flex flex-col gap-0.5">
                  <GoogleAccountSwitcher
                    libraryController={libraryController}
                    showSingle
                    allowRemove
                  />
                  <AddGoogleAccountButton disabled={authBusy} onClick={() => void onSignIn()} />
                </div>
              }
            />
          )}

          {isSignedIn && (
            <SettingRow
              title="Channel"
              below={
                <AccountSwitcher
                  libraryController={libraryController}
                  showSingle
                  className="-mx-2"
                />
              }
            />
          )}
        </SettingsSection>
      )}

      {activeTab === "playback" && (
        <>
          <SettingsSection
            id="playback-engine-title"
            title="Playback"
            first
            note="The playback method applies from the next track."
          >
            <SettingRow
              title="Playback method"
              description={
                audioEngineMode === "native"
                  ? "YTM Offline plays each track itself. Lighter on memory, but slower to start and without gapless playback or crossfade."
                  : "A hidden YouTube frame plays each track. Costs about 90 MB, starts faster, required for gapless and crossfade."
              }
            >
              {() => (
                <Select
                  className="w-52"
                  value={audioEngineMode}
                  onValueChange={(value) => setAudioEngineMode(value as AudioEngineMode)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUDIO_ENGINE_MODES.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </SettingRow>

            <OutputDeviceSetting engineMode={audioEngineMode} />

            <SettingRow
              title="Streaming quality"
              description="Applies to songs played over the network. Lower uses less data."
            >
              {(labelId) => (
                <Select
                  className="w-52"
                  value={streamingQuality}
                  onValueChange={(value) => setStreamingQuality(value as AudioQuality)}
                >
                  <SelectTrigger aria-labelledby={labelId}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(AUDIO_QUALITY_LABELS) as AudioQuality[]).map((quality) => (
                      <SelectItem key={quality} value={quality}>
                        {AUDIO_QUALITY_LABELS[quality]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </SettingRow>

            <SettingToggle
              title="Resolve streams as your account"
              description="Attaches your session when resolving a track — required for Premium bitrates. Downloads always resolve anonymously."
              checked={authenticatedStreaming}
              onCheckedChange={setAuthenticatedStreaming}
            />

            <SettingToggle
              title="Add plays to YouTube Music history"
              description="Reports plays to YouTube, feeding its recommendations. Also enables the setting above. The YouTube frame always reports its own."
              checked={youtubeScrobbling}
              onCheckedChange={(enabled) => {
                // Paired here rather than inside the setter, so the toolbar shortcut can flip
                // scrobbling on its own without silently changing stream resolution too.
                setYouTubeScrobbling(enabled);
                setAuthenticatedStreaming(enabled);
              }}
            />
          </SettingsSection>

          <SettingsSection id="equalizer-settings-title" title="Equaliser">
            <EqualizerSettings engineMode={audioEngineMode} />
          </SettingsSection>

          {/*
            Crossfading a downloaded track is not possible: offline files play through an
            audio element rather than the deck pair the overlap needs. Saying so beats
            leaving people to wonder why it only sometimes works.
          */}
          <SettingsSection
            id="playback-settings-title"
            title="Transitions"
            note="Both apply to streamed tracks. Downloaded and local files always play back to back."
          >
            <SettingToggle
              title="Gapless playback"
              description="Load the next track while the current one is still playing, so albums and live sets run without a pause between songs."
              checked={gaplessEnabled}
              onCheckedChange={setGaplessEnabled}
            />

            <SettingRow
              title="Crossfade"
              description={
                crossfadeSec > 0
                  ? `Overlap each track with the next by ${crossfadeSec} second${
                    crossfadeSec === 1 ? "" : "s"
                  }.`
                  : "Off. Move the slider to overlap the end of each track with the start of the next."
              }
            >
              {(labelId) => (
                <span className="flex items-center gap-3">
                  <RangeSlider
                    className="w-44"
                    value={crossfadeSec}
                    min={0}
                    max={MAX_CROSSFADE_SEC}
                    step={1}
                    onValueChange={setCrossfadeSec}
                    aria-label="Crossfade length in seconds"
                  />
                  <span
                    id={labelId}
                    className="w-10 shrink-0 text-right text-sm tabular-nums text-muted-foreground"
                  >
                    {crossfadeSec > 0 ? `${crossfadeSec}s` : "Off"}
                  </span>
                </span>
              )}
            </SettingRow>
          </SettingsSection>

          <SettingsSection id="session-settings-title" title="Session">
            <SettingToggle
              title="Restore tabs and queues"
              description="Reopen your tabs, queues and playback position on launch. Playback always starts paused."
              checked={sessionRestoreEnabled}
              onCheckedChange={setSessionRestoreEnabled}
            />
          </SettingsSection>
        </>
      )}

      {activeTab === "downloads" && (
        <>
          <SettingsSection id="library-storage-title" title="Downloads" first>
            <DownloadLocationSetting hasDownloads={downloadedCount > 0} />

            <SettingRow
              title="Download quality"
              description="Applies to songs saved for offline. Higher sounds better and uses more disk."
            >
              {(labelId) => (
                <Select
                  className="w-52"
                  value={downloadQuality}
                  onValueChange={(value) => setDownloadQuality(value as AudioQuality)}
                >
                  <SelectTrigger aria-labelledby={labelId}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(AUDIO_QUALITY_LABELS) as AudioQuality[]).map((quality) => (
                      <SelectItem key={quality} value={quality}>
                        {AUDIO_QUALITY_LABELS[quality]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </SettingRow>

            <SettingRow title="Storage limit" description="0 means no limit.">
              {() => (
                <label className={UNIT_FIELD}>
                  <input
                    className="w-full min-w-0 bg-transparent tabular-nums outline-none"
                    type="number"
                    min={0}
                    value={Math.round(offlineMaxGb)}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (!Number.isFinite(next)) return;
                      setOfflineMaxGb(next);
                      setOfflineMaxBytes(Math.max(0, next) * 1024 ** 3);
                    }}
                    aria-label="Maximum download size in gigabytes, zero for unlimited"
                  />
                  <span className="shrink-0 text-[13px] text-muted-foreground">GB</span>
                </label>
              )}
            </SettingRow>

            <SettingRow
              title="Remove all downloads"
              description={
                <span className="tabular-nums">
                  {offlineState.usedBytes > 0 || downloadedCount > 0
                    ? `${formatSongCount(downloadedCount)} · ${formatBytes(offlineState.usedBytes)}`
                    : "No songs downloaded yet."}
                  {offlineState.downloadingId
                    ? offlineState.progress !== null
                      ? ` · downloading ${offlineState.progress}%`
                      : " · downloading"
                    : ""}
                  {offlineState.queued.length > 0
                    ? ` · ${offlineState.queued.length} queued`
                    : ""}
                </span>
              }
            >
              {() => (
                <>
                  <button
                    className={BUTTON_DESTRUCTIVE}
                    type="button"
                    disabled={clearingDownloads || downloadedCount === 0}
                    onClick={() => setIsConfirmingRemoveAll(true)}
                  >
                    {clearingDownloads ? "Removing..." : "Remove all"}
                  </button>
                  <ConfirmDialog
                    open={isConfirmingRemoveAll}
                    title="Remove all downloads?"
                    confirmLabel="Remove all"
                    destructive
                    onCancel={() => setIsConfirmingRemoveAll(false)}
                    onConfirm={() => {
                      setIsConfirmingRemoveAll(false);
                      setClearingDownloads(true);
                      void removeAllDownloadsAndStopSyncing().finally(() => setClearingDownloads(false));
                    }}
                  >
                    {`All ${formatSongCount(downloadedCount)} (${formatBytes(offlineState.usedBytes)}) will be deleted from this computer, and downloaded playlists will stop syncing. Your playlists stay in your library.`}
                  </ConfirmDialog>
                </>
              )}
            </SettingRow>
          </SettingsSection>

          <SettingsSection id="library-cache-title" title="Cache">
            <SettingRow
              title="Cache"
              description={
                <span className="tabular-nums">
                  {cacheStats
                    ? `${formatBytes(cacheStats.usedBytes)} of ${formatBytes(cacheStats.maxBytes)}`
                    : "Loading…"}
                  {cacheStats ? ` · ${cacheStats.entryCount} items` : ""}
                </span>
              }
              below={cacheError && <p className={ROW_ERROR}>{cacheError}</p>}
            >
              {() => (
                <>
                  <label className={UNIT_FIELD}>
                    <input
                      className="w-full min-w-0 bg-transparent tabular-nums outline-none"
                      type="number"
                      min="0.25"
                      max="64"
                      step="0.25"
                      value={cacheSizeGb}
                      disabled={cacheBusy}
                      onChange={(event) => setCacheSizeGb(event.target.value)}
                      aria-label="Maximum cache size in gigabytes"
                    />
                    <span className="shrink-0 text-[13px] text-muted-foreground">GB</span>
                  </label>
                  <button
                    className={BUTTON_SECONDARY}
                    type="button"
                    disabled={cacheBusy}
                    onClick={() => void saveCacheSize()}
                  >
                    Save
                  </button>
                  <button
                    className={BUTTON_DESTRUCTIVE}
                    type="button"
                    disabled={cacheBusy}
                    onClick={() => void handleClearCache()}
                  >
                    Clear cache
                  </button>
                </>
              )}
            </SettingRow>
          </SettingsSection>
        </>
      )}

      {activeTab === "lyrics" && (
        <SettingsSection id="library-lyrics-title" title="Lyrics" first>
          <SettingRow
            title="Translate lyrics"
            description="Shows a translation under each line. Sends the lyrics to Google Translate."
          >
            {(labelId) => (
              <Select
                className="w-52"
                value={lyricsTranslationLang}
                onValueChange={setLyricsTranslationLang}
              >
                <SelectTrigger aria-labelledby={labelId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TRANSLATION_OFF}>Off</SelectItem>
                  {TRANSLATION_LANGUAGES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {getLanguageLabel(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </SettingRow>

          <SettingRow
            title="Lyrics text size"
            description="Scales the lyrics screen. The size still adapts to the window on top of this."
          >
            {(labelId) => (
              <Select
                className="w-52"
                value={String(lyricsFontScale)}
                onValueChange={(value) => setLyricsFontScale(Number(value))}
              >
                <SelectTrigger aria-labelledby={labelId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LYRICS_FONT_SCALES.map((option) => (
                    <SelectItem key={option.value} value={String(option.value)}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </SettingRow>

          <SettingRow
            title="Preferred lyrics source"
            description="Tried first when a song opens. If it has nothing for that song, the others still run."
          >
            {(labelId) => (
              <Select
                className="w-52"
                value={preferredLyricsSource}
                onValueChange={setPreferredLyricsSourceId}
              >
                <SelectTrigger aria-labelledby={labelId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO_LYRICS_SOURCE}>Automatic</SelectItem>
                  {LYRICS_SOURCES.map((source) => (
                    <SelectItem key={source.id} value={source.id}>
                      {source.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </SettingRow>
        </SettingsSection>
      )}

      {activeTab === "library" && (
        <SettingsSection id="library-local-title" title="Local files" first>
          <SettingRow
            title="Local playlists"
            description="Create playlists from folders on this computer."
            below={localPlaylistError && <p className={ROW_ERROR}>{localPlaylistError}</p>}
          >
            {() => (
              <>
                <input
                  className={cn(SETTINGS_FIELD, "w-44")}
                  type="text"
                  value={localPlaylistName}
                  placeholder="Playlist name"
                  aria-label="Local playlist name"
                  onChange={(event) => setLocalPlaylistName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleCreateLocalPlaylist();
                  }}
                />
                <button
                  className={BUTTON_SECONDARY}
                  type="button"
                  onClick={handleCreateLocalPlaylist}
                >
                  <FolderAddIcon size={18} />
                  Create
                </button>
              </>
            )}
          </SettingRow>

          {localPlaylists.map((playlist) => (
            <SettingRow
              key={playlist.id}
              title={
                <span className="flex min-w-0 items-center gap-2">
                  <FolderIcon size={18} aria-hidden="true" className="shrink-0" />
                  <span className="truncate">{playlist.name}</span>
                </span>
              }
              below={
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      className={cn(SETTINGS_FIELD, "flex-1 font-mono text-[13px]")}
                      type="text"
                      value={localPlaylistPathInputs[playlist.id] ?? ""}
                      placeholder="/Users/name/Music"
                      aria-label={`Folder path for ${playlist.name}`}
                      onChange={(event) => setLocalPlaylistPathInputs((current) => ({
                        ...current,
                        [playlist.id]: event.target.value,
                      }))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") handleAddLocalPlaylistPath(playlist.id);
                      }}
                    />
                    <button
                      type="button"
                      className={BUTTON_SECONDARY}
                      disabled={localPlaylistBrowsingId === playlist.id}
                      title="Browse for folder"
                      aria-label={`Browse for a folder for ${playlist.name}`}
                      onClick={() => void handleBrowseLocalPlaylistPath(playlist.id)}
                    >
                      <FolderOpenIcon size={18} aria-hidden="true" />
                      Browse…
                    </button>
                    <button
                      className={BUTTON_SECONDARY}
                      type="button"
                      onClick={() => handleAddLocalPlaylistPath(playlist.id)}
                    >
                      Add
                    </button>
                  </div>

                  {playlist.paths.length > 0 ? (
                    <div className="flex flex-col gap-0.5">
                      {playlist.paths.map((path) => (
                        <div
                          className="flex h-9 items-center justify-between gap-3 rounded bg-background pl-3"
                          key={path}
                        >
                          <span className="truncate font-mono text-[13px] text-foreground">{path}</span>
                          <button
                            type="button"
                            className={ICON_BUTTON}
                            aria-label={`Remove ${path}`}
                            onClick={() => removeLocalPlaylistPath(playlist.id, path)}
                          >
                            <TrashIcon size={16} aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className={ROW_DESCRIPTION}>No paths added yet.</p>
                  )}
                </div>
              }
            >
              {() => (
                <button
                  className={BUTTON_DESTRUCTIVE}
                  type="button"
                  onClick={() => deleteLocalPlaylist(playlist.id)}
                >
                  Delete
                </button>
              )}
            </SettingRow>
          ))}
        </SettingsSection>
      )}

      {activeTab === "appearance" && (
        <>
          <SettingsSection id="accent-settings-title" title="Appearance" first>
            <AccentColorSetting />
          </SettingsSection>

          <SettingsSection id="behavior-settings-title" title="Player bar">
            <SettingToggle
              title="Compact player bar"
              description="Tuck the seek bar under the transport controls instead of spanning the full width."
              checked={compactPlayerBar}
              onCheckedChange={setCompactPlayerBar}
            />
          </SettingsSection>

          <SettingsSection
            id="motion-settings-title"
            title="Motion and performance"
            note="Turn these off on low-powered machines."
          >
            <PotatoPcSettings />
          </SettingsSection>
        </>
      )}

      {activeTab === "window" && (
        <>
          <SettingsSection id="window-settings-title" title="Window" first>
            <SettingRow
              title="Window controls"
              description={isLinux
                ? "How minimize, maximize and close are drawn. Switching OS native restarts the app."
                : "How minimize, maximize and close are drawn."}
            >
              {(labelId) => (
                <div role="group" aria-labelledby={labelId}>
                  <Tabs
                    value={windowControlStyle}
                    onValueChange={(value) =>
                      handleWindowControlStyleChange(value as WindowControlStyle)}
                    variant="segment"
                  >
                    <TabsList>
                      <TabsTrigger value="app">App</TabsTrigger>
                      <TabsTrigger value="native">OS native</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              )}
            </SettingRow>

            {/* Only reachable when it does something: hidden once native chrome takes over,
                and off tiling compositors the buttons already show without this. */}
            {isLinux && tilingWindowManager && windowControlStyle !== "native" && (
              <SettingToggle
                title="Show on this compositor"
                description="Tiling compositors don't draw window buttons for apps, so they're hidden by default. Turn this on to show them anyway."
                checked={forceWindowControls}
                onCheckedChange={setForceWindowControls}
              />
            )}

            {isLinux && (
              <SettingToggle
                title="Show in system media controls"
                description="Expose playback to the desktop's media widget and media keys (MPRIS). Turning this off stops the now-playing notifications some desktops show."
                checked={linuxMediaSession}
                onCheckedChange={setLinuxMediaSession}
              />
            )}

            <SettingToggle
              title="Remember window size and location"
              description="Reopen the main window with its last size and screen position."
              checked={mainWindowGeometryPersistenceEnabled}
              onCheckedChange={setMainWindowGeometryPersistenceEnabled}
            />
          </SettingsSection>

          <SettingsSection id="library-system-title" title="System">
            <SettingToggle
              title="Launch at startup"
              description="Start YTM Offline when your computer starts."
              checked={autostartEnabled}
              disabled={autostartLoading}
              onCheckedChange={(checked) => void handleAutostartChange(checked)}
              below={autostartError && <p className={ROW_ERROR}>{autostartError}</p>}
            />

          </SettingsSection>
        </>
      )}

      {activeTab === "shortcuts" && (
        <SettingsSection id="keyboard-shortcuts-settings-title" title="Shortcuts" first>
          <SettingRow
            title="Reset shortcuts"
            description="Restore every keyboard shortcut to its default."
          >
            {() => (
              <button className={BUTTON_SECONDARY} type="button" onClick={resetKeyboardShortcuts}>
                <RefreshIcon size={18} />
                Reset all
              </button>
            )}
          </SettingRow>

          {KEYBOARD_SHORTCUT_ACTIONS.map((shortcutAction) => {
            const shortcut = keyboardShortcuts[shortcutAction.id];
            const isListening = listeningShortcut === shortcutAction.id;

            return (
              <SettingRow
                key={shortcutAction.id}
                title={shortcutAction.label}
                description={shortcutAction.description}
              >
                {() => (
                  <>
                    <button
                      className={cn(
                        "h-9 min-w-32 rounded px-3 text-center text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        isListening ? "bg-foreground text-background" : "bg-background text-foreground",
                      )}
                      type="button"
                      aria-pressed={isListening}
                      onClick={() => setListeningShortcut(shortcutAction.id)}
                      onKeyDown={(event) => handleShortcutCapture(event, shortcutAction.id)}
                      onBlur={() => {
                        if (isListening) setListeningShortcut(null);
                      }}
                    >
                      {isListening ? "Press shortcut..." : formatKeyboardShortcut(shortcut)}
                    </button>
                    <button
                      className={BUTTON_PLAIN}
                      type="button"
                      onClick={() => resetKeyboardShortcut(shortcutAction.id)}
                    >
                      Reset
                    </button>
                    <button
                      className={BUTTON_PLAIN}
                      type="button"
                      disabled={!shortcut}
                      onClick={() => setKeyboardShortcut(shortcutAction.id, null)}
                    >
                      Clear
                    </button>
                  </>
                )}
              </SettingRow>
            );
          })}
        </SettingsSection>
      )}

      {activeTab === "integrations" && (
        <>
          <SettingsSection id="lastfm-settings-title" title="Last.fm" first>
            <SettingRow
              title={lastFmSession ? `Connected as ${lastFmSession.username}` : "Account connection"}
              description={
                lastFmAuth
                  ? "Approve the connection in your browser, then finish it here."
                  : lastFmSession
                    ? "Disconnecting stops future Last.fm updates from this app."
                    : "Connect Last.fm to scrobble your listening history. A browser window will open so you can approve this app."
              }
              below={(lastFmError ?? lastFmProblem) && <p className={ROW_ERROR}>{lastFmError ?? lastFmProblem}</p>}
            >
              {() => lastFmSession ? (
                <button
                  className={BUTTON_SECONDARY}
                  type="button"
                  disabled={lastFmBusy}
                  onClick={() => void handleDisconnectLastFm()}
                >
                  <LastFmIcon size={18} />
                  {lastFmBusy ? "Disconnecting..." : "Disconnect"}
                </button>
              ) : lastFmAuth ? (
                <button
                  className={BUTTON_PRIMARY}
                  type="button"
                  disabled={lastFmBusy}
                  onClick={() => void handleFinishLastFmAuth()}
                >
                  <LastFmIcon size={18} />
                  {lastFmBusy ? "Finishing..." : "Finish connection"}
                </button>
              ) : (
                <button
                  className={BUTTON_PRIMARY}
                  type="button"
                  disabled={lastFmBusy}
                  onClick={() => void handleStartLastFmAuth()}
                >
                  <LastFmIcon size={18} />
                  {lastFmBusy ? "Opening..." : "Connect Last.fm"}
                </button>
              )}
            </SettingRow>

            <SettingToggle
              title="Scrobble plays"
              description="Send now playing updates and scrobbles after a track reaches the Last.fm listening threshold."
              checked={lastFmSession ? lastFmScrobblingEnabled : false}
              disabled={!lastFmSession}
              onCheckedChange={setLastFmScrobblingEnabled}
            />
          </SettingsSection>

          <SettingsSection id="discord-settings-title" title="Discord">
            <SettingToggle
              title="Show what you're playing"
              description="Publishes the current track, artist and artwork to your Discord profile. Turning this off clears whatever is showing there now."
              checked={discordPresenceEnabled}
              onCheckedChange={(enabled) => void DiscordRpcService.setEnabled(enabled)}
            />
          </SettingsSection>
        </>
      )}

      {activeTab === "about" && (
        <>
          <SettingsSection id="about-settings-title" title="About" first>
            <SettingRow
              title="Updates"
              description={`Installed version: ${
                installedVersion
                  ? installedVersion === "Unknown" ? installedVersion : `v${installedVersion}`
                  : "Loading..."
              }`}
              below={
                <>
                  {updateResult && (
                    <div className="flex items-center justify-between gap-4 rounded bg-card py-2 pl-4 pr-2">
                      <span className="text-sm text-foreground">
                        {`Version ${updateResult.version} is available.`}
                      </span>
                      {/* The one link where a silent failure strands the user: if this cannot
                          open, they have no other route to the download. */}
                      <ExternalLinkButton label="Download" url={updateResult.releaseUrl} />
                    </div>
                  )}
                  {updateStatus === "current" && (
                    <p className={ROW_DESCRIPTION}>You are up to date.</p>
                  )}
                  {updateStatus === "error" && <p className={ROW_ERROR}>{updateError}</p>}
                </>
              }
            >
              {() => (
                <button
                  className={BUTTON_SECONDARY}
                  type="button"
                  disabled={updateStatus === "checking"}
                  onClick={() => void handleCheckForUpdates()}
                >
                  <RefreshIcon size={18} />
                  {updateStatus === "checking" ? "Checking..." : "Check for updates"}
                </button>
              )}
            </SettingRow>

            <SettingRow title="Project" description="Source code and issue tracker on GitHub.">
              {() => (
                <>
                  <ExternalLinkButton
                    icon={<StarIcon size={18} aria-hidden="true" />}
                    label="Star on GitHub"
                    url={GITHUB_REPOSITORY_URL}
                  />
                  <ExternalLinkButton
                    icon={<BugIcon size={18} aria-hidden="true" />}
                    label="Report an issue"
                    url={GITHUB_NEW_ISSUE_URL}
                  />
                </>
              )}
            </SettingRow>
          </SettingsSection>

          <SettingsSection id="library-trouble-title" title="Troubleshooting">
            <SettingRow
              title="Application log"
              description="Open the current log file for sharing or troubleshooting."
              below={logError && <p className={ROW_ERROR}>{logError}</p>}
            >
              {() => (
                <button
                  className={BUTTON_SECONDARY}
                  type="button"
                  disabled={logOpening}
                  onClick={() => void handleOpenLog()}
                >
                  <LogFileIcon size={18} />
                  {logOpening ? "Opening..." : "Open log"}
                </button>
              )}
            </SettingRow>

            <SettingRow
              title="Delete all app data"
              description="Downloads, settings, cache, and the Google and Last.fm sign-ins on this computer."
              below={resetSettingsError && <p className={ROW_ERROR}>{resetSettingsError}</p>}
            >
              {() => (
                <>
                  <button
                    className={BUTTON_DESTRUCTIVE}
                    type="button"
                    disabled={resetSettingsBusy}
                    onClick={() => setIsConfirmingDeleteAll(true)}
                  >
                    {resetSettingsBusy ? "Deleting..." : "Delete everything"}
                  </button>
                  <ConfirmDialog
                    open={isConfirmingDeleteAll}
                    title="Delete all app data?"
                    confirmLabel="Delete everything"
                    destructive
                    onCancel={() => setIsConfirmingDeleteAll(false)}
                    onConfirm={() => void handleClearAllSettings()}
                  >
                    {`${downloadedCount > 0 ? `Your ${formatSongCount(downloadedCount)} of downloads (${formatBytes(offlineState.usedBytes)}), ` : ""}settings and cache will be deleted from this computer, and you'll be signed out of Google and Last.fm. Your YouTube Music library isn't affected. The app restarts afterwards.`}
                  </ConfirmDialog>
                </>
              )}
            </SettingRow>
          </SettingsSection>
        </>
      )}
      </div>
    </main>
  );
}
