import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";
import {
  DownloadIcon,
  HomeActiveIcon,
  HomeIcon,
  PlaylistActiveIcon,
  PlaylistIcon,
  SettingsActiveIcon,
  SettingsIcon,
} from "@/ui/icons";

interface TitleBarProps {
  isHomeActive: boolean;
  isLibraryActive: boolean;
  isDownloadsActive: boolean;
  isSettingsActive: boolean;
  onNavigateHome: () => void;
  onOpenLibrary: () => void;
  onOpenDownloads: () => void;
  onOpenSettings: () => void;
}

const navButton = "flex size-9 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function TitleBar({
  isHomeActive,
  isLibraryActive,
  isDownloadsActive,
  isSettingsActive,
  onNavigateHome,
  onOpenLibrary,
  onOpenDownloads,
  onOpenSettings,
}: TitleBarProps) {
  const startDrag = () => void getCurrentWindow().startDragging();

  return (
    <header className="relative z-30 flex h-[var(--titlebar-height)] shrink-0 items-center justify-between bg-background px-3">
      <nav className="flex items-center gap-1" aria-label="Main navigation">
        <button type="button" className={cn(navButton, isHomeActive ? "bg-muted text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")} onClick={onNavigateHome} aria-label="Home" aria-current={isHomeActive ? "page" : undefined} title="Home">
          {isHomeActive ? <HomeActiveIcon size={20} /> : <HomeIcon size={20} />}
        </button>
        <button type="button" className={cn(navButton, isLibraryActive ? "bg-muted text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")} onClick={onOpenLibrary} aria-label="Library" aria-current={isLibraryActive ? "page" : undefined} title="Library">
          {isLibraryActive ? <PlaylistActiveIcon size={20} /> : <PlaylistIcon size={20} />}
        </button>
        <button type="button" className={cn(navButton, isDownloadsActive ? "bg-muted text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")} onClick={onOpenDownloads} aria-label="Downloads" aria-current={isDownloadsActive ? "page" : undefined} title="Downloads">
          <DownloadIcon size={20} />
        </button>
      </nav>

      <div className="absolute left-1/2 -translate-x-1/2 select-none text-sm font-semibold tracking-wide text-foreground" onPointerDown={startDrag} onDoubleClick={() => void getCurrentWindow().toggleMaximize()}>
        YTM Offline
      </div>

      <button type="button" className={cn(navButton, isSettingsActive ? "bg-muted text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")} onClick={onOpenSettings} aria-label="Settings" aria-current={isSettingsActive ? "page" : undefined} title="Settings">
        {isSettingsActive ? <SettingsActiveIcon size={20} /> : <SettingsIcon size={20} />}
      </button>
    </header>
  );
}
