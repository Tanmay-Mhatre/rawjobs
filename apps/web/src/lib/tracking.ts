import { useEffect, useLayoutEffect, useRef } from "react";
import { getJson, trackingRead } from "./api";
import { canRunLocally } from "./data";
import { healthState, subscribeHealth } from "./health";
import { load, onSave, saveFailed, saveWorked } from "./storage";

/**
 * Your tracking (statuses, notes), Radar preferences, appearance (theme, contrast, density, age limit)
 * and what the dashboard remembers between visits (KEPT_ON_DISK below) are saved on this computer
 * (profile/tracking.json, through the local API) as well as in this browser. The browser copy shows
 * the page instantly; the file is what counts, so opening the dashboard at another address, or in
 * another browser, still finds them. The first page opened with this version uploads what its browser
 * had, so nothing saved before is lost.
 *
 * Each part is a map of keys (a job id, a preference). A save sends only the keys that changed since
 * the file was last read (PATCH, If-Match "<epoch>:<rev>"), so two windows editing different jobs
 * never overwrite each other. When another window changed the same key first, the server says so
 * (409, with its copy): the two are joined (a job's touches and people are merged, anything else
 * keeps this window's change) and sent again.
 */
export type TrackingPart = "state" | "prefs" | "appearance" | "browser";
type Obj = Record<string, unknown>;
type Remote = Partial<Record<TrackingPart, unknown>>;
/** The file's revision: `epoch` changes when an older version rewrote the file, `rev` on every save. */
type Base = { epoch: string; rev: number };
/** What GET /api/tracking says. `base` is null on an older server, which only takes whole parts by PUT. */
type Read = { tracking: Remote | null; base: Base | null };
type Change = { set: Obj; del: string[] };
type Changes = Partial<Record<TrackingPart, Change>>;
type Values = Partial<Record<TrackingPart, Obj>>;
type Conflict = { rev: number; epoch: string; tracking?: Remote | null; conflicts?: { part: string; key: string }[] };

const SAVE_DELAY = 400;
/** Browsers refuse a keepalive request over about 64 KB: a bigger save goes out as a normal one. */
const KEEPALIVE_MAX = 60_000;
/** Saves sent again after another window changed the same key first. */
const RETRIES = 3;

/** What the file holds, or undefined when the local API couldn't be reached or couldn't read it (503). */
async function fetchTracking(): Promise<Read | undefined> {
  const r = await getJson("GET /api/tracking", { cache: "no-store" });
  return (r.ok && trackingRead(r.data)) || undefined;
}

/** One read per page load, shared by every part. */
let first: Promise<Read | undefined> | null = null;
const loadOnce = () => (first ??= fetchTracking());

/** One part kept in step: what the page has now, how to show another copy, and how to join a clash. */
type Part = {
  get: () => Obj;
  set: (v: Obj) => void;
  /** A key changed here and in another window; without it, this window's change wins. */
  merge?: (key: string, mine: unknown, theirs: unknown) => unknown;
  /** The last copy known to match the file; undefined until the file has been read. */
  synced?: Obj;
};
const parts: Partial<Record<TrackingPart, Part>> = {};

/** The file revision this page's synced copies match. */
let base: Base = { epoch: "", rev: 0 };
/** The server has no PATCH (an older version, after a rollback, say): send whole parts by PUT. */
let legacy = false;
let timer: ReturnType<typeof setTimeout> | undefined;
/** The changes on their way to the server. */
let inFlight: Changes | null = null;
/** A change came in while a save was on its way: save again after it. */
let again = false;
/** A save went through, but another window had saved in between: read the file once it's done. */
let behind = false;
let pulling = false;

/** A 409's body: the file's revision and copy, from a server of any version. */
function isConflict(x: unknown): x is Conflict {
  if (!x || typeof x !== "object") return false;
  const c = x as Record<string, unknown>;
  return typeof c.rev === "number" && typeof c.epoch === "string" && (c.tracking == null || typeof c.tracking === "object") && (c.conflicts === undefined || Array.isArray(c.conflicts));
}

const asObj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const tag = (b: Base) => `"${b.epoch}:${b.rev}"`;

/** Same content (as JSON would save it), without turning either into JSON. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => same(x, (b as unknown[])[i]));
  const ka = Object.keys(a).filter((k) => (a as Obj)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Obj)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => same((a as Obj)[k], (b as Obj)[k]));
}

/**
 * The keys of `next` that differ from the synced copy. An entry the page didn't touch is the same
 * object as before (state changes replace only the entries they change), so most are passed over
 * without comparing their contents. `skip`: keys already on their way.
 */
function diff(p: Part, next: Obj, skip?: Change): Change | null {
  const synced = p.synced!;
  const busy = skip && new Set([...Object.keys(skip.set), ...skip.del]);
  const set: Obj = {};
  const del: string[] = [];
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined || v === synced[k] || busy?.has(k)) continue;
    // Same content in a new object (the file's copy, read back): remember this one, so the next look is quick.
    if (same(v, synced[k])) synced[k] = v;
    else set[k] = v;
  }
  for (const k of Object.keys(synced)) if (next[k] === undefined && !busy?.has(k)) del.push(k);
  return Object.keys(set).length || del.length ? { set, del } : null;
}

/** What each part that's in step with the file has now. */
function current(): Values {
  const values: Values = {};
  for (const [name, p] of Object.entries(parts) as [TrackingPart, Part][]) if (p.synced) values[name] = p.get();
  return values;
}

function collect(values: Values, skip?: Changes | null): Changes | null {
  const changes: Changes = {};
  for (const [name, value] of Object.entries(values) as [TrackingPart, Obj][]) {
    const p = parts[name];
    const change = p?.synced && diff(p, value, skip?.[name]);
    if (change) changes[name] = change;
  }
  return Object.keys(changes).length ? changes : null;
}

const hasPending = () => timer !== undefined || inFlight !== null || again || collect(current()) !== null;

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), SAVE_DELAY);
}

type Sent = { kind: "ok" } | { kind: "failed" } | { kind: "conflict"; body: Conflict };

/** Whole parts, for a server without PATCH. */
async function put(changes: Changes, values: Values, keepalive: boolean): Promise<Sent> {
  const names = Object.keys(changes) as TrackingPart[];
  const body = JSON.stringify(Object.fromEntries(names.map((n) => [n, values[n]])));
  try {
    const res = await fetch("/api/tracking", { method: "PUT", body, keepalive: keepalive && body.length <= KEEPALIVE_MAX });
    if (!res.ok) {
      saveFailed("server");
      return { kind: "failed" };
    }
  } catch {
    saveFailed("offline");
    return { kind: "failed" };
  }
  for (const n of names) if (parts[n]?.synced) parts[n].synced = { ...values[n] };
  saveWorked("server");
  return { kind: "ok" };
}

/**
 * Send the changes. Offline, the server restarting or refusing it: the browser copy still has them
 * and the next save sends them again, but say so rather than fail silently.
 */
async function send(changes: Changes, values: Values, keepalive: boolean): Promise<Sent> {
  if (legacy) return put(changes, values, keepalive);
  const sentFrom = base;
  const body = JSON.stringify({ changes });
  const r = await getJson("PATCH /api/tracking", {
    headers: { "content-type": "application/json", "if-match": tag(sentFrom) },
    body,
    keepalive: keepalive && body.length <= KEEPALIVE_MAX,
  });
  if (r.status === 404 || r.status === 405) {
    legacy = true;
    return put(changes, values, keepalive);
  }
  if (!r.ok) {
    if (r.status === 409 && isConflict(r.body)) return { kind: "conflict", body: r.body };
    // Status 0: the request never got an answer (offline, or the local API restarting).
    saveFailed(r.status === 0 ? "offline" : "server");
    return { kind: "failed" };
  }
  const answer = r.data;
  for (const [name, { set, del }] of Object.entries(changes) as [TrackingPart, Change][]) {
    const synced = parts[name]?.synced;
    if (!synced) continue;
    Object.assign(synced, set);
    for (const k of del) delete synced[k];
  }
  // The next revision after the one this page had: nothing else was saved in between.
  if (typeof answer.rev === "number" && answer.rev === sentFrom.rev + 1 && (sentFrom.epoch === "" || answer.epoch === sentFrom.epoch) && base === sentFrom)
    base = { epoch: answer.epoch, rev: answer.rev };
  else behind = true;
  saveWorked("server");
  return { kind: "ok" };
}

/**
 * Another window saved first. Take the file's copy, keep this window's changes on top of it (a
 * key changed in both is joined by the part's merge), show the result, and return it to send again.
 */
function rebase(c: Conflict, mine: Values): Values {
  const clash = new Set((c.conflicts ?? []).map((x) => `${x.part}\n${x.key}`));
  const out: Values = {};
  for (const [name, m] of Object.entries(mine) as [TrackingPart, Obj][]) {
    const p = parts[name];
    if (!p?.synced) continue;
    const theirs = asObj(c.tracking?.[name]);
    const next: Obj = {};
    for (const k of new Set([...Object.keys(m), ...Object.keys(p.synced), ...Object.keys(theirs)])) {
      const changedHere = m[k] !== p.synced[k] && !same(m[k], p.synced[k]);
      const v = !changedHere ? theirs[k] : m[k] !== undefined && theirs[k] !== undefined && p.merge && clash.has(`${name}\n${k}`) ? p.merge(k, m[k], theirs[k]) : m[k];
      if (v !== undefined) next[k] = v;
    }
    p.synced = { ...theirs };
    if (!same(next, m)) p.set(next);
    out[name] = next;
  }
  base = { epoch: c.epoch, rev: c.rev };
  return out;
}

async function flush(keepalive = false): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  if (inFlight) {
    // Closing: send what isn't already on its way now, there's no waiting for the save before it.
    if (keepalive) {
      const values = current();
      const changes = collect(values, inFlight);
      if (changes) void send(changes, values, true);
    } else again = true;
    return;
  }
  let values = current();
  try {
    for (let tries = 0; tries <= RETRIES; tries++) {
      const changes = collect(values);
      if (!changes) return;
      inFlight = changes;
      const sent = await send(changes, values, keepalive);
      if (sent.kind !== "conflict") return;
      values = rebase(sent.body, values);
    }
    // Still changed elsewhere after every try: what's here stays, and the next change tries again.
    saveFailed("conflict");
  } finally {
    inFlight = null;
    if (again) {
      again = false;
      schedule();
    } else if (behind) {
      behind = false;
      void pull();
    }
  }
}

/** Show the file's copy of one part. `initial`: the page's first read, when a missing part is uploaded. */
function take(name: TrackingPart, r: Read, initial: boolean) {
  const p = parts[name];
  if (!p) return;
  legacy = !r.base;
  base = r.base ?? { epoch: "", rev: 0 };
  const saved = r.tracking?.[name];
  if (saved !== undefined) {
    const obj = asObj(saved);
    if (!same(obj, p.get())) p.set(obj);
    p.synced = { ...obj };
  } else if (initial && !p.synced) {
    // No copy in the file yet: this browser's becomes the saved one.
    p.synced = {};
    schedule();
  }
}

/** Pick up what another window or address saved, when nothing here is waiting to be saved. */
async function pull(): Promise<void> {
  if (pulling || hasPending()) return;
  pulling = true;
  try {
    const r = await fetchTracking();
    if (!r || hasPending()) return;
    for (const name of Object.keys(parts) as TrackingPart[]) take(name, r, false);
  } finally {
    pulling = false;
  }
}

/** Watch the server's tracking revision while any part is open: another window's save shows up here. */
let watchers = 0;
let unwatch: (() => void) | undefined;
function watchRevision(): () => void {
  if (watchers++ === 0)
    unwatch = subscribeHealth(() => {
      const rev = healthState().health?.trackingRev;
      if (!legacy && typeof rev === "number" && rev !== base.rev) void pull();
    });
  return () => {
    if (--watchers === 0) unwatch?.();
  };
}

if (typeof window !== "undefined") window.addEventListener("pagehide", () => canRunLocally && void flush(true));
if (typeof document !== "undefined")
  document.addEventListener("visibilitychange", () => {
    if (!canRunLocally) return;
    // Hidden comes before closing: a waiting save goes out now, while a normal request still gets through.
    if (document.visibilityState === "hidden") {
      if (timer !== undefined) void flush();
    } else void pull();
  });

/**
 * Keep one part in step with the file: load it when the page opens (or upload this browser's copy
 * when there's no file yet), save each change, and pick up changes made elsewhere (when you come
 * back to the tab, or when the server says the file changed). `merge` joins a key changed here and
 * in another window at once; without it, this window's change wins. Does nothing on a hosted copy.
 */
export function useSavedOnDisk<T>(part: TrackingPart, value: T, apply: (v: T) => void, merge?: (key: string, mine: unknown, theirs: unknown) => unknown) {
  const latest = useRef({ value, apply, merge });
  // Kept after each render (not during it), for handlers and effects that run later.
  useLayoutEffect(() => {
    latest.current = { value, apply, merge };
  });

  useEffect(() => {
    if (!canRunLocally) return;
    let live = true;
    const p: Part = {
      get: () => asObj(latest.current.value),
      set: (v) => latest.current.apply(v as T),
      merge: (k, mine, theirs) => (latest.current.merge ? latest.current.merge(k, mine, theirs) : mine),
    };
    parts[part] = p;
    void loadOnce().then((r) => {
      if (live && r) take(part, r, true);
    });
    const stop = watchRevision();
    return () => {
      live = false;
      if (parts[part] === p) delete parts[part];
      stop();
    };
  }, [part]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new value is what to save; the save reads it through `latest`
  useEffect(() => {
    // Until the file has been read, a change could overwrite newer saved tracking: wait for it.
    if (parts[part]?.synced) schedule();
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
function browserCopy(): Obj {
  const copy: Obj = {};
  for (const key of KEPT_ON_DISK) {
    const value = load<unknown>(key, null);
    if (value !== null) copy[key] = value;
  }
  return copy;
}

/** Put the file's copy in this browser: what it has, and nothing it doesn't. */
function restoreBrowser(saved: Obj) {
  for (const key of KEPT_ON_DISK) {
    try {
      if (saved[key] == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(saved[key]));
    } catch {
      // storage blocked: this visit uses the defaults
    }
  }
}

onSave((key) => {
  // A change to a key that isn't kept, or that leaves the copy as it was (filters set back), sends nothing.
  if (parts.browser?.synced && KEPT_ON_DISK.includes(key)) schedule();
});

/**
 * Before the first render: bring this browser up to date with the file, so every screen starts from
 * what you had, whichever address the dashboard is at. Waits at most `timeoutMs` for the local API;
 * a slower answer is still taken when it comes. Does nothing on a hosted copy.
 */
export async function restoreFromDisk(timeoutMs = 1000): Promise<void> {
  if (!canRunLocally) return;
  parts.browser ??= { get: browserCopy, set: restoreBrowser };
  const read = loadOnce().then((r) => r && take("browser", r, true));
  await Promise.race([read, new Promise((done) => setTimeout(done, timeoutMs))]);
}

/** Send what's waiting now (the save problem notice's Try again). With nothing left to send, the problem is settled too. */
export async function saveTrackingNow(): Promise<void> {
  await flush();
  if (!hasPending()) saveWorked("server");
}

/** Tests: forget the page's first read, what's in step and anything waiting to be saved. */
export function resetTrackingSync() {
  first = null;
  base = { epoch: "", rev: 0 };
  legacy = false;
  clearTimeout(timer);
  timer = undefined;
  inFlight = null;
  again = behind = pulling = false;
  for (const k of Object.keys(parts) as TrackingPart[]) delete parts[k];
}
