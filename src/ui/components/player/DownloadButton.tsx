import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/motion/tooltip";
import { SpinnerSteps } from "@/components/motion/loader";
import { DownloadActiveIcon, DownloadIcon, DownloadProgressIcon } from "@/ui/icons";
import { usePlayerSelector } from "../../../player/playerStore";
import {
  cancelDownload,
  queueDownload,
  removeDownload,
  useOfflineState,
} from "../../../player/offlineStore";
import { PLAYER_ICON_BUTTON } from "./playerButton";

/**
 * Download state for the song that is actually playing.
 *
 * This replaced an indicator that lit up for *any* download in the queue, which meant the
 * player bar reported on a song the listener might not have thought about for ten minutes
 * and gave them no way to act on it. One control, bound to the now-playing track, that both
 * reports and does something — the same download / cancel / remove contract as the track
 * context menu, so the two can never disagree about what a click means.
 */
export function DownloadButton() {
  const track = usePlayerSelector((state) => state.currentTrack);
  const offline = useOfflineState();

  // Local files are already on disk; a download control for them is a button that lies.
  if (!track || track.source === "local") return null;

  const isReady = Boolean(offline.entries[track.id]);
  const isDownloading = offline.downloadingId === track.id;
  const queuePosition = offline.queued.indexOf(track.id);
  const isQueued = queuePosition >= 0;
  const progress = isDownloading ? offline.progress : null;

  const label = isReady
    ? "Remove download"
    : isDownloading
      ? progress === null
        ? "Downloading — cancel"
        : `Downloading, ${Math.round(progress)}% — cancel`
      : isQueued
        ? `Queued to download, ${queuePosition + 1} in line — cancel`
        : "Download for offline";

  const onClick = () => {
    if (isReady) void removeDownload(track.id);
    else if (isDownloading || isQueued) cancelDownload(track.id);
    else queueDownload(track);
  };

  return (
    <Tooltip content={label}>
      <button
        type="button"
        className={cn(PLAYER_ICON_BUTTON, isQueued && "text-muted-foreground")}
        onClick={onClick}
        aria-label={label}
      >
        {isReady ? (
          <DownloadActiveIcon size={20} aria-hidden="true" />
        ) : isDownloading && progress !== null ? (
          <DownloadProgressIcon
            size={20}
            progress={Math.min(1, Math.max(0, progress / 100))}
            aria-hidden="true"
          />
        ) : isDownloading ? (
          /* The backend only reports a percentage once it knows the total size. Until then a
             determinate fill would have to invent a number, so it spins instead. */
          <SpinnerSteps size={18} />
        ) : (
          <DownloadIcon size={20} aria-hidden="true" />
        )}
      </button>
    </Tooltip>
  );
}
