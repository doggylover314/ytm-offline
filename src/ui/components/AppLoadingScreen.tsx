import { SpinnerSteps } from "@/components/motion/loader";

/** The app icon (assets/icon.svg): red headphones with a download arrow. */
export function AppMark({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" className="shrink-0">
      <rect width="512" height="512" rx="96" fill="#202126" />
      <path
        d="M130 300v-40a126 126 0 0 1 252 0v40"
        fill="none"
        stroke="#FF0033"
        strokeWidth="36"
        strokeLinecap="round"
      />
      <rect x="112" y="288" width="72" height="116" rx="30" fill="#FF0033" />
      <rect x="328" y="288" width="72" height="116" rx="30" fill="#FF0033" />
      <path
        d="M256 250v96m-26-26 26 26 26-26"
        fill="none"
        stroke="#fff"
        strokeWidth="20"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface AppLoadingScreenProps {
  isLeaving: boolean;
}

export function AppLoadingScreen({ isLeaving }: AppLoadingScreenProps) {
  return (
    <div className={`fixed inset-0 z-[100] grid place-items-center bg-background transition-opacity duration-200 ${isLeaving ? "pointer-events-none opacity-0" : "opacity-100"}`} role="status" aria-label="Loading YTM Offline">
      <div className="flex flex-col items-center gap-6">
        <AppMark size={64} />
        <span className="text-[32px] font-semibold leading-none text-foreground">YTM Offline</span>
        <SpinnerSteps size={20} color="currentColor" />
      </div>
    </div>
  );
}
