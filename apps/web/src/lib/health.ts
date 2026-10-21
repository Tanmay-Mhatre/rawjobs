import { useSyncExternalStore } from "react";
import { canRunLocally } from "./data";
import { updatingTo } from "./update";

/** What GET /api/health says (packages/server/src/api.ts). */
export type Health = {
  ok?: boolean;
  version?: string;
  scanning?: boolean;
  background?: boolean;
  dataVersion?: string | null;
  update?: { version: string } | null;
  startLink?: boolean;
  platform?: string;
  home?: string;
  pid?: number;
};

export type HealthState = {
  /** The last answer while it was up (kept while it's down: how to start it again). */
  health: Health | null;
  /** It didn't answer, or said it isn't ok. */
  down: boolean;
  /** When it stopped answering (Date.now()), while it's down. */
  since: number | null;
};

/** While something waits for the server to come back (Start RawJobs, an update restarting). */
const FAST_MS = 1000;
/** While a scan or background check runs. */
const BUSY_MS = 2000;
const DOWN_MS = 3000;
/** For a minute after anything changed, or after you came back to the tab. */
const ACTIVE_MS = 5000;
const ACTIVE_FOR_MS = 60_000;
/** Then less and less often while nothing happens. */
const IDLE_MS = [15_000, 30_000, 60_000];

/**
 * One /api/health poller for the whole page, however many hooks read it. It runs while anything
 * listens and the tab is visible, asks often while something happens and backs off when nothing
 * does, so an open tab left alone costs the laptop almost nothing.
 */
let state: HealthState = { health: null, down: false, since: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight = false;
let holds = 0;
let activeUntil = 0;
let idleStep = 0;
/** Bumped by __resetHealthForTests, so a poll from before it is dropped. */
let generation = 0;

const hidden = () => document.visibilityState === "hidden";

function wait(advance: boolean): number {
  if (holds > 0 || updatingTo()) return FAST_MS;
  if (state.down) return DOWN_MS;
  if (state.health?.scanning || state.health?.background) return BUSY_MS;
  if (Date.now() < activeUntil) return ACTIVE_MS;
  const ms = IDLE_MS[Math.min(idleStep, IDLE_MS.length - 1)]!;
  if (advance) idleStep++;
  return ms;
}

/** Set the next poll. `advance`: after a poll, so an idle wait steps up to the next one. */
function schedule(advance = false) {
  clearTimeout(timer);
  timer = undefined;
  if (!listeners.size || inFlight || hidden()) return;
  timer = setTimeout(() => void poll(), wait(advance));
}

/** Something happened, or you're back: ask now, and often for a minute. */
function wake() {
  activeUntil = Date.now() + ACTIVE_FOR_MS;
  idleStep = 0;
  void poll();
}

async function poll(): Promise<void> {
  if (inFlight || !listeners.size) return;
  inFlight = true;
  clearTimeout(timer);
  const gen = generation;
  let next: HealthState;
  try {
    const res = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(3000) });
    const h = (await res.json()) as Health;
    next = h.ok ? { health: h, down: false, since: null } : { health: state.health, down: true, since: state.since ?? Date.now() };
  } catch {
    next = { health: state.health, down: true, since: state.since ?? Date.now() };
  }
  if (gen !== generation) return;
  inFlight = false;
  const was = state.down ? "down" : JSON.stringify(state.health);
  if ((next.down ? "down" : JSON.stringify(next.health)) !== was) {
    state = next;
    activeUntil = Date.now() + ACTIVE_FOR_MS;
    idleStep = 0;
  }
  // Every poll, changed or not: useBackgroundScan looks again at what's on screen.
  for (const l of [...listeners]) l();
  schedule(true);
}

function onVisibility() {
  if (hidden()) schedule();
  else wake();
}

/** Hear about every poll (it starts with the first listener and stops with the last). */
export function subscribeHealth(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", wake);
    wake();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    clearTimeout(timer);
    timer = undefined;
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", wake);
  };
}

export const healthState = (): HealthState => state;

/** Ask now (the page started a scan, say), and often for a minute. */
export function refreshHealth(): void {
  if (listeners.size) wake();
}

/** Ask every second until the returned function is called (while RawJobs is starting, say). */
export function requestFast(): () => void {
  holds++;
  schedule();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
    schedule();
  };
}

const noSubscribe = () => () => {};
/** The shared health, for rendering: changes only when the server's answer does. */
export const useHealth = (): HealthState => useSyncExternalStore(canRunLocally ? subscribeHealth : noSubscribe, healthState, healthState);

export function __resetHealthForTests(): void {
  generation++;
  clearTimeout(timer);
  timer = undefined;
  listeners.clear();
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("focus", wake);
  state = { health: null, down: false, since: null };
  inFlight = false;
  holds = 0;
  activeUntil = 0;
  idleStep = 0;
}
