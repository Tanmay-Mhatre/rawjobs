/**
 * Download the government lists of employers allowed to sponsor work visas, and keep each one as
 * normalised names in scripts/catalog/raw/visa/<country>.json (small; kept in the catalog's saved
 * state, so a failed download uses last week's copy). publish.ts matches them to directory companies.
 *
 *   pnpm catalog:visa [--only GB,US] [--match]   (--match: also print the matches against out/directory.json)
 *
 * Registers, and their terms (docs/shared-directory.md):
 *   GB  Home Office, Register of licensed sponsors: workers (Open Government Licence v3.0); work routes only
 *   US  USCIS H-1B Employer Data Hub (US government work, public domain): last two fiscal years, employers
 *       with at least one new or continuing approval
 *   CA  ESDC, Positive LMIA employers list (Open Government Licence – Canada): last four quarters
 *   NL  IND, Public register of recognised sponsors, work ("Reuse of content is allowed, if you mention
 *       the source": ind.nl/en/proclaimer)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { VisaCountry } from "@rawjobs/core/catalog/visa";
import { catalogDir } from "./lib/paths";
import { addNames, caEmployers, matchVisa, nlEmployers, readXlsx, type RegisterFile, ukEmployers, usEmployers } from "./lib/visa";

const UA = { "user-agent": "RawJobs-catalog/0.1 (open-source job radar; github.com/Tanmay-Mhatre/rawjobs)" };
const OUT = join(catalogDir, "raw", "visa");

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(4 * 60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

const today = () => new Date().toISOString();

async function uk(): Promise<RegisterFile> {
  const page = (await (await get("https://www.gov.uk/api/content/government/publications/register-of-licensed-sponsors-workers")).json()) as {
    details?: { attachments?: { url?: string; content_type?: string }[] };
    public_updated_at?: string;
  };
  const url = page.details?.attachments?.find((a) => a.url?.endsWith(".csv"))?.url;
  if (!url) throw new Error("no CSV on the register's page");
  const { rows, names } = ukEmployers(await (await get(url)).text());
  const period = /(\d{4}-\d{2}-\d{2})\.csv$/.exec(url)?.[1] ?? page.public_updated_at?.slice(0, 10) ?? today().slice(0, 10);
  const out: Record<string, string> = {};
  addNames(out, names, period);
  return { country: "GB", period, fetched_at: today(), rows, names: out };
}

/** The Data Hub's own export (its "Crosstab View"), one fiscal year at a time. */
const H1B = "https://bigdataanalyticspub-sb.uscis.dhs.gov/views/H1BEmployerDataHub-Final/H1BPublic.csv?Fiscal%20Year%20%20%20=";

async function us(): Promise<RegisterFile> {
  // US fiscal years start on 1 October: FY2027 runs Oct 2026 – Sep 2027. Its data comes a quarter later.
  const now = new Date();
  const current = now.getUTCFullYear() + (now.getUTCMonth() >= 9 ? 1 : 0);
  const out: Record<string, string> = {};
  const years: number[] = [];
  let rows = 0;
  for (let y = current; y >= current - 3 && years.length < 2; y--) {
    const got = usEmployers(await (await get(`${H1B}${y}`)).text(), y);
    console.error(`  US FY${y}: ${got.rows} employers, ${got.names.length} with approvals`);
    if (!got.names.length) continue;
    years.push(y);
    rows += got.rows;
    addNames(out, got.names, `FY${y}`);
  }
  if (!years.length) throw new Error("no fiscal year with approvals");
  return { country: "US", period: `FY${years[0]}`, fetched_at: today(), rows, names: out };
}

async function ca(): Promise<RegisterFile> {
  const pkg = (await (await get("https://open.canada.ca/data/api/action/package_show?id=90fed587-1364-4f33-a9ee-208181dc0b97")).json()) as {
    result: { resources: { name?: string; name_translated?: { en?: string }; language?: string[]; url: string }[] };
  };
  const quarters = pkg.result.resources
    .map((r) => ({ q: /^(\d{4}Q[1-4])/.exec(r.name_translated?.en ?? r.name ?? "")?.[1], r }))
    .filter((x): x is { q: string; r: (typeof pkg.result.resources)[number] } => !!x.q && !!x.r.language?.includes("en") && /\.xlsx$/i.test(x.r.url))
    .sort((a, b) => b.q.localeCompare(a.q))
    .slice(0, 4);
  if (!quarters.length) throw new Error("no quarterly lists found");
  const out: Record<string, string> = {};
  let rows = 0;
  for (const { q, r } of quarters) {
    const got = caEmployers(readXlsx(Buffer.from(await (await get(r.url)).arrayBuffer())));
    console.error(`  CA ${q}: ${got.rows} rows, ${got.names.length} outside primary agriculture`);
    rows += got.rows;
    addNames(out, got.names, q);
  }
  return { country: "CA", period: quarters[0]!.q, fetched_at: today(), rows, names: out };
}

async function nl(): Promise<RegisterFile> {
  const { rows, names, updated } = nlEmployers(await (await get("https://ind.nl/en/public-register-recognised-sponsors/public-register-work")).text());
  const period = updated ?? today().slice(0, 10);
  const out: Record<string, string> = {};
  addNames(out, names, period);
  return { country: "NL", period, fetched_at: today(), rows, names: out };
}

const REGISTERS: Record<VisaCountry, () => Promise<RegisterFile>> = { GB: uk, US: us, CA: ca, NL: nl };

async function main() {
  const onlyArg = process.argv.indexOf("--only");
  const only = onlyArg > 0 ? process.argv[onlyArg + 1]!.toUpperCase().split(",") : Object.keys(REGISTERS);
  mkdirSync(OUT, { recursive: true });
  let failed = 0;
  for (const country of only as VisaCountry[]) {
    const fetcher = REGISTERS[country];
    if (!fetcher) continue;
    try {
      const reg = await fetcher();
      writeFileSync(join(OUT, `${country}.json`), JSON.stringify(reg));
      console.error(`  ${country}: ${reg.rows} rows -> ${Object.keys(reg.names).length} names (list ${reg.period})`);
    } catch (err) {
      failed++;
      console.error(`! ${country}: ${(err as Error).message}`);
      if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Visa register::${country} didn't download (${(err as Error).message}); using last week's copy if there is one.`);
    }
  }
  if (process.argv.includes("--match")) {
    const dir = join(catalogDir, "out", "directory.json");
    const companies = existsSync(dir) ? (JSON.parse(readFileSync(dir, "utf8")) as { companies: { key: string; name: string }[] }).companies : [];
    const regs = (Object.keys(REGISTERS) as VisaCountry[]).flatMap((c) => (existsSync(join(OUT, `${c}.json`)) ? [JSON.parse(readFileSync(join(OUT, `${c}.json`), "utf8")) as RegisterFile] : []));
    const { stats } = matchVisa(companies, regs);
    console.table(stats);
  }
  console.error(failed ? `Done, ${failed} register(s) failed (publish uses the copies already here).` : "Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
