import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn, formatMinutesSeconds } from "@/lib/utils";
import { SpinnerSteps } from "@/components/motion/loader";
import {
  BackIcon,
  DownloadActiveIcon,
  DownloadIcon,
  DownloadProgressIcon,
  PlayIcon,
  SearchIcon,
} from "@/ui/icons";
import type {
  Album,
  Artist,
  Playlist,
  SearchCategory,
  SearchResults,
  Track,
} from "../../datasource/types";
import { libraryController, type PlayerControllerActions } from "../../player/playerStore";
import {
  getOfflineStatus,
  queueDownload,
  removeDownload,
  useOfflineState,
} from "../../player/offlineStore";
import { AlbumCard } from "../components/AlbumCard";
import { ArtistLinks } from "../components/ArtistLinks";
import { TrackArtwork } from "../components/TrackArtwork";
import { usePlaylistContextMenu } from "../components/PlaylistContextMenu";
import { useTrackContextMenu } from "../components/TrackContextMenu";

function normalizeSearchKey(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

type SelectableItem =
  | { kind: "artist"; artist: Artist }
  | { kind: "track"; track: Track }
  | { kind: "album"; album: Album }
  | { kind: "playlist"; playlist: Playlist };

type SearchScope = "all" | "songs" | "artists" | "albums" | "playlists";

const SCOPES: Array<{
  value: SearchScope;
  label: string;
  field: keyof SearchResults;
  /** The filter YouTube Music runs for a deep search of this scope. */
  category?: SearchCategory;
}> = [
  { value: "all", label: "All", field: "tracks" },
  { value: "songs", label: "Songs", field: "tracks", category: "song" },
  { value: "artists", label: "Artists", field: "artists", category: "artist" },
  { value: "albums", label: "Albums", field: "albums", category: "album" },
  { value: "playlists", label: "Playlists", field: "playlists", category: "playlist" },
];

const EMPTY_RESULTS: SearchResults = { artists: [], tracks: [], albums: [], playlists: [] };

function buildFlatItems(results: SearchResults, songsFirst: boolean): SelectableItem[] {
  const items: SelectableItem[] = [];
  if (results.artists.length > 0 && !songsFirst) {
    for (const artist of results.artists) items.push({ kind: "artist", artist });
  }
  for (const track of results.tracks) items.push({ kind: "track", track });
  if (results.artists.length > 0 && songsFirst) {
    for (const artist of results.artists) items.push({ kind: "artist", artist });
  }
  for (const album of results.albums) items.push({ kind: "album", album });
  for (const playlist of results.playlists) items.push({ kind: "playlist", playlist });
  return items;
}

/** Rectangular filter chip; the selected one inverts. */
const CHIP = "h-8 rounded px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type TopResult =
  | { kind: "artist"; artist: Artist }
  | { kind: "track"; track: Track }
  | { kind: "album"; album: Album }
  | { kind: "playlist"; playlist: Playlist };

/**
 * A song's download state as a glyph: outline when absent, filling while it downloads, filled
 * once it is on disk. Subscribes on its own so download progress does not re-render the page.
 */
function useDownloadState(track: Track) {
  const offline = useOfflineState();
  const status = getOfflineStatus(track.id);
  const toggle = () => {
    if (status === "ready") void removeDownload(track.id);
    else queueDownload(track);
  };
  const label = status === "ready" ? `Remove ${track.title} from downloads` : `Download ${track.title}`;
  const icon = (size: number) => status === "ready"
    ? <DownloadActiveIcon size={size} aria-hidden="true" />
    : status === "downloading"
      ? <DownloadProgressIcon size={size} progress={(offline.progress ?? 0) / 100} aria-hidden="true" />
      : <DownloadIcon size={size} aria-hidden="true" />;
  return { status, toggle, label, icon };
}

function RowDownloadToggle({ track }: { track: Track }) {
  const { status, toggle, label, icon } = useDownloadState(track);
  if (track.source === "local") return <span className="size-[18px] shrink-0" aria-hidden="true" />;
  return (
    // A span, not a button: it sits inside the row's own button.
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={status === "ready"}
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        status === "failed" ? "text-destructive" : "text-foreground",
      )}
      onClick={(event) => {
        event.stopPropagation();
        toggle();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        toggle();
      }}
    >
      {icon(18)}
    </span>
  );
}

function TopResultDownloadButton({ track }: { track: Track }) {
  const { status, toggle, label, icon } = useDownloadState(track);
  if (track.source === "local") return null;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={status === "ready"}
      onClick={toggle}
      className={cn(
        "grid size-9 place-items-center rounded bg-muted transition-colors hover:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        status === "failed" ? "text-destructive" : "text-foreground",
      )}
    >
      {icon(20)}
    </button>
  );
}

function SearchLoadingSpinner() {
  return (
    <div className="grid place-items-center px-2 py-16 text-muted-foreground" role="status" aria-live="polite" aria-label="Searching">
      <SpinnerSteps size={30} color="currentColor" />
    </div>
  );
}

export function SearchResultsPage({
  query,
  results,
  isLoading,
  playerController,
  onPlayTrack,
  onOpenArtist,
  onOpenAlbum,
  onOpenPlaylist,
  onBack,
  onEditSearch,
}: {
  query: string;
  results: SearchResults;
  isLoading: boolean;
  playerController: PlayerControllerActions;
  onPlayTrack?: (track: Track) => Promise<void> | void;
  onOpenArtist: (artist: Artist) => void;
  onOpenAlbum: (album: Album) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
  /** Shows a back button beside the search field. */
  onBack?: () => void;
  /** Reopens search. When given, the query is shown in a search field rather than a heading. */
  onEditSearch?: () => void;
}) {
  const { openTrackMenu } = useTrackContextMenu();
  const { openPlaylistMenu, openAlbumMenu } = usePlaylistContextMenu();
  const [scope, setScope] = useState<SearchScope>("all");

  // A scope from the previous query is meaningless against the next one, and silently hiding
  // results the new search did find is the worst outcome.
  useEffect(() => setScope("all"), [query]);

  /*
   * A filtered search, run when a category tab is opened.
   *
   * The mixed search that fills this page samples every category, so its "Songs" shelf is a
   * handful of rows rather than the answer to "show me the songs". Asking YouTube Music for
   * one category returns a proper list, which is the whole point of the tab.
   */
  const [deepResults, setDeepResults] = useState<SearchResults | null>(null);
  const [isDeepLoading, setIsDeepLoading] = useState(false);

  useEffect(() => {
    const category = SCOPES.find((item) => item.value === scope)?.category;
    if (!category || !query.trim()) {
      setDeepResults(null);
      setIsDeepLoading(false);
      return;
    }

    // Guards against a slow request for one tab landing after the user has moved to another.
    let active = true;
    setDeepResults(null);
    setIsDeepLoading(true);
    void libraryController.searchCategory(query, category)
      .then((fetched) => {
        if (active) setDeepResults(fetched);
      })
      .catch(() => {
        // Falling back to the mixed results is a worse answer, not a broken one.
        if (active) setDeepResults(null);
      })
      .finally(() => {
        if (active) setIsDeepLoading(false);
      });

    return () => {
      active = false;
    };
  }, [query, scope]);

  /*
   * Scoping filters the results *before* anything else reads them, so the flat list that
   * drives keyboard selection contains exactly what is on screen. Filtering only at render
   * would leave arrow-down walking through hidden entries.
   */
  const scopedResults = useMemo<SearchResults>(() => {
    if (scope === "all") return results;

    // The deep search is already filtered; the mixed results still need narrowing, and stand
    // in while the deep one is loading or after it has failed.
    const source = deepResults ?? results;
    const narrowed: SearchResults = {
      artists: scope === "artists" ? source.artists : [],
      tracks: scope === "songs" ? source.tracks : [],
      albums: scope === "albums" ? source.albums : [],
      playlists: scope === "playlists" ? source.playlists : [],
    };
    const total = narrowed.artists.length + narrowed.tracks.length
      + narrowed.albums.length + narrowed.playlists.length;
    // A deep search that came back empty is not a reason to show nothing when the mixed
    // search had something for this category.
    return total > 0 || !deepResults ? narrowed : {
      ...EMPTY_RESULTS,
      artists: scope === "artists" ? results.artists : [],
      tracks: scope === "songs" ? results.tracks : [],
      albums: scope === "albums" ? results.albums : [],
      playlists: scope === "playlists" ? results.playlists : [],
    };
  }, [deepResults, results, scope]);

  const availableScopes = useMemo(
    () => SCOPES.filter(
      (item) => item.value === "all" || results[item.field].length > 0,
    ),
    [results],
  );

  const hasResults = scopedResults.artists.length
    + scopedResults.tracks.length
    + scopedResults.albums.length
    + scopedResults.playlists.length > 0;
  const normalizedQuery = normalizeSearchKey(query);
  const hasExactArtist = scopedResults.artists.some(
    (artist) => normalizeSearchKey(artist.name) === normalizedQuery,
  );
  const hasExactTrack = scopedResults.tracks.some(
    (track) => normalizeSearchKey(track.title) === normalizedQuery,
  );
  const songsFirst = hasExactTrack && !hasExactArtist;

  const playTrack = useCallback((track: Track) => {
    if (onPlayTrack) void onPlayTrack(track);
    else void playerController.playTrackById(track.id, scopedResults.tracks, true);
  }, [onPlayTrack, playerController, scopedResults.tracks]);

  /*
   * Songs always come first on screen now (beside the top result), so keyboard order follows
   * them. `songsFirst` still decides what the top result is.
   */
  const flatItems = useMemo(
    () => buildFlatItems(scopedResults, true),
    [scopedResults],
  );

  const topResult = useMemo<TopResult | null>(() => {
    if (scope !== "all") return null;
    const exactArtist = hasExactArtist && !songsFirst
      ? scopedResults.artists.find((artist) => normalizeSearchKey(artist.name) === normalizedQuery)
      : undefined;
    if (exactArtist) return { kind: "artist", artist: exactArtist };
    const exactTrack = scopedResults.tracks.find(
      (track) => normalizeSearchKey(track.title) === normalizedQuery,
    );
    const track = exactTrack ?? scopedResults.tracks[0];
    if (track) return { kind: "track", track };
    if (scopedResults.artists[0]) return { kind: "artist", artist: scopedResults.artists[0] };
    if (scopedResults.albums[0]) return { kind: "album", album: scopedResults.albums[0] };
    if (scopedResults.playlists[0]) return { kind: "playlist", playlist: scopedResults.playlists[0] };
    return null;
  }, [hasExactArtist, normalizedQuery, scope, scopedResults, songsFirst]);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isKeyboardNav, setIsKeyboardNav] = useState(false);

  useEffect(() => {
    setSelectedIndex(0);
    setIsKeyboardNav(false);
  }, [results]);

  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;
  const flatItemsRef = useRef(flatItems);
  flatItemsRef.current = flatItems;
  const hasResultsRef = useRef(hasResults);
  hasResultsRef.current = hasResults;
  const resultsRef = useRef(results);
  resultsRef.current = results;

  const onOpenArtistRef = useRef(onOpenArtist);
  onOpenArtistRef.current = onOpenArtist;
  const onOpenAlbumRef = useRef(onOpenAlbum);
  onOpenAlbumRef.current = onOpenAlbum;
  const onOpenPlaylistRef = useRef(onOpenPlaylist);
  onOpenPlaylistRef.current = onOpenPlaylist;
  const onPlayTrackRef = useRef(onPlayTrack);
  onPlayTrackRef.current = onPlayTrack;
  const playerControllerRef = useRef(playerController);
  playerControllerRef.current = playerController;

  useEffect(() => {
    if (isLoading || !hasResultsRef.current) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setIsKeyboardNav(true);
        setSelectedIndex((prev) => Math.min(prev + 1, flatItemsRef.current.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setIsKeyboardNav(true);
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        const item = flatItemsRef.current[selectedIndexRef.current];
        if (!item) return;
        event.preventDefault();
        switch (item.kind) {
          case "artist":
            onOpenArtistRef.current(item.artist);
            break;
          case "track": {
            const track = item.track;
            if (onPlayTrackRef.current) {
              void onPlayTrackRef.current(track);
            } else {
              void playerControllerRef.current.playTrackById(
                track.id,
                resultsRef.current.tracks,
                true,
              );
            }
            break;
          }
          case "album":
            onOpenAlbumRef.current(item.album);
            break;
          case "playlist":
            onOpenPlaylistRef.current(item.playlist);
            break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isLoading]);

  useEffect(() => {
    if (!isKeyboardNav) return;
    const el = document.querySelector(`[data-selectable-index="${selectedIndex}"]`);
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedIndex, isKeyboardNav]);

  const handleMouseEnter = useCallback((index: number) => {
    setIsKeyboardNav(false);
    setSelectedIndex(index);
  }, []);

  const selected = useCallback(
    (index: number) => (isKeyboardNav && index === selectedIndex ? "bg-card" : ""),
    [isKeyboardNav, selectedIndex],
  );

  const enterStyle = useCallback((index: number) => ({
    "--search-enter-delay": `${Math.min(Math.max(index, 0), 18) * 28}ms`,
  } as CSSProperties), []);

  const songsSection = scopedResults.tracks.length > 0 && (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="text-xl font-semibold">Songs</h2>
      <div className="flex flex-col gap-0.5" data-onboarding="search-results">
        {scopedResults.tracks.map((track) => {
          const index = flatItems.findIndex(
            (item) => item.kind === "track" && item.track.id === track.id,
          );
          return (
            <button
              key={track.id}
              type="button"
              data-selectable-index={index}
              className={cn(
                "group/row flex w-full items-center gap-3 rounded px-2 py-1.5 text-left transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                "animate-in fade-in",
                selected(index),
              )}
              style={enterStyle(index)}
              onContextMenu={(event) => openTrackMenu(event, track)}
              onClick={() => playTrack(track)}
              onMouseEnter={() => handleMouseEnter(index)}
            >
              <TrackArtwork
                className="size-10 shrink-0 rounded bg-card object-cover"
                size={40}
                artworkUrl={track.artworkUrl}
                iconSize={20}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <strong className="truncate text-sm font-semibold text-foreground">{track.title}</strong>
                <span className="truncate text-[13px] text-muted-foreground">
                  <ArtistLinks artists={track.artists} fallback={track.artist} />
                </span>
              </span>
              <span className="hidden w-[200px] shrink-0 truncate text-[13px] text-muted-foreground xl:block">
                {track.album}
              </span>
              <RowDownloadToggle track={track} />
              <time className="w-10 shrink-0 text-right text-[13px] text-muted-foreground">
                {track.durationSec != null ? formatMinutesSeconds(track.durationSec) : ""}
              </time>
            </button>
          );
        })}
      </div>
    </section>
  );

  const openTopResult = (result: TopResult) => {
    if (result.kind === "track") playTrack(result.track);
    else if (result.kind === "artist") onOpenArtist(result.artist);
    else if (result.kind === "album") onOpenAlbum(result.album);
    else onOpenPlaylist(result.playlist);
  };

  const topResultSection = topResult && (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Top result</h2>
      <div
        className="flex flex-col gap-4 rounded-lg bg-chrome p-5"
        onContextMenu={topResult.kind === "track"
          ? (event) => openTrackMenu(event, topResult.track)
          : topResult.kind === "album"
            ? (event) => openAlbumMenu(event, topResult.album)
            : topResult.kind === "playlist"
              ? (event) => openPlaylistMenu(event, topResult.playlist)
              : undefined}
      >
        <TrackArtwork
          className="size-[120px] shrink-0 rounded-lg bg-card object-cover"
          size={120}
          artworkUrl={
            topResult.kind === "track" ? topResult.track.artworkUrl
              : topResult.kind === "artist" ? topResult.artist.artworkUrl
                : topResult.kind === "album" ? topResult.album.artworkUrl
                  : topResult.playlist.artworkUrl
          }
          iconSize={48}
          loading="eager"
          variant={topResult.kind === "track" ? "track" : topResult.kind}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-2xl font-semibold text-foreground">
            {topResult.kind === "track" ? topResult.track.title
              : topResult.kind === "artist" ? topResult.artist.name
                : topResult.kind === "album" ? topResult.album.title
                  : topResult.playlist.title}
          </span>
          <span className="truncate text-[13px] text-muted-foreground">
            {topResult.kind === "track" ? (
              <>
                Song · <ArtistLinks artists={topResult.track.artists} fallback={topResult.track.artist} />
                {topResult.track.durationSec != null && ` · ${formatMinutesSeconds(topResult.track.durationSec)}`}
              </>
            ) : topResult.kind === "artist" ? (
              topResult.artist.subscriberCount ? `Artist · ${topResult.artist.subscriberCount}` : "Artist"
            ) : topResult.kind === "album" ? (
              `Album · ${topResult.album.artist}`
            ) : (
              `Playlist · ${topResult.playlist.owner}`
            )}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => openTopResult(topResult)}
            className="flex h-9 items-center gap-1.5 rounded bg-foreground pl-3 pr-4 text-sm font-medium text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {topResult.kind === "track" ? (
              <>
                <PlayIcon size={18} aria-hidden="true" />
                Play
              </>
            ) : (
              <span className="pl-1">Open</span>
            )}
          </button>
          {topResult.kind === "track" && <TopResultDownloadButton track={topResult.track} />}
        </div>
      </div>
    </section>
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-6">
        {onEditSearch ? (
          <div className="flex items-center gap-3 self-center">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                aria-label="Back"
                className="grid size-10 shrink-0 place-items-center rounded text-foreground transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <BackIcon size={20} aria-hidden="true" />
              </button>
            ) : (
              <span className="size-10 shrink-0" aria-hidden="true" />
            )}
            <button
              type="button"
              onClick={onEditSearch}
              aria-label={`Search: ${query}`}
              className="flex h-11 w-[600px] min-w-0 items-center gap-2.5 rounded bg-card px-3.5 text-left text-[15px] text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground"
            >
              <SearchIcon size={20} className="shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{query}</span>
            </button>
            <span className="size-10 shrink-0" aria-hidden="true" />
          </div>
        ) : (
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label="Back"
                className="grid size-10 shrink-0 place-items-center rounded text-foreground transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <BackIcon size={20} aria-hidden="true" />
              </button>
            )}
            <h1 className="min-w-0 truncate text-[32px] font-semibold text-foreground">{query}</h1>
          </div>
        )}

        {/* Only offered when there is something to narrow to: a row of filters where every
            one but "All" is empty is just noise. */}
        {!isLoading && availableScopes.length > 2 && (
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter results">
            {availableScopes.map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={scope === item.value}
                onClick={() => setScope(item.value)}
                className={cn(
                  CHIP,
                  scope === item.value
                    ? "bg-foreground text-background"
                    : "bg-card text-foreground hover:bg-muted",
                )}
              >
                {item.label}
                {item.value !== "all" && (
                  <span className="ml-1.5 tabular-nums opacity-60">
                    {results[item.field].length}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </header>

      {isLoading || (isDeepLoading && !hasResults) ? (
        <SearchLoadingSpinner />
      ) : !hasResults ? (
        <p className="px-2 py-10 text-center text-sm text-muted-foreground">No results found.</p>
      ) : (
        <div className="flex flex-col gap-8">
          {topResultSection ? (
            <div className="grid gap-10 [grid-template-columns:400px_minmax(0,1fr)]">
              {topResultSection}
              {songsSection}
            </div>
          ) : songsSection}

          {scopedResults.artists.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold">Artists</h2>
              <div className="grid grid-cols-8 gap-5">
                {scopedResults.artists.map((artist) => {
                  const index = flatItems.findIndex(
                    (item) => item.kind === "artist" && item.artist.id === artist.id,
                  );
                  return (
                    <div
                      key={artist.id}
                      data-selectable-index={index}
                      className={cn("animate-in fade-in rounded-lg", selected(index))}
                      style={enterStyle(index)}
                      onMouseEnter={() => handleMouseEnter(index)}
                    >
                      <AlbumCard
                        artworkUrl={artist.artworkUrl}
                        variant="artist"
                        size={128}
                        title={artist.name}
                        subtitle={artist.subscriberCount || "Artist"}
                        onClick={() => onOpenArtist(artist)}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {scopedResults.albums.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold">Albums</h2>
              <div className="grid grid-cols-8 gap-5">
                {scopedResults.albums.map((album) => {
                  const index = flatItems.findIndex(
                    (item) => item.kind === "album" && item.album.id === album.id,
                  );
                  return (
                    <div
                      key={album.id}
                      data-selectable-index={index}
                      className={cn("animate-in fade-in rounded-lg", selected(index))}
                      style={enterStyle(index)}
                      onMouseEnter={() => handleMouseEnter(index)}
                    >
                      <AlbumCard
                        artworkUrl={album.artworkUrl}
                        size={128}
                        title={album.title}
                        subtitleContent={(
                          <ArtistLinks artists={album.artists} fallback={album.artist} />
                        )}
                        onClick={() => onOpenAlbum(album)}
                        onContextMenu={(event) => openAlbumMenu(event, album)}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {scopedResults.playlists.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold">Playlists</h2>
              <div className="grid grid-cols-8 gap-5">
                {scopedResults.playlists.map((playlist) => {
                  const index = flatItems.findIndex(
                    (item) => item.kind === "playlist" && item.playlist.id === playlist.id,
                  );
                  return (
                    <div
                      key={playlist.id}
                      data-selectable-index={index}
                      className={cn("animate-in fade-in rounded-lg", selected(index))}
                      style={enterStyle(index)}
                      onMouseEnter={() => handleMouseEnter(index)}
                    >
                      <AlbumCard
                        artworkUrl={playlist.artworkUrl}
                        variant="playlist"
                        size={128}
                        title={playlist.title}
                        subtitle={playlist.owner}
                        onClick={() => onOpenPlaylist(playlist)}
                        onContextMenu={(event) => openPlaylistMenu(event, playlist)}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
