import {
  type FormEvent,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";
import { cn } from "@/lib/utils";
import { CloseIcon, EyeClosedIcon, EyeIcon, PlusIcon, SearchIcon } from "@/ui/icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/motion/select";
import type { Album, Artist, Playlist, Track } from "../../datasource/types";
import type { LibraryState } from "../../player/LibraryController";
import { libraryController, type PlayerControllerActions } from "../../player/playerStore";
import { queueDownloads } from "../../player/offlineStore";
import { useSyncedPlaylists } from "../../player/playlistSync";
import { logInternalError } from "../../internal/logging";
import { getLocalPlaylistItems, subscribeToLocalPlaylists } from "../../player/localPlaylists";
import { AlbumCard } from "../components/AlbumCard";
import { SelectionBar } from "../components/SelectionBar";
import { TrackRow } from "../components/TrackRow";
import { useTrackContextMenu } from "../components/TrackContextMenu";
import { usePlaylistContextMenu } from "../components/PlaylistContextMenu";
import { useNowPlaying } from "../hooks/useNowPlaying";
import { useTrackSelection } from "../hooks/useTrackSelection";
import { isLikedSongsId } from "../likedSongsArtwork";
import { useHiddenPlaylistIds } from "../settings/hiddenPlaylists";

type LibraryTab = "songs" | "albums" | "artists" | "playlists";

const TABS: Array<{ value: LibraryTab; label: string }> = [
  { value: "playlists", label: "Playlists" },
  { value: "albums", label: "Albums" },
  { value: "artists", label: "Artists" },
  { value: "songs", label: "Songs" },
];

const GRID = "grid grid-cols-6 gap-6";

/** Rectangular filter chip; the selected one inverts. */
const CHIP = "h-8 rounded px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const SECONDARY_BUTTON = "flex h-9 shrink-0 items-center gap-1.5 rounded bg-muted px-4 text-sm font-medium text-foreground transition-colors hover:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/** "recent" is YouTube's own order, which is newest-first — so it sorts by doing nothing. */
type LibrarySort = "recent" | "title" | "artist";

function matches(query: string, ...fields: Array<string | undefined>): boolean {
  if (!query) return true;
  return fields.some((field) => field?.toLocaleLowerCase().includes(query));
}

/**
 * Numeric and case-insensitive, so "Album 2" sorts before "Album 10" and casing does not
 * split the list. A bare `localeCompare` gets both of those wrong.
 */
function compareText(left: string | undefined, right: string | undefined): number {
  return (left || "￿").localeCompare(right || "￿", undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function sortItems<T>(
  items: T[],
  sort: LibrarySort,
  title: (item: T) => string,
  artist: (item: T) => string,
): T[] {
  if (sort === "recent") return items;
  const key = sort === "artist" ? artist : title;
  return [...items].sort((left, right) => compareText(key(left), key(right)));
}

/**
 * Two different nothings.
 *
 * "No songs found" covered both an empty library and a filter that matched nothing, which are
 * different problems with different fixes — one needs saving something, the other needs the
 * filter cleared. Saying which, and offering the way out, is the whole job of this.
 */
function EmptyState({
  noun,
  query,
  onClearQuery,
}: {
  noun: string;
  query: string;
  onClearQuery: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-2 py-16 text-center">
      <p className="text-sm text-muted-foreground">
        {query ? `No ${noun} match "${query}".` : `No ${noun} in your library yet.`}
      </p>
      {query && (
        <button type="button" onClick={onClearQuery} className={SECONDARY_BUTTON}>
          Clear filter
        </button>
      )}
    </div>
  );
}

/**
 * Your library, browsable as a whole.
 *
 * The sidebar only ever led to one playlist or album at a time; there was no way to see
 * everything you have. Artists are derived rather than fetched — the library snapshot has no
 * artist list, but every saved album and liked song names one, and that union is the set of
 * artists you actually own something by.
 */
export function LibraryPage({
  libraryState,
  playerController,
  onOpenAlbum,
  onOpenArtist,
  onOpenPlaylist,
}: {
  libraryState: LibraryState;
  playerController: PlayerControllerActions;
  onOpenAlbum: (album: Album) => void;
  onOpenArtist: (artist: Artist) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
}) {
  const [tab, setTab] = useState<LibraryTab>("playlists");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<LibrarySort>("recent");
  const { currentTrackId, isPlaying } = useNowPlaying();
  const { openTrackMenu, openPlaylistPicker } = useTrackContextMenu();
  const { openPlaylistMenu, openAlbumMenu } = usePlaylistContextMenu();
  const syncedPlaylists = useSyncedPlaylists();

  /*
   * Subscribed, not read once. `getLocalPlaylistItems()` was called inside the playlists memo
   * whose deps never mentioned it, so creating, renaming, deleting or re-covering a local
   * playlist left this page showing the old list until something unrelated re-rendered it.
   */
  const localPlaylists = useSyncExternalStore(
    subscribeToLocalPlaylists,
    getLocalPlaylistItems,
    getLocalPlaylistItems,
  );

  const library = libraryState.library;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const isFiltering = normalizedQuery.length > 0;
  // Artists have no second field to sort on, so that option is hidden there rather than
  // silently doing nothing when the tab changes under a chosen sort.
  const activeSort: LibrarySort = tab === "artists" && sort === "artist" ? "title" : sort;

  // Liked Songs first, then everything else saved to the library — two lists on YouTube's
  // side, one "Songs" tab here.
  // Deduped: a song that is both liked and saved to the library appears in both lists, and
  // listing it twice also broke row keys and multi-select, which address a track by id.
  const allSongs = useMemo(() => {
    const byId = new Map<string, Track>();
    for (const track of [...(library?.likedSongs ?? []), ...(library?.librarySongs ?? [])]) {
      if (!byId.has(track.id)) byId.set(track.id, track);
    }
    return [...byId.values()];
  }, [library?.likedSongs, library?.librarySongs]);

  const songs = useMemo(
    () => sortItems(
      allSongs.filter((track) => matches(normalizedQuery, track.title, track.artist, track.album)),
      activeSort,
      (track) => track.title,
      (track) => track.artist,
    ),
    [activeSort, allSongs, normalizedQuery],
  );

  const albums = useMemo(
    () => sortItems(
      (library?.albums ?? []).filter((album) =>
        matches(normalizedQuery, album.title, album.artist)),
      activeSort,
      (album) => album.title,
      (album) => album.artist,
    ),
    [activeSort, library?.albums, normalizedQuery],
  );

  const playlists = useMemo(() => {
    const all = [...(library?.playlists ?? []), ...localPlaylists];
    return sortItems(
      all.filter((playlist) => matches(normalizedQuery, playlist.title, playlist.owner)),
      activeSort,
      (playlist) => playlist.title,
      (playlist) => playlist.owner,
    );
  }, [activeSort, library?.playlists, localPlaylists, normalizedQuery]);

  /*
   * A display filter, not a second data source: `playlists` above stays the full sorted list,
   * so a hidden playlist keeps its place in that order the moment "show hidden" reveals it
   * again, rather than jumping to wherever it would fall in a filtered-then-reappended list.
   */
  const hiddenPlaylistIds = useHiddenPlaylistIds();
  const hiddenPlaylistIdSet = useMemo(() => new Set(hiddenPlaylistIds), [hiddenPlaylistIds]);
  const [showHiddenPlaylists, setShowHiddenPlaylists] = useState(false);
  const visiblePlaylists = useMemo(
    () => playlists.filter((item) => !hiddenPlaylistIdSet.has(item.id)),
    [playlists, hiddenPlaylistIdSet],
  );
  const hiddenPlaylistCount = playlists.length - visiblePlaylists.length;
  const displayedPlaylists = showHiddenPlaylists ? playlists : visiblePlaylists;

  const allArtists = useMemo(() => {
    const byId = new Map<string, Artist>();
    /*
     * The artist references carried by albums and tracks are a name and a channel id — no
     * photo. The library's own artists section is the only place those come from, so it is
     * consulted by id and by name for anything derived below.
     */
    const artworkByName = new Map(
      (library?.artists ?? [])
        .filter((artist) => artist.artworkUrl)
        .map((artist) => [artist.name.trim().toLocaleLowerCase(), artist.artworkUrl] as const),
    );
    const remember = (reference: { id?: string; name?: string; artworkUrl?: string }) => {
      const name = reference.name?.trim();
      if (!name) return;
      // Matching on name is for references that have no channel id at all. Applying it to one
      // that does would hand an artist the photo of whoever shares their name.
      const artworkUrl = reference.artworkUrl
        ?? (reference.id ? undefined : artworkByName.get(name.toLocaleLowerCase()));
      // Keyed by id where there is one, by name otherwise: an artist without an id still
      // deserves a single row rather than one per track that mentions them.
      const key = reference.id ?? `name:${name.toLocaleLowerCase()}`;
      const existing = byId.get(key);
      if (existing) {
        if (!existing.artworkUrl && artworkUrl) existing.artworkUrl = artworkUrl;
        return;
      }
      byId.set(key, { id: reference.id ?? key, name, artworkUrl });
    };

    for (const artist of library?.artists ?? []) remember(artist);
    for (const album of library?.albums ?? []) {
      if (album.artists?.length) album.artists.forEach((item) => remember(item));
      // No album cover as a stand-in: it is a picture of a record, not of the artist, and one
      // arbitrary sleeve in a round frame reads as the wrong person entirely.
      else remember({ name: album.artist });
    }
    for (const track of [...(library?.likedSongs ?? []), ...(library?.librarySongs ?? [])]) {
      if (track.artists?.length) track.artists.forEach((item) => remember(item));
      else remember({ name: track.artist });
    }

    return [...byId.values()];
  }, [library?.albums, library?.artists, library?.likedSongs, library?.librarySongs]);

  const artists = useMemo(
    () => sortItems(
      allArtists.filter((artist) => matches(normalizedQuery, artist.name)),
      activeSort,
      (artist) => artist.name,
      (artist) => artist.name,
    ),
    [activeSort, allArtists, normalizedQuery],
  );

  const selection = useTrackSelection(songs);
  const tabsId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectTab = useCallback((next: LibraryTab) => {
    setTab(next);
    selection.clear();
  }, [selection]);

  /** Null while the name field is closed. */
  const [newPlaylistName, setNewPlaylistName] = useState<string | null>(null);
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false);
  const [createPlaylistError, setCreatePlaylistError] = useState<string | null>(null);

  const closeNewPlaylist = () => {
    setNewPlaylistName(null);
    setCreatePlaylistError(null);
  };

  const createPlaylist = async (event: FormEvent) => {
    event.preventDefault();
    const title = newPlaylistName?.trim();
    if (!title || isCreatingPlaylist) return;
    setIsCreatingPlaylist(true);
    setCreatePlaylistError(null);
    try {
      await libraryController.createPlaylist(title);
      closeNewPlaylist();
      selectTab("playlists");
    } catch (error) {
      logInternalError("LibraryPage.createPlaylist failed", error);
      setCreatePlaylistError(error instanceof Error ? error.message : "Could not create the playlist.");
    } finally {
      setIsCreatingPlaylist(false);
    }
  };

  /** Arrow keys move within the tablist and wrap; Home and End jump to the ends. */
  const onTabKeyDown = useCallback((event: ReactKeyboardEvent, index: number) => {
    const last = TABS.length - 1;
    const next = event.key === "ArrowRight"
      ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft"
        ? (index === 0 ? last : index - 1)
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? last
            : -1;
    if (next < 0) return;
    event.preventDefault();
    selectTab(TABS[next].value);
    // Focus follows selection, which is what makes the roving tabindex reachable by keyboard.
    tabRefs.current[next]?.focus();
  }, [selectTab]);



  const playSong = (track: Track, index: number, event: MouseEvent<HTMLElement>) => {
    if (selection.handleRowClick(event, index)) return;
    void playerController.playTrackById(track.id, songs);
  };

  const counts: Record<LibraryTab, number> = {
    songs: songs.length,
    albums: albums.length,
    artists: artists.length,
    playlists: visiblePlaylists.length,
  };

  if (!library) {
    return (
      <p className="px-2 py-16 text-center text-sm text-muted-foreground">
        {libraryState.status === "signed-out"
          ? "Sign in to see your library."
          : "Loading your library..."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6 pt-1">
      <header className="flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-[32px] font-semibold text-foreground">Library</h1>
          {newPlaylistName === null ? (
            <button type="button" onClick={() => setNewPlaylistName("")} className={cn(SECONDARY_BUTTON, "pl-3")}>
              <PlusIcon size={18} aria-hidden="true" />
              New playlist
            </button>
          ) : (
            <form className="flex items-center gap-2" onSubmit={(event) => void createPlaylist(event)}>
              {createPlaylistError && (
                <span className="max-w-64 truncate text-[13px] text-destructive" role="alert">
                  {createPlaylistError}
                </span>
              )}
              <input
                autoFocus
                value={newPlaylistName}
                onChange={(event) => setNewPlaylistName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") closeNewPlaylist();
                }}
                placeholder="Playlist name"
                aria-label="New playlist name"
                className="h-9 w-56 rounded bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:shadow-[inset_0_0_0_2px_var(--color-foreground)]"
              />
              <button
                type="submit"
                disabled={!newPlaylistName.trim() || isCreatingPlaylist}
                className="h-9 rounded bg-foreground px-4 text-sm font-medium text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {isCreatingPlaylist ? "Creating…" : "Create"}
              </button>
              <button
                type="button"
                onClick={closeNewPlaylist}
                className="h-9 rounded px-4 text-sm font-medium text-foreground transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cancel
              </button>
            </form>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex shrink-0 gap-2" role="tablist" aria-label="Library section">
            {TABS.map((item, index) => {
              const active = tab === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  id={`${tabsId}-tab-${item.value}`}
                  aria-selected={active}
                  aria-controls={`${tabsId}-panel`}
                  tabIndex={active ? 0 : -1}
                  ref={(node) => {
                    tabRefs.current[index] = node;
                  }}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                  onClick={() => selectTab(item.value)}
                  className={cn(
                    CHIP,
                    active ? "bg-foreground text-background" : "bg-card text-foreground hover:bg-muted",
                  )}
                >
                  {item.label}
                  <span className="ml-1.5 tabular-nums opacity-60">{counts[item.value]}</span>
                </button>
              );
            })}
          </div>

          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
            <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded bg-card px-3 text-muted-foreground focus-within:shadow-[inset_0_0_0_2px_var(--color-foreground)] sm:max-w-72">
              <SearchIcon size={16} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Filter ${tab}`}
                aria-label="Filter library"
                className="w-full min-w-0 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
              />
              {isFiltering && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear filter"
                  className="shrink-0 rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <CloseIcon size={14} />
                </button>
              )}
            </label>

            <Select
              className="w-40 shrink-0"
              value={activeSort}
              onValueChange={(value) => setSort(value as LibrarySort)}
            >
              <SelectTrigger aria-label="Sort library">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Recently added</SelectItem>
                <SelectItem value="title">{tab === "artists" ? "Name" : "Title"}</SelectItem>
                {tab !== "artists" && (
                  <SelectItem value="artist">{tab === "playlists" ? "Owner" : "Artist"}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-tab-${tab}`}>
      {tab === "songs" && (
        songs.length === 0 ? (
          <EmptyState noun="songs" query={query.trim()} onClearQuery={() => setQuery("")} />
        ) : (
          <div className="flex flex-col">
            {/*
              Widths mirror TrackRow's: w-6 index, size-10 artwork, then the flexible columns.
              A list this long is scanned by column, and unlabelled columns are read twice.
            */}
            <div
              className="flex items-center gap-3 px-2 pb-2 text-xs font-medium text-muted-foreground"
              aria-hidden="true"
            >
              <span className="w-6 text-right">#</span>
              <span className="size-10 shrink-0" />
              <span className="min-w-0 flex-1">Title</span>
              <span className="hidden min-w-0 flex-1 basis-0 lg:block">Album</span>
            </div>
            <div className="flex flex-col gap-0.5">
            {songs.map((track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                index={index}
                showAlbum
                isCurrent={currentTrackId === track.id}
                isPlaying={isPlaying && currentTrackId === track.id}
                isSelected={selection.isSelected(track.id)}
                isSelectionActive={selection.isActive}
                onToggleSelected={() => selection.toggle(track.id, index)}
                onSelect={(event) => playSong(track, index, event)}
                onContextMenu={(event) => openTrackMenu(event, track)}
                onQuickAdd={() => openPlaylistPicker(track)}
                onQuickAddToQueue={() => playerController.addToQueue(track)}
                showDownload

                showRating
              />
            ))}
            </div>
          </div>
        )
      )}

      {tab === "albums" && (
        albums.length === 0 ? (
          <EmptyState noun="albums" query={query.trim()} onClearQuery={() => setQuery("")} />
        ) : (
          <div className={GRID}>
            {albums.map((album) => (
              <AlbumCard
                key={album.id}
                artworkUrl={album.artworkUrl}
                liked={isLikedSongsId(album.id)}
                title={album.title}
                subtitle={album.artist}
                onClick={() => onOpenAlbum(album)}
                onContextMenu={(event) => openAlbumMenu(event, album)}
              />
            ))}
          </div>
        )
      )}

      {tab === "artists" && (
        artists.length === 0 ? (
          <EmptyState noun="artists" query={query.trim()} onClearQuery={() => setQuery("")} />
        ) : (
          <div className={GRID}>
            {artists.map((artist) => (
              <AlbumCard
                key={artist.id}
                artworkUrl={artist.artworkUrl}
                variant="artist"
                title={artist.name}
                subtitle="Artist"
                onClick={() => onOpenArtist(artist)}
              />
            ))}
          </div>
        )
      )}

      {tab === "playlists" && (
        playlists.length === 0 ? (
          <EmptyState noun="playlists" query={query.trim()} onClearQuery={() => setQuery("")} />
        ) : (
          <div className="flex flex-col gap-3">
            {hiddenPlaylistCount > 0 && (
              <button
                type="button"
                onClick={() => setShowHiddenPlaylists((current) => !current)}
                className={cn(CHIP, "flex w-fit items-center gap-1.5 bg-card text-foreground hover:bg-muted")}
              >
                {showHiddenPlaylists ? <EyeClosedIcon size={14} /> : <EyeIcon size={14} />}
                {showHiddenPlaylists ? "Hide the hidden playlists" : `Show ${hiddenPlaylistCount} hidden`}
              </button>
            )}
            {displayedPlaylists.length === 0 ? (
              <p className="px-2 py-16 text-center text-sm text-muted-foreground">
                All your playlists are hidden.
              </p>
            ) : (
              <div className={GRID}>
                {displayedPlaylists.map((playlist) => (
                  <div
                    key={playlist.id}
                    className={hiddenPlaylistIdSet.has(playlist.id) ? "opacity-40" : undefined}
                  >
                    <AlbumCard
                      artworkUrl={playlist.artworkUrl}
                      variant="playlist"
                      liked={isLikedSongsId(playlist.id, playlist.kind)}
                      saved={Boolean(syncedPlaylists[playlist.id])}
                      title={playlist.title}
                      subtitle={playlist.owner}
                      onClick={() => onOpenPlaylist(playlist)}
                      onContextMenu={(event) => openPlaylistMenu(event, playlist)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      )}

      </div>

      <SelectionBar
        selection={selection}
        onAddToQueue={(tracks) => {
          playerController.addTracksToQueue(tracks);
          selection.clear();
        }}
        onAddToPlaylist={(tracks) => {
          // One picker for the whole selection, rather than one per track.
          openPlaylistPicker(tracks[0], tracks);
          selection.clear();
        }}
        onDownload={(tracks) => {
          queueDownloads(tracks);
          selection.clear();
        }}
      />
    </div>
  );
}
