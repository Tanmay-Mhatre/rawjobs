import { fitFeatures } from "@rawjobs/core/learn";
import { dayAfter, FOLLOW_UP_DAYS, isActive, isDay, PIPELINE, QUIET_DAYS, STATUS_LABEL, type Status, stageSince, today } from "@rawjobs/core/next-steps";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "./data";
import type { Reason } from "./notForMe";
import type { Prefs } from "./prefs";
import { linkedInUrl } from "./contactLinks";
import { load, save, saveFailed } from "./storage";
import { useSavedOnDisk } from "./tracking";

// The stages and day helpers are shared with the CLI's daily summary (@rawjobs/core/next-steps).
export { ACTIVE, dayAfter, FOLLOW_UP_DAYS, isActive, isDay, PIPELINE, type PipelineStatus, QUIET_DAYS, STATUS_LABEL, type Status, stageSince, today } from "@rawjobs/core/next-steps";

/** How a job you're out of the running for ended (status "rejected", shown as Closed). */
export const CLOSED_AS = { rejected: "Rejected", withdrew: "I withdrew", "no-response": "No response" } as const;
export type ClosedAs = keyof typeof CLOSED_AS;

const HISTORY_MAX = 20;

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

/** Where asking one person about this job for a referral stands, from first to last. */
export const OUTREACH_STAGES = ["to-contact", "warming", "messaged", "replied", "referred"] as const;
export type OutreachStage = (typeof OUTREACH_STAGES)[number];
export const OUTREACH_LABEL: Record<OutreachStage, string> = { "to-contact": "To contact", warming: "Warming up", messaged: "Messaged", replied: "Replied", referred: "Referred" };
export const OUTREACH_VIA = ["linkedin", "email", "topmate", "adplist", "other"] as const;
export type OutreachVia = (typeof OUTREACH_VIA)[number];
export const VIA_LABEL: Record<OutreachVia, string> = { linkedin: "LinkedIn", email: "Email", topmate: "Topmate", adplist: "ADPList", other: "Other" };

/** Asking one person on this job for a referral. */
export type Outreach = {
  stage: OutreachStage;
  via?: OutreachVia;
  /** When the stage last changed (ISO). */
  at: string;
  /** The LinkedIn connection this person came from (network.json id). */
  networkId?: string;
  /** From a pasted search: 1st or 2nd degree, and the shared connection to ask for an introduction. */
  degree?: 1 | 2;
  mutual?: string;
};

/** The Radar's word for how far a referral got: the furthest stage from Messaged on, else nothing. */
export function referralWord(e: Pick<Entry, "outreach"> | undefined): string | undefined {
  let best = -1;
  for (const o of Object.values(e?.outreach ?? {})) best = Math.max(best, OUTREACH_STAGES.indexOf(o.stage));
  return best >= OUTREACH_STAGES.indexOf("messaged") ? OUTREACH_LABEL[OUTREACH_STAGES[best]!] : undefined;
}

/** Size limits, so one job (or an import) can't grow the file without end. */
export const CAPS = {
  text: 1000,
  activities: 100,
  contacts: 30,
  skipped: 50,
  name: 120,
  company: 120,
  email: 254,
  phone: 32,
  linkedin: 300,
  howMet: 500,
  mutual: 120,
  changes: 100,
} as const;

/** One edit to a job that isn't a touch or a stage move ("Follow-up moved to Oct 28"), for its Activity. */
export type Change = { at: string; text: string };

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
  /** The follow-up date is one you picked (Details, Snooze, Pick a date), so a reply keeps it; an automatic one it clears. */
  followUpPicked?: true;
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
  /** Referral asks, by contact id (only people in `contacts`). */
  outreach?: Record<string, Outreach>;
  /** Your other edits (dates, CV, people, interviews, offer), oldest first (at most CAPS.changes). */
  changes?: Change[];
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
export type EntryPatch = Partial<Pick<Entry, "status" | "note" | "reason" | "closedAs" | "followUp" | "cv" | "interviews" | "contacts" | "activities" | "skipped" | "offer" | "outreach">> & {
  /** Move the date you reached the current status (YYYY-MM-DD), e.g. you applied before tracking it. */
  since?: string;
};

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

/**
 * Adds someone to a job's contacts, To contact on LinkedIn. The first person on a job you haven't
 * saved saves it too. `extra` adds where they came from (a network id, a pasted degree).
 */
export function addContactPatch(entry: Entry | undefined, c: Contact, extra?: Omit<Partial<Outreach>, "stage" | "at">): EntryPatch {
  const ask: Outreach = { stage: "to-contact", via: "linkedin", at: new Date().toISOString(), ...extra };
  return { ...(!entry?.status ? { status: "saved" as const } : {}), contacts: [...(entry?.contacts ?? []), c], outreach: { ...entry?.outreach, [c.id]: ask } };
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

/** One entry within the size caps: the newest touches, the first people, the latest done-task keys. */
export function capEntry(e: Entry): Entry {
  const next = { ...e };
  if (next.activities) {
    next.activities = [...next.activities]
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      .slice(-CAPS.activities)
      .map((a) => (a.text && a.text.length > CAPS.text ? { ...a, text: a.text.slice(0, CAPS.text) } : a));
  }
  if (next.contacts && next.contacts.length > CAPS.contacts) next.contacts = next.contacts.slice(0, CAPS.contacts);
  if (next.outreach) {
    // Only people still on the job keep their referral stage.
    const people = new Set((next.contacts ?? []).map((c) => c.id));
    const kept = Object.entries(next.outreach).filter(([id]) => people.has(id));
    if (kept.length) {
      if (kept.length < Object.keys(next.outreach).length) next.outreach = Object.fromEntries(kept);
    } else delete next.outreach;
  }
  // Done keys are kept however old: an overdue task shows until it's done, so dropping its key would bring it back.
  if (next.skipped) next.skipped = [...new Set(next.skipped)].slice(-CAPS.skipped);
  if (next.changes) next.changes = next.changes.filter((c) => isText(c?.at) && isText(c.text)).slice(-CAPS.changes);
  return next;
}

const dayLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const timeLabel = (hhmm: string) => new Date(`2000-01-01T${hhmm}:00`).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const interviewLabel = (i: Interview) => [i.what || "Interview", dayLabel(i.on), i.time && timeLabel(i.time)].filter(Boolean).join(", ");
const OFFER_LABEL: Record<(typeof OFFER_FIELDS)[number], string> = { pay: "pay", bonus: "bonus", equity: "equity", location: "location", start: "start date", deadline: "deadline", note: "note" };
const TASK_LABEL: Record<string, string> = { "follow-up": "Follow-up", reply: "Reply", "thank-you": "Thank-you", interview: "Interview", deadline: "Deadline" };

/**
 * What a change did, in words, for the job's Activity. Stage moves (history) and new touches have
 * rows of their own, so only the rest is described; the dates they set on their own aren't either.
 */
export function describeChanges(prev: Entry | undefined, next: Entry, patch: EntryPatch): string[] {
  if (!prev) return [];
  const out: string[] = [];
  const moved = "status" in patch && patch.status !== prev.status;
  const name = (id: string) => next.contacts?.find((c) => c.id === id)?.name ?? prev.contacts?.find((c) => c.id === id)?.name ?? "Someone";

  // A move or a logged touch sets the follow-up by itself; only a date you picked is a change.
  if ("followUp" in patch && !moved && !("activities" in patch) && next.followUp !== prev.followUp) {
    const word = next.status === "saved" ? "Apply by" : "Follow-up";
    out.push(!next.followUp ? `${word} date cleared` : prev.followUp ? `${word} moved to ${dayLabel(next.followUp)}` : `${word} set for ${dayLabel(next.followUp)}`);
  }
  // A reply logged on a job being chased clears its automatic date, so the follow-up falls a week after the reply: say so.
  if ("activities" in patch && "followUp" in patch && !next.followUp && prev.followUp) out.push("Follow-up moved to a week after their reply");
  if ("closedAs" in patch && !moved && next.closedAs && next.closedAs !== prev.closedAs) out.push(`Outcome set to ${CLOSED_AS[next.closedAs]}`);
  if (patch.since && isDay(patch.since) && next.status) out.push(`${STATUS_LABEL[next.status]} date set to ${dayLabel(patch.since)}`);
  if ("cv" in patch && (next.cv ?? "") !== (prev.cv ?? "")) out.push(next.cv ? `CV set to ${next.cv}` : "CV removed");
  if ("note" in patch && (next.note ?? "") !== (prev.note ?? "")) out.push(next.note ? "Note edited" : "Note deleted");

  if ("interviews" in patch) {
    const key = (i: Interview) => JSON.stringify([i.on, i.time, i.what, i.contactId]);
    const before = new Set((prev.interviews ?? []).map(key));
    const after = new Set((next.interviews ?? []).map(key));
    const added = (next.interviews ?? []).filter((i) => !before.has(key(i)));
    const removed = (prev.interviews ?? []).filter((i) => !after.has(key(i)));
    // As many in as out: the same rounds, edited.
    if (added.length && added.length === removed.length) for (const i of added) out.push(`Interview changed: ${interviewLabel(i)}`);
    else {
      for (const i of added) out.push(`Interview added: ${interviewLabel(i)}`);
      for (const i of removed) out.push(`Interview removed: ${interviewLabel(i)}`);
    }
  }

  const prevPeople = new Map((prev.contacts ?? []).map((c) => [c.id, c]));
  if ("contacts" in patch) {
    const nextIds = new Set((next.contacts ?? []).map((c) => c.id));
    for (const c of next.contacts ?? []) {
      const was = prevPeople.get(c.id);
      if (!was) out.push(`Added ${c.name}${c.role ? ` (${ROLE_LABEL[c.role]})` : ""}`);
      else if (JSON.stringify(was) !== JSON.stringify(c)) out.push(`Updated ${c.name}'s details`);
    }
    for (const c of prev.contacts ?? []) if (!nextIds.has(c.id)) out.push(`Removed ${c.name}`);
  }
  if ("outreach" in patch) {
    for (const [id, o] of Object.entries(next.outreach ?? {})) {
      // A new person's first stage comes with "Added …".
      if (prevPeople.has(id) && o.stage !== prev.outreach?.[id]?.stage) out.push(`Referral ask with ${name(id)}: ${OUTREACH_LABEL[o.stage]}`);
    }
  }

  if ("activities" in patch) {
    const after = new Map((next.activities ?? []).map((a) => [a.id, a]));
    for (const a of prev.activities ?? []) {
      const now = after.get(a.id);
      const what = a.channel === "note" ? "note" : "message";
      if (!now) out.push(`Deleted a ${what}`);
      else if (JSON.stringify(now) !== JSON.stringify(a)) out.push(`Edited a ${what}`);
    }
  }
  if ("skipped" in patch) {
    const before = new Set(prev.skipped ?? []);
    for (const k of next.skipped ?? []) if (!before.has(k)) out.push(`${TASK_LABEL[k.split(":")[0]!] ?? "Next step"} marked done`);
  }
  if ("offer" in patch) {
    const changed = OFFER_FIELDS.filter((f) => (next.offer?.[f] ?? "") !== (prev.offer?.[f] ?? ""));
    if (!next.offer && prev.offer) out.push("Offer details removed");
    else if (!prev.offer && next.offer) out.push("Offer details added");
    else if (changed.length) out.push(`Offer updated: ${changed.map((f) => OFFER_LABEL[f]).join(", ")}`);
  }
  return out;
}

/**
 * Log a touch: the patch that adds it, and then sets the next follow-up (a sent touch,
 * `followUpDays` from today) or clears it (a received one). Not on a Saved job, whose date is "Apply by".
 */
export function addActivity(entry: Entry | undefined, a: Activity, { followUpDays }: { followUpDays?: number } = {}, now = new Date()): EntryPatch {
  const patch: EntryPatch = { activities: [...(entry?.activities ?? []), a] };
  // On a Saved job the date is "Apply by", not a follow-up: a touch leaves it alone.
  if (a.channel === "note" || entry?.status === "saved") return patch;
  // A reply ends the chase, unless the date is one you picked yourself.
  if (a.dir === "received") {
    if (!entry?.followUpPicked) patch.followUp = undefined;
  } else if (a.dir === "sent" && followUpDays) patch.followUp = dayAfter(`${today(now)}T12:00:00`, followUpDays);
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
    // An empty patch only refreshes the job's details (a rename): it isn't a change of yours, so
    // updatedAt (which dates a stage tracked before history existed) stays put.
    updatedAt: prev && Object.keys(patch).length === 0 ? prev.updatedAt : now,
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
  // A follow-up date belongs to the active stages. A move clears it unless the patch sets one or it's
  // a date you picked yourself, and applying sets it a week out.
  const keepPicked = changed && !("followUp" in patch) && !!prev?.followUpPicked && !!prev.followUp;
  if (!isActive(next.status)) delete next.followUp;
  else if (changed && !("followUp" in patch) && !keepPicked) {
    if (next.status === "applied") next.followUp = dayAfter(now, FOLLOW_UP_DAYS);
    else delete next.followUp;
  }
  // Whose date it is: one set on its own (not by a logged touch or a move) is yours, and a reply keeps it.
  if ("followUp" in patch && patch.followUp && !changed && !("activities" in patch)) next.followUpPicked = true;
  else if ("followUp" in patch || (changed && !keepPicked)) delete next.followUpPicked;
  if (!next.followUp) delete next.followUpPicked;
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
  const changes = describeChanges(prev, next, patch).map((text) => ({ at: now, text: text.slice(0, CAPS.text) }));
  if (changes.length) next.changes = [...(prev?.changes ?? []), ...changes];
  return keep(next) ? capEntry(next) : null;
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
  const outreach = theirs.outreach && Object.fromEntries(Object.entries(theirs.outreach).map(([id, o]) => [renamed.get(id) ?? id, o]));
  return { ...theirs, contacts, activities: theirs.activities?.map(follow), interviews: theirs.interviews?.map(follow), ...(outreach ? { outreach } : {}) };
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
    // Referral stages join by person; for someone in both, the later change wins.
    const outreach = { ...older.outreach };
    for (const [cid, o] of Object.entries(newer.outreach ?? {})) if (!outreach[cid] || o.at >= outreach[cid].at) outreach[cid] = o;
    if (Object.keys(outreach).length) merged.outreach = outreach;
    out[id] = capEntry(merged);
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

/** An imported referral ask, if it has the right shape: a known stage and channel, a time that isn't in the future. */
function outreachFrom(v: unknown, now: Date): Outreach | undefined {
  if (!isRecord(v) || !(OUTREACH_STAGES as readonly unknown[]).includes(v.stage)) return undefined;
  const t = isText(v.at) ? Date.parse(v.at) : Number.NaN;
  if (!Number.isFinite(t) || t > now.getTime() + SKEW_MS) return undefined;
  const o: Outreach = { stage: v.stage as OutreachStage, at: v.at as string };
  if ((OUTREACH_VIA as readonly unknown[]).includes(v.via)) o.via = v.via as OutreachVia;
  if (isText(v.networkId) && /^[un]:[\w-]{1,100}$/.test(v.networkId)) o.networkId = v.networkId;
  if (v.degree === 1 || v.degree === 2) o.degree = v.degree;
  const mutual = clip(v.mutual, CAPS.mutual);
  if (mutual) o.mutual = mutual;
  return o;
}

/** The fields this version reads; an entry's other fields (from a newer RawJobs) are kept as they are. */
const ENTRY_FIELDS = new Set([
  "status",
  "note",
  "reason",
  "history",
  "closedAs",
  "followUp",
  "followUpPicked",
  "cv",
  "interviews",
  "contacts",
  "activities",
  "skipped",
  "offer",
  "outreach",
  "updatedAt",
  "snapshot",
]);

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
  const outreach = isRecord(e.outreach)
    ? Object.fromEntries(
        Object.entries(e.outreach).flatMap(([cid, o]) => {
          const ask = people.has(cid) ? outreachFrom(o, now) : undefined;
          return ask ? [[cid, ask] as const] : [];
        }),
      )
    : {};
  const entry: Entry = {
    // A field a newer RawJobs added survives a trip through this one.
    ...Object.fromEntries(Object.entries(e).filter(([k]) => !ENTRY_FIELDS.has(k))),
    ...(status ? { status } : {}),
    ...(e.note ? { note: e.note as string } : {}),
    ...(status === "dismissed" && isText(e.reason) ? { reason: e.reason as Reason } : {}),
    ...(history.length ? { history } : {}),
    ...(status === "rejected" && isText(e.closedAs) && e.closedAs in CLOSED_AS ? { closedAs: e.closedAs as ClosedAs } : {}),
    ...(isActive(status) && isDay(e.followUp) ? { followUp: e.followUp, ...(e.followUpPicked === true ? { followUpPicked: true as const } : {}) } : {}),
    ...(isText(e.cv) && e.cv ? { cv: e.cv } : {}),
    ...(interviews.length ? { interviews } : {}),
    ...(Object.keys(offer).length ? { offer } : {}),
    ...(contacts.length ? { contacts } : {}),
    ...(activities.length ? { activities } : {}),
    ...(skipped.length ? { skipped } : {}),
    ...(Object.keys(outreach).length ? { outreach } : {}),
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
  return keep(entry) ? capEntry(entry) : undefined;
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
