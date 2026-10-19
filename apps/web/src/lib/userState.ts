import { fitFeatures } from "@rawjobs/core/learn";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "./data";
import type { Reason } from "./notForMe";
import type { Prefs } from "./prefs";
import { load, save } from "./storage";
import { useSavedOnDisk } from "./tracking";

export const PIPELINE = ["saved", "applied", "interviewing", "offer", "rejected"] as const;
export type PipelineStatus = (typeof PIPELINE)[number];
export type Status = PipelineStatus | "dismissed";

export const STATUS_LABEL: Record<Status, string> = {
  saved: "Saved",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Closed",
  dismissed: "Not interested",
};

/** How a job you're out of the running for ended (status "rejected", shown as Closed). */
export const CLOSED_AS = { rejected: "Rejected", withdrew: "I withdrew", "no-response": "No response" } as const;
export type ClosedAs = keyof typeof CLOSED_AS;

/** Days after you apply that RawJobs reminds you to follow up. */
export const FOLLOW_UP_DAYS = 7;
/** Days applied with no reply after which RawJobs suggests closing it as No response (likely ghosted). */
export const QUIET_DAYS = 21;
const HISTORY_MAX = 20;

/** Your own tracking for one job. Saved on this computer (profile/tracking.json) and in this browser; export/import to move it. */
export type Entry = {
  status?: Status;
  note?: string;
  /** Why it's Not interested, when you said (one tap, optional). Only kept while the status is "dismissed". */
  reason?: Reason;
  /** Each status change and when, oldest first; `null` when the status was cleared. */
  history?: { status: Status | null; at: string }[];
  /** How it ended, only while the status is "rejected". */
  closedAs?: ClosedAs;
  /** When to chase it (YYYY-MM-DD): a week after you apply, yours to change. Only while the status is "applied". */
  followUp?: string;
  /** Which CV you sent ("Fintech PM v3"). */
  cv?: string;
  updatedAt: string;
  /** Copy of the job's basics, so the pipeline survives the job leaving jobs.json. */
  snapshot: {
    title: string;
    company: string;
    url: string;
    location: string;
    score: number;
    /** The score's parts when you chose (learn.ts fitFeatures): Best match learns from them after the posting closes. */
    fit?: number[];
  };
};

export type UserState = Record<string, Entry>;

/** The job fields tracking needs; a full Job or a stored snapshot both fit. */
export type JobLike = Pick<Job, "id" | "title" | "company" | "url" | "location" | "score"> & Partial<Pick<Job, "why">>;

/** The job's parts for learning: from the job when it has them, else what the entry kept. */
function withFit(job: JobLike, prev: Entry | undefined): { fit?: number[] } {
  const fit = (job.why && fitFeatures(job.why)) ?? prev?.snapshot.fit;
  return fit ? { fit } : {};
}

const KEY = "rawjobs.state.v1";

/** What a change to one job's tracking can set; a key given as undefined clears it. */
export type EntryPatch = Partial<Pick<Entry, "status" | "note" | "reason" | "closedAs" | "followUp" | "cv">> & {
  /** Move the date you reached the current status (YYYY-MM-DD), e.g. you applied before tracking it. */
  since?: string;
};

/** "2026-10-22": a date `days` after `iso`, in local time. */
export function dayAfter(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today as YYYY-MM-DD, in local time. */
export const today = (now = new Date()) => dayAfter(now.toISOString(), 0);

/** The follow-up date has come (applied, and the date is today or past). */
export const followUpDue = (e: Entry | undefined, now = new Date()) => !!e?.followUp && e.status === "applied" && e.followUp <= today(now);

/** Applied this many days ago and nothing since: likely ghosted. */
export const goneQuiet = (e: Entry | undefined, now = new Date()) => !!e && e.status === "applied" && now.getTime() - Date.parse(stageSince(e)) >= QUIET_DAYS * 864e5;

/** One job's entry after a change; null when nothing is left to keep. */
export function applyPatch(prev: Entry | undefined, job: JobLike, patch: EntryPatch, now = new Date().toISOString()): Entry | null {
  const { since, ...fields } = patch;
  const next: Entry = {
    ...prev,
    ...fields,
    updatedAt: now,
    snapshot: { title: job.title, company: job.company, url: job.url, location: job.location, score: job.score, ...withFit(job, prev) },
  };
  const changed = "status" in patch && patch.status !== prev?.status;
  if (changed) {
    // Tracked before history existed: its current status counts from when it was last changed.
    const before = prev?.history ?? (prev?.status ? [{ status: prev.status, at: prev.updatedAt }] : []);
    next.history = [...before, { status: patch.status ?? null, at: now }].slice(-HISTORY_MAX);
  }
  // Each extra belongs to one status: moving the job anywhere else drops it.
  if (next.status !== "dismissed") delete next.reason;
  if (next.status !== "rejected") delete next.closedAs;
  if (next.status !== "applied") delete next.followUp;
  else if (changed && !("followUp" in patch)) next.followUp = dayAfter(now, FOLLOW_UP_DAYS);
  if (since && /^\d{4}-\d{2}-\d{2}$/.test(since) && next.status) {
    // Noon local, so the day reads the same wherever it's shown in your timezone.
    const at = new Date(`${since}T12:00:00`).toISOString();
    const h = next.history ?? (prev?.status === next.status ? [{ status: next.status, at: prev.updatedAt }] : []);
    const i = h.findLastIndex((x) => x.status === next.status);
    next.history = i >= 0 ? h.map((x, j) => (j === i ? { ...x, at } : x)) : [...h, { status: next.status, at }];
  }
  for (const k of ["note", "cv", "followUp", "closedAs", "reason"] as const) if (!next[k]) delete next[k];
  return next.status || next.note || next.cv ? next : null;
}

/** How far along each status is: shortcuts never move a job back down this order. */
const RANK: Record<Status, number> = { dismissed: 0, saved: 1, applied: 2, rejected: 2, interviewing: 3, offer: 4 };

/**
 * What a one-tap status (S, A, X, Save, "Did you apply?") does to a job: the new status, undefined
 * to clear it, or null to leave it alone. Tapping Saved or Not interested again clears it; nothing
 * else clears progress or moves a job back (Applied never undoes Interviewing). The Pipeline and the
 * status menu still set any status.
 */
export function quickStatus(prev: Status | undefined, s: Status): Status | undefined | null {
  if (prev === s) return s === "saved" || s === "dismissed" ? undefined : null;
  if (!prev || prev === "dismissed" || s === "dismissed") return s;
  if (prev === "rejected") return s === "saved" ? null : s;
  return RANK[s] > RANK[prev] ? s : null;
}

/** When the job reached its current status: the last history step there, else its last change. */
export function stageSince(e: Entry): string {
  const h = e.history?.findLast((x) => x.status === e.status);
  return h?.at ?? e.updatedAt;
}

/** Your tracking with an imported file folded in: for a job in both, the more recently changed entry wins. */
export function mergeStates(mine: UserState, theirs: UserState): UserState {
  const out = { ...mine };
  for (const [id, e] of Object.entries(theirs)) if (!out[id] || e.updatedAt > out[id].updatedAt) out[id] = e;
  return out;
}

/** "Rejected", or how a closed job ended ("I withdrew"). */
export const statusLabel = (e: Pick<Entry, "status" | "closedAs">) => (e.status === "rejected" && e.closedAs ? CLOSED_AS[e.closedAs] : e.status ? STATUS_LABEL[e.status] : "");

function withEntry(s: UserState, id: string, entry: Entry | null): UserState {
  if (entry) return { ...s, [id]: entry };
  const { [id]: _, ...rest } = s;
  return rest;
}

/**
 * Your tracking, with actions that never change identity (each reads the latest state when it
 * runs), so components that take them as props don't re-render on every status change.
 */
export function useUserState() {
  const [state, setState] = useState<UserState>(() => load<UserState>(KEY, {}));
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => save(KEY, state), [state]);
  useSavedOnDisk("state", state, setState);

  // Keep tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setState(load<UserState>(KEY, {}));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback((job: JobLike, patch: EntryPatch) => {
    setState((s) => withEntry(s, job.id, applyPatch(s[job.id], job, patch)));
  }, []);

  /** A one-tap status (see quickStatus); false when it left the job alone because it's further along. */
  const toggleStatus = useCallback((job: JobLike, status: Status) => {
    const next = quickStatus(latest.current[job.id]?.status, status);
    if (next === null) return false;
    setState((s) => withEntry(s, job.id, applyPatch(s[job.id], job, { status: next })));
    return true;
  }, []);

  /** A job's status right now (for handlers that need the value before a change). */
  const statusOf = useCallback((id: string): Status | undefined => latest.current[id]?.status, []);

  const replaceAll = useCallback((next: UserState) => setState(next), []);

  return useMemo(() => ({ state, update, toggleStatus, statusOf, replaceAll }), [state, update, toggleStatus, statusOf, replaceAll]);
}

export function exportState(state: UserState, prefs?: Prefs): void {
  const blob = new Blob([JSON.stringify({ app: "rawjobs", version: 1, exportedAt: new Date().toISOString(), state, prefs }, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `rawjobs-tracking-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const STATUSES = new Set<string>([...PIPELINE, "dismissed"]);
const isText = (v: unknown): v is string => typeof v === "string";

/** An imported entry, if it has the shape the pipeline relies on; anything else is left out. */
function entryFrom(v: unknown): Entry | undefined {
  if (!v || typeof v !== "object") return undefined;
  const e = v as Record<string, unknown>;
  const snap = e.snapshot as Record<string, unknown> | undefined;
  if (!snap || typeof snap !== "object" || !isText(snap.title) || !isText(snap.company) || !isText(e.updatedAt)) return undefined;
  if (e.status !== undefined && !(isText(e.status) && STATUSES.has(e.status))) return undefined;
  if (e.note !== undefined && !isText(e.note)) return undefined;
  if (!e.status && !e.note && !isText(e.cv)) return undefined;
  const history = Array.isArray(e.history)
    ? e.history.filter((h): h is { status: Status | null; at: string } => !!h && isText(h.at) && (h.status === null || (isText(h.status) && STATUSES.has(h.status))))
    : [];
  return {
    ...(e.status ? { status: e.status as Status } : {}),
    ...(e.note ? { note: e.note as string } : {}),
    ...(e.status === "dismissed" && isText(e.reason) ? { reason: e.reason as Reason } : {}),
    ...(history.length ? { history } : {}),
    ...(e.status === "rejected" && isText(e.closedAs) && e.closedAs in CLOSED_AS ? { closedAs: e.closedAs as ClosedAs } : {}),
    ...(e.status === "applied" && isText(e.followUp) && /^\d{4}-\d{2}-\d{2}$/.test(e.followUp) ? { followUp: e.followUp } : {}),
    ...(isText(e.cv) && e.cv ? { cv: e.cv } : {}),
    updatedAt: e.updatedAt,
    snapshot: {
      title: snap.title,
      company: snap.company,
      url: isText(snap.url) ? snap.url : "",
      location: isText(snap.location) ? snap.location : "",
      score: typeof snap.score === "number" ? snap.score : 0,
      ...(Array.isArray(snap.fit) && snap.fit.length <= 16 && snap.fit.every((v) => typeof v === "number" && Number.isFinite(v)) ? { fit: snap.fit as number[] } : {}),
    },
  };
}

export async function readStateFile(file: File): Promise<{ state: UserState; prefs?: Partial<Prefs>; skipped: number }> {
  const parsed = JSON.parse(await file.text()) as { app?: string; state?: unknown; prefs?: Partial<Prefs> };
  // Exports made before the rename to RawJobs say "job-hunter".
  if ((parsed.app !== "rawjobs" && parsed.app !== "job-hunter") || !parsed.state || typeof parsed.state !== "object") {
    throw new Error("That file isn't a RawJobs export.");
  }
  const state: UserState = {};
  let skipped = 0;
  for (const [id, v] of Object.entries(parsed.state as Record<string, unknown>)) {
    const entry = entryFrom(v);
    if (entry) state[id] = entry;
    else skipped++;
  }
  return { state, prefs: parsed.prefs && typeof parsed.prefs === "object" ? parsed.prefs : undefined, skipped };
}
