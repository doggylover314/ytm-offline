import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { cn } from "@/lib/utils";
import { emit, listen } from "@tauri-apps/api/event";
import { cursorPosition, getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { SpinnerSteps } from "@/components/motion/loader";
import {
  CloseIcon,
  FullScreenIcon,
  PauseActiveIcon,
  PlayActiveIcon,
  SkipNextIcon,
  SkipPreviousIcon,
} from "@/ui/icons";
import { saveMiniPlayerPosition, useMiniPlayerHoverAction } from "../../settings/miniPlayer";
import { isLinux, isMacOS, isWindows } from "../../platform";
import { TrackArtwork } from "../TrackArtwork";
import { OverflowScrollText } from "../player/OverflowScrollText";

interface PlayerSync {
  status: string;
  artworkUrl: string | null;
  title: string | null;
  artist: string | null;
}

interface TimeSync {
  currentTime: number;
  duration: number;
}

interface VolumeSync {
  muted: boolean;
  volume: number;
}

const win = getCurrentWindow();

const RIGHT_MOUSE_BUTTON = 2;
const LEFT_MOUSE_BUTTON = 0;
const INTERACTIVE_SELECTOR = "button, input, a, [role='button']";

const MINI_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded text-foreground transition-colors hover:bg-card disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function MiniPlayer() {
  const [playerState, setPlayerState] = useState<PlayerSync>({
    status: "idle",
    artworkUrl: null,
    title: null,
    artist: null,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [timeState, setTimeState] = useState<TimeSync>({ currentTime: 0, duration: 0 });
  const [volumeState, setVolumeState] = useState<VolumeSync>({ muted: false, volume: 1 });
  const [seekPreviewTime, setSeekPreviewTime] = useState<number | null>(null);
  const [volumePreview, setVolumePreview] = useState<number | null>(null);
  const [cachedArtwork, setCachedArtwork] = useState<string | null>(null);
  const hoverAction = useMiniPlayerHoverAction();
  const dragTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seekPreviewClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumePreviewClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSeekScrubbingRef = useRef(false);
  const lastSliderInputTimeStampRef = useRef<number | null>(null);
  const seekTargetRef = useRef(0);
  const pendingSeekTargetRef = useRef<number | null>(null);
  const macAlbumDragActiveRef = useRef(false);
  const macAlbumDragMovedRef = useRef(false);
  const suppressNextAlbumArtClickRef = useRef(false);

  const saveCurrentPosition = async () => {
    const position = await win.outerPosition();
    const nextPosition = { x: position.x, y: position.y };
    saveMiniPlayerPosition(nextPosition);
    await emit("mini-player:position-changed", nextPosition);
  };

  const saveCurrentPositionSoon = () => {
    window.setTimeout(() => {
      void saveCurrentPosition();
    }, 120);
    window.setTimeout(() => {
      void saveCurrentPosition();
    }, 500);
  };

  useEffect(() => {
    const setup = async () => {
      const unlisten = await listen<PlayerSync>("player-state-sync", (event) => {
        setPlayerState((previous) => {
          if (event.payload.artworkUrl && event.payload.artworkUrl !== previous.artworkUrl) {
            setCachedArtwork(event.payload.artworkUrl);
          }

          return event.payload;
        });
      });

      /*
       * Asked for only once the listener above is live.
       *
       * `player-state-sync` is emitted on change, not on a timer, so a window created after
       * playback started never hears about the track already playing and sits on "Nothing
       * playing" until the next track change. Requesting after subscribing, rather than before,
       * is what keeps the reply from arriving before anything is listening for it.
       */
      void emit("mini-player:request-sync");

      return unlisten;
    };

    const cleanup = setup();
    return () => { cleanup.then((unlisten) => unlisten()); };
  }, []);

  useEffect(() => {
    return () => {
      if (dragTimerRef.current) {
        clearInterval(dragTimerRef.current);
      }
      if (seekPreviewClearTimerRef.current) {
        clearTimeout(seekPreviewClearTimerRef.current);
      }
      if (volumePreviewClearTimerRef.current) {
        clearTimeout(volumePreviewClearTimerRef.current);
      }
      setIsDragging(false);
    };
  }, []);

  useEffect(() => {
    const setup = async () => {
      const unlisten = await listen<TimeSync>("player-time-sync", (event) => {
        setTimeState(event.payload);
      });

      return unlisten;
    };

    const cleanup = setup();
    return () => { cleanup.then((unlisten) => unlisten()); };
  }, []);

  useEffect(() => {
    const pendingSeekTarget = pendingSeekTargetRef.current;
    if (pendingSeekTarget === null) return;

    if (Math.abs(timeState.currentTime - pendingSeekTarget) <= 0.75) {
      pendingSeekTargetRef.current = null;
      setSeekPreviewTime(null);
      if (seekPreviewClearTimerRef.current) {
        clearTimeout(seekPreviewClearTimerRef.current);
        seekPreviewClearTimerRef.current = null;
      }
    }
  }, [timeState.currentTime]);

  useEffect(() => {
    isSeekScrubbingRef.current = false;
    pendingSeekTargetRef.current = null;
    setSeekPreviewTime(null);
    setVolumePreview(null);
    if (seekPreviewClearTimerRef.current) {
      clearTimeout(seekPreviewClearTimerRef.current);
      seekPreviewClearTimerRef.current = null;
    }
    if (volumePreviewClearTimerRef.current) {
      clearTimeout(volumePreviewClearTimerRef.current);
      volumePreviewClearTimerRef.current = null;
    }
  }, [hoverAction]);

  useEffect(() => {
    const setup = async () => {
      const unlisten = await listen<VolumeSync>("player-volume-sync", (event) => {
        setVolumeState(event.payload);
      });

      return unlisten;
    };

    const cleanup = setup();
    return () => { cleanup.then((unlisten) => unlisten()); };
  }, []);

  useEffect(() => {
    const setup = async () => {
      const unlisten = await win.onMoved(({ payload }) => {
        const nextPosition = { x: payload.x, y: payload.y };
        saveMiniPlayerPosition(nextPosition);
        void emit("mini-player:position-changed", nextPosition);
      });

      return unlisten;
    };

    const cleanup = setup();
    return () => { cleanup.then((unlisten) => unlisten()); };
  }, []);

  const handleRestore = async () => {
    await emit("mini-player:restore-main");

    /*
     * Best-effort, and deliberately not awaited into the restore below.
     *
     * The main window answers that event by *destroying* this window rather than hiding it,
     * so a hide issued here can land after the window is already gone and reject. Awaited,
     * that rejection aborts the rest of this function and leaves the main window in the
     * background — the click appears to do nothing. Kept only for the instant visual
     * feedback while the destroy makes its way across.
     */
    void win.hide().catch(() => {});

    const mainWin = await WebviewWindow.getByLabel("main");
    if (mainWin) {
      await mainWin.show();
      await mainWin.unminimize();
      await mainWin.setFocus();
    }
  };

  const stopAlbumArtDrag = async (restoreIfClick: boolean) => {
    if (!macAlbumDragActiveRef.current) return;

    macAlbumDragActiveRef.current = false;
    if (dragTimerRef.current) {
      clearInterval(dragTimerRef.current);
      dragTimerRef.current = null;
    }

    setIsDragging(false);
    try {
      await saveCurrentPosition();
    } catch (_) {}
    try {
      await win.setCursorIcon("grab");
    } catch (_) {}

    const shouldRestore = restoreIfClick && !macAlbumDragMovedRef.current;
    macAlbumDragMovedRef.current = false;
    if (shouldRestore) {
      await handleRestore();
    }
  };

  const handleAlbumArtMouseDown = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.blur();

    if (isLinux && event.button === LEFT_MOUSE_BUTTON) {
      event.stopPropagation();
      suppressNextAlbumArtClickRef.current = true;
      setIsDragging(true);

      const stopNativeDrag = () => {
        setIsDragging(false);
        saveCurrentPositionSoon();
      };
      document.addEventListener("mouseup", stopNativeDrag, { once: true });
      window.addEventListener("blur", stopNativeDrag, { once: true });

      try {
        await win.startDragging();
        saveCurrentPositionSoon();
      } catch (_) {}
      return;
    }

    if (!isMacOS || event.button !== LEFT_MOUSE_BUTTON) return;

    event.stopPropagation();
    suppressNextAlbumArtClickRef.current = true;

    if (dragTimerRef.current) {
      clearInterval(dragTimerRef.current);
      dragTimerRef.current = null;
    }

    const startCursor = await cursorPosition();
    const startPosition = await win.outerPosition();
    macAlbumDragActiveRef.current = true;
    macAlbumDragMovedRef.current = false;
    setIsDragging(true);
    try {
      await win.setCursorIcon("grabbing");
    } catch (_) {}

    const stopDragFromDocument = (upEvent: globalThis.MouseEvent) => {
      if (upEvent.button === LEFT_MOUSE_BUTTON) void stopAlbumArtDrag(true);
    };
    const stopDragOnBlur = () => {
      void stopAlbumArtDrag(false);
    };

    document.addEventListener("mouseup", stopDragFromDocument, { once: true });
    window.addEventListener("blur", stopDragOnBlur, { once: true });

    dragTimerRef.current = setInterval(() => {
      void (async () => {
        if (!macAlbumDragActiveRef.current) return;

        const cursor = await cursorPosition();
        const deltaX = cursor.x - startCursor.x;
        const deltaY = cursor.y - startCursor.y;
        if (Math.hypot(deltaX, deltaY) > 3) {
          macAlbumDragMovedRef.current = true;
        }

        await win.setPosition(new PhysicalPosition(
          startPosition.x + deltaX,
          startPosition.y + deltaY,
        ));
      })();
    }, 16);
  };

  const handleAlbumArtClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (suppressNextAlbumArtClickRef.current) {
      suppressNextAlbumArtClickRef.current = false;
      event.preventDefault();
      return;
    }

    void handleRestore();
  };

  /*
   * Destroys rather than hides. Dismissing the pill is a request for it to stop being there,
   * and a hidden webview keeps its entire renderer process — the thing this window is created
   * on demand to avoid. The main window creates a fresh one next time it is backgrounded.
   */
  const handleClose = async () => {
    await win.destroy();
  };

  const stopManualWindowDrag = async () => {
    if (dragTimerRef.current) {
      clearInterval(dragTimerRef.current);
      dragTimerRef.current = null;
    }

    setIsDragging(false);
    try {
      await saveCurrentPosition();
    } catch (_) {}
    try {
      await win.setCursorIcon("grab");
    } catch (_) {}
  };

  const startManualWindowDrag = async (button: number) => {
    if (dragTimerRef.current) {
      clearInterval(dragTimerRef.current);
      dragTimerRef.current = null;
    }

    const startCursor = await cursorPosition();
    const startPosition = await win.outerPosition();

    setIsDragging(true);
    try {
      await win.setCursorIcon("grabbing");
    } catch (_) {}

    const stopDragFromDocument = (upEvent: globalThis.MouseEvent) => {
      if (upEvent.button === button) void stopManualWindowDrag();
    };
    const stopDragOnBlur = () => {
      void stopManualWindowDrag();
    };

    document.addEventListener("mouseup", stopDragFromDocument, { once: true });
    window.addEventListener("blur", stopDragOnBlur, { once: true });

    dragTimerRef.current = setInterval(() => {
      void (async () => {
        const cursor = await cursorPosition();
        const nextX = startPosition.x + cursor.x - startCursor.x;
        const nextY = startPosition.y + cursor.y - startCursor.y;

        await win.setPosition(new PhysicalPosition(nextX, nextY));
      })();
    }, 16);
  };

  const startNativeWindowDrag = async () => {
    setIsDragging(true);
    const stopNativeDrag = () => {
      setIsDragging(false);
      saveCurrentPositionSoon();
    };
    document.addEventListener("mouseup", stopNativeDrag, { once: true });
    window.addEventListener("blur", stopNativeDrag, { once: true });

    try {
      await win.startDragging();
      saveCurrentPositionSoon();
    } catch (_) {
      setIsDragging(false);
    }
  };

  const handleContainerMouseDown = async (event: MouseEvent<HTMLDivElement>) => {
    const isInteractiveTarget = event.target instanceof Element
      && Boolean(event.target.closest(INTERACTIVE_SELECTOR));

    if (event.button === RIGHT_MOUSE_BUTTON) {
      event.preventDefault();
      event.stopPropagation();
      await startManualWindowDrag(RIGHT_MOUSE_BUTTON);
      return;
    }

    if (event.button === LEFT_MOUSE_BUTTON && !isInteractiveTarget) {
      event.preventDefault();
      if (isWindows) {
        await startManualWindowDrag(LEFT_MOUSE_BUTTON);
        return;
      }

      await startNativeWindowDrag();
    }
  };

  const keepSeekPreviewUntilSync = (target: number) => {
    pendingSeekTargetRef.current = target;
    if (seekPreviewClearTimerRef.current) {
      clearTimeout(seekPreviewClearTimerRef.current);
    }
    seekPreviewClearTimerRef.current = setTimeout(() => {
      pendingSeekTargetRef.current = null;
      setSeekPreviewTime(null);
      seekPreviewClearTimerRef.current = null;
    }, 1200);
  };

  const keepVolumePreviewUntilSync = () => {
    if (volumePreviewClearTimerRef.current) {
      clearTimeout(volumePreviewClearTimerRef.current);
    }
    volumePreviewClearTimerRef.current = setTimeout(() => {
      setVolumePreview(null);
      volumePreviewClearTimerRef.current = null;
    }, 500);
  };

  const handleSliderPointerDown = (event: PointerEvent<HTMLInputElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    if (hoverAction !== "seek") return;

    isSeekScrubbingRef.current = true;
    const target = Number(event.currentTarget.value);
    seekTargetRef.current = target;
    setSeekPreviewTime(target);
  };

  const handleSliderPointerEnd = () => {
    if (hoverAction !== "seek") {
      keepVolumePreviewUntilSync();
      return;
    }

    if (!isSeekScrubbingRef.current) return;

    isSeekScrubbingRef.current = false;
    const target = seekTargetRef.current;
    setSeekPreviewTime(target);
    keepSeekPreviewUntilSync(target);
    void emit("mini-player:seek", { time: target });
  };

  const handleSliderPointerCancel = () => {
    isSeekScrubbingRef.current = false;
    pendingSeekTargetRef.current = null;
    setSeekPreviewTime(null);
    setVolumePreview(null);
  };

  const handleSliderInput = (event: FormEvent<HTMLInputElement>) => {
    if (event.timeStamp === lastSliderInputTimeStampRef.current) return;
    lastSliderInputTimeStampRef.current = event.timeStamp;

    const value = parseFloat(event.currentTarget.value);
    if (hoverAction === "volume") {
      setVolumePreview(value);
      void emit("mini-player:volume", { volume: value });
      return;
    }

    seekTargetRef.current = value;
    setSeekPreviewTime(value);
    if (!isSeekScrubbingRef.current) {
      keepSeekPreviewUntilSync(value);
      void emit("mini-player:seek", { time: value });
    }
  };

  const handleSliderKeyUp = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      hoverAction !== "seek"
      || !["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)
    ) {
      return;
    }

    const target = seekTargetRef.current;
    keepSeekPreviewUntilSync(target);
    void emit("mini-player:seek", { time: target });
  };

  const isPlaying = playerState.status === "playing";
  const isLoading = playerState.status === "loading";
  const artworkUrl = playerState.artworkUrl ?? cachedArtwork;
  const displayedVolume = volumePreview ?? (volumeState.muted ? 0 : volumeState.volume);
  const displayedTime = seekPreviewTime ?? timeState.currentTime;
  const sliderValue = hoverAction === "volume" ? displayedVolume : displayedTime;
  const sliderMax = hoverAction === "volume" ? 1 : timeState.duration || 100;
  const sliderStep = hoverAction === "volume" ? 0.01 : "any";
  const sliderProgress = hoverAction === "volume"
    ? displayedVolume * 100
    : timeState.duration > 0
      ? (displayedTime / timeState.duration) * 100
      : 0;

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-lg border border-muted bg-chrome text-foreground",
        isDragging ? "cursor-grabbing" : "cursor-grab",
      )}
      onMouseDown={(event) => void handleContainerMouseDown(event)}
      onMouseUp={(event) => {
        if (event.button === RIGHT_MOUSE_BUTTON) void stopManualWindowDrag();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="flex min-h-0 flex-1 items-center gap-3 pl-3 pr-2">
        <button
          type="button"
          className="size-16 shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onMouseDown={(event) => void handleAlbumArtMouseDown(event)}
          onClick={handleAlbumArtClick}
          aria-label="Restore main window"
          title="Restore"
        >
          <TrackArtwork
            artworkUrl={artworkUrl ?? undefined}
            className="size-16 rounded bg-card"
            iconSize={24}
            loading="eager"
            /* Without it this asked for the full-size cover, in the window whose whole
               reason to exist is being small. */
            size={64}
          />
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 flex-col" aria-live="polite" aria-atomic="true">
            <OverflowScrollText
              text={playerState.title ?? "Nothing playing"}
              className="text-sm font-semibold leading-snug text-foreground"
            />
            {playerState.artist ? (
              <OverflowScrollText
                text={playerState.artist}
                className="text-xs leading-snug text-muted-foreground"
              />
            ) : null}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              className={MINI_BUTTON}
              onClick={() => emit("mini-player:skip-previous")}
              aria-label="Previous"
            >
              <SkipPreviousIcon size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="flex size-7 shrink-0 items-center justify-center rounded bg-foreground text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-chrome"
              onClick={() => emit("mini-player:toggle-play-pause")}
              aria-label={isLoading ? "Loading song" : isPlaying ? "Pause" : "Play"}
            >
              {isLoading ? (
                <SpinnerSteps size={16} color="currentColor" />
              ) : isPlaying ? (
                <PauseActiveIcon size={18} aria-hidden="true" />
              ) : (
                <PlayActiveIcon size={18} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className={MINI_BUTTON}
              onClick={() => emit("mini-player:skip-next")}
              aria-label="Next"
            >
              <SkipNextIcon size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mt-2 flex shrink-0 flex-col gap-0.5 self-start">
          <button
            type="button"
            className={cn(MINI_BUTTON, "text-muted-foreground hover:text-foreground")}
            onClick={() => void handleRestore()}
            aria-label="Open YTM Offline"
            title="Open YTM Offline"
          >
            <FullScreenIcon size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={cn(MINI_BUTTON, "text-muted-foreground hover:text-foreground")}
            onClick={() => void handleClose()}
            aria-label="Close mini player"
            title="Close"
          >
            <CloseIcon size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Song position by default; the "hover action" setting can make it the volume. */}
      <div className="relative h-[3px] shrink-0">
        <input
          type="range"
          min={0}
          max={sliderMax}
          step={sliderStep}
          value={sliderValue}
          onInput={handleSliderInput}
          onChange={handleSliderInput}
          onKeyUp={handleSliderKeyUp}
          onPointerDown={handleSliderPointerDown}
          onPointerUp={handleSliderPointerEnd}
          onPointerCancel={handleSliderPointerCancel}
          className="peer absolute inset-x-0 bottom-0 z-10 m-0 h-3 w-full cursor-pointer appearance-none bg-transparent opacity-0 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-px [&::-moz-range-thumb]:border-0 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-px [&::-webkit-slider-thumb]:appearance-none"
          aria-label={hoverAction === "volume" ? "Volume" : "Song position"}
        />
        <div
          className="flex h-full w-full bg-border peer-focus-visible:bg-muted-foreground"
          aria-hidden="true"
        >
          <div
            className={cn("h-full", hoverAction === "volume" ? "bg-foreground" : "bg-primary")}
            style={{ width: `${Math.min(100, Math.max(0, sliderProgress))}%` }}
          />
        </div>
      </div>
    </div>
  );
}
