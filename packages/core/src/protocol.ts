import type { AtsType, CompanyHealth, Config, DashboardJob } from "./schema";

/**
 * What the CLI and the local API send the dashboard: one definition, used on both sides
 * (`@rawjobs/core/protocol`, no node: imports). The CLI's scan progress is newline-delimited JSON,
 * one RunEvent per line.
 */

/** What a scan covers besides your companies: "mine" = your industries, "all" = the whole directory. */
export type ScanScope = "mine" | "all";

export type SetupStatus = {
  configPath: string;
  /** A personal config file exists. */
  isPersonal: boolean;
  valid: boolean;
  /** Human-readable validation problems when the personal config is broken. */
  errors?: string;
  config?: Config;
  /** Whatever could be parsed from a broken config, for the wizard to prefill from. */
  raw?: unknown;
  /** A run has written data. */
  hasData: boolean;
  /** A master resume is saved (profile/resume.md). */
  hasResume: boolean;
};

export type SaveResult = { ok: true; path: string } | { ok: false; errors: string; issues: { path: string; message: string }[] };

export type CompanyCheck = {
  input: string;
  /**
   * live: board has open jobs · dormant: board exists, no openings right now · soon: recognised
   * ATS, connector not built yet · error: recognised but the feed failed (usually a wrong link) ·
   * unknown: not a careers site we recognise.
   */
  status: "live" | "dormant" | "soon" | "error" | "unknown";
  /** Directory key ("ats:slug"). */
  key?: string;
  name?: string;
  /** Where the name came from: the hiring system itself, our company directory, or the link. */
  name_source?: "ats" | "directory" | "slug";
  ats?: AtsType;
  slug?: string;
  region?: "global" | "eu";
  shard?: string;
  site?: string;
  careers_url?: string;
  open_jobs?: number;
  /** Most common job locations, most frequent first. */
  top_locations?: string[];
  sample_titles?: string[];
  /** Open jobs that pass the user's title and location filters (when a profile is given). */
  matches?: number;
  match_examples?: string[];
  /** Already in the company directory. */
  in_directory?: boolean;
  error?: string;
};

export type RunEvent =
  /** Syncing with the shared company directory (the first step of every scan). */
  | { type: "sync" }
  | { type: "synced"; updated: boolean; offline?: boolean; message: string /** What the shared job feed sync said. */; feed?: string }
  | {
      type: "start";
      /** Your companies, in fetch order. */
      companies: string[];
      /** Everything this scan covers (yours + directory companies), including ones done before a resume. */
      total?: number;
      /** Directory companies beyond yours. */
      extra?: number;
      /** Done by the stopped scan this one resumes. */
      resumed?: number;
      scope?: ScanScope;
      /** About how long the rest takes. */
      seconds?: number;
      /** Seconds by stage: the shared job feed (sync and match, done by now) and the live fetches. Older CLIs leave it out. */
      stages?: { feed: number; live: number; seconds: number };
      /** Directory companies skipped: the shared job feed shows nothing for you there. */
      skippedByFeed?: number;
      /** Older CLIs: the last `checking` companies aren't yours. */
      checking?: number;
      /** Companies this scan covers per hiring system ("greenhouse": 120). Older CLIs leave it out. */
      byAts?: Record<string, number>;
      /** Of those, done before this scan started (it resumed a stopped one), per hiring system. */
      doneByAts?: Record<string, number>;
    }
  /** A company done: every one of yours, and directory ones that matched or failed. */
  | ({ type: "company"; done?: number; doneByAts?: Record<string, number> } & CompanyHealth)
  /** A company's matches, fetched live just now: the Radar shows them before the scan ends. Older CLIs don't send it. */
  | { type: "jobs"; jobs: DashboardJob[] }
  /** Directory companies done, as a count (`ats`: the hiring system of the last one). */
  | { type: "progress"; done: number; ats?: string; doneByAts?: Record<string, number> }
  | {
      type: "done";
      jobsFound: number;
      matches: number;
      strong: number;
      newMatches: number;
      failed: number;
      /** Directory companies checked besides yours. */
      checked?: number;
      /** Stopped before the end; the next scan of the same type resumes. */
      stopped?: boolean;
      /** Your companies whose board is gone, with a directory board that may be the new one: suggestions, never applied. */
      moves?: { name: string; from: string; to: string }[];
      /** Older CLIs: switching a moved board in your config failed. */
      moveError?: string;
      /** Older CLIs: jobs found in the directory index. */
      indexJobs?: number;
      /** Where the time went (milliseconds per stage) and what the requests did. Older CLIs leave it out. */
      stats?: {
        stages: { sync: number; match: number; live: number; save: number };
        wallMs: number;
        requests: number;
        notModified: number;
        rateLimited: number;
        timeouts: number;
      };
    }
  /** The Telegram message asked for during the scan: "sent", "off" (not set up) or why it failed. */
  | { type: "notified"; result: string }
  | { type: "error"; message: string };

/** What each scan type covers (GET /api/scan/plan). */
export type ScanPlan = Record<
  ScanScope,
  {
    yours: number;
    extra: number;
    seconds: number;
    /** `seconds` by stage: the shared job feed, then the live fetches. Older CLIs leave it out. */
    stages?: { feed: number; live: number; seconds: number };
    resumable: { done: number; startedAt: string } | null;
  }
>;
