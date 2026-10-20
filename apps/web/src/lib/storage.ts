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
  onSaved?.(key);
  return ok;
}

let onSaved: ((key: string) => void) | undefined;

/** Hear about every save (tracking.ts copies some keys to your RawJobs folder). */
export function onSave(listener: (key: string) => void): void {
  onSaved = listener;
}

let onFailed: (() => void) | undefined;
let lastFailed = 0;
/** At most one "couldn't save" a minute, however many saves fail. */
const FAILED_GAP_MS = 60_000;

/** Your tracking couldn't be saved, in this browser or on disk: tell whoever listens (App shows a toast). */
export function saveFailed(): void {
  const now = Date.now();
  if (now - lastFailed < FAILED_GAP_MS) return;
  lastFailed = now;
  onFailed?.();
}

/** Hear when saving your tracking fails. */
export function onSaveFailed(listener: (() => void) | undefined): void {
  onFailed = listener;
  lastFailed = 0;
}

const MIGRATED_KEY = "rawjobs.migrated.v1";

/**
 * Before the rename to RawJobs everything was saved under jobhunter.* keys. Copy each one to its
 * rawjobs.* key once, keeping the old keys (an older checkout still reads them) and never
 * overwriting a rawjobs.* value. Safe to run on every start.
 */
export function migrateLegacyStorage(): void {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return;
    // Take the keys first: adding keys while walking them by index can skip some.
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    for (const key of keys) {
      if (!key?.startsWith("jobhunter.")) continue;
      const next = `rawjobs.${key.slice("jobhunter.".length)}`;
      const value = localStorage.getItem(key);
      if (value != null && localStorage.getItem(next) == null) localStorage.setItem(next, value);
    }
    localStorage.setItem(MIGRATED_KEY, "1");
  } catch {
    // storage blocked or full: the app starts with defaults, and tries again next time
  }
}
