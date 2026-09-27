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
  getOfflineLocation,
  removeAllDownloads,
  useOfflineState,
} from "../../player/offlineStore";
import {
  disablePlaylistSync,
  syncAllPlaylists,
  syncPlaylist,
  useSyncedPlaylists,
  type SyncedPlaylist,
} from "../../player/playlistSync";
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

function formatAgo(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function useIsOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

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

type DownloadsTab = "playlists" | "songs" | "progress";

/**
 * What is on this machine: synced playlists, songs saved one at a time, and whatever is still
 * arriving. Reads only the offline store and the playlist sync list, so it works with no
 * connection at all.
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
  const isOnline = useIsOnline();
  const { currentTrackId, isPlaying } = useNowPlaying();
  const { openTrackMenu, openPlaylistPicker } = useTrackContextMenu();
  const [confirmRemoveAll, setConfirmRemoveAll] = useState(false);
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
  const savedIndividually = useMemo(
    () => downloads.filter((entry) => entry.savedIndividually !== false),
    [downloads],
  );

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
  ];

  /** One synced playlist's state, derived from its track list and the download queue. */
  const describe = (entry: SyncedPlaylist) => {
    const total = entry.trackIds.length;
    const done = entry.trackIds.filter((id) => offline.entries[id]).length;
    const pending = entry.trackIds.some(
      (id) => id === offline.downloadingId || offline.queued.includes(id),
    );
    const bytes = entry.trackIds.reduce((sum, id) => sum + (offline.entries[id]?.byteLength ?? 0), 0);
    if (entry.syncing || pending) {
      return {
        bytes,
        text: total > 0 ? `Syncing · ${done} of ${total}` : "Syncing",
        tone: "text-foreground",
        progress: total > 0 ? done / total : 0,
      };
    }
    if (!isOnline && done < total) {
      return { bytes, text: "Waiting for a connection", tone: WAITING_TEXT, progress: null };
    }
    if (entry.error) {
      return { bytes, text: entry.error, tone: "text-destructive", progress: null };
    }
    if (!entry.lastSyncedAt) {
      return { bytes, text: "Waiting to sync", tone: "text-muted-foreground", progress: null };
    }
    if (done < total) {
      return { bytes, text: `${done} of ${total} downloaded`, tone: "text-muted-foreground", progress: null };
    }
    return { bytes, text: "Synced", tone: "text-muted-foreground", progress: null };
  };

  const isEmpty = downloads.length === 0 && inFlight.length === 0 && synced.length === 0;

  return (
    <div className="flex flex-col gap-6 pt-1">
      <header className="flex items-end justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-[32px] font-semibold text-foreground">Downloads</h1>
          <p className="truncate text-sm text-muted-foreground">
            {downloads.length} {downloads.length === 1 ? "song" : "songs"} · {formatSize(offline.usedBytes)}
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
            disabled={synced.length === 0 || anySyncing}
            onClick={() => void syncAllPlaylists(libraryController)}
          >
            <RefreshIcon size={18} aria-hidden="true" />
            {anySyncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </header>

      {isEmpty ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="grid size-12 place-items-center rounded bg-card text-foreground">
            <DownloadIcon size={24} aria-hidden="true" />
          </span>
          <p className="text-sm font-semibold text-foreground">Nothing downloaded yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Use the download button on any song to keep it on this machine. Downloaded songs
            play without a connection.
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
                onClick={() => {
                  if (confirmRemoveAll) {
                    void Promise.all(Object.keys(syncedPlaylists).map(disablePlaylistSync)).then(removeAllDownloads);
                    setConfirmRemoveAll(false);
                    return;
                  }
                  setConfirmRemoveAll(true);
                }}
                onBlur={() => setConfirmRemoveAll(false)}
                className={cn(
                  "ml-auto h-8 shrink-0 rounded px-3 text-[13px] font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  confirmRemoveAll
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-muted text-destructive hover:bg-border",
                )}
              >
                {confirmRemoveAll ? "Click again to remove all" : "Remove all"}
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
                        <span className="text-[13px] text-muted-foreground">
                          {entry.trackIds.length} {entry.trackIds.length === 1 ? "song" : "songs"}
                        </span>
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
                        {status.bytes > 0 ? formatSize(status.bytes) : ""}
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
                              void disablePlaylistSync(entry.playlist.id);
                            }}
                            aria-label={`Stop syncing ${entry.playlist.title}`}
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
                      <span className="text-[13px] text-muted-foreground">
                        {savedIndividually.length} {savedIndividually.length === 1 ? "song" : "songs"}
                      </span>
                    </span>
                    <span className="text-[13px] text-muted-foreground">Saved one by one</span>
                    <span className="text-right text-[13px] tabular-nums text-muted-foreground">
                      {formatSize(savedIndividually.reduce((sum, entry) => sum + entry.byteLength, 0))}
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
                        {formatSize(entry.byteLength)}
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
                              : "Queued"}
                          </span>
                          {!isActive && (
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
                          )}
                        </span>
                      }
                    />
                  );
                })}
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
