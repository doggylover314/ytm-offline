import { memo, useCallback, useRef, type MouseEvent, type ReactNode } from "react";
import { DownloadActiveIcon, HeartActiveIcon } from "@/ui/icons";
import { propsEqualIgnoringHandlers } from "../../internal/propsEqual";
import { TrackArtwork } from "./TrackArtwork";

/**
 * Rendered card width in CSS pixels.
 *
 * The default covers the `minmax(9rem…9.5rem, 1fr)` grids these sit in. It only has to land in
 * the right size bucket, not be exact — a column stretched a little wider by `1fr` still
 * resolves to the same request.
 */
const DEFAULT_CARD_SIZE = 176;

interface AlbumCardProps {
  color?: string;
  artworkUrl?: string;
  title?: string;
  subtitle?: string;
  subtitleContent?: ReactNode;
  /** Override when the card is laid out at a materially different width. */
  size?: number;
  /** Which placeholder glyph the artwork falls back to. */
  variant?: "album" | "playlist" | "artist";
  /** Liked Songs: a filled heart on a plain square instead of cover art. */
  liked?: boolean;
  /** Kept on this machine: a small filled download glyph leads the subtitle. */
  saved?: boolean;
  onClick?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
}

/**
 * Memoised on everything except handler identity.
 *
 * Every grid that renders these hands them a fresh inline arrow, so a plain `memo` would never
 * once return true — a search keystroke or a hover elsewhere on the page rebuilt every card on
 * screen. `propsEqualIgnoringHandlers` skips those comparisons, which is only sound because
 * the handlers are invoked through a ref refreshed on each render: a card that *does* render
 * picks up the current closures, and a card that does not render is one whose every other prop
 * is unchanged.
 */
export const AlbumCard = memo(function AlbumCard({
  color = "#1E1E1E",
  artworkUrl,
  title,
  subtitle,
  subtitleContent,
  size = DEFAULT_CARD_SIZE,
  variant = "album",
  liked = false,
  saved = false,
  onClick,
  onContextMenu,
}: AlbumCardProps) {
  const handlersRef = useRef({ onClick, onContextMenu });
  handlersRef.current = { onClick, onContextMenu };

  const handleClick = useCallback(() => handlersRef.current.onClick?.(), []);
  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => handlersRef.current.onContextMenu?.(event),
    [],
  );
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") handlersRef.current.onClick?.();
  }, []);

  return (
    <div
      /*
       * Off-screen cards skip style, layout and paint — the same treatment `TrackRow` gets,
       * and for the same reason: these grids are not windowed, so a library page really does
       * build every card it has loaded.
       *
       * `auto 222px` is a square cover at the ~176px grid column plus the two label lines. The
       * `auto` keyword means the guess only ever applies to a card that has not yet been on
       * screen once; after that the browser uses the size it actually measured.
       */
      className="group/card flex w-full min-w-0 cursor-pointer flex-col gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [content-visibility:auto] [contain-intrinsic-size:auto_222px]"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      {liked ? (
        <span className="grid aspect-square w-full place-items-center rounded-lg bg-muted text-foreground">
          <HeartActiveIcon size={40} aria-hidden="true" />
        </span>
      ) : (
        <div className="relative aspect-square w-full overflow-hidden rounded-lg" style={{ backgroundColor: color }}>
          <TrackArtwork
            className="size-full object-cover"
            artworkUrl={artworkUrl}
            iconSize={48}
            size={size}
            variant={variant}
          />
        </div>
      )}

      <span className="flex min-w-0 flex-col gap-0.5">
        {title && (
          <span className="truncate text-sm font-semibold text-foreground">{title}</span>
        )}
        {(subtitleContent || subtitle || saved) && (
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
            {saved && (
              <>
                <DownloadActiveIcon size={14} className="shrink-0" aria-hidden="true" />
                <span className="sr-only">Downloaded.</span>
              </>
            )}
            <span className="truncate">{subtitleContent ?? subtitle}</span>
          </span>
        )}
      </span>
    </div>
  );
}, propsEqualIgnoringHandlers);
