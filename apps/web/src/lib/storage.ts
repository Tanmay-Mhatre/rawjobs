/** localStorage that never throws (private windows, blocked storage). */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** False when the browser refused it (storage full or blocked). */
export function save(key: string, value: unknown): boolean {
  let ok = true;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the session still works, it just won't persist
    ok = false;
  }
  onKeySaved?.(key);
  return ok;
}

let onKeySaved: ((key: string) => void) | undefined;

/** Hear about every save (tracking.ts copies some keys to your RawJobs folder). */
export function onSave(listener: (key: string) => void): void {
  onKeySaved = listener;
}

/**
 * Why your tracking couldn't be saved. browser: this browser refused it (storage full or blocked).
 * offline: the local API couldn't be reached. server: it answered with an error. conflict: another
 * window kept saving the same thing first, even after joining the two and trying again.
 */
export type SaveCause = "browser" | "offline" | "server" | "conflict";
/** Where a save worked: in this browser, or in your RawJobs folder (which settles offline, server and conflict). */
export type SavedWhere = "browser" | "server";

const failedListeners = new Set<(cause: SaveCause) => void>();
const savedListeners = new Set<(where: SavedWhere) => void>();
const lastFailed: Partial<Record<SaveCause, number>> = {};
/** At most one "couldn't save" a minute for each cause, however many saves fail. */
const FAILED_GAP_MS = 60_000;
const SETTLES: Record<SavedWhere, SaveCause[]> = { browser: ["browser"], server: ["offline", "server", "conflict"] };

/** Your tracking couldn't be saved, in this browser or on disk: tell whoever listens (the save problem notice). */
export function saveFailed(cause: SaveCause): void {
  const now = Date.now();
  if (now - (lastFailed[cause] ?? Number.NEGATIVE_INFINITY) < FAILED_GAP_MS) return;
  lastFailed[cause] = now;
  for (const listener of failedListeners) listener(cause);
}

/** A save worked: the next failure of the causes it settles is told again at once. */
export function saveWorked(where: SavedWhere): void {
  for (const cause of SETTLES[where]) delete lastFailed[cause];
  for (const listener of savedListeners) listener(where);
}

/** Hear when saving your tracking fails, and why. Returns a function that stops listening. Starts the once-a-minute count afresh. */
export function onSaveFailed(listener: (cause: SaveCause) => void): () => void {
  for (const cause of Object.keys(lastFailed) as SaveCause[]) delete lastFailed[cause];
  failedListeners.add(listener);
  return () => failedListeners.delete(listener);
}

/** Hear when a save works. Returns a function that stops listening. */
export function onSaved(listener: (where: SavedWhere) => void): () => void {
  savedListeners.add(listener);
  return () => savedListeners.delete(listener);
}
