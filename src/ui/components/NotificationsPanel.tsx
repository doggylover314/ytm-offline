import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/motion/button";
import { Tooltip } from "@/components/motion/tooltip";
import { SpinnerSteps } from "@/components/motion/loader";
import { BookmarkIcon, BookmarkActiveIcon, RefreshIcon } from "@/ui/icons";
import type { FeedNotification } from "../../datasource/types";
import { libraryController, playerController } from "../../player/playerStore";
import { logInternalError } from "../../internal/logging";
import { FloatingPanel } from "./FloatingPanel";

/**
 * How often the unseen count is refreshed while the app is open.
 *
 * New releases arrive on the order of days, so this only needs to be often enough that the
 * badge is not stale across a long session. Anything faster is a request per user per minute
 * to learn nothing.
 */
const UNSEEN_POLL_MS = 10 * 60 * 1000;

function NotificationRow({
  notification,
  onOpen,
}: {
  notification: FeedNotification;
  onOpen: (notification: FeedNotification) => void;
}) {
  const canOpen = Boolean(notification.videoId);

  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-start gap-3 rounded px-2 py-1.5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        canOpen ? "hover:bg-muted" : "cursor-default",
      )}
      disabled={!canOpen}
      onClick={() => onOpen(notification)}
    >
      {notification.thumbnailUrl ? (
        <img
          className="size-10 shrink-0 rounded object-cover"
          src={notification.thumbnailUrl}
          alt=""
          loading="lazy"
        />
      ) : (
        <span className="size-10 shrink-0 rounded bg-muted" aria-hidden="true" />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "line-clamp-2 text-sm text-foreground",
            !notification.read && "font-semibold",
          )}
        >
          {notification.text}
        </span>
        {notification.sentAtText ? (
          <span className="text-[13px] text-muted-foreground">{notification.sentAtText}</span>
        ) : null}
      </span>
      {!notification.read && (
        <span
          className="mt-1.5 size-2 shrink-0 rounded-[1px] bg-foreground"
          aria-label="Unread"
        />
      )}
    </button>
  );
}

/**
 * The account's notification inbox, as a toolbar button.
 *
 * The list is only fetched when the panel opens — it is a page of rendered HTML-ish content
 * nobody reads most sessions. Only the unseen *count* is polled, because that is what decides
 * whether the button is worth looking at.
 */
export function NotificationsPanel({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<FeedNotification[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [unseen, setUnseen] = useState(0);

  const refreshUnseen = useCallback(() => {
    if (!signedIn) {
      setUnseen(0);
      return;
    }
    void libraryController.getUnseenNotificationCount()
      .then(setUnseen)
      .catch(() => setUnseen(0));
  }, [signedIn]);

  useEffect(() => {
    refreshUnseen();
    const intervalId = window.setInterval(refreshUnseen, UNSEEN_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [refreshUnseen]);

  const load = useCallback(() => {
    let active = true;
    setIsLoading(true);
    void libraryController.getNotifications()
      .then((fetched) => {
        if (active) setNotifications(fetched);
      })
      .catch((error: unknown) => {
        logInternalError("NotificationsPanel.load failed", error);
        if (active) setNotifications([]);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const cancel = load();
    // Opening the list is what "seeing" them means, so the badge clears here rather than
    // waiting for the next poll to report a number the user has already looked at.
    setUnseen(0);
    return cancel;
  }, [load, open]);

  if (!signedIn) return null;

  const handleOpen = (notification: FeedNotification) => {
    if (!notification.videoId) return;
    setOpen(false);
    void playerController.playTrackById(notification.videoId);
  };

  return (
    <FloatingPanel
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      className="w-96 max-w-[calc(100vw-2rem)] p-1.5"
      trigger={
        <Tooltip side="bottom" content="Notifications">
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={unseen > 0 ? `Notifications, ${unseen} unread` : "Notifications"}
            aria-expanded={open}
            // FloatingPanel positions and dismisses the panel but leaves opening to the
            // trigger, so without this the button is inert.
            onClick={() => setOpen((value) => !value)}
          >
            {unseen > 0 ? (
              <BookmarkActiveIcon size={16} aria-hidden="true" />
            ) : (
              <BookmarkIcon size={16} aria-hidden="true" />
            )}
            {unseen > 0 && (
              <span
                className="absolute right-0.5 top-0.5 min-w-3.5 rounded-[2px] bg-foreground px-1 text-[10px] font-semibold leading-3.5 text-background"
                aria-hidden="true"
              >
                {unseen > 9 ? "9+" : unseen}
              </span>
            )}
          </Button>
        </Tooltip>
      }
    >
      <div className="flex items-center justify-between gap-2 pb-1 pl-2.5">
        <span className="text-sm font-semibold text-foreground">Notifications</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh notifications"
          disabled={isLoading}
          onClick={() => load()}
        >
          <RefreshIcon size={15} aria-hidden="true" />
        </Button>
      </div>

      {isLoading && !notifications ? (
        <div className="grid place-items-center py-10" role="status" aria-label="Loading">
          <SpinnerSteps size={24} color="currentColor" />
        </div>
      ) : !notifications?.length ? (
        <p className="px-3 py-8 text-center text-sm text-muted-foreground">
          Nothing new. Subscribe to artists to hear about their releases here.
        </p>
      ) : (
        <div className="flex max-h-96 flex-col gap-0.5 overflow-y-auto">
          {notifications.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              onOpen={handleOpen}
            />
          ))}
        </div>
      )}
    </FloatingPanel>
  );
}
