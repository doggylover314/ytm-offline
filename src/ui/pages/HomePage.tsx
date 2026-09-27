import { useMemo } from "react";
import type { Track } from "../../datasource/types";
import type { LibraryController, LibraryState } from "../../player/LibraryController";
import type { PlayerControllerActions } from "../../player/playerStore";
import type { SearchController } from "../../player/SearchController";
import { usePlayHistory } from "../../player/playHistory";
import { ArtistLinks } from "../components/ArtistLinks";
import { HomeDestinations, type HomeDestinationHandlers } from "../components/HomeDestinations";
import { TrackArtwork } from "../components/TrackArtwork";
import { useTrackContextMenu } from "../components/TrackContextMenu";

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
  const recent = useMemo(() => {
    const tracks = [
      ...history.map((entry) => entry.track),
      ...(libraryState.library?.recentlyPlayed ?? []),
    ];
    return [...new Map(tracks.map((track) => [track.id, track])).values()].slice(0, 12);
  }, [history, libraryState.library]);

  const play = (track: Track) => void playerController.playTrackById(track.id, recent, true);

  return (
    <div className="flex flex-col gap-8">
      {libraryState.status === "signed-out" && (
        <section className="flex items-center justify-between gap-4 rounded-xl bg-card p-4">
          <div>
            <h1 className="font-semibold">Your music, in one place</h1>
            <p className="text-sm text-muted-foreground">Sign in to see your library and playlists.</p>
          </div>
          <button type="button" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={() => void onSignIn()}>
            Sign in
          </button>
        </section>
      )}

      <HomeDestinations {...destinations} />

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Recently played</h2>
        {recent.length === 0 ? (
          <p className="rounded-xl bg-card p-5 text-sm text-muted-foreground">Songs you play will appear here.</p>
        ) : (
          <div className="grid gap-1 [grid-template-columns:repeat(auto-fill,minmax(17rem,1fr))]">
            {recent.map((track) => (
              <button key={track.id} type="button"
                className="flex min-w-0 items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onClick={() => play(track)} onContextMenu={(event) => openTrackMenu(event, track)}>
                <TrackArtwork className="size-11 shrink-0 rounded-md object-cover" size={44} artworkUrl={track.artworkUrl} iconSize={22} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <strong className="truncate text-sm font-semibold">{track.title}</strong>
                  <span className="truncate text-xs text-muted-foreground"><ArtistLinks artists={track.artists} fallback={track.artist} /></span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
