import { useEffect, useId, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { CheckIcon, FolderIcon } from "../icons";
import {
  changeOfflineLocation,
  getOfflineLocation,
  type OfflineLocation,
  type OfflineMigrationMode,
} from "../../player/offlineStore";

const BUTTON =
  "flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-4 text-sm font-medium transition-colors has-[svg]:pl-3 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const PRIMARY = cn(BUTTON, "bg-foreground text-background hover:bg-white");
const SECONDARY = cn(BUTTON, "bg-muted text-foreground hover:bg-border");
const PLAIN = cn(BUTTON, "text-foreground hover:bg-card");

const MODES: ReadonlyArray<{ value: OfflineMigrationMode; label: string; hint: string }> = [
  {
    value: "move",
    label: "Move them",
    hint: "Move every downloaded song to the new folder. The old copies are removed once all of them are there.",
  },
  {
    value: "copy",
    label: "Copy them",
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
  const titleId = useId();

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
    <div className="flex flex-col gap-3 bg-chrome px-5 py-4">
      <div className="flex flex-col gap-0.5">
        <span id={titleId} className="text-sm font-semibold text-foreground">Download folder</span>
        <span className="text-[13px] text-muted-foreground">
          Songs are kept in a YTM Offline folder inside the folder you choose.
        </span>
      </div>

      <div className="flex items-center gap-2">
        <input
          className="h-9 min-w-0 flex-1 truncate rounded bg-background px-3 font-mono text-[13px] text-foreground outline-none"
          readOnly
          value={location?.path ?? "Loading…"}
          title={location?.path}
          aria-labelledby={titleId}
        />
        <button className={SECONDARY} type="button" disabled={busy || !location} onClick={() => void pickFolder()}>
          <FolderIcon size={18} aria-hidden="true" />
          Change…
        </button>
        {location && !location.isDefault && (
          <button
            className={PLAIN}
            type="button"
            disabled={busy}
            onClick={() => request({ folder: null, label: "the default folder" })}
          >
            Use default
          </button>
        )}
      </div>

      {location && !location.available && (
        <p className="text-[13px] text-destructive">
          This folder can't be found. Reconnect the drive it's on, or choose another folder and start fresh.
        </p>
      )}

      {pending && (
        <div className="flex flex-col gap-3 rounded bg-card p-4">
          <p className="text-sm text-foreground">
            Switching to <span className="break-all font-mono text-[13px]">{pending.label}</span>. What should happen to the songs you've already downloaded?
          </p>
          <div className="flex flex-col gap-1" role="radiogroup" aria-label="Existing downloads">
            {MODES.map((option) => {
              const selected = mode === option.value;
              return (
                <label
                  key={option.value}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded px-3 py-2.5 transition-colors",
                    "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-ring",
                    selected ? "bg-muted" : "hover:bg-muted",
                    busy && "pointer-events-none opacity-50",
                  )}
                >
                  {/* The native radio keeps keyboard and screen-reader behaviour; the square
                      beside it is what shows. */}
                  <input
                    className="sr-only"
                    type="radio"
                    name="download-folder-mode"
                    value={option.value}
                    checked={selected}
                    disabled={busy}
                    onChange={() => setMode(option.value)}
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[3px]",
                      selected ? "bg-foreground text-background" : "border-[1.5px] border-foreground",
                    )}
                  >
                    {selected && <CheckIcon size={14} strokeWidth={2.5} />}
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-foreground">{option.label}</span>
                    <span className="text-[13px] text-muted-foreground">{option.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {busy && (
              <span className="mr-auto text-[13px] tabular-nums text-muted-foreground">
                {progress && progress.total > 0
                  ? `${progress.done} of ${progress.total} files`
                  : "Waiting for the current download…"}
              </span>
            )}
            <button className={PLAIN} type="button" disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </button>
            <button
              className={PRIMARY}
              type="button"
              disabled={busy}
              onClick={() => void apply(pending, mode)}
            >
              {busy ? "Working…" : "Change folder"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-[13px] text-destructive">{error}</p>}
    </div>
  );
}
