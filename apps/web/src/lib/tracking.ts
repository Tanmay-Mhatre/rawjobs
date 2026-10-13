import { useEffect, useRef } from "react";
import { canRunLocally } from "./data";

/**
 * Your tracking (statuses, notes), Radar preferences and appearance (theme, contrast, density, age limit) are saved on this computer
 * (profile/tracking.json, through the local API) as well as in this browser. The browser copy shows
 * the page instantly; the file is what counts, so opening the dashboard at another address, or in
 * another browser, still finds them. The first page opened with this version uploads what its browser
 * had, so nothing saved before is lost.
 */
export type TrackingPart = "state" | "prefs" | "appearance";
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
  void fetch("/api/tracking", { method: "PUT", body, keepalive }).catch(() => {
    // Offline or the server is restarting: the browser copy still has it, and the next change saves it all.
  });
}

function queue(part: TrackingPart, value: unknown) {
  pending[part] = value;
  clearTimeout(timer);
  timer = setTimeout(flush, SAVE_DELAY);
}

if (typeof window !== "undefined") window.addEventListener("pagehide", () => flush(true));

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

/** Tests: forget the page's first read and anything waiting to be saved. */
export function resetTrackingSync() {
  first = null;
  clearTimeout(timer);
  timer = undefined;
  for (const k of Object.keys(pending) as TrackingPart[]) delete pending[k];
}
