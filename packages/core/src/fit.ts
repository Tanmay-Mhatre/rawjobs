import type { ScoreBreakdown } from "./schema";

/** The one line under a job in a list: its best reason and its biggest gap, both short. */
export type FitLine = { reason?: string; gap?: { text: string; tone: "missed" | "unknown" } };

/** Gaps in a few words: the row is narrow, and the job's detail has the full sentence. */
const SHORT: Record<string, string> = {
  "level:missed": "Not your level",
  "pay:missed": "Pay below your floor",
  "pay:unknown": "Pay not listed",
  "visa:missed": "No visa sponsorship",
  "visa:unknown": "Visa not stated",
  "musts:missed": "Must-haves not yours",
};

/**
 * What a job's score rests on, in a few words (one reason when there's a gap): "payments, cards · Your title" and "Pay not listed".
 * Gates and dealbreakers say more on their own (the row's flag), so they're left out here.
 * Older scores, made before checks existed, get no line.
 */
export function fitLine(why: ScoreBreakdown, o: { estimated?: boolean } = {}): FitLine {
  if (why.gate || !why.checks) return {};
  const level = why.checks.find((c) => c.id === "level")?.status === "met";
  const facts: string[] = [];
  if ((why.focus ?? 0) >= 0.9) facts.push(level ? "Your title and level" : "Your title");
  else if (level) facts.push("Your level");
  if (why.keywords.length) facts.unshift(why.keywords.slice(0, 2).join(", "));
  if (facts.length < 2) facts.push(why.location === 20 ? "In your place" : "Remote for you");
  const out: FitLine = facts.length ? { reason: facts.join(" · ") } : {};
  if (why.dealbreakers?.length) return out;
  const missed = why.checks.find((c) => c.status === "missed");
  const unknown = why.checks.find((c) => c.status === "unknown");
  if (missed) out.gap = { text: SHORT[`${missed.id}:missed`] ?? missed.note, tone: "missed" };
  else if (unknown) out.gap = { text: SHORT[`${unknown.id}:unknown`] ?? unknown.note, tone: "unknown" };
  else if (!o.estimated && why.missing?.length && why.keywordPoints < 20) out.gap = { text: `No ${why.missing.slice(0, 2).join(", ")}`, tone: "missed" };
  // With a gap beside it, the reason keeps to its first fact, so both fit a narrow row.
  if (out.gap && facts.length) out.reason = facts[0];
  return out;
}
