import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { FolderOpenIcon } from "../icons";
import {
  changeOfflineLocation,
  getOfflineLocation,
  type OfflineLocation,
  type OfflineMigrationMode,
} from "../../player/offlineStore";

const BUTTON =
  "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-card disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

const MODES: ReadonlyArray<{ value: OfflineMigrationMode; label: string; hint: string }> = [
  {
    value: "move",
    label: "Move downloads",
    hint: "Move every downloaded song to the new folder. The old copies are removed once all of them are there.",
  },
  {
    value: "copy",
    label: "Copy downloads",
    hint: "Copy them over and leave the old folder alone. Uses twice the space until you delete it.",
  },
  {
    value: "fresh",
    label: "Start fresh",
    hint: "Delete the old files and download everything again into the new folder. Needs a connection.",
  },
];

/** A picked folder waiting for the user to choose what happens to existing downloads. */
type PendingChange = { folder: string | null; label: string };

export function DownloadLocationSetting({ hasDownloads }: { hasDownloads: boolean }) {
  const [location, setLocation] = useState<OfflineLocation | null>(null);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [mode, setMode] = useState<OfflineMigrationMode>("move");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getOfflineLocation()
      .then((next) => { if (!cancelled) setLocation(next); })
      .catch((reason) => { if (!cancelled) setError(String(reason?.message ?? reason)); });
    return () => { cancelled = true; };
  }, []);

  const apply = async (change: PendingChange, chosenMode: OfflineMigrationMode) => {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const next = await changeOfflineLocation(change.folder, chosenMode, (done, total) =>
        setProgress({ done, total }),
      );
      setLocation(next);
      setPending(null);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String((reason as { message?: string })?.message ?? reason);
      setError(`Could not change the download folder: ${message}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const request = (change: PendingChange) => {
    setError(null);
    setMode("move");
    // Nothing to move: switch straight away instead of asking.
    if (!hasDownloads) void apply(change, "move");
    else setPending(change);
  };

  const pickFolder = async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false, title: "Choose download folder" });
      if (typeof selected !== "string") return;
      request({ folder: selected, label: selected });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to open the folder picker.");
    }
  };

  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Download folder
          <input
            className="w-full min-w-0 truncate rounded-lg bg-background px-3 py-2 font-mono text-sm text-foreground outline-none"
            readOnly
            value={location?.path ?? "Loading…"}
            title={location?.path}
            aria-label="Download folder"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button className={BUTTON} type="button" disabled={busy || !location} onClick={() => void pickFolder()}>
            <FolderOpenIcon size={18} aria-hidden="true" />
            Change…
          </button>
          {location && !location.isDefault && (
            <button
              className={BUTTON}
              type="button"
              disabled={busy}
              onClick={() => request({ folder: null, label: "the default folder" })}
            >
              Use default
            </button>
          )}
        </div>
      </div>

      {location && !location.available && (
        <p className="text-sm text-destructive">
          This folder can't be found. Reconnect the drive it's on, or choose another folder and start fresh.
        </p>
      )}

      {pending && (
        <div className="flex flex-col gap-3 rounded-xl bg-background p-4">
          <p className="text-sm">
            Switching to <span className="font-medium break-all">{pending.label}</span>. What should happen to the songs you've already downloaded?
          </p>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Existing downloads">
            {MODES.map((option) => (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-card",
                  mode === option.value && "bg-card",
                )}
              >
                <input
                  className="mt-1 accent-[var(--color-primary)]"
                  type="radio"
                  name="download-folder-mode"
                  value={option.value}
                  checked={mode === option.value}
                  disabled={busy}
                  onChange={() => setMode(option.value)}
                />
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{option.label}</span>
                  <span className="text-xs text-muted-foreground">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {busy && (
              <span className="mr-auto text-sm tabular-nums text-muted-foreground">
                {progress && progress.total > 0
                  ? `${progress.done} of ${progress.total} files`
                  : "Waiting for the current download…"}
              </span>
            )}
            <button className={BUTTON} type="button" disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </button>
            <button
              className={cn(BUTTON, "bg-primary text-primary-foreground hover:bg-primary/90")}
              type="button"
              disabled={busy}
              onClick={() => void apply(pending, mode)}
            >
              {busy ? "Working…" : "Change folder"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
