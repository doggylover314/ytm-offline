import { useEffect, useState, useSyncExternalStore, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import {
  CloseIcon,
  DownloadsActiveIcon,
  DownloadsIcon,
  HomeActiveIcon,
  HomeIcon,
  LibraryActiveIcon,
  LibraryIcon,
  MaximizeIcon,
  MinimizeIcon,
  SettingsActiveIcon,
  SettingsIcon,
} from "@/ui/icons";
import { logInternalError, logInternalInfo, logInternalWarn } from "../../internal/logging";
import { isLinux, isTilingWindowManager, subscribeTilingWindowManager } from "../platform";
import { useForceWindowControls, useNativeWindowControls } from "../settings/windowControls";

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

const NAV_BUTTON =
  "flex size-10 items-center justify-center rounded text-foreground transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const WINDOW_BUTTON =
  "flex size-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Clicks on these never start a window drag. */
const INTERACTIVE_SELECTOR = "button, a, input, [role='button']";

function NavButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={NAV_BUTTON}
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title={label}
    >
      {children}
    </button>
  );
}

function AppMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="96" fill="#2A2A2A" />
      <path d="M130 300v-40a126 126 0 0 1 252 0v40" fill="none" stroke="#FF0033" strokeWidth="44" strokeLinecap="round" />
      <rect x="112" y="288" width="72" height="116" rx="30" fill="#FF0033" />
      <rect x="328" y="288" width="72" height="116" rx="30" fill="#FF0033" />
    </svg>
  );
}

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
  const appWindow = getCurrentWindow();
  // Only for the button's name: the icon stays the same either way, as designed.
  const [isMaximized, setIsMaximized] = useState(false);
  useEffect(() => {
    const currentWindow = getCurrentWindow();
    let active = true;
    const update = () => {
      void currentWindow.isMaximized().then((maximized) => {
        if (active) setIsMaximized(maximized);
      }).catch(() => {});
    };
    update();
    const stopListening = currentWindow.onResized(update);
    return () => {
      active = false;
      void stopListening.then((stop) => stop());
    };
  }, []);
  const nativeWindowControls = useNativeWindowControls();
  const forceWindowControls = useForceWindowControls();
  // Tiling compositors manage windows themselves and draw nothing, so app-drawn buttons would
  // be dead weight there unless the user asked for them in settings.
  const tilingWindowManager = useSyncExternalStore(
    subscribeTilingWindowManager,
    isTilingWindowManager,
    () => false,
  );
  const showCustomWindowControls = !nativeWindowControls
    && (!isLinux || !tilingWindowManager || forceWindowControls);

  const isInteractiveTarget = (target: EventTarget) =>
    target instanceof Element && Boolean(target.closest(INTERACTIVE_SELECTOR));

  // Empty bar space is the window's drag handle.
  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return;
    void appWindow.startDragging();
  };

  const handleDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if (isInteractiveTarget(event.target)) return;
    void appWindow.toggleMaximize();
  };

  const handleMinimize = async () => {
    try {
      if (await appWindow.isFullscreen()) {
        await appWindow.setFullscreen(false);
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
      await appWindow.minimize();
    } catch (error) {
      logInternalError("TitleBar.minimize failed", error);
    }
  };

  const handleToggleMaximize = async () => {
    try {
      await appWindow.toggleMaximize();
    } catch (error) {
      logInternalError("TitleBar.maximize failed", error);
    }
  };

  // Goes through the backend so the close button and the OS close request share one path:
  // into the tray, or quitting where there is no tray.
  const handleClose = () => {
    logInternalInfo("TitleBar.close clicked");
    void invoke("close_main_window").catch((error) => {
      logInternalError("TitleBar.close close_main_window failed", error);
      logInternalWarn("TitleBar.close fallback to appWindow.close");
      void appWindow.close();
    });
  };

  return (
    <header
      className="relative z-30 grid h-[var(--titlebar-height)] shrink-0 grid-cols-3 items-center bg-chrome px-2 text-foreground"
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      <nav className="flex items-center gap-1" aria-label="Main navigation">
        <NavButton label="Home" active={isHomeActive} onClick={onNavigateHome}>
          {isHomeActive ? <HomeActiveIcon size={22} /> : <HomeIcon size={22} />}
        </NavButton>
        <NavButton label="Library" active={isLibraryActive} onClick={onOpenLibrary}>
          {isLibraryActive ? <LibraryActiveIcon size={22} /> : <LibraryIcon size={22} />}
        </NavButton>
        <NavButton label="Downloads" active={isDownloadsActive} onClick={onOpenDownloads}>
          {isDownloadsActive ? <DownloadsActiveIcon size={22} /> : <DownloadsIcon size={22} />}
        </NavButton>
      </nav>

      <div className="flex select-none items-center justify-center gap-2">
        <AppMark />
        <span className="text-sm font-semibold">YTM Offline</span>
      </div>

      <div className="flex items-center justify-end gap-3">
        <NavButton label="Settings" active={isSettingsActive} onClick={onOpenSettings}>
          {isSettingsActive ? <SettingsActiveIcon size={22} /> : <SettingsIcon size={22} />}
        </NavButton>

        {showCustomWindowControls && (
          <div className="flex items-center gap-0.5" aria-label="Window controls">
            <button type="button" className={WINDOW_BUTTON} onClick={() => void handleMinimize()} aria-label="Minimize" title="Minimize">
              <MinimizeIcon size={16} />
            </button>
            <button type="button" className={WINDOW_BUTTON} onClick={() => void handleToggleMaximize()} aria-label={isMaximized ? "Restore" : "Maximize"} title={isMaximized ? "Restore" : "Maximize"}>
              <MaximizeIcon size={16} />
            </button>
            <button type="button" className={WINDOW_BUTTON} onClick={handleClose} aria-label="Close" title="Close">
              <CloseIcon size={16} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
