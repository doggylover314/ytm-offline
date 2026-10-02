import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { SpinnerSteps } from "@/components/motion/loader";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/motion/popover";
import {
  BackIcon,
  CloseIcon,
  DownloadIcon,
  HeartActiveIcon,
  MoreIcon,
  RefreshIcon,
} from "@/ui/icons";
import type {
  Album,
  Artist,
  BrowsePage as BrowsePageData,
  BrowseSurface,
  BrowseTarget,
  Playlist,
  Track,
} from "../../datasource/types";
import type { LibraryController } from "../../player/LibraryController";
import type { PlayerControllerActions } from "../../player/playerStore";
import { logInternalError } from "../../internal/logging";
import {
  cancelDownload,
  dismissFailedDownload,
  getOfflineLocation,
  MAX_ATTEMPTS,
  resumeDownloads,
  retryFailedDownloads,
  useOfflineState,
  type DownloadFailure,
} from "../../player/offlineStore";
import {
  disablePlaylistSync,
  removeAllDownloadsAndStopSyncing,
  syncAllPlaylists,
  syncedPlaylistDownloadState,
  syncPlaylist,
  useSyncedPlaylists,
  type SyncedPlaylist,
} from "../../player/playlistSync";
import { useIsOnline } from "../../internal/connectivity";
import type { ErrorKind } from "../../internal/errors";
import { formatAgo, formatBytes, formatSongCount } from "@/lib/format";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { BrowseShelves } from "../components/BrowseShelves";
import { TrackArtwork } from "../components/TrackArtwork";
import { TrackRow } from "../components/TrackRow";
import { useTrackContextMenu } from "../components/TrackContextMenu";
import { useNowPlaying } from "../hooks/useNowPlaying";
import { isLikedSongsId } from "../likedSongsArtwork";

/**
 * "downloads" is not a YouTube feed — it reads from the offline store on this machine. It
 * lives here anyway because from the user's side it is the same question ("what can I play?"),
 * and it is the one tab that still works with no connection at all.
 */
export type BrowseTab = BrowseSurface | "downloads";

const SURFACES: Array<{ value: BrowseTab; label: string }> = [
  { value: "explore", label: "Explore" },
  { value: "charts", label: "Charts" },
  { value: "moods", label: "Moods & genres" },
  { value: "podcasts", label: "Podcasts" },
  { value: "downloads", label: "Downloads" },
];

/** Rectangular filter chip; the selected one inverts. */
const CHIP = "h-8 rounded px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const SECONDARY_BUTTON = "flex h-9 shrink-0 items-center gap-1.5 rounded bg-muted px-4 text-sm font-medium text-foreground transition-colors hover:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/** The design's one warning colour, for a sync that is waiting rather than broken. */
const WAITING_TEXT = "text-[#E0B64A]";

/**
 * YouTube Music's browse feeds — explore, charts, moods and podcasts.
 *
 * All four are the same shape (titled shelves of mixed content), so they share one page with
 * a surface switcher rather than becoming four near-identical files. Shelves render by what
 * they actually contain, because a feed row mixes albums, playlists and artists freely and
 * which appears where changes without notice.
 */
export function BrowsePage({
  initialTab = "explore",
  playerController,
  libraryController,
  onOpenAlbum,
  onOpenArtist,
  onOpenPlaylist,
}: {
  /** Which tab to open on. Downloads is reached this way from the home page. */
  initialTab?: BrowseTab;
  playerController: PlayerControllerActions;
  libraryController: LibraryController;
  onOpenAlbum: (album: Album) => void;
  onOpenArtist: (artist: Artist) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
}) {
  const [surface, setSurface] = useState<BrowseTab>(initialTab);
  /*
   * Chips drill into further feeds. Kept as a stack inside this page rather than as new tabs:
   * a mood is a filter of the feed you are already in, not a separate destination, and going
   * back should return you to the shelf you tapped from.
   */
  const [drillDown, setDrillDown] = useState<
    Array<{ browseId: string; title: string; params?: string }>
  >([]);
  const isDownloads = surface === "downloads" && drillDown.length === 0;
  const target: BrowseTarget = drillDown[drillDown.length - 1]
    ?? (surface === "downloads" ? "explore" : surface);
  const [page, setPage] = useState<BrowsePageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Downloads never hits the network, so the feed fetch is skipped entirely.
    if (isDownloads) return;

    let cancelled = false;
    setPage(null);
    setError(null);

    libraryController
      .getBrowsePage(target)
      .then((loaded) => {
        if (!cancelled) setPage(loaded);
      })
      .catch((cause: unknown) => {
        logInternalError("BrowsePage.load failed", cause, { surface });
        if (!cancelled) setError("Could not load this feed.");
      });

    return () => {
      cancelled = true;
    };
  }, [isDownloads, libraryController, target]);

  if (isDownloads) {
    return (
      <DownloadsView
        playerController={playerController}
        libraryController={libraryController}
        onOpenPlaylist={onOpenPlaylist}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 pt-1">
      <header className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          {drillDown.length > 0 && (
            <button
              type="button"
              onClick={() => setDrillDown((stack) => stack.slice(0, -1))}
              aria-label="Back"
              className="grid size-10 shrink-0 place-items-center rounded text-foreground transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BackIcon size={20} aria-hidden="true" />
            </button>
          )}
          <h1 className="text-[32px] font-semibold text-foreground">
            {drillDown[drillDown.length - 1]?.title ?? "Browse"}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Browse feed">
          {SURFACES.map((item) => {
            const active = surface === item.value && drillDown.length === 0;
            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setSurface(item.value);
                  setDrillDown([]);
                }}
                className={cn(
                  CHIP,
                  // A drilled-down feed still belongs to its surface, so that chip stays lit.
                  surface === item.value
                    ? "bg-foreground text-background"
                    : "bg-card text-foreground hover:bg-muted",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </header>

      {error ? (
        <p className="px-2 py-10 text-center text-sm text-muted-foreground">{error}</p>
      ) : page === null ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <SpinnerSteps size={18} color="currentColor" />
          Loading {SURFACES.find((item) => item.value === surface)?.label}...
        </div>
      ) : page.shelves.length === 0 ? (
        <p className="px-2 py-10 text-center text-sm text-muted-foreground">
          YouTube Music returned nothing for this feed.
        </p>
      ) : (
        <BrowseShelves
          shelves={page.shelves}
          playerController={playerController}
          onOpenAlbum={onOpenAlbum}
          onOpenArtist={onOpenArtist}
          onOpenPlaylist={onOpenPlaylist}
          onFollowLink={(link) =>
            /* `params` travels with the id: for a mood the id is a constant and this is the
               only thing identifying which mood was tapped. */
            setDrillDown((stack) => [
              ...stack,
              { browseId: link.browseId, title: link.title, params: link.params },
            ])}
        />
      )}
    </div>
  );
}

type DownloadsTab = "playlists" | "songs" | "progress" | "failed";

/** Why a song could not be downloaded, in words; the raw error is in the tooltip. */
const FAILURE_REASONS: Partial<Record<ErrorKind, string>> = {
  unavailable: "YouTube won't play this song",
  network: "Couldn't reach YouTube",
  expired: "YouTube kept refusing the download",
  invalid: "The download wasn't a valid audio file",
  storage: "The file couldn't be saved",
};

function failureReason(failure: DownloadFailure): string {
  return (failure.kind && FAILURE_REASONS[failure.kind]) ?? `The download failed ${MAX_ATTEMPTS} times`;
}

const PLAIN_BUTTON = "h-8 shrink-0 rounded px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * What is on this machine: synced playlists, songs saved one at a time, whatever is still
 * arriving, and what could not be downloaded. Reads only the offline store and the playlist sync
 * list, so it works with no connection at all.
 */
function DownloadsView({
  playerController,
  libraryController,
  onOpenPlaylist,
}: {
  playerController: PlayerControllerActions;
  libraryController: LibraryController;
  onOpenPlaylist: (playlist: Playlist) => void;
}) {
  const [tab, setTab] = useState<DownloadsTab>("playlists");
  const offline = useOfflineState();
  const syncedPlaylists = useSyncedPlaylists();
  const synced = useMemo(() => Object.values(syncedPlaylists), [syncedPlaylists]);
  const { currentTrackId, isPlaying } = useNowPlaying();
  const { openTrackMenu, openPlaylistPicker } = useTrackContextMenu();
  const online = useIsOnline();
  const [isConfirmingRemoveAll, setIsConfirmingRemoveAll] = useState(false);
  const [removingPlaylist, setRemovingPlaylist] = useState<SyncedPlaylist | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    getOfflineLocation()
      .then((location) => {
        if (active) setFolder(location.path);
      })
      .catch((cause: unknown) => logInternalError("DownloadsView.location failed", cause));
    return () => {
      active = false;
    };
  }, []);

  // Keeps "Last synced 2 min ago" honest while the page stays open.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const downloads = useMemo(
    () => Object.values(offline.entries).sort((left, right) => right.downloadedAt - left.downloadedAt),
    [offline.entries],
  );
  /*
   * Songs still arriving. Without these the page looks empty for as long as a download takes,
   * which is exactly when you go looking at it.
   */
  const inFlight = useMemo(() => {
    const ids = [
      ...(offline.downloadingId ? [offline.downloadingId] : []),
      ...offline.queued,
    ];
    return ids
      .map((id) => offline.pending[id])
      .filter((track): track is NonNullable<typeof track> => Boolean(track));
  }, [offline.downloadingId, offline.pending, offline.queued]);
  const failures = useMemo(
    () => Object.entries(offline.failures).map(([id, failure]) => ({ id, ...failure })),
    [offline.failures],
  );
  const savedIndividually = useMemo(
    () => downloads.filter((entry) => entry.savedIndividually !== false),
    [downloads],
  );

  // A tab that empties while open (the last failure retried) falls back to the playlists.
  useEffect(() => {
    if (tab === "failed" && failures.length === 0) setTab("playlists");
  }, [tab, failures.length]);

  const lastSyncedAt = synced.reduce<number | null>(
    (latest, entry) => entry.lastSyncedAt && (!latest || entry.lastSyncedAt > latest) ? entry.lastSyncedAt : latest,
    null,
  );
  const anySyncing = synced.some((entry) => entry.syncing);

  const playTracks = (tracks: Track[], track: Track) => {
    void playerController.playTrackById(track.id, tracks);
  };

  const tabs: Array<{ value: DownloadsTab; label: string }> = [
    { value: "playlists", label: "Playlists" },
    { value: "songs", label: "Songs" },
    { value: "progress", label: inFlight.length > 0 ? `In progress · ${inFlight.length}` : "In progress" },
    ...(failures.length > 0
      ? [{ value: "failed" as const, label: `Couldn't download · ${failures.length}` }]
      : []),
  ];

  /** One synced playlist's status, from the same state its Download button shows. */
  const describe = (entry: SyncedPlaylist) => {
    const bytes = entry.trackIds.reduce((sum, id) => sum + (offline.entries[id]?.byteLength ?? 0), 0);
    const state = syncedPlaylistDownloadState(entry, offline, online);
    switch (state.kind) {
      case "downloading":
        return {
          bytes,
          text: `Syncing · ${state.downloaded} of ${state.total}`,
          tone: "text-foreground",
          progress: state.downloaded / state.total,
        };
      case "waiting":
        return { bytes, text: "Waiting for a connection", tone: WAITING_TEXT, progress: null };
      case "paused":
        return { bytes, text: "Downloads are paused", tone: WAITING_TEXT, progress: null };
      case "incomplete":
        return {
          bytes,
          text: `${state.failedIds.length} couldn't be downloaded`,
          tone: "text-destructive",
          progress: null,
        };
    }
    if (entry.syncing) {
      return { bytes, text: "Syncing", tone: "text-foreground", progress: state.kind === "preparing" ? 0 : null };
    }
    if (entry.error) return { bytes, text: entry.error, tone: "text-destructive", progress: null };
    if (state.kind === "preparing") {
      return { bytes, text: "Waiting to sync", tone: "text-muted-foreground", progress: null };
    }
    return { bytes, text: "Synced", tone: "text-muted-foreground", progress: null };
  };

  const removingSummary = removingPlaylist
    ? removingPlaylist.trackIds.reduce(
      (summary, id) => offline.entries[id]
        ? { count: summary.count + 1, bytes: summary.bytes + offline.entries[id].byteLength }
        : summary,
      { count: 0, bytes: 0 },
    )
    : null;

  const isEmpty = downloads.length === 0 && inFlight.length === 0 && synced.length === 0 && failures.length === 0;
  const pauseNotice = offline.paused === "storage"
    ? "The download folder can't be written to. Reconnect the drive it's on, or choose another folder in Settings."
    : offline.paused === "limit"
      ? "The storage limit in Settings is reached. Raise or remove it to download the rest."
      : null;

  return (
    <div className="flex flex-col gap-6 pt-1">
      <header className="flex items-end justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-[32px] font-semibold text-foreground">Downloads</h1>
          <p className="truncate text-sm text-muted-foreground">
            {formatSongCount(downloads.length)} · {formatBytes(offline.usedBytes)}
            {folder && (
              <>
                {" · "}
                <span className="font-mono text-[13px]" title={folder}>{folder}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {lastSyncedAt && (
            <span className="text-[13px] text-muted-foreground">
              Last synced {formatAgo(lastSyncedAt, now)}
            </span>
          )}
          <button
            type="button"
            className={cn(SECONDARY_BUTTON, "pl-3")}
            disabled={synced.length === 0 || anySyncing || !online}
            onClick={() => void syncAllPlaylists(libraryController)}
          >
            <RefreshIcon size={18} aria-hidden="true" />
            {anySyncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </header>

      {pauseNotice && (
        <div role="status" className="flex items-center gap-4 rounded-lg bg-card px-4 py-3.5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-semibold text-foreground">Downloads are paused</span>
            <span className="text-[13px] text-muted-foreground" title={offline.pauseMessage ?? undefined}>
              {pauseNotice}
            </span>
          </div>
          {offline.paused === "storage" && (
            <button type="button" className={SECONDARY_BUTTON} onClick={resumeDownloads}>
              Try again
            </button>
          )}
        </div>
      )}

      {isEmpty ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="grid size-12 place-items-center rounded bg-card text-foreground">
            <DownloadIcon size={24} aria-hidden="true" />
          </span>
          <p className="text-sm font-semibold text-foreground">Nothing downloaded yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Use the download button on a playlist, an album or any song to keep it on this
            machine. Downloaded songs play without a connection.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div className="flex gap-2" role="tablist" aria-label="Downloads">
              {tabs.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.value}
                  onClick={() => setTab(item.value)}
                  className={cn(
                    CHIP,
                    tab === item.value ? "bg-foreground text-background" : "bg-card text-foreground hover:bg-muted",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {tab === "songs" && downloads.length > 0 && (
              <button
                type="button"
                onClick={() => setIsConfirmingRemoveAll(true)}
                className="ml-auto h-8 shrink-0 rounded bg-muted px-3 text-[13px] font-medium text-destructive transition-colors hover:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Remove all
              </button>
            )}
          </div>

          {tab === "playlists" && (
            synced.length === 0 && savedIndividually.length === 0 ? (
              <p className="px-2 py-10 text-center text-sm text-muted-foreground">
                Turn on download for a playlist to keep it in sync here.
              </p>
            ) : (
              <div className="flex flex-col gap-0.5" role="group" aria-label="Synced playlists">
                {synced.map((entry) => {
                  const status = describe(entry);
                  const liked = isLikedSongsId(entry.playlist.id, entry.playlist.kind);
                  return (
                    <div
                      key={entry.playlist.id}
                      className="grid grid-cols-[48px_minmax(0,1fr)_240px_80px_36px] items-center gap-4 rounded bg-chrome p-2"
                    >
                      <button
                        type="button"
                        onClick={() => onOpenPlaylist(entry.playlist)}
                        aria-label={`Open ${entry.playlist.title}`}
                        className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {liked ? (
                          <span className="grid size-12 place-items-center rounded bg-muted text-foreground">
                            <HeartActiveIcon size={22} aria-hidden="true" />
                          </span>
                        ) : (
                          <TrackArtwork
                            className="size-12 rounded bg-card object-cover"
                            size={48}
                            artworkUrl={entry.playlist.artworkUrl}
                            iconSize={22}
                            variant="playlist"
                          />
                        )}
                      </button>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-sm font-semibold text-foreground">{entry.playlist.title}</span>
                        <span className="text-[13px] text-muted-foreground">{formatSongCount(entry.trackIds.length)}</span>
                      </span>
                      <span className="flex min-w-0 flex-col gap-1.5">
                        <span className={cn("truncate text-[13px]", status.tone)} title={entry.error ?? undefined}>
                          {status.text}
                        </span>
                        {status.progress !== null && (
                          <span
                            className="flex h-1 overflow-hidden rounded-[1px] bg-border"
                            role="progressbar"
                            aria-label={`${entry.playlist.title} sync progress`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(status.progress * 100)}
                          >
                            <span className="rounded-[1px] bg-primary" style={{ width: `${status.progress * 100}%` }} />
                          </span>
                        )}
                      </span>
                      <span className="text-right text-[13px] tabular-nums text-muted-foreground">
                        {status.bytes > 0 ? formatBytes(status.bytes) : ""}
                      </span>
                      <Popover
                        open={openMenuId === entry.playlist.id}
                        onOpenChange={(open) => setOpenMenuId(open ? entry.playlist.id : null)}
                        align="end"
                      >
                        <PopoverTrigger>
                          <button
                            type="button"
                            aria-label={`More options for ${entry.playlist.title}`}
                            className="grid size-9 place-items-center rounded text-foreground transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <MoreIcon size={20} aria-hidden="true" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="flex w-44 flex-col p-1.5">
                          <button
                            type="button"
                            className="h-9 rounded px-2.5 text-left text-sm text-foreground hover:bg-muted disabled:opacity-50"
                            disabled={entry.syncing}
                            onClick={() => {
                              setOpenMenuId(null);
                              void syncPlaylist(entry.playlist, libraryController);
                            }}
                            aria-label={`Sync ${entry.playlist.title} now`}
                          >
                            Sync now
                          </button>
                          <button
                            type="button"
                            className="h-9 rounded px-2.5 text-left text-sm text-destructive hover:bg-muted"
                            onClick={() => {
                              setOpenMenuId(null);
                              setRemovingPlaylist(entry);
                            }}
                            aria-label={`Remove the downloads of ${entry.playlist.title}`}
                          >
                            Remove
                          </button>
                        </PopoverContent>
                      </Popover>
                    </div>
                  );
                })}

                {savedIndividually.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setTab("songs")}
                    className="grid grid-cols-[48px_minmax(0,1fr)_240px_80px_36px] items-center gap-4 rounded bg-chrome p-2 text-left transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="grid size-12 place-items-center rounded bg-muted text-foreground">
                      <DownloadIcon size={22} aria-hidden="true" />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-sm font-semibold text-foreground">Songs you saved</span>
                      <span className="text-[13px] text-muted-foreground">{formatSongCount(savedIndividually.length)}</span>
                    </span>
                    <span className="text-[13px] text-muted-foreground">Saved one by one</span>
                    <span className="text-right text-[13px] tabular-nums text-muted-foreground">
                      {formatBytes(savedIndividually.reduce((sum, entry) => sum + entry.byteLength, 0))}
                    </span>
                    <span />
                  </button>
                )}
              </div>
            )
          )}

          {tab === "songs" && (
            downloads.length === 0 ? (
              <p className="px-2 py-10 text-center text-sm text-muted-foreground">No songs downloaded yet.</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {downloads.map((entry, index) => (
                  <TrackRow
                    key={entry.track.id}
                    track={entry.track}
                    index={index}
                    isCurrent={currentTrackId === entry.track.id}
                    isPlaying={isPlaying && currentTrackId === entry.track.id}
                    onSelect={() =>
                      playTracks(downloads.map((item) => item.track), entry.track)
                    }
                    onContextMenu={(event) => openTrackMenu(event, entry.track)}
                    onQuickAdd={() => openPlaylistPicker(entry.track)}
                    onQuickAddToQueue={() => playerController.addToQueue(entry.track)}
                    showDownload
                    showRating
                    trailing={
                      <span className="w-16 shrink-0 text-right text-[13px] tabular-nums text-muted-foreground">
                        {formatBytes(entry.byteLength)}
                      </span>
                    }
                  />
                ))}
              </div>
            )
          )}

          {tab === "progress" && (
            inFlight.length === 0 ? (
              <p className="px-2 py-10 text-center text-sm text-muted-foreground">Nothing is downloading.</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {inFlight.map((track, index) => {
                  const isActive = offline.downloadingId === track.id;
                  return (
                    <TrackRow
                      key={`pending:${track.id}`}
                      track={track}
                      index={index}
                      isCurrent={false}
                      isPlaying={false}
                      onSelect={() => playTracks([track], track)}
                      onContextMenu={(event) => openTrackMenu(event, track)}
                      showDownload
                      showRating
                      trailing={
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="text-[13px] tabular-nums text-muted-foreground">
                            {isActive
                              ? offline.progress !== null
                                ? `${offline.progress}%`
                                : "Downloading"
                              : offline.paused === "offline"
                                ? "Waiting"
                                : "Queued"}
                          </span>
                          {/* The row is a button, so this cannot be one. */}
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label={`Cancel download of ${track.title}`}
                            className="grid size-7 place-items-center rounded text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={(event) => {
                              event.stopPropagation();
                              cancelDownload(track.id);
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ") return;
                              event.preventDefault();
                              event.stopPropagation();
                              cancelDownload(track.id);
                            }}
                          >
                            <CloseIcon size={14} aria-hidden="true" />
                          </span>
                        </span>
                      }
                    />
                  );
                })}
              </div>
            )
          )}

          {tab === "failed" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[13px] text-muted-foreground">
                  These are tried again on the next sync. Songs YouTube won't play are only tried
                  again when you ask.
                </span>
                <button type="button" className={cn(SECONDARY_BUTTON, "h-8 px-3 text-[13px]")} onClick={() => retryFailedDownloads()}>
                  Retry all
                </button>
              </div>
              <div className="flex flex-col gap-0.5">
                {failures.map((failure) => (
                  <div
                    key={failure.id}
                    className="grid grid-cols-[40px_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-4 rounded px-2 py-1.5"
                  >
                    <TrackArtwork
                      className="size-10 rounded bg-card object-cover"
                      size={40}
                      artworkUrl={failure.track.artworkUrl}
                      iconSize={18}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-semibold text-foreground">{failure.track.title}</span>
                      <span className="truncate text-[13px] text-muted-foreground">
                        {failure.track.artist}
                      </span>
                    </span>
                    <span className="truncate text-[13px] text-destructive" title={failure.message}>
                      {failureReason(failure)}
                    </span>
                    <span className="flex gap-1">
                      <button type="button" className={PLAIN_BUTTON} onClick={() => retryFailedDownloads([failure.id])}>
                        Retry
                      </button>
                      <button type="button" className={PLAIN_BUTTON} onClick={() => dismissFailedDownload(failure.id)}>
                        Remove
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={isConfirmingRemoveAll}
        title="Remove all downloads?"
        confirmLabel="Remove all"
        destructive
        onCancel={() => setIsConfirmingRemoveAll(false)}
        onConfirm={() => {
          setIsConfirmingRemoveAll(false);
          void removeAllDownloadsAndStopSyncing();
        }}
      >
        {`All ${formatSongCount(downloads.length)} (${formatBytes(offline.usedBytes)}) will be deleted from this computer, and downloaded playlists will stop syncing. Your playlists stay in your library.`}
      </ConfirmDialog>

      <ConfirmDialog
        open={removingPlaylist !== null}
        title="Remove downloads?"
        confirmLabel="Remove downloads"
        destructive
        onCancel={() => setRemovingPlaylist(null)}
        onConfirm={() => {
          if (removingPlaylist) void disablePlaylistSync(removingPlaylist.playlist.id);
          setRemovingPlaylist(null);
        }}
      >
        {removingPlaylist && removingSummary && removingSummary.count > 0
          ? `${removingPlaylist.playlist.title} will stop syncing, and its ${formatSongCount(removingSummary.count)} (${formatBytes(removingSummary.bytes)}) will be deleted from this computer. Songs you saved on their own or in another downloaded playlist stay.`
          : `${removingPlaylist?.playlist.title ?? "This playlist"} will stop downloading and syncing.`}
      </ConfirmDialog>
    </div>
  );
}
