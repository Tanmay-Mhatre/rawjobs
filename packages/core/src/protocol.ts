// Type imports only: nothing here runs, so the dashboard can import this file.
import type { DirectoryStatus } from "./directory";
import type { CompanyRef } from "./directory-boards";
import type { BrowseAnswer } from "./directory-search";
import type { DoctorReport } from "./doctor";
import type { NetworkMe, NetworkPeople, NetworkStatus, NetworkSummary, ReminderState, WatchState } from "./network/types";
import type { WatchErrorCode } from "./network/watch";
import type { ChangelogEntry, ReleaseChange } from "./release-notes";
import type { StoredResume } from "./resume";
import type { AtsType, CompanyHealth, Config, DashboardJob } from "./schema";
import type { CompanySuggestion } from "./suggest";
import type { TrackingConflict, TrackingFile } from "./tracking";

/**
 * What the CLI and the local API send the dashboard: one definition, used on both sides
 * (`@rawjobs/core/protocol`, no node: imports). The CLI's scan progress is newline-delimited JSON,
 * one RunEvent per line.
 */

/**
 * What a scan covers. "mine" (Scan now): your companies, companies that matched you before, and the
 * ones the shared job feed flags for you; every company when the feed is too old. "yours": only your
 * companies. "all": every company in the directory, fetched live.
 */
export type ScanScope = "mine" | "all" | "yours";

/** Who started a scan: this dashboard, the computer's schedule, or `rawjobs scan` in a terminal. */
export type ScanOrigin = "page" | "scheduled" | "terminal";

/** Where a Scan now company comes from: yours, a past match, or picked by the shared job feed. */
export type ScanSource = "yours" | "past" | "feed";

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
      /** A Scan now scan's companies by where they come from, and how many of each are done. Older CLIs leave it out. */
      bySource?: Record<ScanSource, number>;
      doneBySource?: Record<ScanSource, number>;
      /** How old the shared job feed is, in days; null without one. */
      feedAgeDays?: number | null;
      /** The feed is too old to pick companies, so this Scan now checks every company itself. */
      fallback?: boolean;
      /** The quick Scan now, or the background check of every other company that follows it. */
      stage?: "quick" | "background";
    }
  /** A company done: every one of yours, and directory ones that matched or failed. */
  | ({ type: "company"; done?: number; doneByAts?: Record<string, number>; doneBySource?: Record<ScanSource, number> } & CompanyHealth)
  /** A company's matches, fetched live just now: the Radar shows them before the scan ends. Older CLIs don't send it. */
  | { type: "jobs"; jobs: DashboardJob[] }
  /** Directory companies done, as a count (`ats`: the hiring system of the last one, `last`: its name). */
  | { type: "progress"; done: number; ats?: string; last?: string; doneByAts?: Record<string, number>; doneBySource?: Record<ScanSource, number> }
  /** Scan now is done and saved; the background check of every other company starts (its own start … done follow). */
  | { type: "background" }
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
      /** Which stage finished: the quick Scan now, or the background check. Older CLIs leave it out. */
      stage?: "quick" | "background";
      /** Every company in the directory has now been checked (a background check or a full scan that finished). */
      everyCompany?: boolean;
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
    /** Scan now with a job feed too old to pick companies: it checks every company itself. */
    fallback?: boolean;
    resumable: { done: number; startedAt: string } | null;
  }
>;

// ---------- the local API's JSON answers (packages/server/src/api.ts, updater.ts) ----------

/** What GET /api/health says. Every field is optional: a page may be talking to an older server (after an update went back). */
export type Health = {
  ok?: boolean;
  version?: string;
  scanning?: boolean;
  /** A scan this server didn't start (a scheduled one, a terminal's) is running. */
  background?: boolean;
  /** Who started the running scan; null: none. */
  scanOrigin?: ScanOrigin | null;
  /** meta.json's generatedAt: a scan wrote new results when it moves. */
  dataVersion?: string | null;
  /** tracking.json's revision: another window saved when it moves. */
  trackingRev?: number;
  update?: { version: string } | null;
  startLink?: boolean;
  /** The server crashed several times just now, so it started without its background work for a while. */
  safeMode?: boolean;
  platform?: string;
  /** Which RawJobs folder this server is for (an id, not the path). */
  home?: string;
  pid?: number;
};

/** What GET /api/update says (an installed copy's updates). Fields marked optional are missing from older servers. */
export type UpdateStatus = {
  installed: boolean;
  current: string;
  /** `telegram`: a Telegram message when an update is ready (missing on an older server: on). */
  settings: { mode: "ask" | "off"; channel: "stable" | "beta"; telegram?: boolean };
  lastCheck?: string;
  /** A newer version. `critical`: a required update; `ready`: downloaded already, installs in seconds. */
  available: { version: string; notes: string; changes?: ReleaseChange[]; critical: boolean; date: string; major: boolean; ready: boolean } | null;
  /** The newest version, when it didn't start here before (the update went back): Settings offers to try again. */
  skipped?: { version: string; date: string } | null;
  tooOld: boolean;
  state: "idle" | "checking" | "downloading" | "waiting" | "updating";
  error?: string;
  lastUpdate: { from: string; to: string; ok: boolean; at: string; error?: string; notes?: string; skipped?: boolean } | null;
  /** Missing from an older server: Settings → About shows what it has. */
  about?: {
    since?: { at: string; by: "update" | "install" };
    home: string;
    node: string;
    platform: string;
    /** The RawJobs shortcuts on this computer (null: not an installed copy). */
    shortcuts: { desktop: boolean; menu: boolean; desktopFolder: boolean; desktopError: string | null; notice: boolean } | null;
  };
};

/** What GET /api/update/changelog says: this version's history (newest first), and the version waiting, if any. */
export type Changelog = { current: string; entries: ChangelogEntry[]; upcoming: ChangelogEntry | null };

/** What GET /api/tracking says: the file, and its revision for If-Match. */
export type TrackingRead = { tracking: TrackingFile | null; rev: number; epoch: string };
/** PATCH /api/tracking's 409: another window changed the same keys first; its copy, to join with. */
export type TrackingConflictBody = { ok: false; rev: number; epoch: string; tracking: TrackingFile; conflicts: TrackingConflict[] };

/** GET /api/network. `watchable`: this computer offers the Downloads watch (not macOS in this release); `reminder`: "Remind me in 48 hours". */
export type NetworkInfo = { status: NetworkStatus; me: NetworkMe | null; watchable?: boolean; reminder?: ReminderState | null };
/** A /api/network* error: a code, never the company asked about. */
export type NetworkError = { ok: false; errors: { code: string }[] };

/** Telegram alerts as the local API reports them (the token is masked; it never comes back whole). */
export type TelegramStatus = { ok: boolean; token: string | null; bot: string | null; connected: boolean; enabled: boolean; fromEnv: boolean; error?: string };
export type TelegramAction = "token" | "connect" | "test" | "on" | "off" | "forget";
export type TelegramActionResult = { ok: boolean; error?: string; bot?: string; name?: string };

export type ScheduledRun = {
  startedAt: string;
  finishedAt?: string;
  scope: ScanScope;
  ok: boolean;
  matches?: number;
  newMatches?: number;
  notified?: string;
  stopped?: boolean;
  /** Why it stopped: its time ran out ("deadline"), its scheduler ended it, or Stop ("stop"). */
  stopReason?: "deadline" | "scheduler" | "stop";
  error?: string;
  /** Ran late, for a time missed while the computer was off or asleep. */
  catchUp?: boolean;
  /** Still running now (it's logged when it starts). */
  running?: boolean;
};
export type ScheduleStatus = {
  ok: boolean;
  error?: string;
  installed: boolean;
  supported: boolean;
  platform: string;
  settings?: { times: string[]; scope: ScanScope };
  nextRun?: string;
  lastRun?: ScheduledRun;
  runs: ScheduledRun[];
  problem?: string;
};

/** "Today in your Pipeline" each morning on Telegram: its scheduled task, and the last day it ran. */
export type DailySummaryStatus = {
  ok: boolean;
  error?: string;
  installed: boolean;
  supported: boolean;
  platform: string;
  settings?: { time: string };
  nextRun?: string;
  problem?: string;
  last: { day: string; at: string; result: "sent" | "nothing-due" } | null;
  /** Telegram is connected (a bot token and a chat). */
  telegram: boolean;
};

export type Lookalike = CompanySuggestion & { similarity: number; like: string };
/** What `rawjobs companies suggest --json --stdin` answers (POST /api/companies/suggest). */
export type CompanySuggestions = {
  hiringNow: CompanySuggestion[];
  worthWatching: CompanySuggestion[];
  notScannable: CompanySuggestion[];
  scanned: number;
  /** Each past employer, and the directory company it matched (left out when you watch it already). */
  pastEmployers: { name: string; company?: CompanyRef & { key: string; open_jobs: number | null; status?: string }; watched: boolean }[];
  /** Companies like a past employer, per employer. */
  lookalikes: { seed: string; in_directory: boolean; items: Lookalike[] }[];
  /** Best companies per industry you picked, and the next few after them (older answers have no `more`). */
  packs: { industry: string; items: CompanySuggestion[]; more?: CompanySuggestion[] }[];
  /** Companies in your industries in the directory, and how many we can check. */
  coverage: { in_industries: number; trackable: number };
  /**
   * What each list left out because it's in My companies (so "all added" isn't "nothing found"): how
   * many per list and per past employer, and each pack's companies by key. Older answers don't say: 0.
   */
  added?: { hiring: number; watching: number; soon: number; like: Record<string, number>; packs: Record<string, string[]> };
  index_generated_at: string;
  error?: string;
};

/** GET /api/directory: the local copy (`rawjobs directory status --json`), how old it is, and its companies per industry. */
export type DirectoryAnswer = DirectoryStatus & { age_days: number | null; industries?: Record<string, number> | null };

/** The usual error answer: what went wrong, in words. */
export type ApiError = { ok: false; errors: string };

/**
 * Every local API route that answers JSON, and what it answers when it works ("METHOD /path"; `:name`
 * stands for a path part, and a query string isn't part of the key). The server sends these through
 * `send()` (packages/server/src/api.ts) and the dashboard reads them through `getJson()`, so a change
 * to an answer fails the typecheck on the side that wasn't changed. Routes that pass the CLI's JSON
 * output straight through are here too: their type is what that CLI command prints. Not here:
 * GET/POST /api/run, which stream NDJSON (a RunEvent per line).
 */
export type ApiRoutes = {
  "GET /api/health": Health;
  "GET /api/update": UpdateStatus;
  "GET /api/update/changelog": Changelog;
  /** check, apply, retry, seen, shortcut, shortcut-seen and focus: the status after it. */
  "POST /api/update/:action": UpdateStatus;
  "PUT /api/update/settings": UpdateStatus;
  "GET /api/tracking": TrackingRead;
  "PUT /api/tracking": { ok: true; updatedAt: string; rev: number; epoch: string };
  "PATCH /api/tracking": { ok: true; rev: number; epoch: string; updatedAt: string };
  "GET /api/network": NetworkInfo;
  "POST /api/network/watch": { watch: WatchState };
  "DELETE /api/network/watch": { ok: true };
  "POST /api/network/reminder": { reminder: ReminderState };
  "DELETE /api/network/reminder": { ok: true };
  "POST /api/network/import": { ok: true; status: NetworkStatus };
  "GET /api/network/summary": NetworkSummary;
  "GET /api/network/people": NetworkPeople;
  "PUT /api/network/friends": { ok: true };
  "DELETE /api/network": { ok: true };
  "GET /api/setup": SetupStatus;
  "POST /api/setup/config": SaveResult;
  "POST /api/setup/reset": { ok: true; backup: string | null } | ApiError;
  "GET /api/setup/resume": StoredResume;
  "POST /api/setup/resume": { ok: boolean; error?: string; errors?: string };
  "DELETE /api/setup/resume": { ok: boolean; errors?: string };
  "POST /api/setup/check": CompanyCheck[];
  "GET /api/directory": DirectoryAnswer;
  "POST /api/directory/update": { updated?: boolean; message?: string; errors?: string };
  "POST /api/directory/search": BrowseAnswer;
  "POST /api/directory/names": { names: Record<string, string> };
  "POST /api/directory/warm": { present: boolean };
  "POST /api/directory/moves": { queued: true } | { queued: false; reason: string };
  "POST /api/companies/suggest": CompanySuggestions;
  "GET /api/companies/suggest/size": { companies: number | null };
  "POST /api/check": Extract<RunEvent, { type: "done" | "error" }>;
  "GET /api/scan/plan": ScanPlan;
  "GET /api/alerts/telegram": TelegramStatus;
  "POST /api/alerts/telegram/:action": TelegramActionResult;
  "POST /api/doctor": DoctorReport & { ok: true; zip?: string };
  "GET /api/schedule": ScheduleStatus;
  "POST /api/schedule": ScheduleStatus;
  "DELETE /api/schedule": ScheduleStatus;
  /** ApiError (200) while a scan runs. */
  "POST /api/schedule/run": ScheduleStatus | ApiError;
  "GET /api/daily-summary": DailySummaryStatus;
  "POST /api/daily-summary": DailySummaryStatus;
  "DELETE /api/daily-summary": DailySummaryStatus;
  "POST /api/daily-summary/test": { ok: boolean; error?: string };
  "POST /api/run/notify": { ok: boolean };
  "POST /api/run/stop": { ok: boolean };
};
export type ApiRoute = keyof ApiRoutes;

/** What a route answers when it fails (a status other than 2xx), where that isn't an ApiError. */
type ApiErrorBodies = {
  "POST /api/update/:action": UpdateStatus | ApiError;
  "PUT /api/update/settings": UpdateStatus | ApiError;
  "PATCH /api/tracking": ApiError | TrackingConflictBody;
  "POST /api/network/watch": { watch: null; error: WatchErrorCode } | NetworkError;
  "POST /api/network/reminder": NetworkError;
  "POST /api/network/import": NetworkError;
  "GET /api/network/people": NetworkError;
  "PUT /api/network/friends": NetworkError;
  "POST /api/check": Extract<RunEvent, { type: "error" }> | (ApiError & { type: "error"; message: string });
};
/** A route's answer when it fails: an ApiError unless the route says otherwise. */
export type ApiFailure<R extends ApiRoute> = R extends keyof ApiErrorBodies ? ApiErrorBodies[R] : ApiError;
