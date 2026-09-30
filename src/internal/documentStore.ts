import { invoke } from "@tauri-apps/api/core";
import { logInternalWarn } from "./logging";

/**
 * JSON documents kept by the backend in their own files (see `app_document_write`).
 *
 * For state that must survive anything short of deleting the app's data: the offline manifest,
 * the download queue, the synced playlists. Writes to the same document are coalesced — the
 * download queue changes several times a second while it runs, and only the latest version needs
 * to reach disk — and written one at a time so an older version can never land after a newer one.
 */
const WRITE_DELAY_MS = 400;

interface PendingWrite {
  value: unknown;
  timer: number | null;
}

const pending = new Map<string, PendingWrite>();
let chain: Promise<void> = Promise.resolve();

export async function readDocument<T>(name: string): Promise<T | null> {
  try {
    return (await invoke<T | null>("app_document_read", { name })) ?? null;
  } catch (error) {
    logInternalWarn("documentStore.read failed", {
      name,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function write(name: string, value: unknown): Promise<void> {
  chain = chain.then(() =>
    invoke<void>("app_document_write", { name, value }).catch((error) => {
      logInternalWarn("documentStore.write failed", {
        name,
        error: error instanceof Error ? error.message : String(error),
      });
    }),
  );
  return chain;
}

/**
 * Saves `value` now and reports whether it reached disk. For a migration, where the old copy
 * may only be deleted once the new one is safe.
 */
export async function saveDocumentNow(name: string, value: unknown): Promise<boolean> {
  const waiting = pending.get(name);
  if (waiting?.timer != null) window.clearTimeout(waiting.timer);
  pending.delete(name);
  let saved = false;
  chain = chain.then(() =>
    invoke<void>("app_document_write", { name, value }).then(
      () => {
        saved = true;
      },
      (error) => {
        logInternalWarn("documentStore.write failed", {
          name,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    ),
  );
  await chain;
  return saved;
}

/** Saves `value` shortly, replacing any save of the same document still waiting. */
export function saveDocument(name: string, value: unknown): void {
  const existing = pending.get(name);
  if (existing?.timer != null) window.clearTimeout(existing.timer);
  const entry: PendingWrite = { value, timer: null };
  entry.timer = window.setTimeout(() => {
    pending.delete(name);
    void write(name, entry.value);
  }, WRITE_DELAY_MS);
  pending.set(name, entry);
}

/** Writes every waiting save now. */
export function flushDocuments(): Promise<void> {
  for (const [name, entry] of pending) {
    if (entry.timer != null) window.clearTimeout(entry.timer);
    pending.delete(name);
    void write(name, entry.value);
  }
  return chain;
}

if (typeof window !== "undefined") {
  // Best effort: the invoke is asynchronous, but it is queued before the page goes away.
  window.addEventListener("pagehide", () => void flushDocuments());
}
