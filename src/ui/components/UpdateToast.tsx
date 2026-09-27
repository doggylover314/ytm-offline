import { useEffect } from "react";
import { motion } from "motion/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CloseIcon } from "@/ui/icons";
import type { UpdateInfo } from "../../internal/updateChecker";
import { snoozeUpdate } from "../../internal/updateChecker";

const AUTO_DISMISS_MS = 60_000;

const PRIMARY_ACTION =
  "flex h-8 items-center rounded bg-foreground px-3 text-[13px] font-medium text-background transition-colors hover:bg-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface UpdateToastProps {
  update: UpdateInfo;
  onDismiss: () => void;
}

export function UpdateToast({ update, onDismiss }: UpdateToastProps) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      snoozeUpdate(update.version);
      onDismiss();
    }, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [onDismiss, update.version]);

  const dismiss = () => {
    snoozeUpdate(update.version);
    onDismiss();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className="fixed bottom-28 right-5 z-50 flex w-[420px] max-w-[calc(100vw-2.5rem)] items-center gap-3 rounded-lg border border-border bg-card py-3 pl-4 pr-3"
      role="status"
      aria-live="polite"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <strong className="text-sm font-normal text-foreground">
          Version {update.version} is available
        </strong>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <a
          className={PRIMARY_ACTION}
          href={update.releaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open version ${update.version} release on GitHub`}
          onClick={(e) => {
            e.preventDefault();
            void openUrl(update.releaseUrl);
          }}
        >
          Download
        </a>
        <button
          className="flex size-7 items-center justify-center rounded text-foreground transition-colors hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          type="button"
          onClick={dismiss}
          aria-label="Close update notification"
          title="Close"
        >
          <CloseIcon size={16} />
        </button>
      </div>
    </motion.div>
  );
}
