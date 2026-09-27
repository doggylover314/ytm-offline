import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { CheckIcon, CopyIcon } from "@/ui/icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/motion/select";
import type {
  Album,
  Artist,
  ArtistNotificationLevel,
  ArtistPage,
  Playlist,
  Track,
} from "../../datasource/types";
import type { LibraryController } from "../../player/LibraryController";
import type { PlayerControllerActions } from "../../player/playerStore";
import { shuffleTracks } from "../../player/shuffleTracks";
import { AlbumCard } from "../components/AlbumCard";
import { ArtistLinks } from "../components/ArtistLinks";
import { HEADER_SECONDARY_BUTTON, MediaHeader } from "../components/MediaHeader";
import { AlbumGridSkeleton, TrackListSkeleton } from "../components/Skeleton";
import { TrackArtwork } from "../components/TrackArtwork";
import { TrackRow } from "../components/TrackRow";
import { useNowPlaying } from "../hooks/useNowPlaying";
import { usePlaylistContextMenu } from "../components/PlaylistContextMenu";
import { useTrackContextMenu } from "../components/TrackContextMenu";

type ReleaseFilter = "all" | "album" | "single" | "ep";

function compactViews(track: Track): string {
  if (track.viewCount) {
    return new Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(track.viewCount);
  }
  return track.viewCountText
    ? track.viewCountText.replace(/\s*\b(?:views?|plays?)\b\.?/i, "").trim()
    : "";
}

function getArtistUrl(artist: Artist): string {
  if (artist.id.startsWith("UC")) {
    return `https://music.youtube.com/channel/${encodeURIComponent(artist.id)}`;
  }
  if (artist.id) {
    return `https://music.youtube.com/browse/${encodeURIComponent(artist.id)}`;
  }
  return `https://music.youtube.com/search?q=${encodeURIComponent(artist.name)}`;
}

/** How many of the artist's songs the Top songs shelf shows before it is expanded. */
const POPULAR_PREVIEW_COUNT = 6;

/** Top songs and releases side by side once there is room, stacked below that. */
const SONGS_AND_RELEASES = "grid items-start gap-12 xl:grid-cols-[minmax(0,1fr)_420px]";

/*
 * Last-resolved page per artist, for this session only.
 *
 * Only the active tab's view is mounted (see App.tsx), so switching tabs away from an artist and
 * back is a full unmount/remount — and `getArtist` is async even on a cache hit. Without this,
 * every remount reset `page` to null and repainted the header from the nav-prop `artist` alone,
 * which for the common case — arriving via ArtistLinks on a track/album row — is an
 * `{id, name}` stub with no artworkUrl at all: the avatar dropped to its placeholder every time
 * you came back, however briefly. Seeding from here instead means a remount of an artist you've
 * already viewed repaints instantly while the background refresh below catches it up.
 *
 * ponytail: unbounded for the session — an ArtistPage is small and even a long session visiting
 * hundreds of artists is a non-issue; add an eviction if that stops being true.
 */
const artistPageMemory = new Map<string, ArtistPage>();

export function ArtistView({
  artist,
  playerController,
  libraryController,
  onOpenAlbum,
  onOpenPlaylist,
}: {
  artist?: Artist;
  playerController: PlayerControllerActions;
  libraryController: LibraryController;
  onOpenAlbum: (album: Album) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
}) {
  const { openPlaylistPicker, openTrackMenu } = useTrackContextMenu();
  const { openPlaylistMenu, openAlbumMenu } = usePlaylistContextMenu();
  const { currentTrackId, isPlaying, isLoading: isPlayerLoading } = useNowPlaying();
  /*
   * Seeded from the remembered page, not always null.
   *
   * `useEffect` runs after the first paint, so setting this from inside the effect (as the
   * artist-change branch below still needs to, for switching artists without unmounting) left a
   * remount's very first frame — the one right after switching tabs back — rendering with
   * nothing, before the effect caught it up a moment later. Whether that flash was visible
   * depended on timing against the browser's paint, which is exactly an intermittent "sometimes
   * shows, sometimes doesn't". Seeding here means a remounted, already-viewed artist has the
   * right data on the very first render, flash or race no longer possible.
   */
  const [page, setPage] = useState<ArtistPage | null>(
    () => (artist ? artistPageMemory.get(artist.id) ?? null : null),
  );
  const [showAllSongs, setShowAllSongs] = useState(false);
  const [isLoading, setIsLoading] = useState(
    () => !(artist && artistPageMemory.has(artist.id)),
  );
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReleaseFilter>("all");
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  /*
   * "personalized" is YouTube's default for a new subscription, and the artist page does not
   * report the stored level — so this starts at the default and tracks whatever the user
   * chooses here rather than claiming to know what the account already holds.
   */
  const [notificationLevel, setNotificationLevel] =
    useState<ArtistNotificationLevel>("personalized");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!artist) return;
    let active = true;
    // Whatever this artist last resolved to, if anything — shown immediately while the fetch
    // below refreshes it, rather than dropping back to the artwork-less nav stub.
    const remembered = artistPageMemory.get(artist.id) ?? null;
    setPage(remembered);
    setIsLoading(!remembered);
    setError(null);
    setFilter("all");
    setShowAllSongs(false);
    void libraryController.getArtist(artist.id, (updated) => {
      if (!active) return;
      setPage(updated);
      artistPageMemory.set(artist.id, updated);
    })
      .then((result) => {
        if (!active) return;
        setPage(result);
        artistPageMemory.set(artist.id, result);
      })
      .catch(() => {
        // A remembered page is still good to show; only a cold load has nothing to fall back to.
        if (active && !remembered) setError("Unable to load this artist.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [artist, libraryController]);

  const releaseTypes = useMemo(
    () => new Set(page?.releases.map((release) => release.releaseType) ?? []),
    [page?.releases],
  );
  const releaseFilters = useMemo(
    () => (["all", "album", "single", "ep"] as const)
      .filter((type) => type === "all" || releaseTypes.has(type)),
    [releaseTypes],
  );
  const visibleReleases = page?.releases.filter(
    (release) => filter === "all" || release.releaseType === filter,
  ) ?? [];

  const displayedArtist = page?.artist ?? artist;
  /*
   * Six is all `popularSongs` ever holds — the data source caps it there when it enriches them
   * with view counts. The rest of the artist's catalogue is already fetched and sitting in
   * `allSongs`, so expanding costs a render rather than a round trip.
   */
  const allSongs = page?.allSongs ?? [];
  const popularSongs = showAllSongs
    ? allSongs
    : (page?.popularSongs.slice(0, POPULAR_PREVIEW_COUNT) ?? []);
  // Hidden when the shelf was unavailable, in which case `allSongs` falls back to these six.
  const hiddenSongCount = allSongs.length - popularSongs.length;

  useEffect(() => {
    setIsSubscribed(page?.subscribed ?? false);
  }, [page?.subscribed]);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  if (!artist || !displayedArtist) return null;

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3000);
  };

  const trackIds = useMemo(
    () => new Set((page?.allSongs ?? []).map((track) => track.id)),
    [page],
  );
  const isCurrentCollection = currentTrackId !== null && trackIds.has(currentTrackId);

  const togglePlayCollection = () => {
    if (isCurrentCollection) {
      playerController.togglePlayPause();
      return;
    }
    playInOrder();
  };

  const playInOrder = () => {
    const songs = page?.allSongs ?? [];
    if (songs[0]) void playerController.playTrackById(songs[0].id, songs);
  };

  /*
   * Queued in its listed order with shuffle switched on afterwards, not pre-shuffled — so the
   * player bar's toggle reflects reality, and turning shuffle off restores the original order.
   */
  const playShuffled = async () => {
    const songs = page?.allSongs ?? [];
    const firstTrack = shuffleTracks(songs)[0];
    if (!firstTrack) return;
    const started = await playerController.playTrackById(firstTrack.id, songs, false, true);
    if (!started) return;
    playerController.setShuffleEnabled(true);
  };

  /**
   * Changes how often YouTube notifies about this artist.
   *
   * Optimistic, and deliberately so: YouTube does not report the current level on the artist
   * page, so local state is the only record of the choice within a session. A failure puts the
   * previous value back rather than leaving the control showing something that was refused.
   */
  const changeNotificationLevel = async (level: ArtistNotificationLevel) => {
    const previous = notificationLevel;
    setNotificationLevel(level);
    try {
      await libraryController.setArtistNotificationLevel(displayedArtist, level);
      showToast(
        level === "all"
          ? "Notifying you about every release"
          : level === "none" ? "Notifications off" : "Notifications set to personalized",
      );
    } catch (notificationError) {
      setNotificationLevel(previous);
      showToast(
        notificationError instanceof Error
          ? notificationError.message
          : "Unable to change notifications.",
      );
    }
  };

  const toggleArtistSubscription = async () => {
    if (isSubscribing) return;
    const nextSubscribed = !isSubscribed;
    setIsSubscribing(true);
    try {
      await libraryController.setArtistSubscribed(displayedArtist, nextSubscribed);
      setIsSubscribed(nextSubscribed);
      // Unsubscribing drops the preference server-side; showing the old level after
      // resubscribing would claim a setting that no longer exists.
      if (!nextSubscribed) setNotificationLevel("personalized");
    } catch (subscribeError) {
      showToast(
        subscribeError instanceof Error
          ? subscribeError.message
          : "Unable to update this subscription.",
      );
    } finally {
      setIsSubscribing(false);
    }
  };

  const copyArtistUrl = async () => {
    try {
      await navigator.clipboard.writeText(getArtistUrl(displayedArtist));
      showToast("Url copied to clipboard");
    } catch {
      showToast("Unable to copy the link.");
    }
  };

  return (
    <div className="flex flex-col gap-7">
      <MediaHeader
        eyebrow="Artist"
        title={
          <button
            type="button"
            className="group/title flex items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => void copyArtistUrl()}
            aria-label={`Copy ${displayedArtist.name} URL`}
          >
            <span>{displayedArtist.name}</span>
            <CopyIcon
              className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100"
              size={22}
              aria-hidden="true"
            />
          </button>
        }
        meta={displayedArtist.subscriberCount}
        artworkUrl={displayedArtist.artworkUrl}
        artworkSize={160}
        /*
         * The same component every other cover in the app uses. Its own ladder ends by
         * refetching the image through Tauri and painting the bytes, which is what rescues a
         * url the webview refuses to load directly — the hand-rolled <img> here had no such
         * step, and looped back to the first candidate forever once they had all failed.
         *
         * preferProxy: an artist portrait is a googleusercontent URL far more often than not,
         * and those routinely refuse the webview's own referer. The direct ladder stays as a
         * live fallback either way — this only starts the Rust proxy racing it immediately
         * instead of waiting for the (likely) direct failures first, so switching away mid
         * resolution no longer meant the avatar was still mid-walk whenever you came back.
         */
        artworkSlot={
          <TrackArtwork
            className="size-40 shrink-0 rounded-lg"
            size={160}
            artworkUrl={displayedArtist.artworkUrl}
            iconSize={64}
            variant="artist"
            loading="eager"
            preferProxy
          />
        }
        actionsDisabled={isLoading || Boolean(error) || !page?.allSongs.length}
        playback={{
          onToggle: togglePlayCollection,
          isPlaying: isCurrentCollection && isPlaying,
          isLoading: isCurrentCollection && isPlayerLoading,
        }}
        onShuffle={() => void playShuffled()}
        onAddToQueue={() => playerController.addTracksToQueue(page?.allSongs ?? [])}
        onAddToPlaylist={() => {
          const songs = page?.allSongs ?? [];
          if (songs.length > 0) openPlaylistPicker(songs[0], songs);
        }}
        actions={
          <div className="flex items-center gap-2">
            <button
              className={cn(HEADER_SECONDARY_BUTTON, "px-4")}
              type="button"
              disabled={isLoading || Boolean(error) || isSubscribing}
              onClick={() => void toggleArtistSubscription()}
            >
              <span>
                {isSubscribing
                  ? isSubscribed ? "Unsubscribing..." : "Subscribing..."
                  : isSubscribed ? "Subscribed" : "Subscribe"}
              </span>
            </button>

            {/*
              Only while subscribed: YouTube stores the preference against the subscription and
              discards it when that goes away, so offering the control otherwise would accept a
              choice it then silently drops.
            */}
            {isSubscribed && (
              <Select
                className="w-44"
                value={notificationLevel}
                onValueChange={(value) =>
                  void changeNotificationLevel(value as ArtistNotificationLevel)}
              >
                <SelectTrigger aria-label={`Notifications for ${displayedArtist.name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All new releases</SelectItem>
                  <SelectItem value="personalized">Personalized</SelectItem>
                  <SelectItem value="none">No notifications</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        }
      />

      {/*
       * Section headings stay in place — only the rows/cards under them are placeholders. The
       * release-type filter is left out here rather than shown empty: it lists whichever
       * types this artist actually has (`releaseFilters`), which is not known before `page`
       * arrives, so there is nothing honest to render there yet.
       */}
      {isLoading && (
        <div className={SONGS_AND_RELEASES}>
          <section className="flex flex-col gap-3">
            <h2>Top songs</h2>
            <TrackListSkeleton count={POPULAR_PREVIEW_COUNT} label="Loading top songs" />
          </section>
          {/*
            Releases has no fixed preview count — unlike Top songs, every release the artist
            has is shown. `AlbumGridSkeleton`'s own default is what "Listen again"/"More
            recommendations" on Home use for the same reason: a guess at one row, not a real
            number to match.
          */}
          <section className="flex flex-col gap-3">
            <h2>Albums</h2>
            <AlbumGridSkeleton label="Loading releases" />
          </section>
        </div>
      )}
      {error && <p className="px-2 py-10 text-center text-sm text-muted-foreground">{error}</p>}

      {!isLoading && !error && page && (
        <>
          {(popularSongs.length > 0 || page.releases.length > 0) && (
            <div className={SONGS_AND_RELEASES}>
              {popularSongs.length > 0 && (
                <section className="flex min-w-0 flex-col gap-3">
                  <h2>Top songs</h2>
                  <div className="flex flex-col gap-0.5">
                    {popularSongs.map((track, index) => {
                      const views = compactViews(track);
                      return (
                        <TrackRow
                          key={track.id}
                          track={track}
                          index={index}
                          isCurrent={currentTrackId !== null && track.id === currentTrackId}
                          isPlaying={isPlaying && track.id === currentTrackId}
                          suppressArtistId={displayedArtist.id}
                          detail={views ? `${views} plays` : undefined}
                          onSelect={() => void playerController.playTrackById(track.id, page.allSongs)}
                          showDownload
                          showDuration
                          showRating
                          onQuickAddToQueue={() => playerController.addToQueue(track)}
                          onQuickAdd={() => openPlaylistPicker(track)}
                          onContextMenu={(event) => openTrackMenu(event, track)}
                        />
                      );
                    })}
                  </div>
                  {(hiddenSongCount > 0 || showAllSongs) && (
                    <button
                      type="button"
                      onClick={() => setShowAllSongs((current) => !current)}
                      aria-expanded={showAllSongs}
                      className="h-9 self-start rounded bg-muted px-4 text-sm font-medium text-foreground transition-colors hover:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {showAllSongs ? "Show less" : `Show all ${allSongs.length} songs`}
                    </button>
                  )}
                </section>
              )}

              {page.releases.length > 0 && (
                <section className="flex min-w-0 flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2>Albums</h2>
                    <div
                      className="flex flex-wrap items-center gap-2"
                      role="group"
                      aria-label="Release type"
                    >
                      {releaseFilters
                        .map((type) => (
                          <button
                            key={type}
                            type="button"
                            className={cn(
                              "flex h-8 items-center rounded px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              filter === type
                                ? "bg-foreground text-background"
                                : "bg-card text-foreground hover:bg-muted",
                            )}
                            aria-pressed={filter === type}
                            onClick={() => setFilter(type)}
                          >
                            {type === "all"
                              ? "All"
                              : type === "ep"
                                ? "EPs"
                                : `${type[0].toUpperCase()}${type.slice(1)}s`}
                          </button>
                        ))}
                    </div>
                  </div>
                  <div key={filter} className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))] xl:grid-cols-2">
                    {visibleReleases.map((release) => {
                      const hasLinkedArtists = Boolean(release.artists?.length);
                      return (
                        <AlbumCard
                          key={release.id}
                          artworkUrl={release.artworkUrl}
                          title={release.title}
                          subtitle={hasLinkedArtists ? undefined : release.artist}
                          subtitleContent={hasLinkedArtists
                            ? (
                                <ArtistLinks
                                  artists={release.artists}
                                  fallback={release.artist}
                                  suppressArtistId={displayedArtist.id}
                                />
                              )
                            : undefined}
                          onClick={() => onOpenAlbum(release)}
                          onContextMenu={(event) => openAlbumMenu(event, release)}
                        />
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          )}

          {page.playlists.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2>Playlists</h2>
              <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">
                {page.playlists.map((playlist) => (
                  <AlbumCard
                    key={playlist.id}
                    artworkUrl={playlist.artworkUrl}
                    title={playlist.title}
                    subtitle={playlist.owner}
                    onClick={() => onOpenPlaylist(playlist)}
                    onContextMenu={(event) => openPlaylistMenu(event, playlist)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {toast && createPortal(
        <div className="fixed bottom-28 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-lg bg-foreground px-4 py-3 text-sm text-background" role="status">
          {toast === "Url copied to clipboard" && (
            <CheckIcon size={18} aria-hidden="true" />
          )}
          <span>{toast}</span>
        </div>,
        document.body,
      )}
    </div>
  );
}
