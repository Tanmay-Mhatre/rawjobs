/**
 * How well does scoreJob rank jobs against people's own judgement? Scores every labelled
 * profile x posting pair in this folder and prints NDCG, precision, Spearman, band agreement
 * and the worst disagreements.
 *
 *   pnpm eval:match              print the report
 *   pnpm eval:match --json       also write baseline.json (do this when a change is accepted)
 *   pnpm eval:match --compare    print the change against baseline.json
 *   pnpm eval:match --pairs      also list each profile's postings by score, with their labels
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { BANDS, EVAL_DIR, evaluate, loadSet, problems, type Baseline, type Metrics } from "./lib";

const args = process.argv.slice(2);
const baselinePath = join(EVAL_DIR, "baseline.json");
const set = loadSet();
const issues = problems(set);
if (issues.length) {
  console.error(`The eval set has ${issues.length} problem(s):\n  ${issues.slice(0, 20).join("\n  ")}`);
  process.exit(1);
}
const report = evaluate(set);
const base: Baseline | undefined = args.includes("--compare") && existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : undefined;
if (args.includes("--compare") && !base) console.log("No baseline.json yet: run with --json first.\n");

const KEYS: [keyof Metrics, string][] = [
  ["ndcg5", "NDCG@5"],
  ["ndcg10", "NDCG@10"],
  ["p5", "P@5"],
  ["spearman", "Spearman"],
];
const fmt = (x: number) => x.toFixed(3);
const delta = (now: number, was: number | undefined) => {
  if (was === undefined) return "";
  const d = now - was;
  return Math.abs(d) < 0.0005 ? "  (=)" : `  (${d > 0 ? "+" : ""}${d.toFixed(3)})`;
};
const row = (name: string, m: Metrics, was?: Metrics) => `${name.padEnd(18)}${KEYS.map(([k]) => `${fmt(m[k])}${delta(m[k], was?.[k])}`.padEnd(base ? 18 : 10)).join("")}`;

const labelled = Object.values(set.labels).flatMap((m) => Object.values(m));
console.log(
  `${set.profiles.length} profiles x ${set.jobs.length} postings = ${report.overall.pairs} pairs (${labelled.filter((l) => l.by === "reconciled").length} reconciled, ${labelled.filter((l) => l.by === "user").length} reviewed by a person)\n`,
);
console.log(`${"".padEnd(18)}${KEYS.map(([, n]) => n.padEnd(base ? 18 : 10)).join("")}`);
for (const p of report.profiles)
  console.log(
    row(
      p.id,
      p,
      base?.profiles.find((b) => b.id === p.id),
    ),
  );
console.log(row("overall (mean)", report.overall, base?.overall));

console.log("\nBand agreement, all pairs (rows: label band 4-3 / 2 / 1-0; columns: score band >= min / >= min-20 / below)");
console.log(`${"".padEnd(14)}${BANDS.map((b) => `score ${b}`.padEnd(16)).join("")}`);
for (const l of BANDS) console.log(`${`label ${l}`.padEnd(14)}${BANDS.map((s) => String(report.overall.confusion[l][s]).padEnd(16)).join("")}`);
const agree = BANDS.reduce((s, b) => s + report.overall.confusion[b][b], 0);
console.log(`${agree} of ${report.overall.pairs} pairs in the same band (${((100 * agree) / report.overall.pairs).toFixed(1)}%)`);

console.log("\nWorst disagreements (score / 25 against the label)");
for (const w of report.worst)
  console.log(
    `  ${w.gap > 0 ? "too high" : "too low "}  ${`${w.profile}/${w.job}`.padEnd(26)} score ${String(w.score).padStart(3)}  label ${w.label}  ${w.title} @ ${w.company}\n${"".padEnd(12)}${w.why}`,
  );

if (base) {
  const moved = report.pairs.filter((x) => base.scores[`${x.profile}/${x.job}`] !== undefined && base.scores[`${x.profile}/${x.job}`] !== x.score);
  console.log(`\n${moved.length} pair(s) scored differently from the baseline${moved.length > 25 ? " (biggest 25)" : ""}`);
  const was = (x: (typeof moved)[number]) => base.scores[`${x.profile}/${x.job}`]!;
  for (const x of moved.sort((a, b) => Math.abs(b.score - was(b)) - Math.abs(a.score - was(a))).slice(0, 25))
    console.log(`  ${`${x.profile}/${x.job}`.padEnd(26)} ${String(was(x)).padStart(3)} -> ${String(x.score).padStart(3)}  label ${x.label}  ${x.title}`);
}

if (args.includes("--pairs")) {
  for (const p of set.profiles) {
    console.log(`\n${p.id}: postings that scored above 0 or are labelled 2+, by score`);
    const rows = report.pairs.filter((x) => x.profile === p.id && (x.score > 0 || x.label >= 2)).sort((a, b) => b.score - a.score || b.label - a.label);
    for (const r of rows) console.log(`  ${String(r.score).padStart(3)}  label ${r.label}  ${r.job.padEnd(7)} ${r.title} @ ${r.company}`);
  }
}

if (args.includes("--json")) {
  // Each pair's score is kept too, so a later change can be traced to the jobs it moved.
  const { pairs, ...rest } = report;
  const scores = Object.fromEntries(pairs.map((x) => [`${x.profile}/${x.job}`, x.score]));
  writeFileSync(baselinePath, `${JSON.stringify({ ...rest, scores }, null, 2)}\n`);
  console.log(`\nWrote ${relative(process.cwd(), baselinePath)}`);
}
