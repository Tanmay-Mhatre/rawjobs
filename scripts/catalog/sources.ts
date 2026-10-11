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

const here = dirname(fileURLToPath(import.meta.url));
const GH = "https://raw.githubusercontent.com";

/** [folder, file name, URL] */
const FILES: [string, string, string][] = [
  ["latmay", "ats_career_page_urls.csv", "https://huggingface.co/datasets/latmay/ats-career-page-urls/resolve/main/ats_career_page_urls.csv"],
  ...["ashby", "greenhouse", "lever", "smartrecruiters", "workday"].map((f): [string, string, string] => ["kalil0321", `${f}.csv`, `${GH}/kalil0321/ats-scrapers/HEAD/ats-companies/${f}.csv`]),
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
