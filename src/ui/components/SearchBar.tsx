import { Button } from "@/components/motion/button";
import { Tooltip } from "@/components/motion/tooltip";
import { ArrowLeftIcon, ArrowRightIcon, SearchIcon } from "@/ui/icons";
import { primaryModifierLabel } from "../platform";

interface SearchBarProps {
  onOpen: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

export function SearchBar({
  onOpen,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: SearchBarProps) {
  const showBackButton = canGoBack || canGoForward;

  return (
    <div className="mx-auto flex w-full max-w-[600px] items-center gap-2">
      {showBackButton && (
        <Tooltip content="Back">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            disabled={!canGoBack}
            aria-label="Go back"
            className="shrink-0 rounded"
          >
            <ArrowLeftIcon size={18} aria-hidden="true" />
          </Button>
        </Tooltip>
      )}
      {canGoForward && (
        <Tooltip content="Forward">
          <Button
            variant="ghost"
            size="icon"
            onClick={onForward}
            aria-label="Go forward"
            className="shrink-0 rounded"
          >
            <ArrowRightIcon size={18} aria-hidden="true" />
          </Button>
        </Tooltip>
      )}

      <button
        type="button"
        onClick={onOpen}
        className="group flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded bg-card px-3.5 text-left text-[15px] text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <SearchIcon size={20} className="shrink-0" />
        <span className="truncate">Search songs, albums, artists</span>
        <kbd className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 font-sans text-xs text-muted-foreground group-hover:bg-border">
          {primaryModifierLabel} Space
        </kbd>
      </button>
    </div>
  );
}
