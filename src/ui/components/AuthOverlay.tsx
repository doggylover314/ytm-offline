import { AnimatePresence, motion } from "motion/react";
import { useReduceMotion } from "../settings/renderEffects";
import { Loader } from "@/components/motion/loader";
import { cn } from "@/lib/utils";
import type { AuthFlow, AuthProgress, AuthStage } from "../../datasource/types";
import { CheckActiveIcon, GlobalIcon, LoginIcon, PlaylistIcon, UserIcon } from "../icons";
import { AppMark } from "./AppLoadingScreen";

interface Stage {
  id: AuthStage;
  title: string;
  /** What is happening, and for the browser step, what the user has to do about it. */
  description: string;
  Icon: typeof LoginIcon;
}

const LIBRARY_STAGE: Stage = {
  id: "library",
  title: "Fetching your account",
  description: "Loading your channel, playlists, albums and liked songs.",
  Icon: PlaylistIcon,
};

/**
 * The stages of each flow, in the order they run.
 *
 * Listed per flow rather than filtered from one shared array: switching channel has no browser
 * step at all, and a shared list would have to render it as either skipped or already done —
 * both of which claim something that never happened. The wording of the shared steps differs
 * too, which a filter could not express.
 *
 * Ordering is what makes the checklist readable: a step needs to know it is behind the active
 * one to show as done, and only a fixed sequence can say so.
 */
const STAGES_BY_FLOW: Record<AuthFlow, ReadonlyArray<Stage>> = {
  "sign-in": [
    {
      id: "browser",
      title: "Signing in",
      description: "Finish signing in to YouTube Music in the window that opened.",
      Icon: LoginIcon,
    },
    {
      id: "session",
      title: "Securing your session",
      description: "Confirming the account and clearing anything cached from before.",
      Icon: GlobalIcon,
    },
    LIBRARY_STAGE,
  ],
  "account-switch": [
    {
      id: "session",
      title: "Switching channel",
      description: "Handing over to the new channel and clearing the previous one's cache.",
      Icon: UserIcon,
    },
    LIBRARY_STAGE,
  ],
  "google-account-switch": [
    {
      id: "session",
      title: "Switching account",
      description: "Handing over to the other account and clearing the previous one's cache.",
      Icon: UserIcon,
    },
    LIBRARY_STAGE,
  ],
};

const HEADINGS: Record<AuthFlow, { title: string; waiting: string; working: string }> = {
  "sign-in": {
    title: "Connecting to YouTube Music",
    waiting: "This waits on you — the rest takes a few seconds.",
    working: "Nearly there. Keep this window open.",
  },
  "account-switch": {
    title: "Switching channel",
    waiting: "Moving your library over to the new channel.",
    working: "Nearly there. Keep this window open.",
  },
  "google-account-switch": {
    title: "Switching account",
    waiting: "Moving your library over to the other account.",
    working: "Nearly there. Keep this window open.",
  },
};

interface AuthOverlayProps {
  progress: AuthProgress;
  onCancel: () => void;
}

/**
 * Full-screen progress for signing in or switching channel.
 *
 * Mounted only while one is running, so none of the animation below costs anything the rest of
 * the time — the parent renders it conditionally rather than toggling a `hidden` class.
 */
export function AuthOverlay({ progress, onCancel }: AuthOverlayProps) {
  const reduce = useReduceMotion();
  const stages = STAGES_BY_FLOW[progress.flow];
  const headings = HEADINGS[progress.flow];
  const activeIndex = stages.findIndex((stage) => stage.id === progress.stage);
  const isRetrying = progress.attemptCount > 1 && progress.attempt > 1;
  /*
   * Offered only while the browser step is running.
   *
   * This overlay sits above the title bar, so for as long as it is up the window controls are
   * unreachable — and the browser step waits on a person, for up to five minutes. Without a way
   * out, a user who changed their mind cannot even close the app. Every other step, in both
   * flows, takes seconds and is mid-transaction: cancelling would leave a half-applied session.
   */
  const canCancel = progress.stage === "browser";

  return (
    <motion.div
      /* Opaque: this covers the whole app, title bar included. Rounded to the window so it
         follows the corner cutout; the variable is 0 when maximized or on Linux. */
      className="fixed inset-0 z-[95] grid place-items-center overflow-hidden rounded-[var(--window-radius)] bg-background"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0 : 0.18 }}
      role="status"
      aria-live="polite"
      aria-label={headings.title}
    >
      <div className="flex w-[400px] max-w-[calc(100vw-2rem)] flex-col items-start gap-6">
        <AppMark size={64} />
        <div className="flex flex-col gap-2">
          <strong className="text-2xl font-semibold text-foreground">{headings.title}</strong>
          <span className="text-[15px] leading-normal text-muted-foreground">
            {activeIndex <= 0 ? headings.waiting : headings.working}
          </span>
        </div>

        <ol className="flex w-full flex-col gap-0.5">
          {stages.map((stage, index) => (
            <AuthStep
              key={stage.id}
              stage={stage}
              state={
                index < activeIndex ? "done" : index === activeIndex ? "active" : "pending"
              }
              note={
                stage.id === "library" && isRetrying
                  ? `Still syncing — attempt ${progress.attempt} of ${progress.attemptCount}.`
                  : null
              }
            />
          ))}
        </ol>

        {canCancel && (
          <button
            className="h-11 w-full rounded bg-card text-[15px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
    </motion.div>
  );
}

interface AuthStepProps {
  stage: Stage;
  state: "done" | "active" | "pending";
  note: string | null;
}

function AuthStep({ stage, state, note }: AuthStepProps) {
  const { Icon } = stage;
  /*
   * Read here as well as in the parent. `MotionConfig` at the app root suppresses transform and
   * layout animations, but not an explicit height tween — so this one has to opt out itself.
   */
  const reduce = useReduceMotion();

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded px-3 py-2.5 transition-colors duration-200",
        state === "active" && "bg-card",
      )}
    >
      {/*
        Fixed-size and `shrink-0`: the marker swaps between an icon, a spinner and a tick, and
        without a reserved box every swap would shift the text beside it by a pixel or two.
      */}
      <span className="grid size-6 shrink-0 place-items-center" aria-hidden="true">
        {state === "done" ? (
          <CheckActiveIcon size={20} className="text-foreground" />
        ) : state === "active" ? (
          <Loader variant="spinner" size={18} label="" className="text-foreground" />
        ) : (
          <Icon size={18} className="text-muted-foreground" />
        )}
      </span>

      {/*
        `min-w-0` is what lets the note truncate. Flex children default to `min-width: auto`,
        so without it a long line pushes the row wider than the panel instead of wrapping.
      */}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "text-sm font-medium transition-colors duration-200",
            state === "pending" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {stage.title}
        </span>

        {/*
          Only the active step explains itself. Showing every description at once turns a
          three-line checklist into a paragraph nobody reads.
        */}
        <AnimatePresence initial={false}>
          {state === "active" && (
            <motion.span
              className="overflow-hidden text-[13px] leading-normal text-muted-foreground"
              initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, height: "auto" }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
            >
              {note ?? stage.description}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </li>
  );
}
