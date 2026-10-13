/**
 * Download the public company-board lists the directory is merged from, into scripts/catalog/raw/.
 * Licences and how each is used are in merge.ts (only permissive ones may add companies; the
 * others only confirm boards already listed). Our own Common Crawl list is built by commoncrawl.ts.
 *
 *   pnpm catalog:sources
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BOARD_URL, FREEHIRE_COMMIT } from "./lib/freehire";

const here = dirname(fileURLToPath(import.meta.url));
const GH = "https://raw.githubusercontent.com";

/** ats-scrapers files for the systems we have connectors for (its other files are systems we don't read yet). */
const KALIL = [
  "ashby",
  "bamboohr",
  "breezy",
  "greenhouse",
  "icims",
  "jazzhr",
  "jobvite",
  "join_com",
  "lever",
  "oracle",
  "paycom",
  "paylocity",
  "personio",
  "pinpoint",
  "recruitee",
  "rippling",
  "smartrecruiters",
  "successfactors",
  "taleo",
  "teamtailor",
  "workable",
  "workday",
];
/** openings-mcp providers we have connectors for (merge.ts turns each entry into a careers URL). */
export const OPENINGS_MCP = ["ashby", "bamboohr", "greenhouse", "icims", "join", "lever", "oracle", "recruitee", "rippling", "smartrecruiters", "successfactors", "teamtailor", "workable", "workday"];

/** [folder, file name, URL] */
const FILES: [string, string, string][] = [
  ["latmay", "ats_career_page_urls.csv", "https://huggingface.co/datasets/latmay/ats-career-page-urls/resolve/main/ats_career_page_urls.csv"],
  // kalil0321/ats-scrapers (MIT): one name,slug,url list per hiring system we read.
  ...KALIL.map((f): [string, string, string] => ["kalil0321", `${f}.csv`, `${GH}/kalil0321/ats-scrapers/HEAD/ats-companies/${f}.csv`]),
  // strelov1/freehire (MIT): its last committed board list, pinned (lib/freehire.ts).
  ...Object.keys(BOARD_URL).map((f): [string, string, string] => ["freehire", `${f}.yml`, `${GH}/strelov1/freehire/${FREEHIRE_COMMIT}/sources/${f}.yml`]),
  // amikai/openings-mcp (MIT): companies.yaml per provider, each entry checked live by its author.
  ...OPENINGS_MCP.map((f): [string, string, string] => ["openingsmcp", `${f}.yaml`, `${GH}/amikai/openings-mcp/HEAD/internal/provider/${f}/companies.yaml`]),
  ["conorscode", "companies.json", `${GH}/ConorsCode/open-jobs-data/HEAD/companies.json`],
  // LastRound AI's ATS company directory, CC BY 4.0: credit "LastRound AI" (NOTICE.md in the directory repo).
  ["lastround", "ats-directory.csv", "https://datahub.io/lastroundai-hiring-data/lastroundai-hiring-data/_r/-/ats-directory/lastroundai-ats-company-directory-2026-08.csv"],
  ...["ashby", "greenhouse", "lever", "workday"].map((f): [string, string, string] => ["feashliaa", `${f}_companies.json`, `${GH}/Feashliaa/job-board-aggregator/HEAD/data/${f}_companies.json`]),
  ...["ashby", "greenhouse", "lever", "workday"].map((f): [string, string, string] => ["upstreamit", `${f}.json`, `${GH}/ElliotGbaum/upstreamit/HEAD/data/slugs/${f}.json`]),
];

async function main() {
  let failed = 0;
  for (const [folder, name, url] of FILES) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "RawJobs-catalog/0.1 (open-source job radar)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      mkdirSync(join(here, "raw", folder), { recursive: true });
      writeFileSync(join(here, "raw", folder, name), body);
      console.error(`  ${folder}/${name}  ${(body.length / 1024).toFixed(0)} KB`);
    } catch (err) {
      failed++;
      console.error(`! ${folder}/${name}: ${(err as Error).message} (${url})`);
      // In the rebuild: say so on the run page, since merge then uses last week's copy (if saved) or none.
      if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Source list::${folder}/${name} didn't download (${(err as Error).message}); using last week's copy if there is one.`);
    }
  }
  console.error(failed ? `Done, ${failed} of ${FILES.length} failed (merge skips missing files).` : `Done: ${FILES.length} files.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
