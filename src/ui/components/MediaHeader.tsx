import { useState, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/motion/tooltip";
import {
  DownloadActiveIcon,
  DownloadIcon,
  DownloadProgressIcon,
  ListIcon,
  MoreIcon,
  PauseIcon,
  PlayIcon,
  PlaylistAddIcon,
  RepeatActiveIcon,
  RepeatIcon,
  RepeatOneActiveIcon,
  ShuffleActiveIcon,
  ShuffleIcon,
} from "@/ui/icons";
import { SpinnerSteps } from "@/components/motion/loader";
import { FloatingPanel } from "./FloatingPanel";
import { TrackArtwork } from "./TrackArtwork";

/**
 * "24 songs · 1 hr 32 min".
 *
 * The duration is dropped unless every counted track reported one and the list is fully
 * loaded. YouTube omits `durationSec` on most playlist entries, so summing what happens to
 * be present produced badly wrong totals — a 98-track playlist read "98 songs · 3 min".
 * A missing total is honest; a wrong one is not.
 */
export function formatCollectionMeta(
  tracks: readonly { durationSec?: number }[],
  hasMore = false,
): string {
  const trackCount = tracks.length;
  const countLabel = `${trackCount}${hasMore ? "+" : ""} ${trackCount === 1 ? "song" : "songs"}`;
  if (hasMore || trackCount === 0) return countLabel;

  let totalDurationSec = 0;
  for (const track of tracks) {
    if (!track.durationSec) return countLabel;
    totalDurationSec += track.durationSec;
  }

  const totalMinutes = Math.round(totalDurationSec / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const durationLabel = hours > 0 ? `${hours} hr ${minutes} min` : `${minutes} min`;
  return `${countLabel} · ${durationLabel}`;
}

/** A page-specific entry in the header's More menu. */
export interface MediaHeaderMenuItem {
  label: string;
  icon?: ReactNode;
  /** Receives the click, so an item can open a context menu where the pointer is. */
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
}

interface MediaHeaderProps {
  /** Small label above the title: Playlist, Album, Artist. */
  eyebrow: string;
  /** ReactNode so a page can make the title interactive — the artist page's copies its URL. */
  title: ReactNode;
  /** Owner, artist links — leads the line under the title. */
  subtitle?: ReactNode;
  /** Counts and durations; follows the subtitle on the same line. */
  meta?: ReactNode;
  artworkUrl?: string;
  artworkVariant?: "track" | "album" | "artist" | "playlist";
  /** Side of the square artwork in CSS pixels: 200 for collections, 160 for artists. */
  artworkSize?: keyof typeof ARTWORK_SIZE_CLASS;
  /** Replaces the artwork entirely — Liked Songs uses its own glyph. */
  artworkSlot?: ReactNode;
  /**
   * The primary play/pause control. Omit to hide it.
   *
   * Grouped rather than three sibling props because the three are meaningless apart: an
   * `isPlaying` with no handler renders a button that does nothing, and a `isLoading` with no
   * handler renders a spinner that never resolves. As one optional object those states cannot
   * be expressed at all.
   */
  playback?: {
    /** Called for both play and pause — the page decides which, from `isPlaying`. */
    onToggle: () => void;
    /** True while a track from *this* collection is playing, so the button reads "Pause". */
    isPlaying?: boolean;
    /** This collection is starting playback; the button holds its width and shows a spinner. */
    isLoading?: boolean;
  };
  onShuffle?: () => void;
  shuffleEnabled?: boolean;
  /** Queues every track in this collection behind what is already hand-picked. */
  onAddToQueue?: () => void;
  /** Adds every track in this collection to a playlist, via the usual picker. */
  onAddToPlaylist?: () => void;
  /** Offline download for the whole collection. Omit to hide the control. */
  download?: {
    /** Queues every not-yet-downloaded track in this collection for offline use. */
    onStart: () => void;
    onStop?: () => void;
    isSynced?: boolean;
    /**
     * The collection is still being paged in before the download can start.
     *
     * Worth showing: on a long playlist this takes several round trips, and a button that
     * looks idle after a click reads as broken and gets clicked again.
     */
    isBusy?: boolean;
    /**
     * How much of this collection is already offline, so the button can say what pressing it
     * would actually do — "all 12 downloaded" is a different message from "download 9 songs".
     */
    counts?: {
      downloaded: number;
      total: number;
      /** True while pages remain unfetched, so `total` is a floor rather than the real total. */
      isPartial?: boolean;
    };
  };
  /** Play-from-the-top-on-repeat. Omit to hide the control. */
  loop?: {
    /** Starts this collection with repeat-all enabled. */
    onPlay: () => void;
    /** Cycles repeat-all → repeat-one → off when this collection is already playing. */
    onCycle?: () => void;
    /** Current loop mode for the icon and accessible label. */
    mode?: "in-order" | "repeat-all" | "repeat-one";
  };
  actionsDisabled?: boolean;
  /** Extra controls after the download button, e.g. Subscribe. */
  actions?: ReactNode;
  /** Page-specific entries appended to the More menu. */
  menuItems?: MediaHeaderMenuItem[];
  /** Quiet text at the end of the action row, e.g. "Synced 2 min ago". */
  status?: ReactNode;
}

/** Literal classes, so Tailwind can see them. */
const ARTWORK_SIZE_CLASS = { 200: "size-[200px]", 160: "size-40" } as const;

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const DISABLED = "disabled:pointer-events-none disabled:opacity-50";
/** 40px-tall secondary button: one grey step above the page, one more on hover. */
export const HEADER_SECONDARY_BUTTON = cn(
  "flex h-10 shrink-0 items-center justify-center gap-2 rounded bg-muted text-sm font-medium text-foreground transition-colors hover:bg-border",
  FOCUS_RING,
  DISABLED,
);
const MENU_ITEM = cn(
  "flex h-9 w-full shrink-0 items-center gap-2.5 rounded px-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
  DISABLED,
);

/**
 * Shared hero for the playlist, album and artist pages.
 *
 * All three previously hand-rolled the same artwork + title + shuffle arrangement, which is
 * how they ended up subtly different sizes and how only some of them offered a given action.
 *
 * Play is the primary action and the only filled button; shuffle and download are secondary,
 * and everything else that acts on the whole collection lives in the More menu.
 */
export function MediaHeader({
  eyebrow,
  title,
  subtitle,
  meta,
  artworkUrl,
  artworkVariant = "playlist",
  artworkSize = 200,
  artworkSlot,
  playback,
  onShuffle,
  shuffleEnabled = false,
  onAddToQueue,
  onAddToPlaylist,
  download,
  loop,
  actionsDisabled = false,
  actions,
  menuItems = [],
  status,
}: MediaHeaderProps) {
  /* Destructured once, so the body below reads the same as it did when these were flat props
     rather than threading `playback?.` through every branch. */
  const isPlaying = playback?.isPlaying ?? false;
  const isLoading = playback?.isLoading ?? false;
  const downloadBusy = download?.isBusy ?? false;
  const downloadCounts = download?.counts;
  const loopMode = loop?.mode ?? "in-order";
  const isLooping = loopMode !== "in-order";
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const hasMenu = Boolean(loop || onAddToQueue || onAddToPlaylist || menuItems.length > 0);

  const selectMenuItem = (action: () => void) => {
    setIsMenuOpen(false);
    action();
  };

  return (
    <header className="flex flex-wrap items-end gap-7">
      {artworkSlot ?? (
        <TrackArtwork
          className={cn("shrink-0 rounded-lg", ARTWORK_SIZE_CLASS[artworkSize])}
          artworkUrl={artworkUrl}
          iconSize={64}
          loading="eager"
          /*
           * Without this the component skips size bucketing and keeps the original URL — and
           * the stored `artworkUrl` is deliberately the *largest* candidate the source offered
           * (see `selectArtworkUrl`), so this slot would decode a full-size cover, eagerly, on
           * every album, playlist and artist page.
           */
          size={artworkSize}
          variant={artworkVariant}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <span className="text-[13px] text-muted-foreground">{eyebrow}</span>
        {/* Long album titles otherwise push the actions off the row entirely. */}
        <h1 className="line-clamp-2 text-[40px] font-semibold leading-[1.1] text-foreground">
          {title}
        </h1>
        {subtitle || meta ? (
          <div className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            {subtitle ? <span className="min-w-0">{subtitle}</span> : null}
            {subtitle && meta ? <span aria-hidden="true">·</span> : null}
            {meta ? <span>{meta}</span> : null}
          </div>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {playback ? (
            /*
             * Reflects this collection's own state, not the player's: it only becomes a
             * Pause control while the track being played belongs here. Playing something
             * else leaves this reading "Play", which is what the button would then do.
             */
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={playback.onToggle}
              aria-label={isPlaying ? "Pause" : "Play"}
              className={cn(
                "flex h-10 min-w-24 shrink-0 items-center gap-1.5 rounded bg-foreground pl-3.5 pr-5 text-sm font-medium text-background transition-colors hover:bg-white",
                FOCUS_RING,
                DISABLED,
              )}
            >
              {isLoading ? (
                <SpinnerSteps size={20} color="currentColor" />
              ) : isPlaying ? (
                <PauseIcon size={20} aria-hidden="true" />
              ) : (
                <PlayIcon size={20} aria-hidden="true" />
              )}
              {isPlaying ? "Pause" : "Play"}
            </button>
          ) : null}

          {onShuffle ? (
            <Tooltip content={shuffleEnabled ? "Shuffle on" : "Shuffle off"}>
              <button
                type="button"
                disabled={actionsDisabled}
                onClick={onShuffle}
                aria-pressed={shuffleEnabled}
                aria-label={shuffleEnabled ? "Turn off shuffle" : "Turn on shuffle"}
                className={cn(HEADER_SECONDARY_BUTTON, "w-10")}
              >
                {shuffleEnabled ? <ShuffleActiveIcon size={20} aria-hidden="true" /> : <ShuffleIcon size={20} aria-hidden="true" />}
              </button>
            </Tooltip>
          ) : null}

          {download ? (() => {
            /*
             * Disabled once everything here is already offline. Re-queueing downloaded tracks
             * would be a no-op the user cannot see, so the button says so instead of appearing
             * to do nothing.
             */
            const total = downloadCounts?.total ?? 0;
            const downloaded = downloadCounts?.downloaded ?? 0;
            const remaining = Math.max(0, total - downloaded);
            // Never "all downloaded" while pages remain unfetched — the unseen ones are not.
            const allDownloaded = total > 0 && remaining === 0 && !downloadCounts?.isPartial;
            const isSaved = Boolean(download.isSynced) || allDownloaded;

            return (
              <Tooltip
                content={
                  download.isSynced
                    ? "Stop syncing this playlist"
                    : allDownloaded
                    ? "Every song here is downloaded"
                    : downloadCounts?.isPartial
                      ? "Download every song here for offline"
                      : remaining > 0
                        ? `Download ${remaining} song${remaining === 1 ? "" : "s"} for offline`
                        : "Download for offline"
                }
              >
                <button
                  type="button"
                  disabled={actionsDisabled || (allDownloaded && !download.onStop) || downloadBusy}
                  onClick={download.isSynced ? download.onStop : download.onStart}
                  aria-busy={downloadBusy}
                  aria-pressed={isSaved}
                  aria-label={download.isSynced ? "Stop syncing playlist" : download.onStop ? "Download and sync playlist" : allDownloaded ? "Already downloaded" : "Download for offline"}
                  className={cn(HEADER_SECONDARY_BUTTON, "pl-3 pr-4")}
                >
                  {downloadBusy ? (
                    <DownloadProgressIcon
                      size={20}
                      progress={total > 0 ? downloaded / total : 0}
                      aria-hidden="true"
                    />
                  ) : isSaved ? (
                    <DownloadActiveIcon size={20} aria-hidden="true" />
                  ) : (
                    <DownloadIcon size={20} aria-hidden="true" />
                  )}
                  {downloadBusy ? "Downloading" : isSaved ? "Downloaded" : "Download"}
                </button>
              </Tooltip>
            );
          })() : null}

          {actions}

          {hasMenu ? (
            <FloatingPanel
              open={isMenuOpen}
              onOpenChange={setIsMenuOpen}
              side="bottom"
              className="flex min-w-56 flex-col border border-border bg-card p-1.5 shadow-none ring-0"
              trigger={
                <Tooltip content="More">
                  <button
                    type="button"
                    onClick={() => setIsMenuOpen((open) => !open)}
                    aria-label="More"
                    aria-haspopup="menu"
                    aria-expanded={isMenuOpen}
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded text-foreground transition-colors hover:bg-card",
                      FOCUS_RING,
                    )}
                  >
                    <MoreIcon size={20} aria-hidden="true" />
                  </button>
                </Tooltip>
              }
            >
              <div role="menu" aria-label="More actions" className="flex flex-col">
                {loop ? (
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={isLooping}
                    disabled={actionsDisabled}
                    onClick={() => selectMenuItem(isLooping && loop.onCycle ? loop.onCycle : loop.onPlay)}
                    aria-label={loopMode === "repeat-one" ? "Loop current song" : loopMode === "repeat-all" ? "Loop queue" : "Play in loop"}
                    className={MENU_ITEM}
                  >
                    {loopMode === "repeat-one" ? (
                      <RepeatOneActiveIcon size={18} aria-hidden="true" />
                    ) : loopMode === "repeat-all" ? (
                      <RepeatActiveIcon size={18} aria-hidden="true" />
                    ) : (
                      <RepeatIcon size={18} aria-hidden="true" />
                    )}
                    {loopMode === "repeat-one" ? "Loop one" : loopMode === "repeat-all" ? "Loop all" : "Loop"}
                  </button>
                ) : null}
                {onAddToQueue ? (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={actionsDisabled}
                    onClick={() => selectMenuItem(onAddToQueue)}
                    className={MENU_ITEM}
                  >
                    <ListIcon size={18} aria-hidden="true" />
                    Add to queue
                  </button>
                ) : null}
                {onAddToPlaylist ? (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={actionsDisabled}
                    onClick={() => selectMenuItem(onAddToPlaylist)}
                    className={MENU_ITEM}
                  >
                    <PlaylistAddIcon size={18} aria-hidden="true" />
                    Add to playlist
                  </button>
                ) : null}
                {menuItems.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={(event) => selectMenuItem(() => item.onSelect(event))}
                    className={MENU_ITEM}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                ))}
              </div>
            </FloatingPanel>
          ) : null}

          {status ? <span className="ml-2 text-[13px] text-muted-foreground">{status}</span> : null}
        </div>
      </div>
    </header>
  );
}
