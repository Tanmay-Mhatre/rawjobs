import type { EmploymentType } from "./catalog/employment";
import type { VisaInfo } from "./catalog/visa";
import { z } from "zod";

export const ATS_TYPES = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workday",
  "workable",
  "recruitee",
  "personio",
  "bamboohr",
  "breezy",
  // Added after the first five; each has a connector now (see connectors/index.ts).
  "successfactors",
  "teamtailor",
  "comeet",
  "oracle",
  "icims",
  "taleo",
  "jobvite",
  "pinpoint",
  "rippling",
  "jazzhr",
  "zoho",
  "hibob",
  "freshteam",
  "join",
  "paylocity",
  "paycom",
  "hireology",
  "ukg",
  "eightfold",
  "phenom",
  "careerplug",
  "dayforce",
  "adp",
  "applicantpro",
  "paycor",
  "hiringthing",
  "manatal",
  "trakstar",
  "factorial",
  "gem",
  "hrmdirect",
  "softgarden",
  "cornerstone",
  "keka",
  "taleobe",
  "jobscore",
] as const;

/**
 * Public job boards with a free API, added like a company ("Add by link"). Their jobs are fetched on
 * your own computer, credited to the board and linked back to it; they're never shared, put in the
 * directory or the job feed (so the catalog only ever works with ATS_TYPES).
 */
export const JOB_BOARDS = ["hackernews", "remotive", "arbeitnow", "remoteok", "himalayas", "jobicy", "weworkremotely", "remotefirstjobs"] as const;

export type AtsType = (typeof ATS_TYPES)[number] | (typeof JOB_BOARDS)[number];

export type Workplace = "onsite" | "hybrid" | "remote" | "unknown";

export type Salary = { min?: number; max?: number; currency?: string; period?: string };

/** Why a job got its score. Every number is the points awarded for that part. */
/**
 * How a score was made. Points out of: title 30, location 20, keywordPoints 40, industry 10.
 * score = round((title + location + keywordPoints + industry) * (scale ?? 1)).
 */
export type ScoreBreakdown = {
  title: number;
  location: number;
  keywords: string[];
  /** Topic points, 0..40: share of the profile's topic weight matched (min(total, 12) fills it). */
  keywordPoints: number;
  /** Industry points: 10 your industry or your company, 5 not known, 0 another industry. Missing on jobs scored before it existed. */
  industry?: number;
  /** Older scores only: points for being recent (10/6/2), now part of the Radar's order instead. */
  freshness?: number;
  /**
   * Set (100/60) when the profile has no topics: title + location + industry, out of 60, are
   * scaled to 0..100 and there's no topic part. The other fields stay raw points.
   */
  scale?: number;
  /** Set when the job failed a gate and was scored 0. */
  gate?: "title" | "location";
  /** Why the location didn't fit, when it's worth saying (e.g. "Remote, but only in India…"). */
  locationNote?: string;
  /**
   * Your dealbreakers the job breaks, in plain words ("Pay below your floor: up to AED 18k vs your 25k a month").
   * When set, the score is halved and kept under min_score.
   */
  dealbreakers?: string[];
};

/** The one shape every connector produces. */
export type Job = {
  /** "{ats}:{slug}:{atsJobId}", stable across runs. */
  id: string;
  ats: AtsType;
  company: string;
  title: string;
  location: string;
  country?: string;
  workplace: Workplace;
  department?: string;
  salary?: Salary;
  /** Full-time, part-time, contract, internship or temporary, when the hiring system says (catalog/employment.ts). */
  employmentType?: EmploymentType;
  /** From the ATS when available (ISO 8601). */
  postedAt?: string;
  /** Apply / job page on the company's own careers site. */
  url: string;
  /** Plain text, used for scoring. */
  description?: string;
  firstSeen: string;
  lastSeen: string;
  /** closed = missing from 2 successful runs of its company in a row (see diff.ts). */
  status: "open" | "closed";
  /** Successful runs of this company in a row that didn't list the job. */
  missedRuns?: number;
  closedAt?: string;
  /**
   * When this job came back under a new id: the same title and place at the same company, taken down
   * and posted again. It keeps the old one's dates (see diff.ts), so a repost never looks new.
   */
  repostedAt?: string;
  /** How many times it was taken down and posted again (repostedAt is the last); older saves only have repostedAt. */
  repostCount?: number;
  /**
   * The date the board itself gave on the last scan, when it's later than postedAt: a board that
   * refreshes its date, so a months-old job looks freshly posted (postedAt only moves earlier).
   */
  boardPostedAt?: string;
  score: number;
  why: ScoreBreakdown;
};

/** What a connector's normalize() returns; RawJobs fills in the rest. */
export type NormalizedJob = Omit<Job, "firstSeen" | "lastSeen" | "status" | "missedRuns" | "closedAt" | "score" | "why">;

// ---------- run output (data/ files, read by the dashboard) ----------

export type CompanyHealth = {
  company: string;
  ats: AtsType;
  slug: string;
  /** jobCompanyKey() of the company: the prefix of its job ids. Older runs don't have it. */
  key?: string;
  ok: boolean;
  jobsFound: number;
  /** Jobs that passed the title and location gates. */
  matches: number;
  durationMs: number;
  error?: string;
  /** Recognised ATS whose connector isn't built yet; not a failure of the company. */
  unsupported?: boolean;
  /** Postings the hiring system sent that couldn't be read (left out; the rest still count). */
  skipped?: number;
  /** Job pages that failed to load, so those jobs have no description. */
  describeFailed?: number;
  /** The list was cut short (a page cap): its unseen jobs stay open instead of counting as gone. */
  partial?: boolean;
  /** On a partial list: jobs past the cap that the board's search for your titles found (see searchTerms in run.ts). */
  searchFound?: number;
  /**
   * What kind of failure, for resting the board (board-health.ts): "gone" only for a definite answer
   * (404, 410 or the hiring system saying the board is closed); "parse" when our connector couldn't
   * read the answer (not the board's fault). Absent when no request was made.
   */
  failure?: "gone" | "timeout" | "server" | "network" | "parse" | "other";
  /** A hash of the board's job ids, when its whole list was read: board-health.ts notes when it changes. */
  idsHash?: string;
};

export type RunSummary = {
  startedAt: string;
  finishedAt: string;
  /** Run limited to some companies with --only. */
  partial: boolean;
  jobsFound: number;
  matches: number;
  /** Matches seen for the first time in this run. */
  newMatches: number;
  closed: number;
  /** Companies beyond yours checked live this run (their health is in `health` too). */
  checked?: number;
  health: CompanyHealth[];
  /** Your companies whose board was gone, and the directory board with the same name: suggestions to review, never applied. */
  moves?: BoardMove[];
  /** Every company in the directory was checked by this run (a background check or full scan that finished). */
  everyCompany?: boolean;
};

/** A company whose board is gone (404), and a live directory board with the same name that may be its new one. */
export type BoardMove = {
  name: string;
  from: CompanyRef;
  to: CompanyRef;
  /** When RawJobs checked and accepted this move for everyone (the directory's `moves` list); absent for a same-name guess. */
  checked_at?: string;
};

/** data/jobs.json */
/** data/history.json: every job ever seen, as merge needs it (internal). */
export type JobsFile = { version: 1; generatedAt: string; jobs: Job[] };

/** A job as the dashboard gets it: no description (that's in descriptions.json), plus derived fields. */
export type DashboardJob = Omit<Job, "description" | "missedRuns"> & {
  /** Countries the location names ("United Arab Emirates"); empty when it names none. */
  countries: string[];
  /** Cities the location names, as "City, Country" ("Dubai, United Arab Emirates"). */
  cities: string[];
  seniority: "leadership" | "principal" | "senior" | "mid" | "entry";
  /** Same company + same title: postings of one role in several places share it. */
  group: string;
  /** A description is stored (descriptions.json). */
  hasDescription: boolean;
  /** Characters in the stored description, when there is one: a very short one is a sign of a stale posting. */
  descriptionLength?: number;
  /**
   * From the shared weekly index, not checked live (data/discover.json): no description, so the score
   * is an estimate (title, location, industry and topics in the title), and `url` is the company's careers page.
   */
  estimated?: boolean;
  /** Directory key of the job's company ("ats:slug"); set on index jobs. */
  companyKey?: string;
  /**
   * The company's key when the directory knows this board is one of several boards of the same company
   * (`same_as`: same name and the same job titles, or an accepted move). The Radar groups by it.
   */
  identity?: string;
  /** Industry ids the company directory puts the job's company in. */
  industries?: string[];
  /** Visa sponsor registers the job's company is on (country code -> list), from the company directory. */
  visa?: VisaInfo;
  /** The company is opening far more roles than usual (activity.ts isSurge): new roles in the last 30 days, and its usual 30 days. */
  surge?: { n: number; usual: number };
};

/** data/jobs.json (jobs that pass your filters) and data/jobs-other.json (the rest). */
export type DashboardJobsFile = { version: 2; generatedAt: string; jobs: DashboardJob[] };

/** data/meta.json */
export type DataMeta = {
  version: 1;
  generatedAt: string;
  profile: Profile;
  companies: { name: string; ats: AtsType; slug: string; enabled: boolean; careers_url?: string /** Industry ids from the company directory. */; industries?: string[] }[];
  /** Newest first, capped. */
  runs: RunSummary[];
  /** Some company has enough hiring records to compare with (data/activity.json `ready`): the surge filter shows. */
  hiringReady?: boolean;
  /**
   * Your companies whose board is failing, by companyKey(), with when the failures started
   * (board-health.json): the streak outlasts the capped runs above.
   */
  boardHealth?: Record<string, { since: string }>;
};

// ---------- config ----------

const term = z.string().trim().min(1);
const terms = z.array(term);

export const CompanySchema = z
  .object({
    name: z.string().trim().min(1),
    ats: z.enum([...ATS_TYPES, ...JOB_BOARDS]),
    /** Board token / site / company id, as it appears in the careers URL. Workday: the tenant. */
    slug: term,
    /** Lever and Greenhouse host region. */
    region: z.enum(["global", "eu"]).optional(),
    /** Where the board lives: Workday "wd3", Oracle data centre "ocs", SuccessFactors host "career2.successfactors.eu". */
    shard: term.optional(),
    /** The career site within the company: Workday "External", Oracle "CX_1", Taleo section, Zoho page, Comeet company name. */
    site: term.optional(),
    /** Optional link to the public careers page, for your reference. */
    careers_url: z.url().optional(),
    enabled: z.boolean().default(true),
  })
  .superRefine((c, ctx) => {
    if (c.ats === "workday" && (!c.shard || !/^wd\d+$/.test(c.shard) || !c.site)) {
      ctx.addIssue({
        code: "custom",
        message: `${c.name}: workday companies need "shard" (e.g. wd3) and "site" (e.g. External) from the careers URL`,
      });
    }
    if (c.ats === "oracle" && !c.shard) {
      ctx.addIssue({ code: "custom", message: `${c.name}: oracle companies need "shard" (the data centre, e.g. "ocs") from the careers URL` });
    }
  });
export type CompanyRef = z.infer<typeof CompanySchema>;

export const ProfileSchema = z.object({
  name: z.string().default("My profile"),
  titles: z.object({
    include: terms.min(1, "add at least one title to titles.include"),
    exclude: terms.default([]),
  }),
  seniority_boost: terms.default([]),
  locations: z.object({
    include: terms.default([]),
    remote_ok: terms.default([]),
    /** Remote regions you can't work from, e.g. "us", "canada". Blocks a remote match, never a city match. */
    remote_exclude: terms.default([]),
    /** Office jobs (in `include` places) you'll take: "onsite", "hybrid". Empty = both. Remote jobs follow remote_ok. */
    workplace: z.array(z.enum(["onsite", "hybrid"])).default([]),
  }),
  /** Industry ids you want to work in (see catalog/industries.ts); used to suggest companies. */
  industries: z.array(z.string().trim().toLowerCase().min(1)).default([]),
  /** Companies you've worked at (from your resume, confirmed by you); used to suggest similar companies. */
  past_employers: z.array(z.string().trim().min(1)).max(20).default([]),
  /** keyword -> weight 1..5, matched as whole words in title + description. */
  keywords: z.record(term, z.number().int().min(1).max(5)).default({}),
  min_score: z.number().int().min(0).max(100).default(70),
  // Dealbreakers (dealbreakers.ts). Each is optional: left out, nothing is checked. A job that breaks one
  // keeps showing, with the reason, but its score is halved and kept under min_score.
  /** The lowest base pay you'd take. A posted range that tops out more than 5% under it is a dealbreaker. */
  salary_floor: z
    .object({
      amount: z.number().positive(),
      currency: z.string().trim().toUpperCase().length(3, "currency: a 3-letter code such as EUR, USD or AED"),
      period: z.enum(["year", "month"]).default("year"),
    })
    .optional(),
  /**
   * Countries you can work in without a visa sponsor ("united kingdom"; "eu" for the EU/EEA). A job that
   * won't sponsor, in a country not listed, is a dealbreaker. ["none"] if you need sponsorship everywhere.
   */
  work_authorization: terms.optional(),
  /** Work you won't do ("frontend", "credit risk"): a job whose title, or the role it describes, is about one is a dealbreaker. */
  avoid: terms.optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ConfigSchema = z
  .object({
    profile: ProfileSchema,
    /** Empty is allowed: setup saves your profile first, companies are added afterwards. */
    companies: z.array(CompanySchema).default([]),
    /** Companies you never want to see, as "ats:slug" keys (Workday: "workday:tenant|shard|site"). */
    companies_muted: z.array(z.string().trim().toLowerCase().min(1)).default([]),
    alerts: z
      .object({
        telegram: z.boolean().default(false),
        email: z.boolean().default(false),
        only_new: z.boolean().default(true),
      })
      .prefault({}),
    /** The shared company directory: keep the local copy fresh, and share companies you add. */
    directory: z
      .object({
        auto_update: z.boolean().default(true),
        share_additions: z.boolean().default(true),
      })
      .prefault({}),
    /** How scans run: Scan now, then (background) a quiet check of every other company; your industries rank higher (industry_boost). */
    scans: z
      .object({
        background: z.boolean().default(true),
        industry_boost: z.boolean().default(true),
      })
      .prefault({}),
  })
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    cfg.companies.forEach((c, i) => {
      const key = `${c.ats}:${c.slug.toLowerCase()}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", path: ["companies", i], message: `duplicate company ${key}` });
      }
      seen.add(key);
    });
  });
export type Config = z.infer<typeof ConfigSchema>;
