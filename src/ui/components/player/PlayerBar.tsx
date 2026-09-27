import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SpinnerSteps } from "@/components/motion/loader";
import { MiniPlayerIcon, PlayActiveIcon, QueuePanelActiveIcon, QueuePanelIcon } from "@/ui/icons";
import { tauriFetch } from "../../../datasource/youtube/tauriFetch";
import { usePlayerSelector } from "../../../player/playerStore";
import { logInternalError } from "../../../internal/logging";
import { useMiniPlayerEnabled } from "../../settings/miniPlayer";
import { TrackInfo } from "./TrackInfo";
import { PlaybackControls } from "./PlaybackControls";
import { SeekBar } from "./SeekBar";
import { DownloadButton } from "./DownloadButton";
import { PlaybackOptions } from "./PlaybackOptions";
import { VolumeControl } from "./VolumeControl";
import { LyricsButton } from "./LyricsButton";
import { PLAYER_ICON_BUTTON } from "./playerButton";
import {
  useCompactPlayerBar,
} from "../../settings/playerControls";

interface PlayerBarProps {
  onToggleLyrics: () => void;
  onToggleQueue: () => void;
  isQueueOpen: boolean;
  onConnectionRestored: () => Promise<void>;
  handlePlayerBarClick:()=>void;
}

/*
 * Two endpoints so one being blocked does not read as "offline", and both answer 204 with an
 * empty body. This used to lead with `https://music.youtube.com/`, which is 380 KB of HTML
 * fetched only to prove the network exists — and `allSettled` requests both, so every check
 * paid for it. gstatic keeps the "can we reach Google" signal at zero bytes.
 */
const CONNECTION_CHECK_URLS = [
  "https://www.gstatic.com/generate_204",
  "https://cp.cloudflare.com/generate_204",
];

export function PlayerBar({ onToggleLyrics, onToggleQueue, isQueueOpen, onConnectionRestored,handlePlayerBarClick }: PlayerBarProps) {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);
 
  const connectionCheckRef = useRef<Promise<boolean> | null>(null);
  const wasOfflineRef = useRef(!navigator.onLine);
  const recoveryStartedRef = useRef(false);
  const failedChecksRef = useRef(0);

  const updateConnectionState = useCallback((connected: boolean) => {
    if (connected) failedChecksRef.current = 0;
    setIsOnline(connected);

    if (!connected) {
      wasOfflineRef.current = true;
      return;
    }

    if (wasOfflineRef.current && !recoveryStartedRef.current) {
      recoveryStartedRef.current = true;
      void onConnectionRestored();
    }
  }, [onConnectionRestored]);

  const checkConnection = useCallback(async () => {
    if (connectionCheckRef.current) return connectionCheckRef.current;

    const check = (async () => {
      if (!navigator.onLine) {
        failedChecksRef.current += 1;
        if (failedChecksRef.current >= 2) {
          updateConnectionState(false);
        } else {
          window.setTimeout(() => void checkConnection(), 1500);
        }
        return false;
      }

      const checks = await Promise.allSettled(
        CONNECTION_CHECK_URLS.map((url) =>
          tauriFetch(url, {
            cache: "no-store",
            method: "GET",
          })
        ),
      );
      const connected = checks.some((result) => result.status === "fulfilled");
      if (connected) {
        updateConnectionState(true);
      } else {
        failedChecksRef.current += 1;
        if (failedChecksRef.current >= 2) {
          updateConnectionState(false);
        } else {
          window.setTimeout(() => void checkConnection(), 1500);
        }
      }
      return connected;
    })();

    connectionCheckRef.current = check;
    try {
      return await check;
    } finally {
      connectionCheckRef.current = null;
    }
  }, [updateConnectionState]);

  useEffect(() => {
    const handleOnline = () => void checkConnection();
    const handleOffline = () => void checkConnection();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkConnection();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void checkConnection();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [checkConnection, updateConnectionState]);

  useEffect(() => {
    if (isOnline) return;

    const retryTimer = window.setInterval(() => {
      void checkConnection();
    }, 5000);

    return () => window.clearInterval(retryTimer);
  }, [checkConnection, isOnline]);

  const reconnect = async () => {
    setIsCheckingConnection(true);

    try {
      await checkConnection();
    } finally {
      setIsCheckingConnection(false);
    }
  };

  const compactPlayerBar = useCompactPlayerBar();
  const miniPlayerEnabled = useMiniPlayerEnabled();
  const hasTrack = usePlayerSelector((state) => state.currentTrack !== null);

  // Minimising is what brings the mini player up (App listens for the minimise), so the
  // button only exists while the mini player is switched on and has a song to show.
  const openMiniPlayer = () => {
    void getCurrentWindow().minimize().catch((error) => {
      logInternalError("PlayerBar.openMiniPlayer failed", error);
    });
  };

  return (
    <>
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="flex shrink-0 items-center justify-center gap-3 overflow-hidden bg-muted px-2 py-1 text-sm text-foreground"
            role="status"
            aria-live="polite"
          >
            <span>You don't have an internet connection</span>
            <button
              type="button"
              className="flex h-7 items-center gap-1.5 rounded px-2.5 text-xs transition-colors hover:bg-border disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => void reconnect()}
              disabled={isCheckingConnection}
              aria-label="Reconnect to the internet"
            >
              {isCheckingConnection ? (
                <SpinnerSteps size={14} />
              ) : (
                <PlayActiveIcon size={14} aria-hidden="true" />
              )}
              <span>{isCheckingConnection ? "Checking" : "Reconnect"}</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className="group/playerbar flex h-[76px] shrink-0 flex-col bg-chrome"
        onClick={handlePlayerBarClick}
      >
        {/* Expanded: the seek line runs the full width of the bar, above everything. */}
        {!compactPlayerBar && <SeekBar />}

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-3">
          <div className="min-w-0">
            <TrackInfo />
          </div>

          {/* Compact: the seek line tucks under the controls, in the centre column only. */}
          <div className="flex flex-col items-center gap-1">
            <PlaybackControls extraControlsAlwaysVisible />
            {compactPlayerBar && <SeekBar />}
          </div>

          <div className="flex min-w-0 items-center justify-end gap-1">
            <LyricsButton onToggle={onToggleLyrics} />

            <button
              type="button"
              className={PLAYER_ICON_BUTTON}
              onClick={onToggleQueue}
              aria-label={isQueueOpen ? "Close queue" : "Open queue"}
              aria-pressed={isQueueOpen}
              title={isQueueOpen ? "Close queue" : "Open queue"}
            >
              {isQueueOpen ? <QueuePanelActiveIcon size={20} /> : <QueuePanelIcon size={20} />}
            </button>

            <DownloadButton />
            <PlaybackOptions />
            <VolumeControl />

            {miniPlayerEnabled && hasTrack && (
              <button
                type="button"
                className={`${PLAYER_ICON_BUTTON} ml-1`}
                onClick={openMiniPlayer}
                aria-label="Open mini-player"
                title="Open mini-player"
              >
                <MiniPlayerIcon size={20} />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
