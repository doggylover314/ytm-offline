import { cn } from "@/lib/utils";
import type { Album, Artist, BrowseLink, BrowseShelf, Playlist, Track } from "../../datasource/types";
import type { PlayerControllerActions } from "../../player/playerStore";
import { AlbumCard } from "./AlbumCard";
import { TrackRow } from "./TrackRow";
import { useNowPlaying } from "../hooks/useNowPlaying";
import { usePlaylistContextMenu } from "./PlaylistContextMenu";
import { useTrackContextMenu } from "./TrackContextMenu";

/** Shelves wrap onto a grid rather than scrolling sideways: everything in a shelf is visible. */
const SHELF_GRID = "grid grid-cols-6 gap-6";

/**
 * Renders browse shelves: song rows, then chips, then artwork grids.
 *
 * Shared by the Browse surfaces and the Related page, which receive the same shelf shape from
 * different endpoints. The ordering inside a shelf is fixed rather than following the response,
 * because songs read as a list and everything else reads as artwork, and interleaving the two
 * produced a column that changed rhythm every few rows.
 */
export function BrowseShelves({
  shelves,
  playerController,
  onOpenAlbum,
  onOpenArtist,
  onOpenPlaylist,
  onFollowLink,
  className,
}: {
  shelves: readonly BrowseShelf[];
  playerController: PlayerControllerActions;
  onOpenAlbum: (album: Album) => void;
  onOpenArtist: (artist: Artist) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
  /** Absent hides the chips: a surface with nowhere to drill into should not offer to. */
  onFollowLink?: (link: BrowseLink) => void;
  className?: string;
}) {
  const { currentTrackId, isPlaying } = useNowPlaying();
  const { openTrackMenu, openPlaylistPicker } = useTrackContextMenu();
  const { openPlaylistMenu, openAlbumMenu } = usePlaylistContextMenu();

  const playShelfTrack = (shelfTracks: Track[], track: Track) => {
    void playerController.playTrackById(track.id, shelfTracks);
  };

  return (
    <div className={cn("flex flex-col gap-8", className)}>
      {shelves.map((shelf) => (
        <section key={shelf.title} className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-foreground">{shelf.title}</h2>

          {shelf.tracks.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {shelf.tracks.map((track, index) => (
                <TrackRow
                  key={`${track.id}:${index}`}
                  track={track}
                  index={index}
                  isCurrent={currentTrackId === track.id}
                  isPlaying={isPlaying && currentTrackId === track.id}
                  onSelect={() => playShelfTrack(shelf.tracks, track)}
                  onContextMenu={(event) => openTrackMenu(event, track)}
                  onQuickAdd={() => openPlaylistPicker(track)}
                  onQuickAddToQueue={() => playerController.addToQueue(track)}
                  showDownload
                  showRating
                />
              ))}
            </div>
          )}

          {onFollowLink && shelf.links.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {shelf.links.map((link) => (
                <button
                  key={link.browseId}
                  type="button"
                  onClick={() => onFollowLink(link)}
                  className="h-8 rounded bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {link.title}
                </button>
              ))}
            </div>
          )}

          {shelf.albums.length > 0 && (
            <div className={SHELF_GRID}>
              {shelf.albums.map((album) => (
                <AlbumCard
                  key={album.id}
                  artworkUrl={album.artworkUrl}
                  title={album.title}
                  subtitle={album.artist}
                  onClick={() => onOpenAlbum(album)}
                  onContextMenu={(event) => openAlbumMenu(event, album)}
                />
              ))}
            </div>
          )}

          {shelf.playlists.length > 0 && (
            <div className={SHELF_GRID}>
              {shelf.playlists.map((playlist) => (
                <AlbumCard
                  key={playlist.id}
                  artworkUrl={playlist.artworkUrl}
                  variant="playlist"
                  title={playlist.title}
                  subtitle={playlist.owner}
                  onClick={() => onOpenPlaylist(playlist)}
                  onContextMenu={(event) => openPlaylistMenu(event, playlist)}
                />
              ))}
            </div>
          )}

          {shelf.artists.length > 0 && (
            <div className={SHELF_GRID}>
              {shelf.artists.map((artist) => (
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
          )}
        </section>
      ))}
    </div>
  );
}
