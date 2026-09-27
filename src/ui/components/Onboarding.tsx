import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckActiveIcon,
  CheckIcon,
  CloseIcon,
  KeyIcon,
} from "@/ui/icons";
import { AppMark } from "./AppLoadingScreen";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { primaryModifierLabel } from "../platform";
import { useReduceMotion } from "../settings/renderEffects";
import {
  CARD_WIDTH,
  ONBOARDING_STEPS,
  SPOTLIGHT_PADDING,
  getCardPosition,
  type OnboardingStep,
  type Rect,
} from "./onboardingSteps";

export {
  ONBOARDING_STEPS,
  nextOnboardingStep,
  previousOnboardingStep,
  type OnboardingStep,
} from "./onboardingSteps";

type StepContent = { title: string; text: string; target: string; shortcut?: string };

function getStepContent(): Record<OnboardingStep, StepContent> {
  return {
    "open-search": {
      title: "Find something to play",
      text: `Press ${primaryModifierLabel} Space, or click the search bar.`,
      target: '[data-onboarding="search"]',
      shortcut: `${primaryModifierLabel} Space`,
    },
    "type-first": {
      title: "Search for a song",
      text: "Type one of your favourites, then pick it from the results.",
      target: '[data-onboarding="search-panel"]',
      shortcut: `${primaryModifierLabel} Space`,
    },
    "play-first": {
      title: "Play it",
      text: "Choose a result to start playing.",
      target: '[data-onboarding="search-panel"], [data-onboarding="search-results"]',
    },
    "new-tab": {
      title: "Open a second tab",
      text: "Tabs each keep their own music, so this song carries on playing here.",
      target: '[data-onboarding="new-tab"]',
      shortcut: `${primaryModifierLabel} T`,
    },
    "type-second": {
      title: "Search again",
      text: "Find a different song in this new tab.",
      target: '[data-onboarding="search-panel"]',
      shortcut: `${primaryModifierLabel} Space`,
    },
    "play-second": {
      title: "Play the second song",
      text: "This tab now has music of its own.",
      target: '[data-onboarding="search-panel"], [data-onboarding="search-results"]',
    },
    "switch-back": {
      title: "Switch back",
      text: "Your first song is exactly where you left it.",
      target: '[data-onboarding="first-tab"]',
      shortcut: `${primaryModifierLabel} 1, 2, 3…`,
    },
  };
}

/**
 * Tracks the highlighted element's position.
 *
 * Watched rather than polled: the previous version re-queried on a 120ms interval, which both
 * burned work while idle and let the spotlight visibly lag anything that moved. A null result is
 * a normal outcome, not a failure — the step's target may not be on screen yet, and the caller
 * degrades to a centred card rather than showing nothing at all.
 */
function useTargetRect(selector: string): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    let frame = 0;
    let observed: HTMLElement | null = null;
    const resizeObserver = new ResizeObserver(() => measure());

    function measure() {
      const target = document.querySelector<HTMLElement>(selector);

      if (target !== observed) {
        if (observed) resizeObserver.unobserve(observed);
        if (target) resizeObserver.observe(target);
        observed = target;
      }

      if (!target) {
        setRect(null);
      } else {
        const box = target.getBoundingClientRect();
        // Zero-sized elements are mid-mount or hidden; treating them as absent avoids a
        // spotlight collapsing onto a point in the corner.
        setRect(
          box.width > 0 && box.height > 0
            ? {
                left: Math.max(0, box.left - SPOTLIGHT_PADDING),
                top: Math.max(0, box.top - SPOTLIGHT_PADDING),
                right: Math.min(window.innerWidth, box.right + SPOTLIGHT_PADDING),
                bottom: Math.min(window.innerHeight, box.bottom + SPOTLIGHT_PADDING),
              }
            : null,
        );
      }

      // The target can move without resizing — a tab opening, a panel sliding — and nothing
      // fires an event for that, so one rAF pass per frame keeps the ring attached.
      frame = requestAnimationFrame(measure);
    }

    measure();
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [selector]);

  return rect;
}

/** Reveals text a character at a time, unless motion is unwelcome or the reader is impatient. */
function useTypedText(text: string, enabled: boolean) {
  const [typed, setTyped] = useState(enabled ? "" : text);
  const reveal = useCallback(() => setTyped(text), [text]);

  useEffect(() => {
    if (!enabled) {
      setTyped(text);
      return;
    }
    setTyped("");
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setTyped(text.slice(0, index));
      if (index >= text.length) window.clearInterval(timer);
    }, 18);
    return () => window.clearInterval(timer);
  }, [text, enabled]);

  return { typed, reveal, done: typed === text };
}

interface OnboardingProps {
  step: OnboardingStep;
  /** Ends the tour entirely. */
  onSkip: () => void;
  /** Moves past this one step without doing it. */
  onSkipStep: () => void;
  onBack: () => void;
}

export function Onboarding({ step, onSkip, onSkipStep, onBack }: OnboardingProps) {
  // The typewriter is a JS timer, so no stylesheet can stop it — this is the hook that can.
  const reduceMotion = useReduceMotion();
  const content = getStepContent()[step];
  const rect = useTargetRect(content.target);
  const { typed, reveal, done } = useTypedText(content.text, !reduceMotion);

  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(160);
  useLayoutEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight);
  }, [content.text, typed]);

  const index = ONBOARDING_STEPS.indexOf(step);
  const isFirst = index === 0;
  const isLast = index === ONBOARDING_STEPS.length - 1;
  const { left: cardLeft, top: cardTop } = getCardPosition(rect, cardHeight, {
    width: window.innerWidth,
    height: window.innerHeight,
  });

  /*
   * Escape leaves the tour and the arrows walk it. A tour that traps someone is worse than no
   * tour, and Escape is the first thing anyone reaches for.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onSkip();
        return;
      }
      // Only with a modifier: the arrows belong to the app while the tour is a passenger.
      if (!event.altKey) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onSkipStep();
      }
      if (event.key === "ArrowLeft" && !isFirst) {
        event.preventDefault();
        onBack();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSkip, onSkipStep, onBack, isFirst]);

  return (
    /*
     * pointer-events-none throughout, re-enabled only on the card. Every decorative layer here
     * sits over the very control the step is asking to be clicked, so without this the tour
     * blocks the action it requests.
     */
    <div className="pointer-events-none fixed inset-0 z-[90]">
      {/* An outline only, no scrim: the design has no translucent layers, and an opaque one
          would hide the very screen the step is talking about. A border rather than a ring so
          the Potato PC "shadows" switch cannot erase it. */}
      {rect && (
        <div
          className="absolute rounded-lg border-2 border-foreground"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
          }}
        />
      )}

      <div
        ref={cardRef}
        className="pointer-events-auto absolute flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-sm text-foreground"
        style={{ left: cardLeft, top: cardTop, width: CARD_WIDTH }}
        role="dialog"
        aria-modal="false"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-text"
        // Tapping the card finishes the typewriter rather than making anyone wait it out.
        onClick={done ? undefined : reveal}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-muted-foreground">
              Step {index + 1} of {ONBOARDING_STEPS.length}
            </span>
            <h2 id="onboarding-title" className="text-lg font-semibold">
              {content.title}
            </h2>
          </div>
          <button
            className="grid size-7 shrink-0 place-items-center rounded text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            type="button"
            onClick={onSkip}
            aria-label="Skip the whole tour"
            title="Skip tour (Esc)"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <p id="onboarding-text" className="min-h-[2.5rem] leading-normal text-muted-foreground">
          {typed}
        </p>

        {content.shortcut && (
          <kbd className="w-fit rounded bg-muted px-1.5 py-0.5 font-sans text-xs text-foreground">
            {content.shortcut}
          </kbd>
        )}

        {/* Progress as dots: cheaper to read at a glance than the counter, and shows the end. */}
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {ONBOARDING_STEPS.map((id, dotIndex) => (
            <span
              key={id}
              className={`h-1 flex-1 rounded-[1px] transition-colors ${
                dotIndex <= index ? "bg-primary" : "bg-border"
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            className="flex h-8 items-center gap-1 rounded px-2 text-[13px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
            type="button"
            onClick={onBack}
            disabled={isFirst}
            title="Previous step (Alt ←)"
          >
            <ArrowLeftIcon size={14} />
            Back
          </button>

          <div className="flex items-center gap-1">
            <button
              className="h-8 rounded px-2 text-[13px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              type="button"
              onClick={onSkip}
            >
              Skip tour
            </button>
            <button
              className="flex h-8 items-center gap-1 rounded bg-foreground px-3 text-[13px] font-medium text-background transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              type="button"
              onClick={onSkipStep}
              title={isLast ? "Finish" : "Skip this step (Alt →)"}
            >
              {isLast ? (
                <>
                  Finish
                  <CheckIcon size={14} />
                </>
              ) : (
                <>
                  Skip step
                  <ArrowRightIcon size={14} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function OnboardingCompleteToast() {
  return (
    <div
      className="fixed bottom-28 left-1/2 z-[95] flex -translate-x-1/2 items-center gap-3 rounded-lg bg-foreground py-3 pl-4 pr-5 text-background"
      role="status"
    >
      <CheckActiveIcon size={20} aria-hidden="true" />
      <span className="text-sm">You're all set</span>
    </div>
  );
}

interface OnboardingWelcomeProps {
  onSignIn: () => void;
  onContinue: () => void;
  isSigningIn: boolean;
}

/** First launch with no account: sign in, or carry on without one. */
export function OnboardingWelcome({ onSignIn, onContinue, isSigningIn }: OnboardingWelcomeProps) {
  return (
    <div
      className="fixed inset-0 z-[95] grid place-items-center bg-background"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      <div className="flex w-[400px] max-w-[calc(100vw-2rem)] flex-col items-start gap-6">
        <AppMark size={64} />
        <div className="flex flex-col gap-2">
          <h1 id="welcome-title" className="text-[32px] font-semibold leading-tight text-foreground">
            YTM Offline
          </h1>
          <p className="text-[15px] leading-normal text-muted-foreground">
            Sign in to see your YouTube Music library. Download a playlist once and it stays in sync.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2">
          <GoogleSignInButton onClick={onSignIn} isBusy={isSigningIn} size="lg" fullWidth />
          <button
            type="button"
            className="h-11 w-full rounded bg-card text-[15px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground"
            onClick={onContinue}
          >
            Continue without signing in
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Unofficial app. Not affiliated with YouTube or Google.
        </p>
      </div>
    </div>
  );
}

interface KeychainNoticeProps {
  onContinue: () => void;
}

export function KeychainNotice({ onContinue }: KeychainNoticeProps) {
  return (
    <div
      className="fixed inset-0 z-[95] grid place-items-center bg-background"
      role="dialog"
      aria-modal="true"
      aria-labelledby="keychain-title"
    >
      <div className="flex w-[400px] max-w-[calc(100vw-2rem)] flex-col items-start gap-6">
        <span className="grid size-16 place-items-center rounded-lg bg-card text-foreground" aria-hidden="true">
          <KeyIcon size={32} />
        </span>
        <div className="flex flex-col gap-3 text-[15px] leading-normal text-muted-foreground">
          <h1 id="keychain-title" className="text-2xl font-semibold text-foreground">
            A note about macOS Keychain
          </h1>
          <p>
            This client uses Keychain to protect the encryption key for your YouTube Music session
            cookie. macOS may ask for permission when you continue.
          </p>
          <p>
            The app only accesses the Keychain item it created for this purpose. It does not request
            access to your passwords or any other Keychain items. You can deny this, but signing in
            with YouTube Music will not work then.
          </p>
          <p>
            <strong className="font-semibold text-foreground">
              Choose “Always Allow” if you would rather not see the prompt again.
            </strong>
          </p>
        </div>
        <button
          type="button"
          className="h-11 w-full rounded bg-foreground text-[15px] font-medium text-background transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onContinue}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
