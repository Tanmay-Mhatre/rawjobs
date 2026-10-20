/** How likely a person is to help with a job: points from what's known, never from guesses. Pure. */
import { ROLE_FAMILIES, type RoleFamily } from "../catalog/roles";
import { SENIORITY_LEVELS, type Seniority, seniorityOf } from "../catalog/seniority";
import { matchesAny, matchesTitle } from "../text";
import type { NetworkPosition } from "./types";

export type PersonPointId = "first" | "friend" | "colleague" | "function" | "seniority" | "recruiter" | "years";
export type PersonPoint = { id: PersonPointId; points: number; text: string };
export type PersonBand = "high" | "medium" | "low";
export type PersonScore = { total: number; band: PersonBand; points: PersonPoint[]; why: string };

export const RECRUITER_TERMS = ["recruiter", "talent acquisition", "sourcer", "talent partner", "people partner"];

/** High from 60, medium from 35. */
export function bandOf(total: number): PersonBand {
  return total >= 60 ? "high" : total >= 35 ? "medium" : "low";
}

function familyOf(title: string): RoleFamily | undefined {
  return ROLE_FAMILIES.find((f) => matchesTitle(title, f.titles));
}

const rank = (s: Seniority) => SENIORITY_LEVELS.findIndex((l) => l.id === s);

export function scorePerson(
  p: { degree: 1 | 2; position?: string; connectedOn?: string; friend?: boolean },
  job: { title: string; seniority: Seniority },
  me: { positions: readonly NetworkPosition[] },
  now: Date = new Date(),
): PersonScore {
  const points: PersonPoint[] = [];
  if (p.degree === 1) points.push({ id: "first", points: 40, text: "You're connected on LinkedIn" });
  if (p.friend) points.push({ id: "friend", points: 20, text: "You marked them as a close contact" });

  const on = p.connectedOn?.slice(0, 7);
  if (on) {
    const thisMonth = now.toISOString().slice(0, 7);
    const at = me.positions.find((x) => x.from && x.from <= on && on <= (x.to ?? thisMonth));
    if (at) points.push({ id: "colleague", points: 15, text: `You connected while you were at ${at.company}: likely a past colleague` });
  }

  const position = p.position?.trim();
  if (position) {
    const theirs = familyOf(position);
    if (theirs && theirs.id === familyOf(job.title)?.id) points.push({ id: "function", points: 15, text: `Works in ${theirs.label}, like this job` });
    if (rank(seniorityOf(position)) <= rank(job.seniority)) points.push({ id: "seniority", points: 10, text: "At or above this job's level" });
    if (matchesAny(position, RECRUITER_TERMS)) points.push({ id: "recruiter", points: 10, text: "A recruiter: can route your application, can't vouch for you" });
  }

  if (p.connectedOn) {
    const since = new Date(`${p.connectedOn.slice(0, 10)}T00:00:00Z`);
    let years = now.getUTCFullYear() - since.getUTCFullYear();
    if (now.getUTCMonth() < since.getUTCMonth() || (now.getUTCMonth() === since.getUTCMonth() && now.getUTCDate() < since.getUTCDate())) years--;
    if (years >= 2) points.push({ id: "years", points: 5, text: `Connected for ${years} years` });
  }

  const total = points.reduce((n, x) => n + x.points, 0);
  const why = [...points]
    .sort((a, b) => b.points - a.points)
    .slice(0, 2)
    .map((x) => x.text)
    .join(". ");
  return { total, band: bandOf(total), points, why };
}
