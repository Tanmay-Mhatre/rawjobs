import { useEffect, useRef } from "react";
import { canRunLocally } from "./data";
import { load, onSave, saveFailed } from "./storage";

/**
 * Your tracking (statuses, notes), Radar preferences, appearance (theme, contrast, density, age limit)
 * and what the dashboard remembers between visits (KEPT_ON_DISK below) are saved on this computer
 * (profile/tracking.json, through the local API) as well as in this browser. The browser copy shows
 * the page instantly; the file is what counts, so opening the dashboard at another address, or in
 * another browser, still finds them. The first page opened with this version uploads what its browser
 * had, so nothing saved before is lost.
 */
export type TrackingPart = "state" | "prefs" | "appearance" | "browser";
type Remote = Partial<Record<TrackingPart, unknown>>;

const SAVE_DELAY = 400;

/** What the file holds: null when there's no file yet, undefined when the local API couldn't be reached. */
async function fetchTracking(): Promise<Remote | null | undefined> {
  try {
    const res = await fetch("/api/tracking", { cache: "no-store" });
    if (!res.ok) return undefined;
    return ((await res.json()) as { tracking?: Remote | null }).tracking ?? null;
  } catch {
    return undefined;
  }
}

/** One read per page load, shared by every part. */
let first: Promise<Remote | null | undefined> | null = null;
const loadOnce = () => (first ??= fetchTracking());

const pending: Remote = {};
let timer: ReturnType<typeof setTimeout> | undefined;

function flush(keepalive = false) {
  clearTimeout(timer);
  timer = undefined;
  if (!Object.keys(pending).length) return;
  const body = JSON.stringify(pending);
  for (const k of Object.keys(pending) as TrackingPart[]) delete pending[k];
  // Offline, the server restarting or refusing it: the browser copy still has it and the next change
  // saves it all, but say so rather than fail silently.
  void fetch("/api/tracking", { method: "PUT", body, keepalive })
    .then((res) => {
      if (!res.ok) saveFailed();
    })
    .catch(() => saveFailed());
}

function queue(part: TrackingPart, value: unknown) {
  pending[part] = value;
  clearTimeout(timer);
  timer = setTimeout(flush, SAVE_DELAY);
}

/** Browsers refuse a keepalive request over about 64 KB: a bigger save goes out as a normal one. */
const KEEPALIVE_MAX = 60_000;
const big = () => JSON.stringify(pending).length > KEEPALIVE_MAX;

if (typeof window !== "undefined") window.addEventListener("pagehide", () => flush(!big()));
// Hidden comes before closing: a big save is sent then, while a normal request still gets through.
if (typeof document !== "undefined")
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && big()) flush();
  });

/**
 * Keep one part in step with the file: load it when the page opens (or upload this browser's copy
 * when there's no file yet), save each change, and pick up changes made elsewhere when you come
 * back to the tab. Does nothing on a hosted copy.
 */
export function useSavedOnDisk<T>(part: TrackingPart, value: T, apply: (v: T) => void) {
  const ready = useRef(false);
  /** The last value known to match the file, as JSON: nothing to save when it hasn't changed. */
  const synced = useRef<string | undefined>(undefined);
  const latest = useRef({ value, apply });
  latest.current = { value, apply };

  useEffect(() => {
    if (!canRunLocally) return;
    let live = true;
    const take = (remote: Remote | null | undefined, initial: boolean) => {
      if (!live || remote === undefined) return;
      const saved = remote?.[part];
      if (saved !== undefined) {
        const json = JSON.stringify(saved);
        if (json !== JSON.stringify(latest.current.value)) latest.current.apply(saved as T);
        synced.current = json;
      } else if (initial) {
        // No file yet: this browser's copy becomes the saved one.
        synced.current = JSON.stringify(latest.current.value);
        queue(part, latest.current.value);
      }
      ready.current = true;
    };
    void loadOnce().then((r) => take(r, true));
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !ready.current || pending[part] !== undefined) return;
      void fetchTracking().then((r) => take(r, false));
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [part]);

  useEffect(() => {
    // Until the file has been read, a change could overwrite newer saved tracking: wait for it.
    if (!ready.current) return;
    const json = JSON.stringify(value);
    if (json === synced.current) return;
    synced.current = json;
    queue(part, value);
  }, [part, value]);
}

/**
 * What the dashboard remembers between visits that isn't tracking or preferences: the New line, what
 * Scan now does, the Radar's own filters, what you dismissed, an unfinished setup. Each screen keeps
 * reading and writing its key in this browser (storage.ts); a copy of these keys is the "browser"
 * part of the file, so they come back at another address too. Anything else stays in the browser.
 */
export const KEPT_ON_DISK: readonly string[] = [
  "rawjobs.radar.seen",
  "rawjobs.scanScope",
  "rawjobs.scanAsk",
  "rawjobs.radar.v2",
  "rawjobs.radar.everywhere",
  "rawjobs.checklist.dismissed",
  "rawjobs.goBackDismissed",
  "rawjobs.notThisOne",
  "rawjobs.setupDraft.v1",
  "rawjobs.welcomeSeen",
  "rawjobs.starPrompt",
  "rawjobs.linkedinBanner.dismissed",
];

/** This browser's copy of the kept keys (a cleared key, saved as null, is left out). */
function browserCopy(): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const key of KEPT_ON_DISK) {
    const value = load<unknown>(key, null);
    if (value !== null) copy[key] = value;
  }
  return copy;
}

/** Put the file's copy in this browser: what it has, and nothing it doesn't. */
function restoreBrowser(saved: Record<string, unknown>) {
  for (const key of KEPT_ON_DISK) {
    try {
      if (saved[key] == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(saved[key]));
    } catch {
      // storage blocked: this visit uses the defaults
    }
  }
}

/** Set once the file's copy has been read: until then a save could overwrite newer ones there. */
let browserReady = false;

function takeBrowser(remote: Remote | null | undefined, initial: boolean) {
  if (remote === undefined) return;
  const saved = remote?.browser;
  if (saved && typeof saved === "object" && !Array.isArray(saved)) restoreBrowser(saved as Record<string, unknown>);
  // No copy yet: this browser's becomes the saved one.
  else if (initial) queue("browser", browserCopy());
  browserReady = true;
}

onSave((key) => {
  if (browserReady && KEPT_ON_DISK.includes(key)) queue("browser", browserCopy());
});

/**
 * Before the first render: bring this browser up to date with the file, so every screen starts from
 * what you had, whichever address the dashboard is at. Waits at most `timeoutMs` for the local API;
 * a slower answer is still taken when it comes. Does nothing on a hosted copy.
 */
export async function restoreFromDisk(timeoutMs = 1000): Promise<void> {
  if (!canRunLocally) return;
  const read = loadOnce().then((r) => takeBrowser(r, true));
  await Promise.race([read, new Promise((done) => setTimeout(done, timeoutMs))]);
}

if (typeof document !== "undefined") {
  // Back in this tab: pick up what another tab or address saved, for the screens you open next.
  document.addEventListener("visibilitychange", () => {
    if (!canRunLocally || document.visibilityState !== "visible" || !browserReady || pending.browser !== undefined) return;
    void fetchTracking().then((r) => takeBrowser(r, false));
  });
}

/** Tests: forget the page's first read and anything waiting to be saved. */
export function resetTrackingSync() {
  first = null;
  browserReady = false;
  clearTimeout(timer);
  timer = undefined;
  for (const k of Object.keys(pending) as TrackingPart[]) delete pending[k];
}
