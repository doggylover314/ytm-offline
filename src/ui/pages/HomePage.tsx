import { useMemo } from "react";
import { cn, formatMinutesSeconds } from "@/lib/utils";
import type { Track } from "../../datasource/types";
import type { LibraryController, LibraryState } from "../../player/LibraryController";
import type { PlayerControllerActions } from "../../player/playerStore";
import type { SearchController } from "../../player/SearchController";
import { usePlayHistory } from "../../player/playHistory";
import { ArtistLinks } from "../components/ArtistLinks";
import { HomeDestinations, type HomeDestinationHandlers } from "../components/HomeDestinations";
import { TrackArtwork } from "../components/TrackArtwork";
import { useTrackContextMenu } from "../components/TrackContextMenu";
import { useNowPlaying } from "../hooks/useNowPlaying";

/** One row of six tiles, then two columns of four rows. */
const RECENT_TILES = 6;
const QUICK_PICKS = 8;

interface HomePageProps {
  tabId: string;
  playerController: PlayerControllerActions;
  libraryController: LibraryController;
  libraryState: LibraryState;
  searchController: SearchController;
  onSignIn: () => Promise<void>;
  destinations: HomeDestinationHandlers;
}

/** Home deliberately uses already loaded data: opening it does not start recommendation requests. */
export function HomePage({ playerController, libraryState, onSignIn, destinations }: HomePageProps) {
  const history = usePlayHistory();
  const { openTrackMenu } = useTrackContextMenu();
  const { currentTrackId } = useNowPlaying();

  const recent = useMemo(() => {
    const tracks = [
      ...history.map((entry) => entry.track),
      ...(libraryState.library?.recentlyPlayed ?? []),
    ];
    return [...new Map(tracks.map((track) => [track.id, track])).values()]
      .slice(0, RECENT_TILES + QUICK_PICKS);
  }, [history, libraryState.library]);

  const tiles = recent.slice(0, RECENT_TILES);
  /*
   * Whatever recent plays the tiles did not take, topped up from Liked Songs. Both are already
   * in memory, so the section fills without asking YouTube for recommendations.
   */
  const quickPicks = useMemo(() => {
    const picks = recent.slice(RECENT_TILES);
    const taken = new Set(recent.map((track) => track.id));
    for (const track of libraryState.library?.likedSongs ?? []) {
      if (picks.length >= QUICK_PICKS) break;
      if (!taken.has(track.id)) picks.push(track);
    }
    return picks;
  }, [libraryState.library?.likedSongs, recent]);

  const play = (track: Track, queue: Track[]) =>
    void playerController.playTrackById(track.id, queue, true);

  return (
    <div className="flex flex-col gap-8">
      {libraryState.status === "signed-out" && (
        <section className="flex items-center justify-between gap-4 rounded-lg bg-chrome p-5">
          <div className="flex flex-col gap-0.5">
            <h1 className="text-xl font-semibold">Your music, in one place</h1>
            <p className="text-[13px] text-muted-foreground">Sign in to see your library and playlists.</p>
          </div>
          <button
            type="button"
            className="h-9 shrink-0 rounded bg-foreground px-4 text-sm font-medium text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => void onSignIn()}
          >
            Sign in
          </button>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Recently played</h2>
        {tiles.length === 0 ? (
          <p className="rounded-lg bg-chrome p-5 text-sm text-muted-foreground">Songs you play will appear here.</p>
        ) : (
          <div className="grid grid-cols-6 gap-6">
            {tiles.map((track) => (
              <button
                key={track.id}
                type="button"
                className="group/tile flex min-w-0 flex-col gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => play(track, recent)}
                onContextMenu={(event) => openTrackMenu(event, track)}
              >
                <TrackArtwork
                  className="aspect-square w-full rounded-lg bg-card object-cover"
                  size={176}
                  artworkUrl={track.artworkUrl}
                  iconSize={40}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <strong className={cn(
                    "truncate text-sm font-semibold",
                    currentTrackId === track.id ? "text-accent-text" : "text-foreground",
                  )}>
                    {track.title}
                  </strong>
                  <span className="truncate text-[13px] text-muted-foreground">
                    <ArtistLinks artists={track.artists} fallback={track.artist} />
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {quickPicks.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Quick picks</h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-0.5">
            {quickPicks.map((track) => (
              <button
                key={track.id}
                type="button"
                className="flex min-w-0 items-center gap-3 rounded px-2 py-1.5 text-left transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => play(track, quickPicks)}
                onContextMenu={(event) => openTrackMenu(event, track)}
              >
                <TrackArtwork
                  className="size-10 shrink-0 rounded bg-card object-cover"
                  size={40}
                  artworkUrl={track.artworkUrl}
                  iconSize={20}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <strong className={cn(
                    "truncate text-sm font-semibold",
                    currentTrackId === track.id ? "text-accent-text" : "text-foreground",
                  )}>
                    {track.title}
                  </strong>
                  <span className="truncate text-[13px] text-muted-foreground">
                    <ArtistLinks artists={track.artists} fallback={track.artist} />
                  </span>
                </span>
                {track.durationSec != null && (
                  <time className="shrink-0 text-[13px] text-muted-foreground">
                    {formatMinutesSeconds(track.durationSec)}
                  </time>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      <HomeDestinations {...destinations} />
    </div>
  );
}
