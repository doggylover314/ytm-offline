import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { SpinnerSteps } from "@/components/motion/loader";
import { ArrowDownIcon, ArrowUpIcon, CloseIcon, FolderAddIcon, HeartActiveIcon, MoreIcon, SearchIcon } from "@/ui/icons";
import type { Playlist, Track } from "../../datasource/types";
import type { LibraryController } from "../../player/LibraryController";
import type { PlayerControllerActions } from "../../player/playerStore";
import { markPlaylistPlayed } from "../../player/recentPlaylists";
import { useTrackContextMenu } from "../components/TrackContextMenu";
import { addLocalPlaylistPath, isLocalPlaylist } from "../../player/localPlaylists";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Tooltip } from "@/components/motion/tooltip";
import { logInternalError } from "../../internal/logging";
import { SelectionBar } from "../components/SelectionBar";
import { useTrackSelection } from "../hooks/useTrackSelection";
import {
  getOfflineTrack,
  queueDownloads,
  retryFailedDownloads,
  useOfflineState,
} from "../../player/offlineStore";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { formatBytes, formatSongCount } from "@/lib/format";
import {
  disablePlaylistSync,
  enablePlaylistSync,
  getSyncedPlaylists,
  syncedPlaylistDownloadState,
  useSyncedPlaylists,
} from "../../player/playlistSync";
import { useIsOnline } from "../../internal/connectivity";
import { usePlaylistContextMenu } from "../components/PlaylistContextMenu";
import { formatCollectionMeta, HEADER_SECONDARY_BUTTON, MediaHeader } from "../components/MediaHeader";
import { isLikedSongsId } from "../likedSongsArtwork";
import { TrackListSkeleton } from "../components/Skeleton";
import { TrackListHeader, TrackRow } from "../components/TrackRow";
import { useNowPlaying } from "../hooks/useNowPlaying";
import { useKeyboardShortcuts } from "../settings/keyboardShortcuts";
import { shouldStartPageSearch } from "./pageSearchKeyboard";
import { collectTrackPages } from "./collectTrackPages";

/*
 * Collapsed search affordance that widens on hover/focus or while it holds a query —
 * the behaviour the original .playlistSearch width transition provided.
 */
const SEARCH_FIELD =
  "group/search flex h-8 items-center gap-1.5 overflow-hidden rounded bg-card px-2.5 " +
  "text-muted-foreground transition-[width,background-color] duration-200 cursor-text " +
  "hover:bg-muted focus-within:bg-card focus-within:text-foreground " +
  "[&_input]:min-w-0 [&_input]:flex-1 [&_input]:bg-transparent [&_input]:text-sm " +
  "[&_input]:text-foreground [&_input]:outline-none [&_input]:placeholder:text-muted-foreground";
const SEARCH_FIELD_COLLAPSED = "w-9 hover:w-56 focus-within:w-56";

interface PlaylistViewProps {
  playlist?: Playlist;
  playerController: PlayerControllerActions;
  libraryController: LibraryController;
}

type PlaylistSort = "dateAdded" | "name" | "album";
type SortDirection = "asc" | "desc";

const playlistSorts: Array<{ value: PlaylistSort; label: string }> = [
  { value: "name", label: "Name" },
  { value: "album", label: "Album" },
  { value: "dateAdded", label: "Date Added" },
];

function compareText(left: string | undefined, right: string | undefined): number {
  return (left || "\uffff").localeCompare(right || "\uffff", undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function getDirectionLabel(sort: PlaylistSort, direction: SortDirection): string {
  if (sort === "dateAdded") return direction === "desc" ? "Newest" : "Oldest";
  return direction === "asc" ? "Asc" : "Desc";
}

function SortDirectionIcon({ direction }: { direction: SortDirection }) {
  return direction === "asc"
    ? <ArrowUpIcon size={13} strokeWidth={2.2} aria-hidden="true" />
    : <ArrowDownIcon size={13} strokeWidth={2.2} aria-hidden="true" />;
}

/** "Synced 2 min ago". Coarse on purpose: the sync runs in the background, not by the second. */
function formatSyncedAgo(syncedAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - syncedAt) / 60_000);
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `Synced ${days} day${days === 1 ? "" : "s"} ago`;
}

function getTrackRenderKey(track: Track, index: number): string {
  return track.playlistItemId ?? `${track.id}:${index}`;
}

function getUniqueNewTracks(current: Track[], next: Track[]): Track[] {
  const existingIds = new Set(current.map((track) => track.id));
  return next.filter((track) => {
    if (existingIds.has(track.id)) return false;
    existingIds.add(track.id);
    return true;
  });
}

function PlaylistLoadingSpinner({ label }: { label: string }) {
  return (
    <div className="grid place-items-center px-2 py-16 text-muted-foreground" role="status" aria-live="polite" aria-label={label}>
      <SpinnerSteps size={18} color="currentColor" />
    </div>
  );
}

/**
 * A playlist's description, editable in place when the playlist is the user's own.
 *
 * Collapsed to three lines by default. Descriptions are frequently a wall of text pasted from
 * somewhere else, and letting one push the track list off the screen would be a worse default
 * than hiding the tail behind a click.
 */
function PlaylistDescription({
  playlist,
  libraryController,
}: {
  playlist: Playlist;
  libraryController: LibraryController;
}) {
  const canEdit = Boolean(playlist.isEditable) && !isLocalPlaylist(playlist);
  /*
   * Fetched rather than read off the prop. The library shelves that produce Playlist objects
   * carry a title, an owner and a cover but never the description — only the playlist's own
   * page has it, so asking for it is the only way to show one that already exists.
   */
  const [description, setDescription] = useState(playlist.description?.trim() ?? "");
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(description);
  const [isSaving, setIsSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // A different playlist means a different description; keeping the old draft would offer to
  // save one playlist's text onto another.
  useEffect(() => {
    let active = true;
    setIsEditing(false);
    setExpanded(false);
    const initial = playlist.description?.trim() ?? "";
    setDescription(initial);
    setDraft(initial);

    void libraryController.getPlaylistDescription(playlist).then((fetched) => {
      if (!active || fetched === null) return;
      setDescription(fetched);
      setDraft(fetched);
    }).catch(() => {
      // A missing description is indistinguishable from an empty one to the reader.
    });

    return () => {
      active = false;
    };
  }, [libraryController, playlist]);

  if (!description && !canEdit) return null;

  if (isEditing) {
    return (
      <div className="flex flex-col gap-2">
        <textarea
          className="min-h-20 w-full resize-y rounded bg-card px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          value={draft}
          autoFocus
          maxLength={5000}
          placeholder="Describe this playlist"
          onChange={(event) => setDraft(event.target.value)}
          aria-label="Playlist description"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="h-8 rounded bg-foreground px-3 text-sm font-medium text-background transition-colors hover:bg-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={isSaving}
            onClick={() => {
              setIsSaving(true);
              void libraryController.setPlaylistDescription(playlist, draft)
                .then(() => {
                  setDescription(draft.trim());
                  setIsEditing(false);
                })
                .catch((error: unknown) => {
                  logInternalError("PlaylistView.setPlaylistDescription failed", error);
                })
                .finally(() => setIsSaving(false));
            }}
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            className="h-8 rounded px-3 text-sm font-medium text-foreground transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={isSaving}
            onClick={() => {
              setDraft(description);
              setIsEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      {description ? (
        <p
          className={cn(
            "min-w-0 flex-1 whitespace-pre-wrap text-sm text-muted-foreground",
            !expanded && "line-clamp-3",
          )}
          onClick={() => setExpanded((previous) => !previous)}
        >
          {description}
        </p>
      ) : (
        <p className="min-w-0 flex-1 text-sm italic text-muted-foreground">No description yet.</p>
      )}
      {canEdit && (
        <button
          type="button"
          className="h-8 shrink-0 rounded px-3 text-sm font-medium text-foreground transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setIsEditing(true)}
        >
          {description ? "Edit" : "Add description"}
        </button>
      )}
    </div>
  );
}

export function PlaylistView({ playlist, playerController, libraryController }: PlaylistViewProps) {
  const { openPlaylistPicker, openTrackMenu } = useTrackContextMenu();
  const { openPlaylistMenu } = usePlaylistContextMenu();
  const keyboardShortcuts = useKeyboardShortcuts();
  /*
   * Only the identity of the current track and the transport status are needed here, and
   * both change at most once per track. Playback *position* deliberately never enters this
   * component — it lives in SeekBar's local state, so a long playlist is not re-rendered on
   * every tick.
   */
  const {
    currentTrackId,
    isPlaying,
    isLoading: isPlayerLoading,
    playbackOrderMode,
    shuffleEnabled,
  } = useNowPlaying();
  const [tracks, setTracks] = useState<Track[]>([]);
  /** Bumped when a folder is added, so the scan re-runs in place. */
  const [localFolderToken, setLocalFolderToken] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreTracks, setHasMoreTracks] = useState(false);
  const [nextPageKey, setNextPageKey] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [sort, setSort] = useState<PlaylistSort>("dateAdded");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [playlistSearchQuery, setPlaylistSearchQuery] = useState("");
  const [dropTargetIndex, setDropTargetIndex] = useState<{ localPath: string; insertAfter: boolean } | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const playlistSearchInputRef = useRef<HTMLInputElement | null>(null);
  const playlistIdRef = useRef<string | undefined>(undefined);
  const isLoadingMoreRef = useRef(false);
  const isCollectingAllRef = useRef(false);
  const tracksRef = useRef<Track[]>([]);
  const pointerDragRef = useRef<{
    pointerId: number;
    localPath: string;
    startY: number;
    isDragging: boolean;
  } | null>(null);
  const dropTargetRef = useRef<{ localPath: string; insertAfter: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  playlistIdRef.current = playlist?.id;
  isLoadingMoreRef.current = isLoadingMore;
  tracksRef.current = tracks;

  /*
   * Derived from the offline store so the header button can say what pressing it would do.
   * Recomputed from entries rather than tracked separately: a count kept in parallel with the
   * store is a count that drifts the moment a download finishes elsewhere.
   */
  const offlineState = useOfflineState();
  const syncedPlaylists = useSyncedPlaylists();
  const syncState = playlist ? syncedPlaylists[playlist.id] : undefined;
  const isOnline = useIsOnline();
  const downloadState = useMemo(
    () => syncedPlaylistDownloadState(syncState, offlineState, isOnline),
    [syncState, offlineState, isOnline],
  );
  /** What removing the downloads would delete, for the confirmation. */
  const downloadedHere = useMemo(() => {
    const entries = (syncState?.trackIds ?? [])
      .map((trackId) => offlineState.entries[trackId])
      .filter(Boolean);
    return { count: entries.length, bytes: entries.reduce((total, entry) => total + entry.byteLength, 0) };
  }, [syncState, offlineState.entries]);
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);

  /* Ticks once a minute while there is a sync time to show, so "2 min ago" does not freeze. */
  const lastSyncedAt = syncState?.lastSyncedAt ?? null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (lastSyncedAt === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [lastSyncedAt]);

  const isLocalPlaylistView = playlist ? isLocalPlaylist(playlist) : false;
  /*
   * Reordering now reaches YouTube too, not just local playlists. Liked Songs is excluded
   * because it has no user-defined order to persist.
   */
  const canReorderTracks = Boolean(
    playlist
      && (isLocalPlaylistView
        || (playlist.isEditable !== false && !isLikedSongsId(playlist.id, playlist.kind))),
  );

  useEffect(() => {
    if (!playlist) return;
    let active = true;
    setSort("dateAdded");
    setSortDirection("desc");
    setPlaylistSearchQuery("");
    setTracks([]);
    setIsLoading(true);
    setIsLoadingMore(false);
    setHasMoreTracks(false);
    setNextPageKey(undefined);
    setError(null);
    setLoadMoreError(null);
    let showedPage = false;
    const showPage = (page: { tracks: Track[]; hasMore: boolean; nextPageKey?: string }) => {
      if (!active) return;
      showedPage = true;
      setTracks(page.tracks);
      setHasMoreTracks(page.hasMore);
      setNextPageKey(page.nextPageKey);
      setIsLoading(false);
    };
    void libraryController.getPlaylistTrackPage(playlist, undefined, (page) => {
      if (page.tracks.length > 0) showPage(page);
    })
      .then((page) => {
        showPage(page);
      })
      .catch(() => {
        if (!active || showedPage) return;
        // Offline, a synced playlist is still whatever of it is downloaded, in playlist order.
        const downloaded = (getSyncedPlaylists()[playlist.id]?.trackIds ?? [])
          .map((trackId) => getOfflineTrack(trackId))
          .filter((track): track is Track => Boolean(track));
        if (downloaded.length > 0) showPage({ tracks: downloaded, hasMore: false });
        else setError("Unable to load this playlist.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [playlist, libraryController, localFolderToken]);

  /*
   * Assigning folders lives on the page as well as in Settings.
   *
   * A local playlist *is* its list of folders, so an empty one has nothing to offer but a
   * message — and the only way to fix it was a settings screen two levels away with no hint
   * that it was where to go.
   */
  const [isChoosingFolder, setIsChoosingFolder] = useState(false);
  const handleAddLocalFolder = useCallback(async () => {
    if (!playlist) return;
    setIsChoosingFolder(true);
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "Choose music folder",
      });
      if (typeof selected !== "string") return;
      addLocalPlaylistPath(playlist.id, selected);
      // The load effect keys off this, so the new folder is scanned without a navigation.
      setLocalFolderToken((token) => token + 1);
    } catch (error) {
      logInternalError("PlaylistView local folder pick failed", error);
    } finally {
      setIsChoosingFolder(false);
    }
  }, [playlist]);

  const loadMoreTracks = useCallback(async () => {
    if (!playlist || !hasMoreTracks || !nextPageKey || isLoading) return;
    if (isLoadingMoreRef.current || isCollectingAllRef.current) return;
    const loadingPlaylistId = playlist.id;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    setLoadMoreError(null);

    try {
      const page = await libraryController.getPlaylistTrackPage(playlist, nextPageKey);
      if (playlistIdRef.current !== loadingPlaylistId) return;
      const uniqueNewTracks = getUniqueNewTracks(tracksRef.current, page.tracks);
      if (uniqueNewTracks.length > 0) {
        setTracks((current) => [...current, ...uniqueNewTracks]);
      }
      setHasMoreTracks(page.hasMore);
      setNextPageKey(page.nextPageKey);
    } catch {
      if (playlistIdRef.current === loadingPlaylistId) {
        setLoadMoreError("Could not load more songs.");
      }
    } finally {
      if (playlistIdRef.current === loadingPlaylistId) {
        isLoadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    }
  }, [hasMoreTracks, isLoading, libraryController, nextPageKey, playlist]);

  /**
   * Pulls every remaining page, and returns the complete list.
   *
   * Whole-collection actions — download all, queue all, add all to a playlist — are the only
   * things that need more than what is on screen, so the rest is fetched when one is invoked
   * rather than on mount. Eagerly paging a 5,000-track playlist would spend dozens of round
   * trips before the first row appeared, to serve a button most visits never press.
   *
   * Returns the tracks rather than relying on the state it also sets, because callers act on
   * the result immediately and a `setTracks` in the same tick is not visible to them yet.
   */
  const collectAllTracks = useCallback(async (): Promise<Track[]> => {
    if (!playlist || !hasMoreTracks || !nextPageKey) return tracksRef.current;

    const loadingPlaylistId = playlist.id;
    // Held for the whole sweep so the scroll sentinel does not fetch the same pages alongside it.
    isCollectingAllRef.current = true;
    setLoadMoreError(null);

    try {
      return await collectTrackPages({
        initial: tracksRef.current,
        hasMore: hasMoreTracks,
        nextPageKey,
        fetchPage: (pageKey) => libraryController.getPlaylistTrackPage(playlist, pageKey),
        isStale: () => playlistIdRef.current !== loadingPlaylistId,
        // Written through on every page so the list fills in as it loads, and the work already
        // done survives if the sweep is abandoned partway.
        onPage: (collected, more, pageKey) => {
          tracksRef.current = collected;
          setTracks(collected);
          setHasMoreTracks(more);
          setNextPageKey(pageKey);
        },
      });
    } catch {
      if (playlistIdRef.current === loadingPlaylistId) {
        setLoadMoreError("Could not load the rest of this playlist.");
      }
      return tracksRef.current;
    } finally {
      if (playlistIdRef.current === loadingPlaylistId) {
        isCollectingAllRef.current = false;
      }
    }
  }, [hasMoreTracks, libraryController, nextPageKey, playlist]);

  useEffect(() => {
    if (!hasMoreTracks) return;
    const sentinel = loadMoreRef.current;
    if (!sentinel) return;
    const scrollRoot = sentinel.closest("[data-page-scroll-root]");

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadMoreTracks();
      }
    }, {
      root: scrollRoot instanceof Element ? scrollRoot : null,
      rootMargin: "700px 0px",
    });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreTracks, loadMoreTracks, tracks.length]);

  useEffect(() => {
    if (!playlist || isLoading || error || tracks.length === 0) return;

    const handlePageSearchKeyDown = (event: KeyboardEvent) => {
      if (!shouldStartPageSearch(event, keyboardShortcuts)) return;
      event.preventDefault();
      setPlaylistSearchQuery((current) => `${current}${event.key}`);
      window.requestAnimationFrame(() => playlistSearchInputRef.current?.focus());
    };

    window.addEventListener("keydown", handlePageSearchKeyDown);
    return () => window.removeEventListener("keydown", handlePageSearchKeyDown);
  }, [error, isLoading, keyboardShortcuts, playlist, tracks.length]);

  const sortedTracks = useMemo(() => {
    if (sort === "dateAdded") {
      return sortDirection === "desc" ? tracks : [...tracks].reverse();
    }
    const sorted = [...tracks].sort((left, right) => {
      if (sort === "name") {
        return compareText(left.title, right.title)
          || compareText(left.artist, right.artist)
          || compareText(left.album, right.album);
      }
      return compareText(left.album, right.album)
        || compareText(left.title, right.title)
        || compareText(left.artist, right.artist);
    });
    return sortDirection === "asc" ? sorted : sorted.reverse();
  }, [sort, sortDirection, tracks]);

  const sortedTracksRef = useRef(sortedTracks);
  sortedTracksRef.current = sortedTracks;

  /*
   * Dragging only in the playlist's own order. A move is saved against that order, so dragging
   * a sorted or filtered list sent moves that landed somewhere else entirely.
   */
  const canDragTracks = canReorderTracks
    && sort === "dateAdded"
    && sortDirection === "desc"
    && !playlistSearchQuery.trim();

  const visibleTracks = useMemo(() => {
    const query = playlistSearchQuery.trim().toLocaleLowerCase();
    if (!query) return sortedTracks;
    return sortedTracks.filter((track) => [
      track.title,
      track.artist,
      track.album,
      ...(track.artists?.map((artist) => artist.name) ?? []),
    ].some((value) => value?.toLocaleLowerCase().includes(query)));
  }, [playlistSearchQuery, sortedTracks]);

  /*
   * Drag to reorder.
   *
   * Rows are keyed by playlistItemId where there is one, because YouTube addresses a playlist
   * entry by the row it sits in — the same song can appear twice, and keying on the video id
   * would move whichever copy came first.
   */
  useEffect(() => {
    if (!canDragTracks) return;

    const handlePointerMove = (event: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;

      if (!drag.isDragging) {
        const distance = Math.abs(event.clientY - drag.startY);
        if (distance < 6) return;
        drag.isDragging = true;
      }

      event.preventDefault();
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-playlist-track-path]");
      if (!target) {
        setDropTargetIndex(null);
        dropTargetRef.current = null;
        return;
      }

      const bounds = target.getBoundingClientRect();
      const nextTarget = {
        localPath: target.dataset.playlistTrackPath ?? "",
        insertAfter: event.clientY >= bounds.top + bounds.height / 2,
      };
      dropTargetRef.current = nextTarget;
      setDropTargetIndex(nextTarget);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;

      if (drag.isDragging && dropTargetRef.current && playlist) {
        const fromPath = drag.localPath;
        const toPath = dropTargetRef.current.localPath;
        if (!fromPath || !toPath) {
          pointerDragRef.current = null;
          setDropTargetIndex(null);
          return;
        }

        const sorted = sortedTracksRef.current;
        const rowKey = (t: Track) => t.localPath ?? t.playlistItemId ?? t.id;
        const fromIndex = sorted.findIndex((item) => rowKey(item) === fromPath);
        const toIndex = sorted.findIndex((item) => rowKey(item) === toPath);
        if (fromIndex < 0 || toIndex < 0) return;

        const clampedToIndex = dropTargetRef.current.insertAfter
          ? Math.min(toIndex + 1, sorted.length)
          : toIndex;
        const insertIndex = fromIndex < clampedToIndex
          ? clampedToIndex - 1
          : clampedToIndex;

        if (fromIndex !== insertIndex) {
          const movedTrack = sorted[fromIndex];
          const reordered = [...sorted];
          reordered.splice(fromIndex, 1);
          reordered.splice(insertIndex, 0, movedTrack);
          // YouTube positions a row *after* another one, so it needs the new neighbour above.
          const predecessorTrack = insertIndex > 0 ? reordered[insertIndex - 1] : null;
          const previousTracks = sorted;

          setTracks(reordered);
          void libraryController
            .reorderPlaylistTracks(playlist, movedTrack, predecessorTrack, {
              from: fromIndex,
              to: clampedToIndex,
            })
            .catch((error: unknown) => {
              // Snapping back is the honest outcome: the row is not where it looks.
              logInternalError("PlaylistView.reorder failed", error, {
                playlistId: playlist.id,
                trackId: movedTrack.id,
              });
              setTracks(previousTracks);
            });
        }
      }

      if (drag.isDragging) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      dropTargetRef.current = null;
      pointerDragRef.current = null;
      setDropTargetIndex(null);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [canDragTracks, libraryController, playlist]);

  if (!playlist) return null;

  const playPlaylistTrack = async (track: Track) => {
    const started = await playerController.playTrackById(track.id, visibleTracks);
    if (started) markPlaylistPlayed(playlist.id);
  };

  const isLikedSongs = isLikedSongsId(playlist.id, playlist.kind);

  /*
   * O(1) membership test instead of scanning the track array on every render — these lists
   * run to several hundred rows.
   */
  const trackIds = useMemo(() => new Set(tracks.map((track) => track.id)), [tracks]);
  const isCurrentCollection = currentTrackId !== null && trackIds.has(currentTrackId);

  /*
   * Resumes rather than restarts when this collection is already loaded: pressing Play on
   * the playlist you just paused should pick up where it left off, not jump to track one.
   */
  const togglePlayCollection = async () => {
    if (isCurrentCollection) {
      playerController.togglePlayPause();
      return;
    }
    await playInOrder();
  };

  const playInOrder = async () => {
    const firstTrack = tracks[0];
    if (!firstTrack) return;

    const started = await playerController.playTrackById(firstTrack.id, tracks);
    if (started) markPlaylistPlayed(playlist.id);
  };

  const playInLoop = async () => {
    const firstTrack = tracks[0];
    if (!firstTrack) return;

    // Set before starting, so a very short first track cannot end before the mode applies.
    playerController.setPlaybackOrderMode("repeat-all");
    const started = await playerController.playTrackById(firstTrack.id, tracks);
    if (started) markPlaylistPlayed(playlist.id);
  };

  const selection = useTrackSelection(visibleTracks);

  const removeTrackFromList = (removedTrack: Track) => {
    setTracks((current) => current.filter((item) =>
      playlist.kind === "liked-songs" || playlist.id === "LM"
        ? item.id !== removedTrack.id
        : removedTrack.localPath
          ? item.localPath !== removedTrack.localPath
          : item.playlistItemId !== removedTrack.playlistItemId
    ));
  };

  const selectSort = (nextSort: PlaylistSort) => {
    if (nextSort === sort) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSort(nextSort);
    setSortDirection(nextSort === "dateAdded" ? "desc" : "asc");
  };

  const handlePlaylistSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Backspace" || playlistSearchQuery) return;
    event.preventDefault();
    event.currentTarget.blur();
  };

  const handlePointerDown = (event: React.PointerEvent, track: Track) => {
    if (!canDragTracks || event.button !== 0) return;
    pointerDragRef.current = {
      pointerId: event.pointerId,
      localPath: track.localPath ?? track.playlistItemId ?? track.id,
      startY: event.clientY,
      isDragging: false,
    };
  };

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-5" onContextMenu={(event) => openPlaylistMenu(event, playlist)}>
        <MediaHeader
          eyebrow="Playlist"
          title={playlist.title}
          subtitle={playlist.owner}
          meta={formatCollectionMeta(tracks, hasMoreTracks)}
          artworkUrl={playlist.artworkUrl}
          artworkVariant="playlist"
          artworkSlot={isLikedSongs ? (
            <span className="grid size-[200px] shrink-0 place-items-center rounded-lg bg-muted text-foreground">
              <HeartActiveIcon size={64} aria-hidden="true" />
            </span>
          ) : undefined}
          {...(isLocalPlaylistView
            ? {
              actions: (
                <Tooltip content="Add a folder of music to this playlist">
                  <button
                    type="button"
                    onClick={() => void handleAddLocalFolder()}
                    disabled={isChoosingFolder}
                    aria-label="Add a music folder"
                    className={cn(HEADER_SECONDARY_BUTTON, "w-10")}
                  >
                    {isChoosingFolder ? (
                      <SpinnerSteps size={20} color="currentColor" />
                    ) : (
                      <FolderAddIcon size={20} aria-hidden="true" />
                    )}
                  </button>
                </Tooltip>
              ),
            }
            : {})}
          actionsDisabled={isLoading || Boolean(error) || tracks.length === 0}
          playback={{
            onToggle: () => void togglePlayCollection(),
            isPlaying: isCurrentCollection && isPlaying,
            isLoading: isCurrentCollection && isPlayerLoading,
          }}
          onShuffle={() => playerController.toggleShuffle()}
          shuffleEnabled={shuffleEnabled}
          loop={{
            onPlay: () => void playInLoop(),
            onCycle: () => playerController.setPlaybackOrderMode(
              playbackOrderMode === "repeat-all" ? "repeat-one" : "in-order",
            ),
            mode: isCurrentCollection ? playbackOrderMode : "in-order",
          }}
          /*
           * Whole-collection actions page in the rest of the playlist first. Acting on the
           * loaded `tracks` alone would quietly cover only what had scrolled into view —
           * "download this playlist" on a 500-song list would fetch the visible 100 and look
           * finished.
           */
          onAddToQueue={() => {
            void collectAllTracks().then((all) => playerController.addTracksToQueue(all));
          }}
          onAddToPlaylist={() => {
            void collectAllTracks().then((all) => openPlaylistPicker(all[0], all));
          }}
          download={{
            state: downloadState,
            onStart: () => {
              if (playlist) void enablePlaylistSync(playlist, libraryController);
            },
            onRemove: () => setIsConfirmingRemove(true),
            onRetry: downloadState.kind === "incomplete"
              ? () => retryFailedDownloads(downloadState.failedIds)
              : undefined,
          }}
          menuItems={[{
            label: "Playlist options",
            icon: <MoreIcon size={18} aria-hidden="true" />,
            onSelect: (event) => openPlaylistMenu(event, playlist),
          }]}
          status={syncState?.error
            ? "Sync failed"
            : syncState && !syncState.syncing && lastSyncedAt !== null
              ? formatSyncedAgo(lastSyncedAt, now)
              : undefined}
        />
        <PlaylistDescription playlist={playlist} libraryController={libraryController} />
        <ConfirmDialog
          open={isConfirmingRemove}
          title="Remove downloads?"
          confirmLabel="Remove downloads"
          destructive
          onCancel={() => setIsConfirmingRemove(false)}
          onConfirm={() => {
            setIsConfirmingRemove(false);
            void disablePlaylistSync(playlist.id);
          }}
        >
          {downloadedHere.count > 0
            ? `${playlist.title} will stop syncing, and its ${formatSongCount(downloadedHere.count)} (${formatBytes(downloadedHere.bytes)}) will be deleted from this computer. Songs you saved on their own or in another downloaded playlist stay.`
            : `${playlist.title} will stop downloading and syncing.`}
        </ConfirmDialog>
      </div>
      {error && <p className="px-2 py-10 text-center text-sm text-muted-foreground">{error}</p>}
      {!isLoading && !error && !hasMoreTracks && tracks.length === 0 && (
        <p className="px-2 py-10 text-center text-sm text-muted-foreground">
          {/* The empty state is exactly when the folder button needs pointing at. */}
          {isLocalPlaylistView
            ? "No music yet — use the folder button above to add one."
            : "This playlist is empty."}
        </p>
      )}
      {/*
       * Sort and search stand apart from the loading state below them: they don't depend on
       * the tracks being in yet, and hiding them behind the skeleton would make every playlist
       * flash them in only once songs had already arrived.
       */}
      {!error && (isLoading || tracks.length > 0 || hasMoreTracks) && (
        <>
          <div
            className="flex flex-wrap items-center gap-2 self-start [&>button]:flex [&>button]:h-8 [&>button]:min-w-0 [&>button]:items-center [&>button]:justify-center [&>button]:gap-1.5 [&>button]:rounded [&>button]:px-3 [&>button]:text-[13px] [&>button]:font-medium [&>button]:transition-colors focus-visible:[&>button]:outline-none focus-visible:[&>button]:ring-2 focus-visible:[&>button]:ring-ring"
            role="group"
            aria-label="Playlist song tools"
          >
            {playlistSorts.map((item) => (
              <button
                key={item.value}
                type="button"
                className={sort === item.value
                  ? "bg-foreground text-background"
                  : "bg-card text-foreground hover:bg-muted"}
                aria-pressed={sort === item.value}
                aria-label={`Sort by ${item.label} ${
                  sort === item.value ? getDirectionLabel(item.value, sortDirection) : ""
                }`.trim()}
                onClick={() => selectSort(item.value)}
              >
                <span>{item.label}</span>
                {sort === item.value && (
                  <span className="flex items-center" aria-hidden="true">
                    <span className="shrink-0">
                      <SortDirectionIcon direction={sortDirection} />
                    </span>
                    {item.value === "dateAdded" && (
                      <span className="sr-only">
                        {getDirectionLabel(item.value, sortDirection)}
                      </span>
                    )}
                  </span>
                )}
              </button>
            ))}
            <div
              className={cn(SEARCH_FIELD, playlistSearchQuery ? "w-56" : SEARCH_FIELD_COLLAPSED)}
              role="search"
              onClick={() => playlistSearchInputRef.current?.focus()}
            >
              <span className="shrink-0">
                <SearchIcon size={16} aria-hidden="true" />
              </span>
              <input
                ref={playlistSearchInputRef}
                type="text"
                value={playlistSearchQuery}
                aria-label="Search songs in playlist"
                placeholder="Search playlist"
                onChange={(event) => setPlaylistSearchQuery(event.target.value)}
                onKeyDown={handlePlaylistSearchKeyDown}
              />
              {playlistSearchQuery && (
                <button
                  className="flex size-6 shrink-0 items-center justify-center rounded text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  type="button"
                  aria-label="Clear playlist search"
                  onClick={() => setPlaylistSearchQuery("")}
                >
                  <CloseIcon size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
          {isLoading ? (
            <TrackListSkeleton label="Loading songs" />
          ) : visibleTracks.length === 0 && playlistSearchQuery.trim() ? (
            <p className="px-2 py-10 text-center text-sm text-muted-foreground">No songs match this search.</p>
          ) : (
          <div className="flex flex-col gap-0.5">
            <TrackListHeader showAlbum showDownload showDuration className="mb-1.5" />
            {visibleTracks.map((track, index) => {
              const trackPath = track.localPath ?? track.playlistItemId ?? track.id;
              /*
               * Match on the *player's* current track rather than a row index: the same
               * track can appear more than once, and the queue can be reordered or shuffled
               * out from under this list.
               */
              const isCurrent = currentTrackId !== null && track.id === currentTrackId;
              const isCurrentPlaying = isCurrent && isPlaying;
              const isDragged = pointerDragRef.current?.localPath === trackPath && pointerDragRef.current.isDragging;
              const isDropBefore = dropTargetIndex
                && dropTargetIndex.localPath === trackPath
                && !dropTargetIndex.insertAfter;
              const isDropAfter = dropTargetIndex
                && dropTargetIndex.localPath === trackPath
                && dropTargetIndex.insertAfter;
              return (
                <TrackRow
                  key={getTrackRenderKey(track, index)}
                  track={track}
                  index={index}
                  showAlbum
                  isCurrent={isCurrent}
                  isPlaying={isCurrentPlaying}
                  data-playlist-track-path={trackPath}
                  className={cn(isDragged && "opacity-40")}
                  isSelected={selection.isSelected(track.id)}
                  isSelectionActive={selection.isActive}
                  onToggleSelected={() => selection.toggle(track.id, index)}
                  onSelect={(event) => {
                    // A drag that ended on this row must not also count as a click.
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    if (selection.handleRowClick(event, index)) return;
                    void playPlaylistTrack(track);
                  }}
                  showDownload
                  showDuration
                  showRating
                  onQuickAddToQueue={() => playerController.addToQueue(track)}
                  onQuickAdd={() => openPlaylistPicker(track)}
                  onContextMenu={(event) => openTrackMenu(event, track, {
                    playlist,
                    onRemove: removeTrackFromList,
                  })}
                  onPointerDown={(event) => handlePointerDown(event, track)}
                >
                  {/* Reorder drop indicators, drawn inside the row so they track it. */}
                  {isDropBefore && (
                    <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-foreground" />
                  )}
                  {isDropAfter && (
                    <span className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 bg-foreground" />
                  )}
                </TrackRow>
              );
            })}
          </div>
          )}
          {!isLoading && (
            <div ref={loadMoreRef} className="px-2 py-4 text-center text-sm text-muted-foreground" aria-live="polite">
              {isLoadingMore ? (
                <PlaylistLoadingSpinner label="Loading more songs" />
              ) : loadMoreError ? (
                loadMoreError
              ) : hasMoreTracks ? (
                ""
              ) : (
                ""
              )}
            </div>
          )}
        </>
      )}
      <SelectionBar
        selection={selection}
        removeLabel="Remove"
        onAddToQueue={(selected) => {
          playerController.addTracksToQueue(selected);
          selection.clear();
        }}
        onAddToPlaylist={(selected) => {
          openPlaylistPicker(selected[0], selected);
          selection.clear();
        }}
        onDownload={(selected) => {
          queueDownloads(selected);
          selection.clear();
        }}
        onRemove={async (selected) => {
          // Sequential for the same reason batch-add is: YouTube rejects rapid bursts of
          // playlist edits, and a half-applied removal is worse than a slow one.
          for (const item of selected) {
            try {
              await libraryController.removeTrackFromPlaylist(item, playlist);
              removeTrackFromList(item);
            } catch (error) {
              logInternalError("PlaylistView.batchRemove failed", error, {
                trackId: item.id,
                playlistId: playlist.id,
              });
            }
          }
          selection.clear();
        }}
      />

    </div>
  );
}
