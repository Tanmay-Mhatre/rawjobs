import { fitFeatures } from "@rawjobs/core/learn";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "./data";
import type { Reason } from "./notForMe";
import type { Prefs } from "./prefs";
import { linkedInUrl } from "./contactLinks";
import { load, save, saveFailed } from "./storage";
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

/** Stages with a next step: a follow-up date is kept in each. */
export const ACTIVE: readonly Status[] = ["saved", "applied", "interviewing", "offer"];
export const isActive = (s: Status | undefined) => !!s && ACTIVE.includes(s);

/** One interview round: its day (YYYY-MM-DD), what it is ("Technical", "Final"), its time (HH:MM) and who with. */
export type Interview = { on: string; what: string; time?: string; contactId?: string };

/** How you were in touch. "meeting" is shown as In person; a "note" is neither sent nor received. */
export const CHANNELS = ["email", "linkedin", "whatsapp", "call", "meeting", "referral", "note"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<Channel, string> = {
  email: "Email",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  call: "Call",
  meeting: "In person",
  referral: "Referral",
  note: "Note",
};
export type Direction = "sent" | "received";

/** One thing that happened on a job: a message, a call, a note. Stage changes stay in `history`. */
export type Activity = {
  id: string;
  /** When it happened (ISO); a past day is stored at noon local. */
  at: string;
  channel: Channel;
  /** Not for notes. */
  dir?: Direction;
  contactId?: string;
  text?: string;
  /** Logged from a follow-up or thank-you task: the close rule and "Follow-ups sent" count only these. */
  followUp?: true;
};

export const CONTACT_ROLES = ["recruiter", "agency", "hiring-manager", "referrer", "interviewer", "other"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];
export const ROLE_LABEL: Record<ContactRole, string> = {
  recruiter: "Recruiter",
  agency: "Agency recruiter",
  "hiring-manager": "Hiring manager",
  referrer: "Referrer",
  interviewer: "Interviewer",
  other: "Other",
};

/**
 * Someone for this job: a recruiter, a referrer, the hiring manager. The same `id` on several jobs is
 * the same person (an agency recruiter), and editing them changes every copy.
 */
export type Contact = {
  id: string;
  name: string;
  role?: ContactRole;
  company?: string;
  email?: string;
  phone?: string;
  /** The phone number is on WhatsApp. */
  whatsapp?: boolean;
  /** Full https URL of their LinkedIn profile. */
  linkedin?: string;
  howMet?: string;
  /** The v1 profile link, kept so older versions still show it. */
  link?: string;
};

/** Size limits, so one job (or an import) can't grow the file without end. */
export const CAPS = {
  text: 1000,
  activities: 100,
  contacts: 30,
  skipped: 50,
  /** Done task keys whose date is older than this many days are dropped. */
  skippedDays: 30,
  name: 120,
  company: 120,
  email: 254,
  phone: 32,
  linkedin: 300,
  howMet: 500,
} as const;

/** What an offer says, as you'd write it ("AED 45k a month", "15%"); dates are YYYY-MM-DD. */
export type Offer = { pay?: string; bonus?: string; equity?: string; location?: string; start?: string; deadline?: string; note?: string };
export const OFFER_FIELDS = ["pay", "bonus", "equity", "location", "start", "deadline", "note"] as const;

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
  /** When to chase it (YYYY-MM-DD): a week after you apply, yours to change. Kept in every active stage (on Saved it reads "Apply by"). */
  followUp?: string;
  /** Which CV you sent ("Fintech PM v3"). */
  cv?: string;
  interviews?: Interview[];
  contacts?: Contact[];
  /** Messages, calls and notes, oldest first (at most CAPS.activities). */
  activities?: Activity[];
  /** Next-step keys you marked done ("follow-up:2026-10-22"), so a new date brings the task back. */
  skipped?: string[];
  /** The offer's terms, kept once you have one (also after you accept or decline). */
  offer?: Offer;
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
export type EntryPatch = Partial<Pick<Entry, "status" | "note" | "reason" | "closedAs" | "followUp" | "cv" | "interviews" | "contacts" | "activities" | "skipped" | "offer">> & {
  /** Move the date you reached the current status (YYYY-MM-DD), e.g. you applied before tracking it. */
  since?: string;
};

/** "2026-10-22": a date `days` after `iso`, in local time. For a YYYY-MM-DD day, pass `${day}T12:00:00`. */
export function dayAfter(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today as YYYY-MM-DD, in local time. */
export const today = (now = new Date()) => dayAfter(now.toISOString(), 0);

export const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** The follow-up date has come (an active stage, and the date is today or past). */
export const followUpDue = (e: Entry | undefined, now = new Date()) => !!e?.followUp && isActive(e.status) && e.followUp <= today(now);

/** Applied this many days ago and nothing since: likely ghosted. A follow-up date still ahead (you just chased it) waits for that date. */
export const goneQuiet = (e: Entry | undefined, now = new Date()) =>
  !!e && e.status === "applied" && !(e.followUp && e.followUp > today(now)) && now.getTime() - Date.parse(stageSince(e)) >= QUIET_DAYS * 864e5;

/** A new id: the time plus a random part (crypto.randomUUID isn't there on plain http). */
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** When a touch logged for `day` happened: now when it's today, else noon local that day. */
export const activityAt = (day: string, now = new Date()) => (day === today(now) ? now.toISOString() : new Date(`${day}T12:00:00`).toISOString());

/** Which v2 role a v1 free-text role reads as. */
function roleOfText(t: string): ContactRole {
  if (t.includes("agency")) return "agency";
  if (t.includes("recruit")) return "recruiter";
  if (t.includes("hiring") || t.includes("manager")) return "hiring-manager";
  if (t.includes("refer")) return "referrer";
  if (t.includes("interview")) return "interviewer";
  return "other";
}

/**
 * A v1 free-text role ("Senior recruiter, APAC") as a v2 role. The text is kept as how you met,
 * unless it's just the role's own word ("Recruiter", "Hiring manager").
 */
export function roleFrom(text: string): { role: ContactRole; howMet?: string } {
  const t = text.trim().toLowerCase();
  const role = roleOfText(t);
  const plain = t === role || t === role.replace("-", " ") || t === ROLE_LABEL[role].toLowerCase();
  return plain ? { role } : { role, howMet: text.trim() };
}

const isText = (v: unknown): v is string => typeof v === "string";
/** Free text, trimmed and cut to `max`; nothing when empty. */
const clip = (v: unknown, max: number) => (isText(v) && v.trim() ? v.trim().slice(0, max) : undefined);
/** A structured value (email, phone, URL): kept whole or not at all. */
const whole = (v: unknown, max: number) => (isText(v) && v.trim() && v.trim().length <= max ? v.trim() : undefined);

/**
 * A person in the v2 shape, from v2 or v1 data ({ name, role?: string, link? }), within the size caps;
 * undefined without a name. `fallbackId` is used when it has no id.
 */
export function toContact(v: unknown, fallbackId: string): Contact | undefined {
  if (!v || typeof v !== "object") return undefined;
  const c = v as Record<string, unknown>;
  const name = clip(c.name, CAPS.name);
  if (!name) return undefined;
  const mapped = (CONTACT_ROLES as readonly unknown[]).includes(c.role)
    ? { role: c.role as ContactRole, howMet: undefined }
    : clip(c.role, CAPS.howMet)
      ? roleFrom(clip(c.role, CAPS.howMet)!)
      : undefined;
  const link = whole(c.link, CAPS.linkedin);
  const out: Contact = {
    id: isText(c.id) && c.id ? c.id : fallbackId,
    name,
    role: mapped?.role,
    company: clip(c.company, CAPS.company),
    email: whole(c.email, CAPS.email),
    phone: whole(c.phone, CAPS.phone),
    whatsapp: c.whatsapp === true || undefined,
    linkedin: linkedInUrl(whole(c.linkedin, CAPS.linkedin)) ?? (link && linkedInUrl(link) ? link : undefined),
    howMet: clip(c.howMet, CAPS.howMet) ?? mapped?.howMet,
    link,
  };
  for (const k of Object.keys(out) as (keyof Contact)[]) if (out[k] === undefined) delete out[k];
  return out;
}

const isV2 = (c: Contact) => !!c?.id && (c.role === undefined || CONTACT_ROLES.includes(c.role));

/**
 * Your tracking in the v2 shape, wherever it was read from (this browser, the file, another tab, an
 * import). It converts on read only: a v1 person gets the id `v1:<job id>:<index>`, the same on
 * every read. Returns the same object when there was nothing to convert.
 */
export function normalizeState(s: unknown): UserState {
  if (!s || typeof s !== "object" || Array.isArray(s)) return {};
  const state = s as UserState;
  let out: UserState | undefined;
  for (const [id, e] of Object.entries(state)) {
    if (!Array.isArray(e?.contacts) || e.contacts.every(isV2)) continue;
    out ??= { ...state };
    out[id] = { ...e, contacts: e.contacts.flatMap((c, i) => toContact(c, `v1:${id}:${i}`) ?? []) };
  }
  return out ?? state;
}

const dayIn = (key: string) => key.match(/\d{4}-\d{2}-\d{2}/)?.[0];

/** One entry within the size caps: the newest touches, the first people, recent done-task keys. */
export function capEntry(e: Entry, now = new Date()): Entry {
  const next = { ...e };
  if (next.activities) {
    next.activities = [...next.activities]
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      .slice(-CAPS.activities)
      .map((a) => (a.text && a.text.length > CAPS.text ? { ...a, text: a.text.slice(0, CAPS.text) } : a));
  }
  if (next.contacts && next.contacts.length > CAPS.contacts) next.contacts = next.contacts.slice(0, CAPS.contacts);
  if (next.skipped) {
    const oldest = dayAfter(now.toISOString(), -CAPS.skippedDays);
    next.skipped = [...new Set(next.skipped)].filter((k) => !((dayIn(k) ?? oldest) < oldest)).slice(-CAPS.skipped);
  }
  return next;
}

/**
 * Log a touch: the patch that adds it, and then sets the next follow-up (a sent touch,
 * `followUpDays` from today) or clears it (a received one).
 */
export function addActivity(entry: Entry | undefined, a: Activity, { followUpDays }: { followUpDays?: number } = {}, now = new Date()): EntryPatch {
  const patch: EntryPatch = { activities: [...(entry?.activities ?? []), a] };
  if (a.channel === "note") return patch;
  if (a.dir === "received") patch.followUp = undefined;
  else if (a.dir === "sent" && followUpDays) patch.followUp = dayAfter(`${today(now)}T12:00:00`, followUpDays);
  return patch;
}

/** An entry is kept while it holds anything of yours: a status, a note, a CV, touches or people. */
const keep = (e: Pick<Entry, "status" | "note" | "cv" | "activities" | "contacts">) => !!(e.status || e.note || e.cv || e.activities?.length || e.contacts?.length);

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
  // A follow-up date belongs to the active stages. A move clears it unless the patch sets one, and
  // applying sets it a week out.
  if (!isActive(next.status)) delete next.followUp;
  else if (changed && !("followUp" in patch)) {
    if (next.status === "applied") next.followUp = dayAfter(now, FOLLOW_UP_DAYS);
    else delete next.followUp;
  }
  if (since && isDay(since) && next.status) {
    // Noon local, so the day reads the same wherever it's shown in your timezone.
    const at = new Date(`${since}T12:00:00`).toISOString();
    const h = next.history ?? (prev?.status === next.status ? [{ status: next.status, at: prev.updatedAt }] : []);
    const i = h.findLastIndex((x) => x.status === next.status);
    next.history = i >= 0 ? h.map((x, j) => (j === i ? { ...x, at } : x)) : [...h, { status: next.status, at }];
  }
  for (const k of ["note", "cv", "followUp", "closedAs", "reason"] as const) if (!next[k]) delete next[k];
  for (const k of ["interviews", "contacts", "activities", "skipped"] as const) if (!next[k]?.length) delete next[k];
  if (next.offer && !Object.values(next.offer).some(Boolean)) delete next.offer;
  return keep(next) ? capEntry(next, new Date(now)) : null;
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

/** Both lists, one item per id; for an id in both, the newer list's item wins (in the older one's place). */
function unionById<T extends { id: string }>(older: readonly T[] = [], newer: readonly T[] = []): T[] {
  const byId = new Map(older.map((x) => [x.id, x]));
  for (const x of newer) byId.set(x.id, x);
  return [...byId.values()];
}

/**
 * A v1 id (`v1:<job>:<index>`) only says where a person was in their file, so the same id in two
 * files can be two people. A person from `theirs` whose v1 id belongs to someone else in `mine`
 * gets a new id, and their touches and interviews follow it, so both are kept.
 */
function sameV1Ids(mine: Entry, theirs: Entry): Entry {
  const renamed = new Map<string, string>();
  const contacts = theirs.contacts?.map((c) => {
    const other = c.id.startsWith("v1:") ? mine.contacts?.find((x) => x.id === c.id) : undefined;
    if (!other || other.name === c.name) return c;
    const id = newId();
    renamed.set(c.id, id);
    return { ...c, id };
  });
  if (!renamed.size) return theirs;
  const follow = <T extends { contactId?: string }>(x: T): T => (x.contactId && renamed.has(x.contactId) ? { ...x, contactId: renamed.get(x.contactId) } : x);
  return { ...theirs, contacts, activities: theirs.activities?.map(follow), interviews: theirs.interviews?.map(follow) };
}

/**
 * Your tracking with an imported file folded in. For a job in both, the more recently changed entry
 * wins, except touches, people and done tasks, which are joined by id (a person's newer fields win).
 */
export function mergeStates(mine: UserState, theirs: UserState, now = new Date()): UserState {
  const out = { ...mine };
  for (const [id, e] of Object.entries(theirs)) {
    const m = out[id];
    if (!m) {
      out[id] = e;
      continue;
    }
    const incoming = sameV1Ids(m, e);
    const [older, newer] = incoming.updatedAt > m.updatedAt ? [m, incoming] : [incoming, m];
    const merged: Entry = { ...newer };
    const activities = unionById(older.activities, newer.activities);
    const contacts = unionById(older.contacts, newer.contacts);
    const skipped = [...new Set([...(older.skipped ?? []), ...(newer.skipped ?? [])])];
    if (activities.length) merged.activities = activities;
    if (contacts.length) merged.contacts = contacts;
    if (skipped.length) merged.skipped = skipped;
    out[id] = capEntry(merged, now);
  }
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
  const [state, setState] = useState<UserState>(() => normalizeState(load<unknown>(KEY, {})));
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    if (!save(KEY, state)) saveFailed();
  }, [state]);
  useSavedOnDisk<UserState>("state", state, (v) => setState(normalizeState(v)));

  // Keep tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setState(normalizeState(load<unknown>(KEY, {})));
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

  const replaceAll = useCallback((next: UserState) => setState(normalizeState(next)), []);

  /**
   * Edit a person on every job they're on (same id). Only `contacts` changes: no `updatedAt` bump,
   * so stage ages and applied dates stay put. Removing a person is a patch on one job instead.
   */
  const updateContact = useCallback((c: Contact) => {
    const clean = toContact(c, c.id);
    if (!clean) return;
    setState((s) => {
      let changed = false;
      const out: UserState = {};
      for (const [id, e] of Object.entries(s)) {
        if (e.contacts?.some((x) => x.id === clean.id)) {
          changed = true;
          out[id] = { ...e, contacts: e.contacts.map((x) => (x.id === clean.id ? clean : x)) };
        } else out[id] = e;
      }
      return changed ? out : s;
    });
  }, []);

  return useMemo(() => ({ state, update, toggleStatus, statusOf, replaceAll, updateContact }), [state, update, toggleStatus, statusOf, replaceAll, updateContact]);
}

export function exportState(state: UserState, prefs?: Prefs): void {
  const blob = new Blob([JSON.stringify({ app: "rawjobs", version: 2, exportedAt: new Date().toISOString(), state, prefs }, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `rawjobs-tracking-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const STATUSES = new Set<string>([...PIPELINE, "dismissed"]);
const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
/** A clock a few minutes ahead on the other computer shouldn't drop a touch logged just now. */
const SKEW_MS = 5 * 60_000;

/** An imported touch, if it has the right shape: a known channel and direction, a time that isn't in the future. */
function activityFrom(v: unknown, now: Date): Activity | undefined {
  if (!isRecord(v) || !isText(v.id) || !v.id || !(CHANNELS as readonly unknown[]).includes(v.channel)) return undefined;
  const t = isText(v.at) ? Date.parse(v.at) : Number.NaN;
  if (!Number.isFinite(t) || t > now.getTime() + SKEW_MS) return undefined;
  const channel = v.channel as Channel;
  if (v.dir !== undefined && v.dir !== "sent" && v.dir !== "received") return undefined;
  const a: Activity = { id: v.id, at: v.at as string, channel };
  if (channel !== "note" && v.dir) a.dir = v.dir as Direction;
  if (isText(v.contactId) && v.contactId) a.contactId = v.contactId;
  const text = clip(v.text, CAPS.text);
  if (text) a.text = text;
  if (v.followUp === true) a.followUp = true;
  return a;
}

/** An imported entry, if it has the shape the pipeline relies on; anything else is left out. */
function entryFrom(v: unknown, id: string, now: Date): Entry | undefined {
  if (!isRecord(v)) return undefined;
  const e = v;
  const snap = e.snapshot as Record<string, unknown> | undefined;
  if (!isRecord(snap) || !isText(snap.title) || !isText(snap.company) || !isText(e.updatedAt)) return undefined;
  if (e.status !== undefined && !(isText(e.status) && STATUSES.has(e.status))) return undefined;
  if (e.note !== undefined && !isText(e.note)) return undefined;
  const status = e.status as Status | undefined;
  const history = Array.isArray(e.history)
    ? e.history.filter((h): h is { status: Status | null; at: string } => !!h && isText(h.at) && (h.status === null || (isText(h.status) && STATUSES.has(h.status))))
    : [];
  const contacts = (Array.isArray(e.contacts) ? e.contacts.flatMap((c, i) => toContact(c, `v1:${id}:${i}`) ?? []) : []).slice(0, CAPS.contacts);
  const people = new Set(contacts.map((c) => c.id));
  // A touch or interview naming someone who isn't on this job any more: the name is gone, the touch stays.
  const withPerson = <T extends { contactId?: string }>(x: T): T => {
    if (x.contactId === undefined || people.has(x.contactId)) return x;
    const { contactId: _, ...rest } = x;
    return rest as T;
  };
  const activities = Array.isArray(e.activities) ? e.activities.flatMap((a) => activityFrom(a, now) ?? []).map(withPerson) : [];
  const interviews = Array.isArray(e.interviews)
    ? e.interviews.flatMap((i): Interview[] =>
        isRecord(i) && isDay(i.on) && isText(i.what)
          ? [
              withPerson({
                on: i.on,
                what: i.what,
                ...(isText(i.time) && /^\d{2}:\d{2}$/.test(i.time) ? { time: i.time } : {}),
                ...(isText(i.contactId) && i.contactId ? { contactId: i.contactId } : {}),
              }),
            ]
          : [],
      )
    : [];
  const skipped = Array.isArray(e.skipped) ? e.skipped.filter((k): k is string => isText(k) && !!k && k.length <= 64) : [];
  const offer = isRecord(e.offer)
    ? (Object.fromEntries(
        OFFER_FIELDS.flatMap((k) => (isText((e.offer as Record<string, unknown>)[k]) && (e.offer as Record<string, string>)[k] ? [[k, (e.offer as Record<string, string>)[k]]] : [])),
      ) as Offer)
    : {};
  const entry: Entry = {
    ...(status ? { status } : {}),
    ...(e.note ? { note: e.note as string } : {}),
    ...(status === "dismissed" && isText(e.reason) ? { reason: e.reason as Reason } : {}),
    ...(history.length ? { history } : {}),
    ...(status === "rejected" && isText(e.closedAs) && e.closedAs in CLOSED_AS ? { closedAs: e.closedAs as ClosedAs } : {}),
    ...(isActive(status) && isDay(e.followUp) ? { followUp: e.followUp } : {}),
    ...(isText(e.cv) && e.cv ? { cv: e.cv } : {}),
    ...(interviews.length ? { interviews } : {}),
    ...(Object.keys(offer).length ? { offer } : {}),
    ...(contacts.length ? { contacts } : {}),
    ...(activities.length ? { activities } : {}),
    ...(skipped.length ? { skipped } : {}),
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
  return keep(entry) ? capEntry(entry, now) : undefined;
}

export async function readStateFile(file: File, now = new Date()): Promise<{ state: UserState; prefs?: Partial<Prefs>; skipped: number }> {
  const parsed = JSON.parse(await file.text()) as { app?: string; state?: unknown; prefs?: Partial<Prefs> };
  // Exports made before the rename to RawJobs say "job-hunter".
  if ((parsed.app !== "rawjobs" && parsed.app !== "job-hunter") || !parsed.state || typeof parsed.state !== "object") {
    throw new Error("That file isn't a RawJobs export.");
  }
  const state: UserState = {};
  let skipped = 0;
  for (const [id, v] of Object.entries(parsed.state as Record<string, unknown>)) {
    const entry = entryFrom(v, id, now);
    if (entry) state[id] = entry;
    else skipped++;
  }
  return { state, prefs: parsed.prefs && typeof parsed.prefs === "object" ? parsed.prefs : undefined, skipped };
}
