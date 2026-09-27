import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/lib/utils";
import { GitHubIcon, ListIcon } from "@/ui/icons";
import { parseReleaseNote, RELEASE_NOTE_BODY } from "../../internal/releaseNote";
import { ExternalLinkButton } from "./ExternalLinkButton";
import { GITHUB_NEW_ISSUE_URL, GITHUB_RELEASES_URL } from "../links";

interface ReleaseNoteDialogProps {
  /** The version being announced, or null when there is nothing to announce. */
  version: string | null;
  onDismiss: () => void;
}

/**
 * Shown once after an update installs.
 *
 * Portalled and centred rather than dropped into the page, because it has to survive whatever
 * view happens to be mounted at startup — including the lyrics screen, which owns its own
 * scrolling and would clip anything rendered inside it.
 */
export function ReleaseNoteDialog({ version, onDismiss }: ReleaseNoteDialogProps) {
  const dismissRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!version) return;
    // Focus the way out, not a link: the dialog interrupts a launch nobody asked to have
    // interrupted, so Enter and Escape should both simply close it.
    dismissRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [version, onDismiss]);

  return createPortal(
    <AnimatePresence>
      {version ? (
        <motion.div
          /* No scrim: the design has no translucent surfaces. This layer only catches clicks. */
          className="fixed inset-0 z-[200] flex items-center justify-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          /* Clicking outside dismisses too — this is an announcement, not a decision. */
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) onDismiss();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="release-note-title"
            className="w-full max-w-lg rounded-lg border border-border bg-card p-6 text-card-foreground"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.15 }}
          >
            <span className="text-[13px] text-muted-foreground">Updated</span>
            <h2 id="release-note-title" className="mt-1 text-lg font-semibold">
              YTM Offline {version}
            </h2>

            {/* `whitespace-pre-line` so the note stays plain text: it is edited per release,
                and making it markdown would mean a renderer and an escaping question. The
                subreddit is linked where it is mentioned rather than as a button, so the
                sentence reads as a sentence. */}
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {parseReleaseNote(RELEASE_NOTE_BODY).map((segment, index) =>
                segment.kind === "text" ? (
                  segment.value
                ) : segment.kind === "strong" ? (
                  <strong
                    key={`${index}:${segment.value}`}
                    className="font-semibold text-foreground"
                  >
                    {segment.value}
                  </strong>
                ) : (
                  <button
                    key={`${index}:${segment.value}`}
                    type="button"
                    className="font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => void openUrl(segment.url)}
                  >
                    {segment.value}
                  </button>
                ),
              )}
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <ExternalLinkButton
                icon={<ListIcon size={15} aria-hidden="true" />}
                label="Release notes"
                url={GITHUB_RELEASES_URL}
              />
              <ExternalLinkButton
                icon={<GitHubIcon size={15} aria-hidden="true" />}
                label="Report an issue"
                url={GITHUB_NEW_ISSUE_URL}
              />

              <button
                ref={dismissRef}
                type="button"
                className={cn(
                  "ml-auto h-9 rounded bg-foreground px-4 text-sm font-medium text-background",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
                onClick={onDismiss}
              >
                Got it
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
