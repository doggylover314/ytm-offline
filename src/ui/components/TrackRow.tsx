import {
  memo,
  useCallback,
  useRef,
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import { cn, formatMinutesSeconds } from "@/lib/utils";
import { propsEqualIgnoringHandlers } from "../../internal/propsEqual";
import { Tooltip } from "@/components/motion/tooltip";
import {
  CheckIcon,
  DislikeActiveIcon,
  DislikeIcon,
  DownloadActiveIcon,
  DownloadIcon,
  DownloadProgressIcon,
  HeartActiveIcon,
  HeartIcon,
  ListIcon,
  PlayIcon,
  PlaylistAddIcon,
} from "@/ui/icons";
import {
  getOfflineStatus,
  queueDownload,
  removeDownload,
  useOfflineState,
} from "../../player/offlineStore";
import type { Track, TrackRating } from "../../datasource/types";
import { libraryController, useLibraryState } from "../../player/playerStore";
import { useTrackContextMenu } from "./TrackContextMenu";
import { ArtistLinks } from "./ArtistLinks";
import { TrackArtwork } from "./TrackArtwork";

/**
 * Anything else a caller needs on the underlying button — the playlist page attaches
 * pointer handlers and a data attribute here for drag-reorder. `onClick` and `onContextMenu`
 * are owned by this component, so they are excluded to keep one source of truth.
 */
type PassthroughButtonProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "onClick" | "onContextMenu" | "onSelect" | "children" | "className" | "type"
>;

interface TrackRowProps extends PassthroughButtonProps {
  track: Track;
  /** Zero-based; rendered as the 1-based position. */
  index: number;
  /** This is the track the player is on, whether or not it is currently advancing. */
  isCurrent: boolean;
  /** Current *and* actually playing — announced to screen readers. */
  isPlaying: boolean;
  onSelect: (event: MouseEvent<HTMLElement>) => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
  /** Shows a quick "add to playlist" affordance on hover. Omit to hide it. */
  onQuickAdd?: () => void;
  /** Shows a quick "add to queue" affordance on hover. Omit to hide it. */
  onQuickAddToQueue?: () => void;
  /** Shows a download-for-offline toggle. Omit on rows where it makes no sense. */
  showDownload?: boolean;
  /** Shows like/dislike. Omit where a rating makes no sense, e.g. local-only lists. */
  showRating?: boolean;
  /** Part of a multi-selection. Swaps the index column for a checkbox. */
  isSelected?: boolean;
  /** True while any row in the list is selected, so every row shows its checkbox. */
  isSelectionActive?: boolean;
  onToggleSelected?: () => void;
  /** Album pages repeat one cover on every row, so they opt out. */
  showArtwork?: boolean;
  /**
   * Shows the album as its own column, between the title and the trailing actions.
   *
   * Off by default and off inside an album: every row would repeat the page's own title. It is
   * for the mixed lists — playlists, search, history — where the album is the fact that tells
   * two versions of the same song apart.
   */
  showAlbum?: boolean;
  /** Shows the track's length in its own right-aligned column. */
  showDuration?: boolean;
  /** Appended to the artist line, e.g. a play count. A string so the row memo still holds. */
  detail?: string;
  /** Hides the artist whose page we are already on. */
  suppressArtistId?: string;
  /** Right-aligned extras — play counts, durations, remove buttons. */
  trailing?: ReactNode;
  className?: string;
  /** Rendered inside the row: drag indicators and the like. */
  children?: ReactNode;
}

/*
 * Column widths, shared by the row and `TrackListHeader` so the two cannot drift apart.
 * The album column only appears from `lg`: at narrower widths it would win space from the
 * title, which is the one thing every row needs to stay readable.
 */
const INDEX_COLUMN = "w-8 shrink-0 text-right";
const ALBUM_COLUMN = "hidden min-w-0 shrink-0 truncate lg:block lg:w-48 xl:w-[280px]";
const DOWNLOAD_COLUMN = "grid w-8 shrink-0 place-items-center";
const DURATION_COLUMN = "w-14 shrink-0 text-right tabular-nums";

/** Transparent at rest, one grey step up on hover — the row itself is already on `bg-card`. */
const ROW_ACTION =
  "grid size-8 shrink-0 place-items-center rounded text-foreground transition-colors hover:bg-muted " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Column headings for a list of `TrackRow`s. Pass the same column flags the rows get.
 */
export function TrackListHeader({
  showAlbum = false,
  showDownload = false,
  showDuration = false,
  className,
}: {
  showAlbum?: boolean;
  showDownload?: boolean;
  showDuration?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 border-b border-card px-2 pb-2 text-xs text-muted-foreground",
        className,
      )}
      aria-hidden="true"
    >
      <span className={INDEX_COLUMN}>#</span>
      <span className="min-w-0 flex-1">Title</span>
      {showAlbum && <span className={ALBUM_COLUMN}>Album</span>}
      {showDownload && <span className={DOWNLOAD_COLUMN} />}
      {showDuration && <span className={DURATION_COLUMN}>Time</span>}
    </div>
  );
}

/**
 * Download-for-offline toggle, and the row's download state.
 *
 * Always visible rather than a hover action: whether a song is on this computer is state you
 * need to see without hovering, the same reasoning as the queue's stop marker.
 */
function DownloadAction({ track }: { track: Track }) {
  // Subscribing here rather than in TrackRow keeps download churn from re-rendering the
  // whole row, which matters on a 500-row playlist while a queue is draining.
  const offline = useOfflineState();
  const status = getOfflineStatus(track.id);
  const isDownloading = status === "downloading";

  if (track.source === "local") return null;

  const label = status === "ready"
    ? `Remove ${track.title} from downloads`
    : isDownloading
      ? `Downloading ${track.title}`
      : `Download ${track.title}`;

  return (
    <Tooltip content={status === "ready" ? "Downloaded — click to remove" : "Download"}>
      <span
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-pressed={status === "ready"}
        className={cn(ROW_ACTION, status === "failed" && "text-destructive")}
        onClick={(event) => {
          event.stopPropagation();
          if (status === "ready") void removeDownload(track.id);
          else queueDownload(track);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          if (status === "ready") void removeDownload(track.id);
          else queueDownload(track);
        }}
      >
        {isDownloading || status === "queued" ? (
          /* The square fills from the bottom, fed by the real byte count streamed from Rust.
             Queued, or a response with no Content-Length, stays an empty square. */
          <DownloadProgressIcon
            size={18}
            progress={isDownloading ? (offline.progress ?? 0) / 100 : 0}
            aria-hidden="true"
          />
        ) : status === "ready" ? (
          <DownloadActiveIcon size={18} aria-hidden="true" />
        ) : (
          <DownloadIcon size={18} aria-hidden="true" />
        )}
      </span>
    </Tooltip>
  );
}

/**
 * A hover action inside the row.
 *
 * A span with role="button" rather than a <button>: the row itself is a button, and nesting
 * one inside another is invalid and gets flattened by the parser. The click must not fall
 * through either, or "add to queue" would also start the song playing.
 */
function QuickAction({
  label,
  tooltip,
  onActivate,
  children,
}: {
  label: string;
  tooltip: string;
  onActivate: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={tooltip}>
      <span
        role="button"
        tabIndex={0}
        aria-label={label}
        className={cn(ROW_ACTION, "opacity-0 group-hover/row:opacity-100 focus:opacity-100")}
        onClick={(event) => {
          event.stopPropagation();
          onActivate();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          onActivate();
        }}
      >
        {children}
      </span>
    </Tooltip>
  );
}

/**
 * Like and dislike, as a pair.
 *
 * Shown together rather than as one cycling control: a rating has three states, and a single
 * button that walks like → dislike → none makes the user guess where they are in the cycle.
 * Two buttons say what they will do and which one is active.
 *
 * The active one stays visible when set — hiding a rating until hover would mean you cannot see
 * what you rated without hunting for it — while the inactive one appears on hover like the
 * other row actions.
 */
function RatingActions({ track }: { track: Track }) {
  const { rateTrack } = useTrackContextMenu();
  const libraryState = useLibraryState();

  // Local files have no YouTube rating to set, and a signed-out session has nowhere to put one.
  if (track.source === "local") return null;

  const rating = libraryController.getTrackRating(track.id);
  const isPending = libraryState.pendingLikeTrackIds.has(track.id);

  const button = (target: Exclude<TrackRating, "none">, icon: ReactNode, label: string) => {
    const isActive = rating === target;
    return (
      <Tooltip content={isActive ? `Undo ${label.toLowerCase()}` : label}>
        <span
          role="button"
          tabIndex={0}
          aria-label={isActive ? `Undo ${label.toLowerCase()} for ${track.title}` : `${label} ${track.title}`}
          aria-pressed={isActive}
          aria-busy={isPending}
          className={cn(
            ROW_ACTION,
            isPending && "pointer-events-none opacity-50",
            !isActive && "opacity-0 group-hover/row:opacity-100 focus:opacity-100",
          )}
          onClick={(event) => {
            event.stopPropagation();
            // Pressing the active rating clears it, which is the only way back to neutral.
            void rateTrack(track, isActive ? "none" : target);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            void rateTrack(track, isActive ? "none" : target);
          }}
        >
          {icon}
        </span>
      </Tooltip>
    );
  };

  return (
    <span className="flex shrink-0 items-center">
      {button(
        "like",
        rating === "like" ? <HeartActiveIcon size={17} /> : <HeartIcon size={17} />,
        "Like",
      )}
      {button(
        "dislike",
        rating === "dislike" ? <DislikeActiveIcon size={17} /> : <DislikeIcon size={17} />,
        "Dislike",
      )}
    </span>
  );
}

/**
 * One track in a list, shared by the playlist, album and artist pages.
 *
 * Those three had drifted into three different rows — only one showed artwork, only one
 * showed what was playing, and each styled its title differently. Sharing them means the
 * now-playing treatment is defined once and cannot fall out of sync again.
 *
 * Memoised on purpose. The lists subscribe to player state so they can mark the current
 * track, which re-renders the list on every track change; without this, a 500-row playlist
 * would rebuild every row to repaint two of them.
 *
 * The memo only started working when the handlers stopped being compared. Every call site
 * passes inline arrows — `onSelect={(e) => playSong(track, index, e)}` and four more — so all
 * five differed on every render and the default comparison never once returned true. The
 * handlers are now invoked through a ref refreshed on each render, which makes their identity
 * irrelevant: they only ever fire from events, long after the render that supplied them.
 *
 * `trailing` and `children` are still compared, and a call site passing fresh JSX for either
 * will still re-render its rows. That is honest — those are content, not callbacks.
 */
/**
 * The explicit-content stamp.
 *
 * A muted square rather than the brand accent: it is a content warning, not a feature, and
 * in red it would read as the app drawing attention to the song rather than labelling it.
 * The letter is decorative — the accessible name is the full word, since "E" read aloud on
 * its own means nothing.
 */
function ExplicitBadge() {
  return (
    <span
      title="Explicit"
      aria-label="Explicit"
      role="img"
      className="grid size-[15px] shrink-0 place-items-center rounded-[3px] bg-muted-foreground text-[10px] font-bold leading-none text-background"
    >
      <span aria-hidden="true">E</span>
    </span>
  );
}

/** Shared by the always-on slot and the hover affordance, so the two cannot drift apart. */
function SelectionCheckbox({
  title,
  isSelected,
  onToggle,
}: {
  title: string;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <span
      role="checkbox"
      aria-checked={isSelected}
      tabIndex={0}
      aria-label={`Select ${title}`}
      className={cn(
        "grid size-[18px] shrink-0 place-items-center rounded-[3px] border-[1.5px] border-foreground transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isSelected ? "bg-foreground text-background" : "text-transparent",
      )}
      onClick={(event) => {
        // Without this the row's own click handler also fires and starts playback.
        event.stopPropagation();
        onToggle();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
    >
      <CheckIcon size={14} aria-hidden="true" />
    </span>
  );
}

export const TrackRow = memo(function TrackRow({
  track,
  index,
  isCurrent,
  isPlaying,
  onSelect,
  onContextMenu,
  onQuickAdd,
  onQuickAddToQueue,
  showDownload = false,
  showRating = false,
  isSelected = false,
  isSelectionActive = false,
  onToggleSelected,
  showArtwork = true,
  showAlbum = false,
  showDuration = false,
  detail,
  suppressArtistId,
  trailing,
  className,
  children,
  ...buttonProps
}: TrackRowProps) {
  /*
   * The handlers, read at call time instead of captured at render time.
   *
   * This is what lets `trackRowPropsEqual` ignore their identity: the wrappers below never
   * change, but always reach the newest closure, so a row that skipped a render still acts on
   * current state when you click it.
   */
  // Stable across renders (the provider memoizes it), so reading it here costs the memo nothing.
  const { openAlbumForTrack } = useTrackContextMenu();
  const handlersRef = useRef({
    onSelect,
    onContextMenu,
    onQuickAdd,
    onQuickAddToQueue,
    onToggleSelected,
  });
  handlersRef.current = {
    onSelect,
    onContextMenu,
    onQuickAdd,
    onQuickAddToQueue,
    onToggleSelected,
  };

  const handleSelect = useCallback(
    (event: MouseEvent<HTMLElement>) => handlersRef.current.onSelect(event),
    [],
  );
  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => handlersRef.current.onContextMenu?.(event),
    [],
  );
  const handleQuickAdd = useCallback(() => handlersRef.current.onQuickAdd?.(), []);
  const handleQuickAddToQueue = useCallback(
    () => handlersRef.current.onQuickAddToQueue?.(),
    [],
  );
  const handleToggleSelected = useCallback(() => handlersRef.current.onToggleSelected?.(), []);

  /* Whether this list does multi-select at all. Browse and search rows do not pass a handler,
     and must keep their play-on-hover glyph rather than gain a checkbox that does nothing. */
  const canSelect = Boolean(onToggleSelected);

  return (
    <button
      {...buttonProps}
      type="button"
      onClick={handleSelect}
      /* Kept conditional: whether the prop was supplied still decides whether a handler is
         attached at all, only its identity is ignored. */
      onContextMenu={onContextMenu ? handleContextMenu : undefined}
      aria-current={isCurrent ? "true" : undefined}
      className={cn(
        "group/row relative flex w-full items-center gap-4 rounded px-2 py-1.5 text-left",
        "transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-inset focus-visible:ring-ring",
        /*
         * Off-screen rows skip layout, paint and compositing.
         *
         * These lists are not windowed — a 500-track playlist really does build 500 rows of
         * ~20 elements each — and windowing them properly fights both the drag-reorder and the
         * shift-range selection, which need the full index space. This is the platform doing
         * the same job for one line: the nodes stay, the rendering work does not.
         *
         * `auto 52px` is the row's height (40px artwork + `py-1.5`); the `auto` keyword means
         * the browser prefers the size it last actually measured, so the guess only matters for
         * rows that have never been on screen. Width is untouched by the containment because
         * `w-full` states it outright rather than deriving it from content.
         */
        "[content-visibility:auto] [contain-intrinsic-size:auto_52px]",
        isSelected && "bg-muted hover:bg-muted",
        className,
      )}
    >
      {children}

      {/* While a selection is open the index column becomes a checkbox. It replaces the
          number rather than sitting beside it so the row width never changes — a list that
          reflows the moment you select something is unusable for range-selecting. */}
      <span className={cn(INDEX_COLUMN, "relative text-[13px] tabular-nums text-muted-foreground")}>
        {isSelectionActive && canSelect ? (
          <span className="flex justify-end">
            <SelectionCheckbox
              title={track.title}
              isSelected={isSelected}
              onToggle={handleToggleSelected}
            />
          </span>
        ) : (
          <>
            {/* The position number is only useful until you have decided to act on the row,
                so it gives way to a checkbox or a play glyph on hover. Both share the slot,
                so the row never reflows between states. */}
            <span className="transition-opacity group-hover/row:opacity-0">{index + 1}</span>

            {/*
              On a list that supports multi-select, hover offers the checkbox instead of the
              play glyph. Selection was previously unreachable without already having a
              selection: the box only appeared once `isSelectionActive`, and the only way in
              was a ctrl-click nothing advertised. The row itself still plays on click.
            */}
            {canSelect ? (
              <span className="absolute inset-0 flex items-center justify-end opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
                <SelectionCheckbox
                  title={track.title}
                  isSelected={isSelected}
                  onToggle={handleToggleSelected}
                />
              </span>
            ) : (
              <span className="absolute inset-0 flex items-center justify-end text-foreground opacity-0 transition-opacity group-hover/row:opacity-100">
                <PlayIcon size={16} aria-hidden="true" />
              </span>
            )}
          </>
        )}
      </span>

      <span className="flex min-w-0 flex-1 items-center gap-3">
        {showArtwork ? (
          <TrackArtwork
            className="size-10 shrink-0 rounded"
            size={40}
            artworkUrl={track.artworkUrl}
            iconSize={18}
          />
        ) : null}

        <span className="flex min-w-0 flex-1 flex-col">
          {/*
            The badge sits beside the title rather than inside it: as a sibling it keeps its
            own width while `truncate` eats the title, so a long name shortens instead of
            pushing the stamp out of the row.
          */}
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                "truncate text-sm font-semibold",
                isCurrent ? "text-accent-text" : "text-foreground",
              )}
            >
              {track.title}
            </span>
            {track.isExplicit && <ExplicitBadge />}
          </span>
          <span className="truncate text-[13px] text-muted-foreground">
            <ArtistLinks
              artists={track.artists}
              fallback={track.artist}
              suppressArtistId={suppressArtistId}
            />
            {detail ? ` · ${detail}` : null}
          </span>
        </span>

        {/* Hover actions, at the end of the title cell so the columns after it stay put. The
            row itself is a <button>, so these cannot be buttons — see QuickAction. */}
        {showRating && <RatingActions track={track} />}
        {(onQuickAddToQueue || onQuickAdd) && (
          <span className="flex shrink-0 items-center">
            {onQuickAddToQueue && (
              <QuickAction
                label={`Add ${track.title} to the queue`}
                tooltip="Add to queue"
                onActivate={handleQuickAddToQueue}
              >
                <ListIcon size={18} aria-hidden="true" />
              </QuickAction>
            )}
            {onQuickAdd && (
              <QuickAction
                label={`Add ${track.title} to a playlist`}
                tooltip="Add to playlist"
                onActivate={handleQuickAdd}
              >
                <PlaylistAddIcon size={18} aria-hidden="true" />
              </QuickAction>
            )}
          </span>
        )}
      </span>

      {showAlbum && (
        <span className={cn(ALBUM_COLUMN, "text-[13px] text-muted-foreground")}>
          {track.album
            ? (openAlbumForTrack && track.source !== "local" ? (
              /*
                A span with role="link", not an anchor or a button: the row itself is a
                <button>, and nesting interactive elements is invalid markup that the parser
                flattens. Same treatment ArtistLinks gives artist names, and the pointerdown
                has to stop too or the row's drag-reorder claims the gesture.
              */
              <span
                role="link"
                tabIndex={0}
                className="cursor-pointer rounded-sm underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openAlbumForTrack(track);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  openAlbumForTrack(track);
                }}
              >
                {track.album}
              </span>
            ) : track.album)
            : ""}
        </span>
      )}

      {/* The slot is kept for local files, which have nothing to download, so the columns
          still line up with the header. */}
      {showDownload && (
        <span className={DOWNLOAD_COLUMN}>
          <DownloadAction track={track} />
        </span>
      )}

      {showDuration && (
        <span className={cn(DURATION_COLUMN, "text-[13px] text-muted-foreground")}>
          {track.durationSec ? formatMinutesSeconds(track.durationSec) : ""}
        </span>
      )}

      {trailing}

      {/* The playing row is marked by its title colour alone, so say it for screen readers. */}
      {isCurrent ? (
        <span className="sr-only">{isPlaying ? "Now playing" : "Paused"}</span>
      ) : null}
    </button>
  );
}, propsEqualIgnoringHandlers);
