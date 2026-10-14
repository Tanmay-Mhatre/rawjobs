/**
 * Hiring activity's working state (packages/core/src/activity.ts): each directory company's new roles
 * per day and month, recorded from the job feed's daily change file and carried from one run to the
 * next (scripts/catalog/state.sh, "jobs" set). The published file is made from it (toActivityFile).
 */
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import {
  ACTIVITY_MONTHS,
  ACTIVITY_SCHEMA,
  activityMonths,
  addMonths,
  dayNumber,
  dayString,
  groupKey,
  MASS_POSTER_OPEN_JOBS,
  monthOf,
  REPOST_DAYS,
  roleKind,
  WINDOW_DAYS,
  type ActivityFile,
  type CompanyActivity,
  type FeedDiff,
  type FeedManifestV2,
  type FeedState,
} from "@rawjobs/core";
import { brotli, readFeed, sha, type FeedFormat } from "./feed-v2";

/** [day number, new roles, internships, graduate roles, reposts (new ids reusing a title)] */
export type DayCounts = [number, number, number, number, number];

export type CompanyState = {
  /** The day the company first appeared, or came back after it was gone: its jobs then aren't new. */
  first: string;
  /** Gone from the feed: when it comes back, its jobs that day aren't new. */
  gone?: true;
  /** Title fingerprint (titleMark) -> the day number it was last listed; kept REPOST_DAYS. */
  titles: Record<string, number>;
  /** Days with new ids, the last REPOST_DAYS. */
  days: DayCounts[];
  /** "YYYY-MM" -> [new roles, internships, graduate roles], the last ACTIVITY_MONTHS. */
  months: Record<string, [number, number, number]>;
};

export type ActivityState = {
  schema: number;
  /** The feed version last recorded. */
  seq: number;
  /** The feed format whose versions `seq` counts (absent: the second). */
  feed?: FeedFormat;
  /** The day last recorded. */
  date: string;
  /** The first day whose new roles were counted (the second recorded run). */
  since: string | null;
  companies: Record<string, CompanyState>;
};

export const emptyActivityState = (): ActivityState => ({ schema: ACTIVITY_SCHEMA, seq: 0, date: "", since: null, companies: {} });

/**
 * A short fingerprint of a title as one role (groupKey's title part: place left out, short forms
 * written out), so the state stays a few MB: FNV-1a, 32 bits, base 36. Two titles of one company
 * sharing one is about a one-in-a-billion chance per pair.
 */
export function titleMark(title: string): string {
  let mark = marks.get(title);
  if (mark === undefined) {
    const key = groupKey("", title);
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    mark = (h >>> 0).toString(36);
    if (marks.size > 2_000_000) marks.clear();
    marks.set(title, mark);
  }
  return mark;
}
/** Remembered per title: the feed lists about 1.5 million jobs under 0.9 million titles, every day. */
const marks = new Map<string, string>();

/**
 * Record one feed run: `today` is the feed after it, `diff` its change file (undefined when the run
 * published only a full copy; that day's new ids then go uncounted). A company seen for the first
 * time, or back after it was gone, counts nothing that day: its jobs are its starting point. Ids
 * whose title the company listed in the last REPOST_DAYS are reposts, and a role posted under several
 * ids the same day (one per city) is one role. Runs already recorded (by `seq`) are skipped.
 */
export function recordActivity(state: ActivityState, today: FeedState, diff: FeedDiff | undefined, meta: { seq: number; date: string }): ActivityState {
  if (meta.seq <= state.seq) return state;
  const d = dayNumber(meta.date);
  const month = monthOf(meta.date);
  const counting = !!diff && state.seq > 0;
  for (const key of diff?.removed ?? []) if (state.companies[key]) state.companies[key]!.gone = true;

  for (const [key, rows] of Object.entries(today.jobs)) {
    let c = state.companies[key];
    const fresh = !c || c.gone;
    if (!c || c.gone) c = state.companies[key] = { first: meta.date, titles: c?.titles ?? {}, days: c?.days ?? [], months: c?.months ?? {} };
    const change = diff?.changes[key];
    if (counting && !fresh && change?.add) {
      // A job whose title, place or date changed is removed and added again under its id: not new.
      const changed = new Set(change.remove ?? []);
      const counts: DayCounts = [d, 0, 0, 0, 0];
      const todays = new Set<string>();
      for (const [id, title] of change.add) {
        if (changed.has(id)) continue;
        const mark = titleMark(title);
        const last = c.titles[mark];
        if (last !== undefined && d - last <= REPOST_DAYS) {
          counts[4]++;
          continue;
        }
        if (todays.has(mark)) continue;
        todays.add(mark);
        counts[1]++;
        const kind = roleKind(title);
        if (kind === "internship") counts[2]++;
        else if (kind === "graduate") counts[3]++;
      }
      if (counts[1] || counts[4]) {
        c.days.push(counts);
        const m = (c.months[month] ??= [0, 0, 0]);
        m[0] += counts[1];
        m[1] += counts[2];
        m[2] += counts[3];
      }
    }
    for (const r of rows) c.titles[titleMark(r[1])] = d;
  }

  // Keep REPOST_DAYS of titles and days and ACTIVITY_MONTHS of months; drop gone companies with nothing left.
  const oldestMonth = addMonths(month, 1 - ACTIVITY_MONTHS);
  for (const [key, c] of Object.entries(state.companies)) {
    for (const [mark, last] of Object.entries(c.titles)) if (d - last > REPOST_DAYS) delete c.titles[mark];
    c.days = c.days.filter((x) => d - x[0] < REPOST_DAYS);
    for (const m of Object.keys(c.months)) if (m < oldestMonth) delete c.months[m];
    if (c.gone && !Object.keys(c.months).length) delete state.companies[key];
  }
  return { ...state, schema: ACTIVITY_SCHEMA, seq: meta.seq, date: meta.date, since: state.since ?? (counting ? meta.date : null) };
}

/**
 * The published file: every company in today's feed. Besides the counts, `p` (roles with a posted
 * date in the last 30 days) works from the first day; Workday's dates are relative and stop at "30+
 * days ago", which falls just outside the window.
 *
 * Mass posters get `e: 1`, and the app never calls their numbers a surge: a company with more than
 * MASS_POSTER_OPEN_JOBS open jobs whose new ids in the last 30 days were mostly reposts of titles it
 * already lists (staffing firms, evergreen requisitions), or whose new roles came to more than half
 * its open jobs (a long list turning over, often at a hiring system's 2,000-job cap, with a store
 * number in every title: "Delivery Driver (05748) - 1909 N Columbia St.").
 */
export function toActivityFile(state: ActivityState, today: FeedState, generated: string): ActivityFile {
  const date = state.date || generated.slice(0, 10);
  const d = dayNumber(date);
  const months = activityMonths(date, ACTIVITY_MONTHS);
  const companies: Record<string, CompanyActivity> = {};
  for (const [key, rows] of Object.entries(today.jobs)) {
    const c = state.companies[key];
    const out: CompanyActivity = { n: 0 };
    if (c) {
      const series = (i: 0 | 1 | 2) => months.map((m) => c.months[m]?.[i] ?? 0);
      const [m, i, g] = [series(0), series(1), series(2)];
      if (m.some(Boolean)) out.m = m;
      if (i.some(Boolean)) out.i = i;
      if (g.some(Boolean)) out.g = g;
      const recent = c.days.filter((x) => d - x[0] < WINDOW_DAYS);
      out.n = recent.reduce((a, x) => a + x[1], 0);
      const reposts = recent.reduce((a, x) => a + x[4], 0);
      // Counted from the day after it first appeared, when that's after records started.
      if (state.since) {
        const from = Math.min(dayNumber(c.first) + 1, d);
        if (from > dayNumber(state.since)) out.s = dayString(from);
      }
      if (rows.length > MASS_POSTER_OPEN_JOBS && (reposts > out.n || out.n > rows.length / 2)) out.e = 1;
    }
    const posted = new Set<string>();
    let dated = false;
    for (const r of rows) {
      if (!r[4]) continue;
      dated = true;
      const age = d - dayNumber(r[4]);
      if (age >= 0 && age < WINDOW_DAYS) posted.add(titleMark(r[1]));
    }
    if (dated) out.p = posted.size;
    companies[key] = out;
  }
  return { schema: ACTIVITY_SCHEMA, generated_at: generated, date, since: state.since, first_month: months[0]!, companies };
}

/** The state carried between runs, in the feed's folder. */
export const ACTIVITY_STATE = "activity-state.json";
const MANIFEST = (f: FeedFormat) => `jobs-v${f}-manifest.json`;

/** Write next to the file, then rename: a run cut short never leaves half a file. */
const writeWhole = (path: string, body: string | Buffer) => {
  writeFileSync(`${path}.tmp`, body);
  renameSync(`${path}.tmp`, path);
};

export type ActivityResult = { file: ActivityFile; bytes: number; stateBytes: number; notes: string[] };

/**
 * Record this run of the feed in `out` (manifest, full copy and change file: the third format, every
 * hiring system, or else the second) and publish jobs-activity-<seq>.json.br. Writes the state, the
 * file, and last each manifest with its `activity` entry (older apps read it from the second format's),
 * so a failure anywhere leaves the manifests as jobs.ts wrote them.
 */
export function writeActivity(out: string): ActivityResult {
  const format: FeedFormat = existsSync(join(out, MANIFEST(3))) ? 3 : 2;
  const feed = readFeed(out, format);
  if (!feed) throw new Error(`no feed in ${out}: run jobs.ts first`);
  const { manifest, state: today } = feed;
  const notes: string[] = [];
  // Today's change file, when this run made one (yesterday's copy was there to compare with).
  const last = manifest.diffs.at(-1);
  const diffFile = last?.seq === manifest.seq ? join(out, last.file) : undefined;
  const diff = diffFile && existsSync(diffFile) ? (JSON.parse(brotliDecompressSync(readFileSync(diffFile)).toString("utf8")) as FeedDiff) : undefined;

  const statePath = join(out, ACTIVITY_STATE);
  let state = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, "utf8")) as ActivityState) : emptyActivityState();
  if (state.schema !== ACTIVITY_SCHEMA) state = emptyActivityState();
  if ((state.feed ?? 2) !== format) {
    // Another format numbers its versions afresh: keep the records and take this run as a starting point.
    if (state.seq) notes.push(`now recording the feed's format ${format}; this run's new roles go uncounted`);
    state = { ...state, seq: 0 };
  }
  if (state.seq && state.seq < manifest.seq - 1) notes.push(`runs ${state.seq + 1}-${manifest.seq - 1} weren't recorded; their new roles go uncounted`);
  if (!diff) notes.push("no change file today; today's new roles go uncounted");
  state = { ...recordActivity(state, today, diff, { seq: manifest.seq, date: manifest.generated_at.slice(0, 10) }), feed: format };
  const stateJson = JSON.stringify(state);
  writeWhole(statePath, stateJson);

  const file = toActivityFile(state, today, manifest.generated_at);
  const buf = brotli(JSON.stringify(file));
  const name = `jobs-activity-${manifest.seq}.json.br`;
  writeWhole(join(out, name), buf);
  for (const f of readdirSync(out)) if (/^jobs-activity-\d+\.json\.br$/.test(f) && f !== name) rmSync(join(out, f));
  const activity = { file: name, sha256: sha(buf), bytes: buf.length };
  for (const f of [3, 2] as const) {
    const path = join(out, MANIFEST(f));
    if (!existsSync(path)) continue;
    const next: FeedManifestV2 = { ...(JSON.parse(readFileSync(path, "utf8")) as FeedManifestV2), activity };
    writeWhole(path, `${JSON.stringify(next, null, 2)}\n`);
  }
  return { file, bytes: buf.length, stateBytes: stateJson.length, notes };
}
