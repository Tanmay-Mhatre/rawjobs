/**
 * How much of each hiring system's companies the directory holds, measured three ways:
 *
 * 1. Estimate (Chao2) from how often our URL sources agree: a lower bound, because they all draw
 *    on the same crawls.
 * 2. Independent sample: companies picked from Wikidata (not from any URL list) and resolved from
 *    their own websites. The share of their boards the URL sources already had is the coverage
 *    figure the 90% target is measured on.
 * 3. Hold-one-out: how many live boards only one URL source lists (what we'd lose without it).
 */
import { ATS_TYPES } from "@rawjobs/core";
import { chao2 } from "./estimate";

/** Families that pick companies rather than crawl URLs: excluded from estimates and from "already known". */
export const COMPANY_FIRST = new Set(["seeds", "probe", "contributions"]);
export const SYSTEMS = ATS_TYPES;

export type UniverseInput = {
  boards: { key: string; ats: string; families: string[] }[];
  /** Latest live-check status per board key. */
  status: Map<string, string>;
  /** Board keys that companies from the independent sample resolved to. */
  sample: string[];
  restrictedOnly: Record<string, number>;
};

export type UniverseRow = {
  ats: string;
  ours: number;
  estimate: number;
  sampleBoards: number;
  sampleKnown: number;
  restrictedOnly: number;
};

const alive = (s: string | undefined) => s === "live" || s === "dormant";

export function universe(input: UniverseInput): { rows: UniverseRow[]; holdOut: { family: string; boards: number; unique: number }[] } {
  const byKey = new Map(input.boards.map((b) => [b.key, b]));
  const urlFamilies = (b: { families: string[] }) => b.families.filter((f) => !COMPANY_FIRST.has(f));
  const sample = [...new Set(input.sample)].map((k) => byKey.get(k)).filter((b): b is UniverseInput["boards"][number] => !!b && alive(input.status.get(b.key)));

  const rows = SYSTEMS.map((ats) => {
    const live = input.boards.filter((b) => b.ats === ats && alive(input.status.get(b.key)));
    const incidence = live.map((b) => urlFamilies(b).length).filter((n) => n > 0);
    const families = new Set(live.flatMap(urlFamilies));
    const est = chao2(incidence, families.size);
    const s = sample.filter((b) => b.ats === ats);
    return {
      ats,
      ours: live.length,
      // Company-first boards are real too: the estimate can't be below what we hold.
      estimate: Math.max(est.estimate + (live.length - incidence.length), live.length),
      sampleBoards: s.length,
      sampleKnown: s.filter((b) => urlFamilies(b).length > 0).length,
      restrictedOnly: input.restrictedOnly[ats] ?? 0,
    };
  });

  const live = input.boards.filter((b) => alive(input.status.get(b.key)));
  const holdOut = [...new Set(live.flatMap(urlFamilies))]
    .map((family) => {
      const listed = live.filter((b) => b.families.includes(family));
      return { family, boards: listed.length, unique: listed.filter((b) => urlFamilies(b).length === 1).length };
    })
    .sort((a, b) => b.unique - a.unique);
  return { rows, holdOut };
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");

export function universeMarkdown(u: ReturnType<typeof universe>): string[] {
  const sum = (f: (r: UniverseRow) => number) => u.rows.reduce((n, r) => n + f(r), 0);
  const lines = [
    "## Universe: how much of each hiring system we hold",
    "",
    "**Sample coverage** is the target figure: Wikidata companies resolved from their own websites, and the share of their live boards our URL sources already had (a sample under 30 is too small to trust). **Estimate** is a lower bound on all boards, from how often our URL sources agree.",
    "",
    "| Hiring system | Ours (live + dormant) | Estimate | Ours / estimate | Sample boards | Already had | Sample coverage | Listed only by restricted sources |",
    "|---|---|---|---|---|---|---|---|",
    ...u.rows.map(
      (r) =>
        `| ${r.ats} | ${r.ours.toLocaleString()} | ${r.estimate.toLocaleString()} | ${pct(r.ours, r.estimate)} | ${r.sampleBoards} | ${r.sampleKnown} | ${pct(r.sampleKnown, r.sampleBoards)} | ${r.restrictedOnly.toLocaleString()} |`,
    ),
    `| **All** | ${sum((r) => r.ours).toLocaleString()} | ${sum((r) => r.estimate).toLocaleString()} | ${pct(
      sum((r) => r.ours),
      sum((r) => r.estimate),
    )} | ${sum((r) => r.sampleBoards)} | ${sum((r) => r.sampleKnown)} | ${pct(
      sum((r) => r.sampleKnown),
      sum((r) => r.sampleBoards),
    )} | ${sum((r) => r.restrictedOnly).toLocaleString()} |`,
    "",
    "### Which URL source carries its weight (live + dormant boards)",
    "",
    "| Source family | Boards | Only this source |",
    "|---|---|---|",
    ...u.holdOut.map((h) => `| ${h.family} | ${h.boards.toLocaleString()} | ${h.unique.toLocaleString()} |`),
    "",
  ];
  return lines;
}
