import { linkedInUrl, phoneDigits } from "../../lib/contactLinks";
import { activityText, type Task } from "../../lib/nextSteps";
import { type Activity, CHANNEL_LABEL, type Channel, type Contact, type Entry, ROLE_LABEL, STATUS_LABEL, statusLabel, type UserState } from "../../lib/userState";

/**
 * The job detail's logic (docs/plans/pipeline-v2.md, section 6.2), kept out of the components so it
 * can be tested on its own: the timeline, its filters, paste-to-fill and people across jobs.
 */

export type TimelineItem =
  | { kind: "touch"; key: string; at: string; activity: Activity; title: string }
  | { kind: "note"; key: string; at: string; text: string; legacy?: true }
  | { kind: "stage"; key: string; at: string; text: string }
  | { kind: "change"; key: string; at: string; text: string }
  | { kind: "found"; key: string; at: string };

/** Stage moves are one line each, so they show under All only. */
export type TimelineFilter = "all" | "messages" | "notes" | "changes";
export const TIMELINE_FILTERS: { id: TimelineFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "messages", label: "Messages" },
  { id: "notes", label: "Notes" },
  { id: "changes", label: "Changes" },
];

const time = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/**
 * One job's history, newest first: touches, notes, stage changes, your other edits, and "Found on your Radar" when you
 * know when it was first seen. The v1 note, which has no date, comes first.
 */
export function timeline(entry: Entry, foundAt?: string): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const a of entry.activities ?? []) {
    if (a.channel === "note") items.push({ kind: "note", key: a.id, at: a.at, text: a.text ?? "" });
    else items.push({ kind: "touch", key: a.id, at: a.at, activity: a, title: activityText(entry, a) });
  }
  const history = entry.history ?? [];
  history.forEach((h, i) => {
    // The current stage shows how it closed ("No response"); older rows show the stage's own word.
    const last = i === history.length - 1;
    const label = h.status ? (last && h.status === entry.status ? statusLabel(entry) : STATUS_LABEL[h.status]) : "";
    items.push({ kind: "stage", key: `stage:${i}:${h.at}`, at: h.at, text: h.status ? `Moved to ${label}` : "Taken off the board" });
  });
  (entry.changes ?? []).forEach((c, i) => {
    items.push({ kind: "change", key: `change:${i}:${c.at}`, at: c.at, text: c.text });
  });
  if (foundAt && time(foundAt)) items.push({ kind: "found", key: "found", at: foundAt });
  // Newest first; on the same moment, keep the order they were added in reverse (a stage before its touch).
  const sorted = items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => time(b.it.at) - time(a.it.at) || b.i - a.i)
    .map((x) => x.it);
  // The v1 note has no date of its own (the entry's updatedAt moves with every change), so it stays on top.
  return entry.note?.trim() ? [{ kind: "note", key: "note:v1", at: entry.updatedAt, text: entry.note.trim(), legacy: true }, ...sorted] : sorted;
}

export function filterTimeline(items: readonly TimelineItem[], f: TimelineFilter): TimelineItem[] {
  if (f === "messages") return items.filter((i) => i.kind === "touch");
  if (f === "notes") return items.filter((i) => i.kind === "note");
  if (f === "changes") return items.filter((i) => i.kind === "change");
  return [...items];
}

/** Text long enough to fold: more than 6 lines, or about that much wrapped prose. */
export const isLong = (text: string) => text.split("\n").length > 6 || text.length > 480;

const EMAIL = /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/;

/** Which field a pasted value belongs in: a LinkedIn URL, an email address or a phone number. */
export function pasteField(raw: string): { field: "linkedin" | "email" | "phone"; value: string } | undefined {
  const v = raw.trim();
  if (!v || v.includes("\n")) return undefined;
  const url = linkedInUrl(v) ?? (/^(www\.)?linkedin\.com\//i.test(v) ? linkedInUrl(`https://${v}`) : undefined);
  if (url) return { field: "linkedin", value: url };
  const email = v.replace(/^mailto:/i, "");
  if (EMAIL.test(email)) return { field: "email", value: email };
  if (/^\+?[\d\s().-]+$/.test(v) && phoneDigits(v)) return { field: "phone", value: v };
  return undefined;
}

/** People on your other jobs that aren't on this one yet, once each (same id), by name. */
export function knownPeople(state: UserState, jobId: string): Contact[] {
  const here = new Set((state[jobId]?.contacts ?? []).map((c) => c.id));
  const out = new Map<string, Contact>();
  for (const [id, e] of Object.entries(state)) {
    if (id === jobId) continue;
    for (const c of e.contacts ?? []) if (!here.has(c.id) && !out.has(c.id)) out.set(c.id, c);
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A person's touches on this job: the newest one and how many. */
export function touchesWith(entry: Entry, contactId: string): { last?: Activity; count: number } {
  const touches = (entry.activities ?? []).filter((a) => a.contactId === contactId && a.channel !== "note");
  const last = touches.reduce<Activity | undefined>((m, a) => (!m || time(a.at) >= time(m.at) ? a : m), undefined);
  return { last, count: touches.length };
}

/** "Last: Email, 3 days ago · 2 touches", or "No touches yet". */
export function touchLine(entry: Entry, contactId: string, ago: (iso: string) => string): string {
  const { last, count } = touchesWith(entry, contactId);
  if (!last) return "No touches yet";
  return `Last: ${CHANNEL_LABEL[last.channel]}, ${ago(last.at)} · ${count} ${count === 1 ? "touch" : "touches"}`;
}

/** What Copy puts on the clipboard: the name and role, then each contact detail on its own line. */
export function contactText(c: Contact): string {
  const head = [c.name, c.role ? ROLE_LABEL[c.role] : "", c.company ?? ""].filter(Boolean).join(", ");
  return [head, c.email, c.phone, c.linkedin ?? c.link].filter(Boolean).join("\n");
}

/** Built-in texts for Log follow-up and Log thank-you (section 9.3: no templates page). */
export function templateText(kind: "follow-up" | "thank-you" | "check-in", name: string | undefined, title: string): string {
  const hi = name ? `Hi ${name.split(/\s+/)[0]},` : "Hi,";
  if (kind === "thank-you") return `${hi} thank you for your time on the ${title} interview. I enjoyed the conversation and I'm keen on the role.`;
  if (kind === "check-in") return `${hi} I wanted to check in on the ${title} role. Is there anything else you need from me?`;
  return `${hi} I applied for the ${title} role and wanted to follow up. I'm still very interested and happy to share anything that helps.`;
}

/**
 * What Log follow-up and Log thank-you put in the composer: the channel and person of the last sent
 * touch (or the task's person), the built-in text, and the follow-up mark.
 */
export function taskPrefill(entry: Entry, task: Task, title: string): { channel: Channel; dir: "sent"; contactId?: string; text: string; followUp: boolean } {
  const lastSent = (entry.activities ?? []).filter((a) => a.dir === "sent" && a.channel !== "note").at(-1);
  const contactId = task.contactId ?? lastSent?.contactId;
  const name = entry.contacts?.find((c) => c.id === contactId)?.name;
  return { channel: lastSent?.channel ?? "email", dir: "sent", contactId, text: templateText(task.kind === "thank-you" ? "thank-you" : "follow-up", name, title), followUp: entry.status !== "saved" };
}
