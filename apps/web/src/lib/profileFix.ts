import { seniorityCue, seniorityOf } from "@rawjobs/core/catalog/seniority";
import { createContext, useContext } from "react";
import type { Job } from "./data";
import type { Draft } from "./setup";

/** A one-click fix beside a check in "Why it matched": add a word to a profile list, or open a setting. */
export type FitFix = { check: "visa" | "level"; label: string; field: "workAuthorization" | "seniority"; value: string; done: string } | { check: "pay"; label: string; section: "dealbreakers" };

/**
 * The fixes for a job's unknown or missed checks, from what the job itself says:
 * - visa: "I can work in Germany" when the job is in exactly one country
 * - pay: a link to the pay floor
 * - level: "Count Lead roles" when the title names a level word (a mid-level title has none to add)
 */
export function fitFixes(job: Job): FitFix[] {
  const checks = job.why.checks ?? [];
  const out: FitFix[] = [];
  const pay = checks.find((c) => c.id === "pay");
  if (pay && (pay.status === "unknown" || pay.status === "missed")) out.push({ check: "pay", label: "Change pay floor", section: "dealbreakers" });
  const visa = checks.find((c) => c.id === "visa");
  const [country, ...more] = job.countries;
  if (visa && (visa.status === "unknown" || visa.status === "missed") && country && !more.length)
    out.push({ check: "visa", label: `I can work in ${country}`, field: "workAuthorization", value: country.toLowerCase(), done: `Added ${country} to where you can work.` });
  const word = checks.some((c) => c.id === "level" && c.status === "missed") ? levelWord(job.title) : undefined;
  if (word) {
    const name = word[0]!.toUpperCase() + word.slice(1);
    out.push({ check: "level", label: `Count ${name} roles`, field: "seniority", value: word, done: `${name} roles now count as your level.` });
  }
  return out;
}

/** The title's own level word ("lead" in "Lead Product Manager"), lowercased; undefined for a mid-level title. */
function levelWord(title: string): string | undefined {
  const level = seniorityOf(title);
  if (level === "mid") return undefined;
  return title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .find((w) => w && seniorityCue(w) === level);
}

/** Whether your saved profile already has the fix (then it's hidden). */
export const fixApplied = (fix: FitFix, draft: Draft) => "field" in fix && draft[fix.field].some((v) => v.toLowerCase() === fix.value);

/** Saving a fix to your profile; null in the demo, on someone else's radar, or before setup is done. */
export type ProfileFixApi = { draft: Draft; add: (field: "workAuthorization" | "seniority", value: string) => Promise<string | null> };
const ProfileFixContext = createContext<ProfileFixApi | null>(null);
export const ProfileFixProvider = ProfileFixContext.Provider;
export const useProfileFix = () => useContext(ProfileFixContext);
