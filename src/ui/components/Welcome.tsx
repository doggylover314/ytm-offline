import { KeyIcon } from "@/ui/icons";
import { AppMark } from "./AppLoadingScreen";
import { GoogleSignInButton } from "./GoogleSignInButton";

/*
 * The screens shown before the app itself: the first-launch welcome, and the notice for a
 * system that cannot store the sign-in securely.
 */

interface OnboardingWelcomeProps {
  onSignIn: () => void;
  onContinue: () => void;
  isSigningIn: boolean;
}

/** First launch with no account: sign in, or carry on without one. */
export function OnboardingWelcome({ onSignIn, onContinue, isSigningIn }: OnboardingWelcomeProps) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 top-[var(--titlebar-height)] z-[95] grid place-items-center bg-background"
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
      className="fixed inset-x-0 bottom-0 top-[var(--titlebar-height)] z-[95] grid place-items-center bg-background"
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
