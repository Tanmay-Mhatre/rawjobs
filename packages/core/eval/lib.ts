/**
 * The matching eval set: invented profiles, invented postings, and a 0..4 label for every pair.
 * Loads the set, scores every pair with the real scoreJob, and measures how well the score order
 * agrees with the labels. run.ts prints it; test/eval.test.ts guards against regressions.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { ProfileSchema, type Profile, type Salary, type Workplace } from "../src/schema";
import { scoreJob } from "../src/score";

export const EVAL_DIR = dirname(fileURLToPath(import.meta.url));

export type EvalProfile = { id: string; summary: string; about: string; profile: Profile };
export type EvalJob = {
  id: string;
  title: string;
  company: string;
  /** The company's industry ids; missing when unknown. */
  industries?: string[];
  location: string;
  workplace: Workplace;
  salary?: Salary;
  postedAt?: string;
  /** Missing on title-only postings, like estimated index jobs. */
  description?: string;
};
export type Label = { label: number; why: string; by: "draft" | "reconciled" | "user" };
export type EvalSet = { profiles: EvalProfile[]; jobs: EvalJob[]; labels: Record<string, Record<string, Label>> };

export function loadSet(dir = EVAL_DIR): EvalSet {
  const profiles = readdirSync(join(dir, "profiles"))
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => {
      const raw = parseYaml(readFileSync(join(dir, "profiles", f), "utf8")) as Omit<EvalProfile, "profile"> & { profile: unknown };
      return { ...raw, profile: ProfileSchema.parse(raw.profile) };
    });
  const jobs = readdirSync(join(dir, "jobs"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(join(dir, "jobs", f), "utf8")) as EvalJob[]);
  const labels = parseYaml(readFileSync(join(dir, "labels.yaml"), "utf8")) as EvalSet["labels"];
  return { profiles, jobs, labels };
}

/** Everything wrong with the set: missing or unknown pairs, bad labels, duplicate ids. Empty when it's sound. */
export function problems(set: EvalSet): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const j of set.jobs) {
    if (ids.has(j.id)) out.push(`duplicate job id ${j.id}`);
    ids.add(j.id);
  }
  for (const p of set.profiles) {
    const mine = set.labels[p.id];
    if (!mine) {
      out.push(`no labels for profile ${p.id}`);
      continue;
    }
    for (const j of set.jobs) {
      const l = mine[j.id];
      if (!l) out.push(`${p.id}/${j.id}: not labelled`);
      else {
        if (!Number.isInteger(l.label) || l.label < 0 || l.label > 4) out.push(`${p.id}/${j.id}: label must be 0..4`);
        if (!l.why?.trim()) out.push(`${p.id}/${j.id}: no why`);
        if (l.by !== "draft" && l.by !== "reconciled" && l.by !== "user") out.push(`${p.id}/${j.id}: by must be draft, reconciled or user`);
      }
    }
    for (const id of Object.keys(mine)) if (!ids.has(id)) out.push(`${p.id}/${id}: no such job`);
  }
  for (const id of Object.keys(set.labels)) if (!set.profiles.some((p) => p.id === id)) out.push(`labels for unknown profile ${id}`);
  return out;
}

// ---------- metrics ----------

/** Groups of equal scores, best first. Ties are averaged so the order of equal scores never matters. */
function tiedGroups(pairs: { score: number; label: number }[]): { score: number; label: number }[][] {
  const sorted = [...pairs].sort((a, b) => b.score - a.score);
  const groups: { score: number; label: number }[][] = [];
  for (const p of sorted) {
    const last = groups.at(-1);
    if (last && last[0]!.score === p.score) last.push(p);
    else groups.push([p]);
  }
  return groups;
}

const gain = (label: number) => 2 ** label - 1;

/** DCG of the top k, each tied group spreading its mean gain over the places it takes. */
function dcg(groups: { label: number }[][], k: number): number {
  let at = 0;
  let sum = 0;
  for (const g of groups) {
    const mean = g.reduce((s, p) => s + gain(p.label), 0) / g.length;
    for (let i = 0; i < g.length && at < k; i++, at++) sum += mean / Math.log2(at + 2);
    if (at >= k) break;
  }
  return sum;
}

/** NDCG@k of the score order (gain 2^label - 1). 1 when no pair has any gain. */
export function ndcg(pairs: { score: number; label: number }[], k: number): number {
  const ideal = dcg(
    [...pairs].sort((a, b) => b.label - a.label).map((p) => [p]),
    k,
  );
  return ideal === 0 ? 1 : dcg(tiedGroups(pairs), k) / ideal;
}

/** Share of the top k (by score) labelled 3 or 4, ties averaged. */
export function precisionAt(pairs: { score: number; label: number }[], k: number): number {
  let at = 0;
  let hits = 0;
  for (const g of tiedGroups(pairs)) {
    const take = Math.min(g.length, k - at);
    hits += (take * g.filter((p) => p.label >= 3).length) / g.length;
    at += take;
    if (at >= k) break;
  }
  return hits / k;
}

/** Ranks from 1, ties sharing their mean rank. */
function ranks(xs: number[]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    for (let m = i; m <= j; m++) out[order[m]![1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

/** Spearman correlation of score and label; 0 when either doesn't vary. */
export function spearman(pairs: { score: number; label: number }[]): number {
  const a = ranks(pairs.map((p) => p.score));
  const b = ranks(pairs.map((p) => p.label));
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export const BANDS = ["strong", "good", "weak"] as const;
export type Band = (typeof BANDS)[number];
/** The score's band, the way the app shows it: strong at min_score, good within 20 below. */
export const scoreBand = (score: number, minScore: number): Band => (score >= minScore ? "strong" : score >= minScore - 20 ? "good" : "weak");
/** The label's band: 4-3 strong, 2 good, 1-0 weak. */
export const labelBand = (label: number): Band => (label >= 3 ? "strong" : label === 2 ? "good" : "weak");

/** confusion[labelBand][scoreBand] = pairs. */
export type Confusion = Record<Band, Record<Band, number>>;
const emptyConfusion = (): Confusion => ({
  strong: { strong: 0, good: 0, weak: 0 },
  good: { strong: 0, good: 0, weak: 0 },
  weak: { strong: 0, good: 0, weak: 0 },
});

export type Pair = { profile: string; job: string; title: string; company: string; score: number; label: number; why: string };
export type Metrics = { ndcg5: number; ndcg10: number; p5: number; spearman: number };
export type ProfileReport = Metrics & { id: string; confusion: Confusion };
export type Report = { overall: Metrics & { confusion: Confusion; pairs: number }; profiles: ProfileReport[]; worst: (Pair & { gap: number })[]; pairs: Pair[] };
/** What baseline.json holds: the report, with each pair's score in place of the pairs. */
export type Baseline = Omit<Report, "pairs"> & { scores: Record<string, number> };

const round = (x: number) => Math.round(x * 1000) / 1000;

/** Scores every pair with scoreJob (pure fit, no recency) and measures it against the labels. */
export function evaluate(set: EvalSet): Report {
  const all: Pair[] = [];
  const profiles: ProfileReport[] = [];
  const total = emptyConfusion();
  for (const p of set.profiles) {
    const pairs: Pair[] = set.jobs.map((j) => {
      const l = set.labels[p.id]?.[j.id];
      const { score } = scoreJob(j, p.profile, j.industries ? { industries: j.industries } : {});
      return { profile: p.id, job: j.id, title: j.title, company: j.company, score, label: l?.label ?? 0, why: l?.why ?? "" };
    });
    const confusion = emptyConfusion();
    for (const x of pairs) {
      confusion[labelBand(x.label)][scoreBand(x.score, p.profile.min_score)]++;
      total[labelBand(x.label)][scoreBand(x.score, p.profile.min_score)]++;
    }
    profiles.push({ id: p.id, ndcg5: round(ndcg(pairs, 5)), ndcg10: round(ndcg(pairs, 10)), p5: round(precisionAt(pairs, 5)), spearman: round(spearman(pairs)), confusion });
    all.push(...pairs);
  }
  const mean = (key: keyof Metrics) => round(profiles.reduce((s, r) => s + r[key], 0) / (profiles.length || 1));
  // Disagreement: the score read on the label's 0..4 scale, against the label.
  const worst = all
    .map((x) => ({ ...x, gap: round(x.score / 25 - x.label) }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || a.profile.localeCompare(b.profile) || a.job.localeCompare(b.job))
    .slice(0, 10);
  return { overall: { ndcg5: mean("ndcg5"), ndcg10: mean("ndcg10"), p5: mean("p5"), spearman: mean("spearman"), confusion: total, pairs: all.length }, profiles, worst, pairs: all };
}
