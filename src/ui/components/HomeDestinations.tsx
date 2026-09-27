import { AlbumIcon, ClockIcon, CompassIcon, DownloadIcon } from "@/ui/icons";
import { useOfflineState } from "../../player/offlineStore";
import { usePlayHistory } from "../../player/playHistory";
import { useLibraryState } from "../../player/playerStore";

export interface HomeDestinationHandlers {
  onOpenLibrary: () => void;
  onOpenBrowse: () => void;
  onOpenHistory: () => void;
  onOpenDownloads: () => void;
}

/**
 * The app's four destinations, on the home page rather than in the rail.
 *
 * They moved here because a permanently collapsed 72px rail could only ever show them as
 * unlabelled glyphs — three icons you had to hover to identify, competing for attention with
 * the playlist artwork that is the rail's actual job. On the home page they can carry a name
 * and a live count, which is what makes them worth a click.
 */
export function HomeDestinations({
  onOpenLibrary,
  onOpenBrowse,
  onOpenHistory,
  onOpenDownloads,
}: HomeDestinationHandlers) {
  const libraryState = useLibraryState();
  const offline = useOfflineState();
  const history = usePlayHistory();

  const library = libraryState.library;
  const savedCount = (library?.playlists.length ?? 0) + (library?.albums.length ?? 0);
  const downloadCount = Object.keys(offline.entries).length;

  const cards: Array<{
    key: string;
    label: string;
    hint: string;
    icon: typeof AlbumIcon;
    onClick: () => void;
    /** Live state, so the card says something the label alone cannot. */
    badge?: string;
  }> = [
    {
      key: "library",
      label: "Library",
      hint: "Songs, albums, artists",
      icon: AlbumIcon,
      onClick: onOpenLibrary,
      badge: savedCount > 0 ? `${savedCount} saved` : undefined,
    },
    {
      key: "browse",
      label: "Browse",
      hint: "Charts, moods, podcasts",
      icon: CompassIcon,
      onClick: onOpenBrowse,
    },
    {
      key: "history",
      label: "History",
      hint: "Everything you played",
      icon: ClockIcon,
      onClick: onOpenHistory,
      badge: history.length > 0 ? `${history.length} plays` : undefined,
    },
    {
      key: "downloads",
      label: "Downloads",
      hint: "Saved for offline",
      icon: DownloadIcon,
      onClick: onOpenDownloads,
      // A download in flight outranks the total: it is the thing that is changing.
      badge: offline.downloadingId
        ? offline.progress !== null
          ? `${offline.progress}%`
          : "downloading"
        : downloadCount > 0
          ? `${downloadCount} songs`
          : undefined,
    },
  ];

  return (
    <section className="flex flex-col gap-3" aria-label="Go to">
      <div className="grid grid-cols-4 gap-4">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={card.onClick}
            className="flex min-w-0 items-center gap-3 rounded-lg bg-chrome p-4 text-left transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <card.icon size={22} className="shrink-0 text-foreground" aria-hidden="true" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-semibold text-foreground">{card.label}</span>
              <span className="truncate text-[13px] tabular-nums text-muted-foreground">
                {card.badge ?? card.hint}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
