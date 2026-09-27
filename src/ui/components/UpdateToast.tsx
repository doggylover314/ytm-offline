import { useEffect } from "react";
import { motion } from "motion/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CloseIcon } from "@/ui/icons";
import type { UpdateInfo } from "../../internal/updateChecker";
import { snoozeUpdate } from "../../internal/updateChecker";

const AUTO_DISMISS_MS = 60_000;

const PRIMARY_ACTION =
  "rounded-full bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 24, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 400, damping: 32 }}
      className="fixed bottom-28 right-5 z-50 flex max-w-md items-center gap-4 rounded-xl bg-card px-4 py-3 shadow-2xl"
      role="status"
      aria-live="polite"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <strong className="text-sm font-medium text-foreground">
          Version {update.version} is available
        </strong>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
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
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
