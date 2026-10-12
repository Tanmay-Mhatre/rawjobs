/**
 * Join merged boards with live-check results into the company directory, and report how well
 * source agreement predicted a live board.
 *
 *   pnpm exec tsx scripts/catalog/build.ts  -> scripts/catalog/out/{directory.json,summary.md}
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { careersUrl, guessName, isPlaceholderBoard, type DetectedCompany } from "../../packages/core/src/index";
import { readChecks, type CheckRow } from "./lib/checks";
import { readDenylist } from "./lib/denylist";

const here = dirname(fileURLToPath(import.meta.url));
type Merged = { key: string; ats: string; slug: string; region?: string; shard?: string; site?: string; name?: string; families: string[]; confidence: "high" | "single" };
type Check = { key: string; status: "live" | "dormant" | "dead" | "error" | "unreachable"; jobs: number | null; name?: string; http?: number; checked_at: string };

/**
 * Workday answers a wrong site name with 500 and a protected board with 401/403, after retries.
 * Those aren't transient errors: call them unreachable (left out, re-checked on the monthly pass).
 */
function settle(c: CheckRow): CheckRow {
  if (c.status === "error" && c.key.startsWith("workday:") && typeof c.http === "number" && [401, 403, 500].includes(c.http)) return { ...c, status: "unreachable" };
  return c;
}

const merged = (JSON.parse(readFileSync(join(here, "out", "merged.json"), "utf8")) as { boards: Merged[] }).boards;
// Latest result wins, but a definite answer beats a later error (mergeCheck).
const checks = readChecks(join(here, "out"), settle) as unknown as Map<string, Check>;

// The hand-reviewed boards (seeds/curated-boards.json) are the curated tier.
const curated = new Set<string>();
/** Hand-picked display names from the curated list (e.g. "Crypto.com", "talabat"). */
const curatedNames = new Map<string, string>();
const curatedFile = join(here, "seeds", "curated-boards.json");
if (existsSync(curatedFile)) {
  for (const c of (JSON.parse(readFileSync(curatedFile, "utf8")) as { companies: { key: string; name: string }[] }).companies) {
    curated.add(c.key);
    curatedNames.set(c.key, c.name);
  }
}

const rows = merged.map((b) => {
  const c = checks.get(b.key);
  return {
    key: b.key,
    // Best name first: the hiring system's own, then a source list's, then the curated one, then the slug.
    name: c?.name || b.name || curatedNames.get(b.key) || guessName(b.slug),
    name_source: c?.name ? "ats" : b.name ? "source list" : curatedNames.has(b.key) ? "curated" : "slug",
    ats: b.ats,
    slug: b.slug,
    ...(b.region ? { region: b.region } : {}),
    ...(b.shard ? { shard: b.shard } : {}),
    ...(b.site ? { site: b.site } : {}),
    careers_url: careersUrl(b as DetectedCompany),
    tier: curated.has(b.key) ? "curated" : "dump",
    confidence: b.confidence,
    agreeing_sources: b.families.length,
    status: c?.status ?? "unchecked",
    open_jobs: c?.jobs ?? null,
    checked_at: c?.checked_at ?? null,
  };
});

// Directory keeps live + dormant (dormant may come back); dead/unknown stay out, and so do
// sandbox/training/test boards, which post fake or years-old jobs.
// Companies removed on request never reach the directory (docs/shared-directory.md, "Denylist").
const denied = readDenylist();
const directory = rows.filter((r) => (r.status === "live" || r.status === "dormant") && !isPlaceholderBoard(r.name) && !denied(r));
writeFileSync(join(here, "out", "directory.json"), JSON.stringify({ generated_at: new Date().toISOString(), count: directory.length, companies: directory }));

// ---- summary ----
const STATUSES = ["live", "dormant", "dead", "unreachable", "error", "unchecked"] as const;
const table = (group: (r: (typeof rows)[number]) => string) => {
  const m = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const g = group(r);
    if (!m.has(g)) m.set(g, {});
    const t = m.get(g)!;
    t[r.status] = (t[r.status] ?? 0) + 1;
    t.total = (t.total ?? 0) + 1;
  }
  const lines = ["| | total | live | dormant | dead | unreachable | error | unchecked | live % |", "|---|---|---|---|---|---|---|---|---|"];
  for (const [g, t] of [...m.entries()].sort()) {
    const checked = (t.total ?? 0) - (t.unchecked ?? 0) - (t.error ?? 0) - (t.unreachable ?? 0);
    lines.push(`| ${g} | ${t.total} | ${STATUSES.map((s) => t[s] ?? 0).join(" | ")} | ${checked ? Math.round(((t.live ?? 0) / checked) * 100) : 0}% |`);
  }
  return lines.join("\n");
};

const md = [
  "# Company directory: build summary",
  "",
  `Built ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from ${rows.length} merged boards. Directory (live + dormant): **${directory.length}** companies, of which **${directory.filter((r) => r.tier === "curated").length}** are in the curated tier.`,
  "",
  "## By hiring system",
  table((r) => r.ats),
  "",
  "## Does source agreement predict a live board?",
  "Agreement = number of independent source families listing the board.",
  table((r) => (r.agreeing_sources >= 4 ? "4+ sources" : `${r.agreeing_sources} source${r.agreeing_sources === 1 ? "" : "s"}`)),
  "",
  "## By confidence",
  table((r) => r.confidence),
  "",
].join("\n");
writeFileSync(join(here, "out", "summary.md"), md);
console.log(md);
