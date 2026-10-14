/**
 * Invented demo data for the design screenshot harness (scripts/design/shots.ts).
 *
 * Nothing here comes from a real install: no personal config, resume, profile/ or data/ folder is read.
 * Company names are fictional; links point at example.com. Scores and "why" breakdowns are made by the
 * real core scoring (scoreJob + toDashboardJob), so the dashboard shows realistic numbers.
 * Every date is relative to the fixed NOW, so screenshots are stable from run to run.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  companyKey,
  parseConfig,
  ROLE_FAMILIES,
  scoreJob,
  toDashboardJob,
  type AtsType,
  type CompanyHealth,
  type Config,
  type DashboardJob,
  type DashboardJobsFile,
  type DataMeta,
  type Job,
  type RunSummary,
  type Salary,
  type Workplace,
} from "@rawjobs/core";

/** The page's clock is frozen here too. */
export const NOW = new Date("2026-06-15T09:00:00.000Z");
const DAY = 86_400_000;
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const daysAgo = (d: number) => iso(NOW.getTime() - d * DAY);

// ---------- config: the public example, with fictional companies ----------

/** `visa`: on a government visa sponsor register (the directory's field): its UK jobs show "Sponsors visas". */
type DemoCompany = { name: string; ats: AtsType; slug: string; industries: string[]; visa?: Record<string, string> };

/** Your companies (the demo config's watchlist). */
export const MY_COMPANIES: DemoCompany[] = [
  { name: "Northwind Payments", ats: "greenhouse", slug: "northwindpay", industries: ["payments", "fintech"], visa: { GB: "2026-06-08" } },
  { name: "TideWave", ats: "lever", slug: "tidewave", industries: ["fintech", "digital-bank"] },
  { name: "Acme Ledger", ats: "ashby", slug: "acmeledger", industries: ["payments"], visa: { GB: "2026-06-08", US: "FY2026" } },
  { name: "Brightpath Bank", ats: "greenhouse", slug: "brightpathbank", industries: ["digital-bank", "lending"] },
  /** Dormant: scanned fine every day, never anything for you (the "remove?" flag). */
  { name: "Quillfeather", ats: "workable", slug: "quillfeather", industries: ["fintech"] },
  /** Broken: its board stopped answering three scans ago. */
  { name: "Larkspur Labs", ats: "lever", slug: "larkspurlabs", industries: ["payments"] },
  /** Chronic: its board hasn't answered for over a month (board-health's record outlasts the saved scans). */
  { name: "Ospreyline", ats: "ashby", slug: "ospreyline", industries: ["fintech"] },
];

/** Directory companies (not yours): estimated jobs, suggestions, Browse all. */
export const DIRECTORY_COMPANIES: (DemoCompany & { open_jobs: number; status?: "live" | "dormant" | "unverified" })[] = [
  { name: "Copperkettle Pay", ats: "greenhouse", slug: "copperkettle", industries: ["payments"], open_jobs: 48 },
  { name: "Fernhill Ledger", ats: "ashby", slug: "fernhill", industries: ["fintech"], open_jobs: 22 },
  { name: "Halcyon Clearing", ats: "lever", slug: "halcyonclearing", industries: ["payments", "trading-tech"], open_jobs: 61 },
  { name: "Mosswood Bank", ats: "greenhouse", slug: "mosswoodbank", industries: ["digital-bank", "banking"], open_jobs: 35 },
  { name: "Pebblestone Capital", ats: "smartrecruiters", slug: "pebblestonecapital", industries: ["brokerage", "trading-tech"], open_jobs: 17 },
  { name: "Quayside Markets", ats: "ashby", slug: "quaysidemarkets", industries: ["trading-tech"], open_jobs: 12 },
  { name: "Thistle Finance", ats: "workable", slug: "thistlefinance", industries: ["lending", "fintech"], open_jobs: 9 },
  { name: "Saltmarsh Labs", ats: "lever", slug: "saltmarshlabs", industries: ["payments", "devtools"], open_jobs: 14 },
  { name: "Juniper Remit", ats: "greenhouse", slug: "juniperremit", industries: ["payments"], open_jobs: 26 },
  { name: "Kestrel Insure", ats: "recruitee", slug: "kestrelinsure", industries: ["insurtech"], open_jobs: 7 },
  { name: "Lumen Treasury", ats: "personio", slug: "lumentreasury", industries: ["fintech"], open_jobs: 0, status: "dormant" },
  { name: "Marigold Wallet", ats: "bamboohr", slug: "marigoldwallet", industries: ["payments", "crypto"], open_jobs: 11 },
  { name: "Wrenfield Assurance", ats: "icims", slug: "wrenfield", industries: ["insurtech"], open_jobs: null as unknown as number, status: "unverified" },
];

const careers = (slug: string) => `https://careers.example.com/${slug}`;

function demoConfig(): Config {
  const example = parseConfig(readFileSync(resolve(import.meta.dirname, "../../rawjobs.config.example.yaml"), "utf8"), "rawjobs.config.example.yaml");
  return {
    ...example,
    profile: {
      ...example.profile,
      industries: ["payments", "fintech"],
      past_employers: ["Saltmarsh Labs", "Halcyon Clearing"],
    },
    companies: MY_COMPANIES.map((c) => ({ name: c.name, ats: c.ats, slug: c.slug, careers_url: careers(c.slug), enabled: true })),
    alerts: { ...example.alerts, telegram: true },
  };
}

export const CONFIG = demoConfig();
const PROFILE = CONFIG.profile;

// ---------- jobs ----------

type Spec = {
  company: string;
  title: string;
  location: string;
  workplace: Workplace;
  /** Posted this many days before NOW. */
  posted: number;
  /** First seen this many days before NOW (default: the scan after it was posted). "new" = in the latest scan. */
  seen?: number | "new";
  salary?: Salary;
  department?: string;
  /** Description paragraphs (scored for topics). */
  desc?: string;
  /** Second posting of the same role. */
  id?: string;
  /** What the hiring system says (Lever's commitment, Ashby's employmentType…). */
  employment?: Job["employmentType"];
};

const SCAN_AT = NOW.getTime() - 3 * HOUR;

const DESC = {
  payments: `About the team
The Payments Platform team builds the APIs that move money for thousands of B2B merchants across Europe. You'll own the roadmap for card acquiring, payouts and reconciliation.

What you'll do
- Set the strategy for our payments platform and turn it into a clear, sequenced roadmap.
- Work with engineering on API design, reliability and developer experience.
- Partner with compliance and risk so new markets launch safely.
- Talk to merchants every week and bring what you learn back to the team.

What you'll bring
- Several years of product management in fintech or payments.
- Comfort with technical detail: APIs, ledgers, settlement flows.
- A track record of shipping B2B products that customers love.`,
  openBanking: `TideWave is building the account-to-account payments network for Europe. As Head of Product you'll lead four product teams across open banking, fintech partnerships and our developer platform.

You'll hire and grow product managers, shape our API strategy and work closely with the founders on what we build next. Experience with payments or open banking APIs is a must.`,
  infra: `Acme Ledger runs the payments infrastructure behind modern finance teams. We're hiring a Director of Product to lead our ledger, payouts and API platform groups.

You'll set direction for a platform used by B2B fintech companies, partner with compliance on licensing, and grow a team of six product managers.`,
  merchant: `Lead the merchant experience group: onboarding, dashboard and the B2B billing tools merchants use every day. You'll run three squads and work on our payments platform roadmap with engineering and design.`,
  risk: `Own our risk and compliance products: transaction monitoring, KYC flows and the internal tooling our operations team uses. You'll work with a public API and with regulators' requirements.`,
  devPlatform: `Our developer platform serves thousands of integrators. You'll own SDKs, API docs, sandbox environments and the platform's public status page.`,
  growth: `Drive acquisition and activation for our B2B accounts. You'll run experiments across sign-up, onboarding and pricing pages.`,
  billing: `Own billing and invoicing for our customers: usage metering, invoices and dunning. You'll partner with finance and engineering on a new pricing platform.`,
  internal: `Own the tools our support and operations teams use every day. You'll work with a small engineering team on case management and reporting.`,
  lending: `Brightpath is a fintech lender. You'll lead our lending products for small businesses, from application to repayment, working closely with credit risk and compliance.`,
  mobile: `Own the Brightpath mobile app: onboarding, everyday banking and notifications. You'll work with iOS and Android engineers and our design team.`,
  cards: `Own card issuing for our customers: physical and virtual cards, spending controls and the card API.`,
} as const;

const LIVE: Spec[] = [
  // Northwind Payments
  {
    company: "Northwind Payments",
    title: "Senior Product Manager, Payments Platform",
    location: "London, United Kingdom",
    workplace: "hybrid",
    posted: 1,
    seen: "new",
    salary: { min: 95000, max: 115000, currency: "GBP", period: "year" },
    department: "Product",
    desc: DESC.payments,
    employment: "full-time",
  },
  {
    company: "Northwind Payments",
    title: "Group Product Manager, Merchant Experience",
    location: "London, United Kingdom",
    workplace: "hybrid",
    posted: 4,
    seen: 4,
    salary: { min: 120000, max: 140000, currency: "GBP", period: "year" },
    desc: DESC.merchant,
  },
  { company: "Northwind Payments", title: "Product Manager, Risk & Compliance", location: "Remote - Europe", workplace: "remote", posted: 12, seen: 12, desc: DESC.risk },
  { company: "Northwind Payments", title: "Product Manager, Card Issuing", location: "London, United Kingdom", workplace: "onsite", posted: 7, seen: 7, desc: DESC.cards, id: "a" },
  { company: "Northwind Payments", title: "Product Manager, Card Issuing", location: "Manchester, United Kingdom", workplace: "onsite", posted: 7, seen: 7, desc: DESC.cards, id: "b" },
  // TideWave
  {
    company: "TideWave",
    title: "Head of Product, Open Banking",
    location: "London, United Kingdom",
    workplace: "hybrid",
    posted: 2,
    seen: "new",
    salary: { min: 150000, max: 175000, currency: "GBP", period: "year" },
    desc: DESC.openBanking,
    employment: "full-time",
  },
  {
    company: "TideWave",
    title: "Product Manager, Developer Platform",
    location: "Remote (EMEA)",
    workplace: "remote",
    posted: 6,
    seen: 6,
    desc: DESC.devPlatform,
    // An hourly contract in another currency: the salary sort puts it after the pounds and euros, by its yearly figure.
    salary: { min: 85, max: 110, currency: "USD", period: "hour" },
    employment: "contract",
  },
  { company: "TideWave", title: "Senior Product Manager, Growth", location: "London, United Kingdom", workplace: "hybrid", posted: 20, seen: 20, desc: DESC.growth },
  { company: "TideWave", title: "Product Manager, Payments", location: "Remote (US)", workplace: "remote", posted: 5, seen: 5, desc: DESC.payments },
  // Acme Ledger
  { company: "Acme Ledger", title: "Director of Product, Payments Infrastructure", location: "London, United Kingdom", workplace: "hybrid", posted: 0, seen: "new", desc: DESC.infra },
  {
    company: "Acme Ledger",
    title: "Product Lead, Billing",
    location: "Remote, Europe",
    workplace: "remote",
    posted: 9,
    seen: 9,
    salary: { min: 90000, max: 105000, currency: "EUR", period: "year" },
    desc: DESC.billing,
  },
  { company: "Acme Ledger", title: "Product Manager, Internal Tools", location: "London, United Kingdom", workplace: "onsite", posted: 45, seen: 45, desc: DESC.internal },
  { company: "Acme Ledger", title: "Product Marketing Manager", location: "London, United Kingdom", workplace: "hybrid", posted: 3, seen: 3 },
  // Brightpath Bank
  { company: "Brightpath Bank", title: "Senior Product Manager, Lending", location: "London, United Kingdom", workplace: "hybrid", posted: 3, seen: 3, desc: DESC.lending },
  { company: "Brightpath Bank", title: "Product Manager, Mobile App", location: "London, United Kingdom", workplace: "onsite", posted: 25, seen: 25, desc: DESC.mobile },
  { company: "Brightpath Bank", title: "Associate Product Manager", location: "London, United Kingdom", workplace: "onsite", posted: 2, seen: 2 },
];

/** From the shared directory index: no description, so the score is an estimate. */
const ESTIMATED: Spec[] = [
  { company: "Copperkettle Pay", title: "Senior Product Manager, Checkout", location: "London, United Kingdom", workplace: "hybrid", posted: 3 },
  { company: "Copperkettle Pay", title: "Product Manager, Payouts", location: "Remote - Europe", workplace: "remote", posted: 8 },
  { company: "Fernhill Ledger", title: "Head of Product", location: "London, United Kingdom", workplace: "hybrid", posted: 5 },
  { company: "Halcyon Clearing", title: "Product Manager, Settlement", location: "London, United Kingdom", workplace: "onsite", posted: 2 },
  { company: "Halcyon Clearing", title: "Principal Product Manager", location: "Remote (EMEA)", workplace: "remote", posted: 14 },
  { company: "Mosswood Bank", title: "Product Manager, Cards", location: "Manchester, United Kingdom", workplace: "hybrid", posted: 10 },
  { company: "Pebblestone Capital", title: "Senior Product Manager, Trading", location: "London, United Kingdom", workplace: "hybrid", posted: 6 },
  { company: "Quayside Markets", title: "Product Lead, Data", location: "Remote - Europe", workplace: "remote", posted: 18 },
  { company: "Thistle Finance", title: "Product Manager", location: "Edinburgh, United Kingdom", workplace: "onsite", posted: 21 },
];

const companyOf = (name: string) => [...MY_COMPANIES, ...DIRECTORY_COMPANIES].find((c) => c.name === name)!;
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function fullJob(s: Spec, n: number): Job {
  const c = companyOf(s.company);
  const postedAt = NOW.getTime() - s.posted * DAY - 2 * HOUR;
  const firstSeen = s.seen === "new" ? SCAN_AT : s.seen !== undefined ? NOW.getTime() - s.seen * DAY - 3 * HOUR : postedAt;
  const atsId = String(4100 + n);
  const base = {
    title: s.title,
    location: s.location,
    workplace: s.workplace,
    description: s.desc,
    postedAt: iso(postedAt),
  };
  const { score, why } = scoreJob(base, PROFILE, { tracked: true });
  return {
    id: `${c.ats}:${c.slug}:${atsId}`,
    ats: c.ats,
    company: c.name,
    title: s.title,
    location: s.location,
    workplace: s.workplace,
    ...(s.department ? { department: s.department } : {}),
    ...(s.salary ? { salary: s.salary } : {}),
    ...(s.employment ? { employmentType: s.employment } : {}),
    postedAt: iso(postedAt),
    url: `${careers(c.slug)}/jobs/${atsId}-${slugify(s.title)}`,
    description: s.desc,
    firstSeen: iso(firstSeen),
    lastSeen: iso(SCAN_AT),
    status: "open",
    score,
    why,
  };
}

const liveFull = LIVE.map(fullJob);
/**
 * A job board's copy of TideWave's Head of Product role, under the company's legal name: one company has
 * that name and posts that role in London, so the Radar shows TideWave's own posting with "Also on Remotive".
 */
const tidewaveLead = liveFull.find((j) => j.title === "Head of Product, Open Banking")!;
const remotiveCopy: Job = {
  ...tidewaveLead,
  id: "remotive:remotive:90001",
  ats: "remotive",
  company: "TideWave Ltd",
  title: "Head of Product - Open Banking",
  url: "https://remotive.example/jobs/90001",
  score: tidewaveLead.score - 1,
};
const liveDash = [...liveFull, remotiveCopy].map((j) => {
  const c = companyOf(j.company);
  const visa = c?.visa;
  return { ...toDashboardJob(j), companyKey: c ? companyKey(c) : "remotive:remotive", ...(visa ? { visa } : {}) };
});
/** Jobs that pass your filters (jobs.json), and the rest (jobs-other.json). */
const passing = liveDash.filter((j) => !j.why.gate);
const failing = liveDash.filter((j) => j.why.gate);

const estimated: DashboardJob[] = ESTIMATED.map((s, i) => {
  const c = companyOf(s.company);
  const { description: _d, ...job } = fullJob(s, 200 + i);
  return {
    ...toDashboardJob(job),
    url: careers(c.slug),
    estimated: true,
    companyKey: companyKey(c),
    industries: c.industries,
    hasDescription: false,
  };
}).filter((j) => !j.why.gate);

// ---------- runs and company health (meta.json) ----------

const RUNS = 14;
function healthFor(c: DemoCompany, run: number): CompanyHealth {
  const key = companyKey(c);
  const base = { company: c.name, ats: c.ats, slug: c.slug, key, durationMs: 800 + ((run * 137 + c.slug.length * 53) % 1400) };
  if (c.slug === "larkspurlabs" && run < 3) return { ...base, ok: false, jobsFound: 0, matches: 0, error: "HTTP 404: the board at jobs.lever.co/larkspurlabs isn't there any more" };
  if (c.slug === "ospreyline") return { ...base, ok: false, jobsFound: 0, matches: 0, error: "timed out after 15s (https://api.ashbyhq.com/posting-api/job-board/ospreyline)" };
  if (c.slug === "quillfeather") return { ...base, ok: true, jobsFound: 4, matches: 0 };
  const mine = passing.filter((j) => j.company === c.name && Date.parse(j.firstSeen) <= SCAN_AT - run * DAY);
  const all = liveDash.filter((j) => j.company === c.name).length;
  return { ...base, ok: true, jobsFound: all + 8 + (run % 3), matches: mine.length };
}

const runs: RunSummary[] = Array.from({ length: RUNS }, (_, i) => {
  const startedAt = SCAN_AT - i * DAY;
  const health = MY_COMPANIES.map((c) => healthFor(c, i));
  const matches = health.reduce((n, h) => n + h.matches, 0);
  return {
    startedAt: iso(startedAt),
    finishedAt: iso(startedAt + 6 * 60_000 + 12_000),
    partial: false,
    jobsFound: health.reduce((n, h) => n + h.jobsFound, 0) + 1240,
    matches: matches + 9,
    newMatches: i === 0 ? 3 : i % 4 === 0 ? 1 : 0,
    closed: i % 5 === 0 ? 1 : 0,
    checked: 30,
    health,
  };
});

export const META: DataMeta = {
  version: 1,
  generatedAt: runs[0]!.finishedAt,
  profile: PROFILE,
  companies: MY_COMPANIES.map((c) => ({ name: c.name, ats: c.ats, slug: c.slug, enabled: true, careers_url: careers(c.slug), industries: c.industries })),
  runs,
  // Ospreyline's failures started before the oldest saved scan.
  boardHealth: { "ashby:ospreyline": { since: iso(SCAN_AT - 41 * DAY) } },
};

const generatedAt = runs[0]!.finishedAt;
export const JOBS: DashboardJobsFile = { version: 2, generatedAt, jobs: passing };
export const JOBS_OTHER: DashboardJobsFile = { version: 2, generatedAt, jobs: failing };
export const INDEX_GENERATED_AT = daysAgo(2);
export const DISCOVER = { version: 1 as const, generatedAt, indexGeneratedAt: INDEX_GENERATED_AT, jobs: estimated };
export const DESCRIPTIONS: Record<string, string> = Object.fromEntries(liveFull.filter((j) => j.description).map((j) => [j.id, j.description!]));

/** The strongest live job (the drawer opens on it). */
export const STRONG_JOB = [...passing].sort((a, b) => b.score - a.score)[0]!;

// ---------- your tracking (localStorage rawjobs.state.v1) ----------

const byTitle = (title: string) => [...passing, ...estimated].find((j) => j.title === title)!;
function entry(title: string, status: string, updatedDaysAgo: number, note?: string) {
  const j = byTitle(title);
  return [j.id, { status, ...(note ? { note } : {}), updatedAt: daysAgo(updatedDaysAgo), snapshot: { title: j.title, company: j.company, url: j.url, location: j.location, score: j.score } }] as const;
}

export const USER_STATE = Object.fromEntries([
  entry(STRONG_JOB.title, "saved", 0.1, "Strong fit. Ask about the payouts roadmap."),
  entry("Senior Product Manager, Lending", "saved", 2),
  entry("Senior Product Manager, Checkout", "saved", 1),
  entry("Head of Product, Open Banking", "applied", 1, "Applied via referral."),
  entry("Product Manager, Developer Platform", "applied", 5),
  entry("Senior Product Manager, Growth", "interviewing", 3, "Second round on Thursday."),
  entry("Group Product Manager, Merchant Experience", "offer", 0.5),
  entry("Product Manager, Internal Tools", "rejected", 12),
  entry("Product Manager, Mobile App", "dismissed", 10),
]);

// ---------- company directory (catalog/directory.json) ----------

export const DIRECTORY = {
  companies: [
    ...MY_COMPANIES.map((c) => ({
      name: c.name,
      ats: c.ats,
      slug: c.slug,
      careers_url: careers(c.slug),
      key: companyKey(c),
      tier: "curated",
      status: c.slug === "quillfeather" ? "dormant" : "live",
      open_jobs: liveDash.filter((j) => j.company === c.name).length + 8,
      indexed: true,
      tags: c.industries,
    })),
    ...DIRECTORY_COMPANIES.map((c) => ({
      name: c.name,
      ats: c.ats,
      slug: c.slug,
      careers_url: careers(c.slug),
      key: companyKey(c),
      tier: c.status === "unverified" ? "dump" : "curated",
      status: c.status ?? "live",
      open_jobs: c.status === "unverified" ? null : c.open_jobs,
      indexed: c.status !== "unverified" && c.open_jobs > 0,
      tags: c.industries,
    })),
  ],
};

// ---------- company suggestions (POST /api/companies/suggest) ----------

function suggestion(name: string, o: { score: number; matches: number; newMatches?: number; examples: string[]; reasons: string[]; topics?: string[] }) {
  const c = DIRECTORY_COMPANIES.find((d) => d.name === name)!;
  return {
    key: companyKey(c),
    name: c.name,
    ats: c.ats,
    slug: c.slug,
    careers_url: careers(c.slug),
    open_jobs: c.status === "unverified" ? null : c.open_jobs,
    tier: "curated",
    score: o.score,
    matches: o.matches,
    new_matches: o.newMatches ?? 0,
    near_misses: Math.max(0, 3 - o.matches),
    elsewhere: 1,
    in_your_places: 4,
    examples: o.examples,
    topics: o.topics ?? ["payments", "platform"],
    industries: c.industries.filter((i) => PROFILE.industries.includes(i)),
    hires_for: [],
    reasons: o.reasons,
  };
}

const hiringNow = [
  suggestion("Copperkettle Pay", {
    score: 92,
    matches: 4,
    newMatches: 2,
    examples: ["Senior Product Manager, Checkout (London)", "Product Manager, Payouts (Remote - Europe)"],
    reasons: ["4 jobs for you", "2 new this week", "In payments"],
  }),
  suggestion("Halcyon Clearing", {
    score: 86,
    matches: 3,
    newMatches: 1,
    examples: ["Product Manager, Settlement (London)", "Principal Product Manager (Remote EMEA)"],
    reasons: ["3 jobs for you", "In payments"],
  }),
  suggestion("Juniper Remit", { score: 78, matches: 2, examples: ["Product Manager, FX (London)"], reasons: ["2 jobs for you", "In payments"] }),
  suggestion("Fernhill Ledger", { score: 71, matches: 1, examples: ["Head of Product (London)"], reasons: ["1 job for you", "In fintech"], topics: ["fintech"] }),
  suggestion("Pebblestone Capital", { score: 64, matches: 1, examples: ["Senior Product Manager, Trading (London)"], reasons: ["1 job for you"], topics: ["platform"] }),
];
const worthWatching = [
  suggestion("Mosswood Bank", { score: 58, matches: 0, examples: ["Product Manager, Cards (Manchester)"], reasons: ["Hires your role in other places", "Team in London"] }),
  suggestion("Marigold Wallet", { score: 52, matches: 0, examples: ["Product Designer (London)"], reasons: ["In payments", "Team in London"] }),
  suggestion("Thistle Finance", { score: 47, matches: 0, examples: ["Product Manager (Edinburgh)"], reasons: ["In fintech"] }),
  suggestion("Quayside Markets", { score: 41, matches: 0, examples: ["Product Lead, Data (Remote - Europe)"], reasons: ["Similar roles nearby"] }),
];
const notScannable = [suggestion("Wrenfield Assurance", { score: 30, matches: 0, examples: [], reasons: ["In your industries", "Its hiring system isn't supported yet"] })];
const saltmarsh = DIRECTORY_COMPANIES.find((c) => c.name === "Saltmarsh Labs")!;

export const SUGGESTIONS = {
  hiringNow,
  worthWatching,
  notScannable,
  scanned: 18_204,
  pastEmployers: [
    {
      name: "Saltmarsh Labs",
      company: { key: companyKey(saltmarsh), name: saltmarsh.name, ats: saltmarsh.ats, slug: saltmarsh.slug, careers_url: careers(saltmarsh.slug), open_jobs: saltmarsh.open_jobs, status: "live" },
      watched: false,
    },
    { name: "Halcyon Clearing", watched: false },
  ],
  lookalikes: [
    {
      seed: "Saltmarsh Labs",
      in_directory: true,
      items: [
        { ...hiringNow[0]!, similarity: 0.82, like: "Saltmarsh Labs" },
        { ...hiringNow[2]!, similarity: 0.74, like: "Saltmarsh Labs" },
        { ...worthWatching[1]!, similarity: 0.66, like: "Saltmarsh Labs" },
      ],
    },
  ],
  packs: [
    { industry: "payments", items: [hiringNow[0]!, hiringNow[1]!, hiringNow[2]!, worthWatching[1]!] },
    { industry: "fintech", items: [hiringNow[3]!, worthWatching[2]!] },
  ],
  coverage: { in_industries: 412, trackable: 287 },
  index_generated_at: INDEX_GENERATED_AT,
  took_ms: 140,
};

// ---------- local API answers ----------

export const RESUME_TEXT = `# Sam Rivera
Senior Product Manager · London, United Kingdom

## Experience
**Senior Product Manager, Payments Platform** · Saltmarsh Labs · 2022 – present
- Led the payments platform roadmap: card acquiring, payouts and reconciliation APIs for B2B merchants.
- Launched instant payouts in 12 European markets with compliance and risk.

**Product Manager, Settlement** · Halcyon Clearing · 2019 – 2022
- Owned settlement and reporting for institutional clients; cut breaks by 40%.

## Skills
Payments, fintech, APIs, platform products, B2B SaaS, compliance.
`;

export const SETUP_STATUS = {
  configPath: "/home/demo/rawjobs/rawjobs.config.local.yaml",
  isPersonal: true,
  valid: true,
  config: CONFIG,
  hasData: true,
  hasResume: true,
};

/** No config yet: the first-run experience. */
export const SETUP_STATUS_FRESH = { configPath: SETUP_STATUS.configPath, isPersonal: false, valid: false, hasData: false, hasResume: true };

export const DIRECTORY_STATUS = {
  local: { version: "2026.06.13", generated_at: daysAgo(2), companies: 18_204, indexed: 9_862, files: {}, updated_at: daysAgo(2) },
  present: true,
  outbox: 0,
  sharing: true,
  age_days: 2,
};

export const SCAN_PLAN = {
  mine: { yours: MY_COMPANIES.length, extra: 259, seconds: 180, resumable: null },
  yours: { yours: MY_COMPANIES.length, extra: 0, seconds: 50, resumable: null },
  all: { yours: MY_COMPANIES.length, extra: 6_790, seconds: 3_900, resumable: null },
};

/** Telegram set up with an obviously fake, masked token. */
export const TELEGRAM_STATUS = { ok: true, token: "000000000:AAA…000", bot: "demo_radar_bot", connected: true, enabled: true, fromEnv: false };

const scheduledRuns = [0, 1, 2, 3].flatMap((d) => [
  {
    startedAt: iso(NOW.getTime() - d * DAY - 1 * HOUR),
    finishedAt: iso(NOW.getTime() - d * DAY - 1 * HOUR + 7 * 60_000),
    scope: "mine",
    ok: true,
    matches: 22 - d,
    newMatches: d === 0 ? 3 : 1,
    notified: "sent",
  },
]);
export const SCHEDULE_STATUS = {
  ok: true,
  installed: true,
  supported: true,
  platform: "win32",
  settings: { times: ["08:00", "18:00"], scope: "mine" },
  nextRun: iso(NOW.getTime() + 9 * HOUR),
  lastRun: scheduledRuns[0],
  runs: scheduledRuns,
};

export const SCAN_DONE = { type: "done", jobsFound: 1312, matches: passing.length, strong: passing.filter((j) => j.score >= PROFILE.min_score).length, newMatches: 3, failed: 1, checked: 30 };

// ---------- the setup wizard's working copy (localStorage rawjobs.setupDraft.v1) ----------

/** The demo config as the wizard's draft (the shape of apps/web/src/lib/setup.ts Draft). */
export function demoDraft(furthestStep = 5) {
  const p = PROFILE;
  const family = ROLE_FAMILIES.map((f) => ({ id: f.id, n: p.titles.include.filter((t) => f.titles.includes(t)).length }))
    .filter((f) => f.n > 0)
    .sort((a, b) => b.n - a.n)[0]?.id;
  return {
    name: p.name,
    include: p.titles.include,
    exclude: p.titles.exclude,
    seniority: p.seniority_boost,
    places: p.locations.include,
    office: ["onsite", "hybrid"],
    remote: p.locations.remote_ok.length > 0,
    remoteOk: p.locations.remote_ok,
    remoteExclude: p.locations.remote_exclude,
    keywords: p.keywords,
    industries: p.industries,
    pastEmployers: p.past_employers,
    companies: CONFIG.companies.map((c, i) => ({ id: `demo${i}`, input: c.careers_url ?? `${c.ats}: ${c.slug}`, state: "saved", name: c.name, ats: c.ats, slug: c.slug })),
    minScore: p.min_score,
    alerts: CONFIG.alerts,
    directory: CONFIG.directory,
    muted: [],
    furthestStep,
    ...(family ? { family } : {}),
  };
}
