interface AppLoadingScreenProps {
  isLeaving: boolean;
}

export function AppLoadingScreen({ isLeaving }: AppLoadingScreenProps) {
  return (
    <div className={`fixed inset-0 z-[100] grid place-items-center bg-background transition-opacity duration-200 ${isLeaving ? "pointer-events-none opacity-0" : "opacity-100"}`} role="status" aria-label="Loading YTM Offline">
      <div className="flex flex-col items-center gap-4">
        <span className="text-xl font-semibold tracking-wide text-foreground">YTM Offline</span>
        <span className="size-5 animate-spin rounded-full border-2 border-muted border-t-primary" aria-hidden="true" />
      </div>
    </div>
  );
}
