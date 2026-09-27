import { SpinnerSteps } from "@/components/motion/loader";
import { cn } from "@/lib/utils";
import { HeartActiveIcon, HeartBrokenIcon, HeartIcon } from "@/ui/icons";
import { shallowEqual, usePlayerSelector } from "../../../player/playerStore";
import { useLibraryState } from "../../../player/playerStore";
import { TrackArtwork } from "../TrackArtwork";
import { ArtistLinks } from "../ArtistLinks";
import { useTrackContextMenu } from "../TrackContextMenu";
import { OverflowScrollText } from "./OverflowScrollText";

export function TrackInfo() {
  const state = usePlayerSelector((player) => ({ currentTrack: player.currentTrack }), shallowEqual);
  const libraryState = useLibraryState();
  const { openTrackMenu, toggleTrackLike } = useTrackContextMenu();
  const currentTrack = state.currentTrack;
  if (!currentTrack) {
    return null;
  }

  const isLikeStatusLoading =
    (libraryState.status === "restoring" || libraryState.status === "loading")
    && !libraryState.library;
  const canLikeCurrentTrack = currentTrack.source !== "local";
  const isLikePending = canLikeCurrentTrack && libraryState.pendingLikeTrackIds.has(currentTrack.id);
  const isLiked = canLikeCurrentTrack && (libraryState.library?.likedSongs.some(
    (track) => track.id === currentTrack.id,
  ) ?? false);

  return (
    <div
      className="flex min-w-0 items-center gap-3"
      onContextMenu={(event) => openTrackMenu(event, currentTrack)}
    >
      <TrackArtwork className="size-12 shrink-0 rounded-lg object-cover" size={48} artworkUrl={currentTrack.artworkUrl} iconSize={22} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <OverflowScrollText text={currentTrack.title} className="text-sm font-semibold text-foreground" />
        <OverflowScrollText text={currentTrack.artist} className="text-xs font-normal text-muted-foreground">
          <ArtistLinks artists={currentTrack.artists} fallback={currentTrack.artist} />
        </OverflowScrollText>
      </div>

      {canLikeCurrentTrack && (
        <button
          type="button"
          className={cn(
            "group/like flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
            "disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isLiked ? "text-primary" : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => void toggleTrackLike(currentTrack)}
          disabled={isLikeStatusLoading || isLikePending}
          aria-label={
            isLikeStatusLoading || isLikePending
              ? "Loading like status"
              : isLiked
                ? "Remove like"
                : libraryState.status === "signed-out"
                  ? "Sign in to like"
                  : "Like song"
          }
          title={
            libraryState.status === "signed-out"
              ? "Sign in to like"
              : isLiked
                ? "Remove like"
                : "Like song"
          }
        >
          {isLikeStatusLoading || isLikePending ? (
            <SpinnerSteps size={18} color="currentColor" />
          ) : isLiked ? (
            // Hovering a liked track previews the un-like action.
            <span className="relative grid size-[18px] place-items-center" aria-hidden="true">
              <HeartActiveIcon
                size={18}
                className="absolute transition-opacity group-hover/like:opacity-0"
              />
              <HeartBrokenIcon
                size={18}
                className="absolute opacity-0 transition-opacity group-hover/like:opacity-100"
              />
            </span>
          ) : (
            <HeartIcon size={18} />
          )}
        </button>
      )}
    </div>
  );
}
