/**
 * Review moved careers pages that users reported: copy the inbox's reports into moves-pending.json in
 * the directory repo, check the old and new boards, run every gate, read the company's own careers
 * page for evidence (lib/evidence.ts), and open one review issue per old board whose report passes.
 * A maintainer approves on the issue (moves-approve.ts). With AUTO_ACCEPT on, a move whose verdict is
 * "auto" is accepted here (by: "auto") and ships once a second look a day later confirms it; without
 * it, the verdict is only shown on the issue (shadow mode). Each run also re-checks recent auto moves
 * (reverting one only when the company page now points somewhere else) and snapshots company careers
 * pages as baselines (docs/plans/auto-accept-moves.md).
 *
 *   pnpm exec tsx scripts/catalog/moves.ts --items moves-inbox.json --dir directory-repo \
 *     --directory live-directory.json [--issues] [--max-minutes 10]
 *
 * --items      { items: [...] } from GET /v1/moves/pending (all pages)
 * --dir        the directory repo checkout: moves-pending.json, moves.json, moves-blocked.json and
 *              moves-baselines.json (all written), contributions.json
 * --directory  the current directory (the live release's directory.json)
 * --issues     open and update review issues with `gh` (GH_TOKEN, GITHUB_REPOSITORY)
 * DENYLIST_FILE as everywhere else. AUTO_ACCEPT=1 accepts "auto" verdicts (lib/moves.ts autoAcceptEnabled).
 *
 * Prints a JSON summary; `processed` lists the inbox ids to acknowledge once the file is committed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { companyKey, HttpClient } from "@rawjobs/core";
import { readDenylist } from "./lib/denylist";
import {
  baselineBoards,
  baselineSwap,
  type BaselinesFile,
  decide,
  emptyBaselines,
  isNxdomain,
  judge,
  type PageEvidence,
  type RdapLookup,
  rdapLookup,
  readCompanyPage,
  sameBoard,
  trustedUrlOf,
  vendorHostOf,
  BASELINE_REFRESH_DAYS,
} from "./lib/evidence";
import { writeFileAtomic } from "./lib/fs";
import { checkBoard, type CheckResult } from "./lib/live-check";
import {
  activeMoves,
  autoAcceptEnabled,
  type BlockedFile,
  block,
  boardKey,
  type Candidate,
  DAY_MS,
  type DirRow,
  emptyBlocked,
  emptyMoves,
  emptyPending,
  evaluate,
  expire,
  gateContext,
  type InboxMove,
  checkMoves,
  codeSafe,
  ISSUE_LABEL,
  issueBody,
  issuesOf,
  issueTitle,
  MAX_CHECKS_KEPT,
  MAX_CHECKS_PER_RUN,
  type MoveBoard,
  type MoveRecord,
  type MovesFile,
  mergeInbox,
  type PendingFile,
  type PendingMove,
  RECHECK_MS,
} from "./lib/moves";
import { sameCompany } from "./lib/slugs";
import { safeFetcher, type SafeGet } from "./lib/safe-fetch";
import { maxMsFromArgs, nextInTime } from "./lib/time-box";

/** New boards checked per old board in one run. */
const MAX_TO_CHECKS = 5;
/** Auto-accepts at most this many per run and per day (the release gate allows 50 new moves per release). */
export const MAX_AUTO_PER_RUN = 10;
export const MAX_AUTO_PER_DAY = 20;
/** Company careers pages snapshot per run (about 3,000 live rows have one: a full pass in about 10 days). */
export const MAX_BASELINES_PER_RUN = 40;
/** Auto moves are re-checked this long after they're accepted. */
export const REVERIFY_DAYS = 30;
export const USER_AGENT = "RawJobs-catalog/0.1 (open-source job radar; checking shared boards; +https://github.com/Tanmay-Mhatre/rawjobs)";

export type Summary = {
  inbox: number;
  processed: string[];
  invalid: number;
  new_candidates: number;
  checked: number;
  cap_hit: boolean;
  timed_out: boolean;
  pending: number;
  passed: number;
  held: number;
  rejected: number;
  removals: number;
  expired: number;
  cleared_approved: number;
  issues_opened: number;
  issues_updated: number;
  accepted: number;
  auto_accept: boolean;
  /** Passing candidates the company page points at: fast-track (a person approves) and would-auto. */
  fast_track: number;
  would_auto: number;
  evidence_unknown: number;
  unreported: number;
  /** Auto moves: confirmed a day later, reverted (the page now points elsewhere), page unreadable. */
  confirmed: number;
  reverted: number;
  reverify_unknown: number;
  blocked_added: number;
  baselines_taken: number;
  /** Auto moves never confirmed within 30 days: dropped, not blocked. */
  expired_auto: number;
  rejections: { from: string; to: string; reason: string }[];
};

/** What the run needs from GitHub issues (`gh` in production, a fake in tests). */
export type IssueApi = {
  find(title: string): { number: number; state: string; body: string } | null;
  view(n: number): { state: string; body: string } | null;
  create(title: string, body: string): number;
  edit(n: number, body: string): void;
  close(n: number, comment: string): void;
  comment(n: number, body: string): void;
};

export type RunInput = {
  pending: PendingFile;
  moves: MovesFile;
  items: InboxMove[];
  directory: DirRow[];
  contributions: { key: string; added_at?: string }[];
  denied: (c: { key?: string; name?: string; careers_url?: string }) => boolean;
  check: (b: MoveBoard) => Promise<CheckResult>;
  issues?: IssueApi;
  now?: () => Date;
  maxChecks?: number;
  maxMs?: number;
  /** Refused or reverted moves (changed in place: closed reviews and reverts are added). */
  blocked?: BlockedFile;
  /** Company careers page snapshots (changed in place). */
  baselines?: BaselinesFile;
  /** Company pages, strictly (lib/safe-fetch.ts). Without it there's no evidence: every move goes to a person. */
  get?: SafeGet;
  rdap?: RdapLookup;
  /** Whether a host is NXDOMAIN (lib/evidence.ts isNxdomain). */
  nxdomain?: (host: string) => Promise<boolean>;
  /** Defaults to AUTO_ACCEPT. */
  autoAccept?: boolean;
  maxAutoPerRun?: number;
  maxAutoPerDay?: number;
  maxBaselines?: number;
};

const isOk = (r: CheckResult) => r.status === "live" || r.status === "dormant";
/** Still worth looking at: not rejected, or reported again since it was. */
const open = (c: Candidate) => (c.gates ? c.gates.result !== "reject" || c.last_at > c.gates.checked_at : true);

/** One review run over the pending file (changed in place). Pure apart from `check` and `issues`. */
export async function runReview(input: RunInput): Promise<Summary> {
  const clock = input.now ?? (() => new Date());
  const started = clock();
  const { pending, moves } = input;
  const summary: Summary = {
    inbox: input.items.length,
    processed: input.items.map((i) => String(i.id)),
    invalid: 0,
    new_candidates: 0,
    checked: 0,
    cap_hit: false,
    timed_out: false,
    pending: 0,
    passed: 0,
    held: 0,
    rejected: 0,
    removals: 0,
    expired: 0,
    cleared_approved: 0,
    issues_opened: 0,
    issues_updated: 0,
    accepted: 0,
    auto_accept: input.autoAccept ?? autoAcceptEnabled(),
    fast_track: 0,
    would_auto: 0,
    evidence_unknown: 0,
    unreported: 0,
    confirmed: 0,
    reverted: 0,
    reverify_unknown: 0,
    blocked_added: 0,
    baselines_taken: 0,
    expired_auto: 0,
    rejections: [],
  };
  const blocked = input.blocked ?? emptyBlocked();
  const baselines = input.baselines ?? emptyBaselines();
  const maxMs = input.maxMs ?? Infinity;
  const inTime = () => clock().getTime() - started.getTime() < maxMs;

  const merged = mergeInbox(pending, input.items, started);
  summary.invalid = merged.invalid.length;
  summary.new_candidates = merged.added;

  // Moves a maintainer approved since the last run are done: they live in moves.json now.
  const accepted = new Set(activeMoves(moves).map((m) => boardKey(m.from)));
  for (const fromKey of Object.keys(pending.moves))
    if (accepted.has(fromKey)) {
      delete pending.moves[fromKey];
      summary.cleared_approved++;
    }

  // Holds past 30 days go, and so do their open review issues.
  const expired = expire(pending, started);
  summary.expired = expired.length;
  for (const x of expired)
    for (const n of x.issues) {
      const v = input.issues?.view(n);
      if (v && v.state.toUpperCase() === "OPEN") input.issues!.close(n, "This report expired after 30 days without an approval. A new report opens a new review.");
    }

  // Recent auto moves first: confirm them a day later, or revert one the company page now contradicts.
  if (input.get) await reverify(input, moves, blocked, summary, clock, inTime);

  const ctx = gateContext({ now: started, directory: input.directory, denied: input.denied, contributions: input.contributions, moves, pending, blocked });
  const rdapCache = new Map<string, Promise<{ date: string } | { unknown: string }>>();
  const registered = (host: string) => {
    let p = rdapCache.get(host);
    if (!p && input.rdap) rdapCache.set(host, (p = input.rdap(host)));
    return p ?? Promise.resolve(null);
  };

  /** Read the company page once for an old board, and judge every passing candidate against it. */
  const gatherEvidence = async (e: PendingMove, now: Date) => {
    for (const c of Object.values(e.candidates)) if (c.gates?.result !== "pass") delete c.evidence;
    delete e.unreported;
    const passing = Object.values(e.candidates).filter((c) => c.gates?.result === "pass");
    if (!passing.length || !e.trusted_url || !input.get) return;
    const ev: PageEvidence = await readCompanyPage(e.trusted_url, input.get);
    if (ev.status === "unknown") summary.evidence_unknown++;
    const reg = ev.status === "ok" ? await registered(new URL(e.trusted_url).hostname) : null;
    const fromRow = ctx.directory.get(companyKey(e.from));
    const base = baselines.pages[companyKey(e.from)];
    const reportedAt = Object.values(e.candidates).reduce((min, c) => (c.first_at < min ? c.first_at : min), Object.values(e.candidates)[0]!.first_at);
    // The company page names one board no one reported: a person looks (it's suggested on the issue).
    const single = ev.status === "ok" ? (ev.redirect ?? (ev.boards.length === 1 ? ev.boards[0] : undefined)) : undefined;
    if (single && !sameBoard(single, e.from) && !Object.values(e.candidates).some((c) => sameBoard(c.to, single))) {
      e.unreported = boardKey(single);
      summary.unreported++;
    }
    for (const c of passing) {
      const j = judge(ev, c.to);
      const swap = baselineSwap(base, reportedAt, e.from, c.to, ev);
      const toRow = ctx.directory.get(companyKey(c.to));
      const pack = (fromRow?.tags?.length ?? 0) > 0 || (toRow?.tags?.length ?? 0) > 0;
      const d = decide({ finding: j.finding, gone: c.gates!.gone, baselineSwap: swap, registered: reg, ...(base ? { firstSeen: base.first_at ?? base.at } : {}), pack, now });
      c.evidence = {
        at: now.toISOString(),
        finding: j.finding,
        ...(j.kind ? { kind: j.kind } : {}),
        verdict: d.verdict,
        reasons: d.reasons,
        ...(j.points && j.finding !== "match" ? { points: boardKey(j.points) } : {}),
        ...(reg && "date" in reg ? { registered: reg.date } : {}),
        ...(swap ? { baseline_swap: true } : {}),
      };
    }
  };

  // Old boards due a check: never checked first, then the longest ago. A rejected candidate is looked at
  // again only after a newer report of it.
  const due = (e: PendingMove) =>
    Object.values(e.candidates).some(open) && (!e.last_check_at || started.getTime() - Date.parse(e.last_check_at) >= RECHECK_MS || Object.values(e.candidates).some((c) => !c.gates));
  const queue = Object.entries(pending.moves)
    .filter(([, e]) => due(e))
    .sort(([, a], [, b]) => (a.last_check_at ?? "").localeCompare(b.last_check_at ?? ""));
  const cap = input.maxChecks ?? MAX_CHECKS_PER_RUN;

  for (;;) {
    if (summary.checked >= cap) {
      summary.cap_hit = queue.length > 0;
      break;
    }
    const next = nextInTime(queue, started.getTime(), maxMs, clock().getTime());
    if (!next) {
      summary.timed_out = queue.length > 0;
      break;
    }
    const [fromKey, e] = next;
    summary.checked++;
    const now = clock();
    const nowIso = now.toISOString();
    const fromRow = ctx.directory.get(companyKey(e.from));
    if (fromRow && sameCompany(fromRow.name, e.name)) {
      e.in_directory_at ??= nowIso;
      // The company-hosted careers page the directory already had: the only page evidence may come from.
      if (!e.trusted_url) {
        const trusted = trustedUrlOf(fromRow);
        if (trusted) e.trusted_url = trusted;
      }
    }
    const cands = Object.entries(e.candidates).filter(([, c]) => open(c));

    // The cheap gates first: no network for a report that fails them anyway.
    const cheap = cands.map(([toKey, c]) => [toKey, c, evaluate(fromKey, e, toKey, c, { ...ctx, now })] as const);
    if (cheap.every(([, , g]) => g.result === "reject" || g.result === "removal")) {
      for (const [, c, g] of cheap) c.gates = g;
      continue;
    }

    const fromCheck = await input.check(e.from);
    // A vendor-provisioned host that no longer exists (twice, a day apart) proves the old board gone.
    const vendorHost = !isOk(fromCheck) && input.nxdomain ? vendorHostOf(e.from) : null;
    const nx = vendorHost ? await input.nxdomain!(vendorHost) : false;
    e.checks = [
      ...e.checks,
      { at: nowIso, status: fromCheck.status, ...(fromCheck.http ? { http: fromCheck.http } : isOk(fromCheck) ? { http: 200 } : {}), ...(nx ? { nxdomain: true as const } : {}) },
    ].slice(-MAX_CHECKS_KEPT);
    e.last_check_at = nowIso;
    if (isOk(fromCheck)) delete e.first_gone_at;
    else e.first_gone_at ??= nowIso;

    let toChecks = 0;
    for (const [toKey, c] of cands) {
      let g = evaluate(fromKey, e, toKey, c, { ...ctx, now });
      if (g.result === "hold" && g.reason === "to not checked yet" && toChecks < MAX_TO_CHECKS) {
        toChecks++;
        g = evaluate(fromKey, e, toKey, c, { ...ctx, now }, await input.check(c.to));
      }
      c.gates = g;
    }
    await gatherEvidence(e, now);
  }

  // Tally, and review issues for every old board with a passing candidate.
  for (const [fromKey, e] of Object.entries(pending.moves)) {
    for (const [toKey, c] of Object.entries(e.candidates)) {
      const r = c.gates?.result ?? "hold";
      if (r === "pass" && c.evidence?.verdict === "auto") summary.would_auto++;
      else if (r === "pass" && c.evidence?.verdict === "fast") summary.fast_track++;
      if (r === "pass") summary.passed++;
      else if (r === "hold") summary.held++;
      else if (r === "removal") summary.removals++;
      else {
        summary.rejected++;
        if (summary.rejections.length < 20) summary.rejections.push({ from: fromKey, to: toKey, reason: c.gates?.reason ?? "" });
      }
    }
    if (input.issues) syncIssue(fromKey, e, input.issues, summary, { blocked, now: started });
  }

  if (summary.auto_accept) autoAccept(input, moves, summary, started);

  // Baselines last, with what's left of the time box.
  if (input.get) await takeBaselines(input, baselines, summary, started, inTime);

  summary.pending = Object.keys(pending.moves).length;
  return summary;
}

/**
 * Accept the old boards whose one auto candidate holds, within the caps. The move is recorded unconfirmed
 * (it ships after a second look a day later), the review issue is closed with the evidence, and the
 * report leaves the pending file.
 */
function autoAccept(input: RunInput, moves: MovesFile, summary: Summary, now: Date): void {
  const dayAgo = now.getTime() - DAY_MS;
  let today = moves.moves.filter((m) => m.by === "auto" && Date.parse(m.accepted_at) > dayAgo).length;
  let thisRun = 0;
  const perRun = input.maxAutoPerRun ?? MAX_AUTO_PER_RUN;
  const perDay = input.maxAutoPerDay ?? MAX_AUTO_PER_DAY;
  for (const [fromKey, e] of Object.entries(input.pending.moves)) {
    const auto = Object.entries(e.candidates).filter(([, c]) => c.gates?.result === "pass" && c.evidence?.verdict === "auto");
    if (auto.length !== 1 || e.unreported || !e.trusted_url) continue;
    if (thisRun >= perRun || today >= perDay) break;
    const [toKey, c] = auto[0]!;
    const ev = c.evidence!;
    const nowIso = now.toISOString();
    const evidence = [
      `company page ${e.trusted_url} ${ev.kind === "S2" ? "redirects to" : "links only"} the new board`,
      `old board: ${c.gates!.gone === "proven" ? "proven gone" : "replaced on the company page"}${ev.baseline_swap ? " (before/after snapshot)" : ""}`,
      ...(ev.registered ? [`domain registered ${ev.registered.slice(0, 10)}`] : []),
      `new board: live${c.gates!.to_live?.jobs != null ? ` with ${c.gates!.to_live.jobs} jobs` : ""}`,
      `reports: ${c.reporters}`,
    ];
    const record: MoveRecord = {
      from: e.from,
      to: c.to,
      name: e.name,
      accepted_at: nowIso,
      by: "auto",
      evidence,
      evidence_url: e.trusted_url,
      verified: [nowIso],
      ...(c.issue ? { issue: c.issue } : {}),
    };
    moves.moves.push(record);
    if (c.issue && input.issues)
      input.issues.close(
        c.issue,
        [
          "Accepted automatically: the company's own careers page points at the new board. It ships once a second look, a day later, confirms it.",
          "",
          "```text",
          `from ${codeSafe(fromKey)}`,
          `to   ${codeSafe(toKey)}`,
          ...evidence.map((x) => codeSafe(x)),
          "```",
          "",
          "To undo it: set `reverted: true` on this move in `moves.json` in the directory repo, and add it to `moves-blocked.json`.",
        ].join("\n"),
      );
    delete input.pending.moves[fromKey];
    summary.accepted++;
    thisRun++;
    today++;
  }
}

/** Re-check auto moves accepted in the last 30 days, at most every 6 hours each. */
async function reverify(input: RunInput, moves: MovesFile, blocked: BlockedFile, summary: Summary, clock: () => Date, inTime: () => boolean): Promise<void> {
  for (const m of activeMoves(moves)) {
    if (!inTime()) return;
    const now = clock();
    if (m.by !== "auto" || !m.evidence_url) continue;
    if (now.getTime() - Date.parse(m.accepted_at) > REVERIFY_DAYS * DAY_MS) {
      // Never confirmed in 30 days (the page stayed unreadable): drop it, without a block (nothing contradicted it).
      if (!m.confirmed_at) {
        m.reverted = true;
        m.reverted_at = now.toISOString();
        summary.expired_auto++;
      }
      continue;
    }
    const last = m.verified?.[m.verified.length - 1];
    if (last && now.getTime() - Date.parse(last) < RECHECK_MS) continue;
    const j = judge(await readCompanyPage(m.evidence_url, input.get!), m.to);
    const nowIso = now.toISOString();
    if (j.finding === "match") {
      m.verified = [...(m.verified ?? []), nowIso].slice(-10);
      if (!m.confirmed_at && now.getTime() - Date.parse(m.accepted_at) >= DAY_MS) {
        m.confirmed_at = nowIso;
        summary.confirmed++;
      }
    } else if (j.finding === "other") {
      // Only a contradiction reverts: the company page now points at a different board.
      m.reverted = true;
      m.reverted_at = nowIso;
      const why = `company page now points at ${boardKey(j.points!)}`;
      if (block(blocked, { from: boardKey(m.from), to: boardKey(m.to), at: nowIso, why, ...(m.issue ? { issue: m.issue } : {}) })) summary.blocked_added++;
      summary.reverted++;
      if (m.issue && input.issues) input.issues.comment(m.issue, `Reverted: the ${codeSafe(why)}. The move is blocked for good (\`moves-blocked.json\`).`);
    } else summary.reverify_unknown++; // unreadable, bot-blocked, several or no boards: keep it, look again later
  }
}

/** Snapshot company careers pages (missing first, then the oldest), never one with a pending report. */
async function takeBaselines(input: RunInput, baselines: BaselinesFile, summary: Summary, now: Date, inTime: () => boolean): Promise<void> {
  const pendingDirKeys = new Set(Object.values(input.pending.moves).map((e) => companyKey(e.from)));
  const stale = now.getTime() - BASELINE_REFRESH_DAYS * DAY_MS;
  const due = input.directory
    .filter((r) => r.status === "live" && !pendingDirKeys.has(r.key) && trustedUrlOf(r))
    .filter((r) => !baselines.pages[r.key] || Date.parse(baselines.pages[r.key]!.at) < stale)
    .sort((a, b) => (baselines.pages[a.key]?.at ?? "").localeCompare(baselines.pages[b.key]?.at ?? "") || a.key.localeCompare(b.key))
    .slice(0, input.maxBaselines ?? MAX_BASELINES_PER_RUN);
  for (const r of due) {
    if (!inTime()) return;
    const url = trustedUrlOf(r)!;
    const ev = await readCompanyPage(url, input.get!);
    if (ev.status !== "ok") continue;
    const at = now.toISOString();
    baselines.pages[r.key] = { url, boards: baselineBoards(ev.redirect ? [ev.redirect] : ev.boards), at, first_at: baselines.pages[r.key]?.first_at ?? baselines.pages[r.key]?.at ?? at };
    summary.baselines_taken++;
  }
}

/**
 * Open or update the one review issue for an old board. Opened only when a candidate passes; a
 * closed issue is never reopened or recreated (a maintainer closed it: refused, or spam).
 */
export function syncIssue(
  fromKey: string,
  e: PendingMove,
  api: IssueApi,
  summary: Pick<Summary, "issues_opened" | "issues_updated"> & Partial<Pick<Summary, "blocked_added">>,
  opts: { blocked?: BlockedFile; now?: Date } = {},
): void {
  const passing = Object.values(e.candidates).some((c) => c.gates?.result === "pass");
  let number = issuesOf(e)[0];
  let current = number ? api.view(number) : null;
  if (!number) {
    const found = api.find(issueTitle(fromKey));
    if (found) {
      number = found.number;
      current = found;
    }
  }
  if (current && current.state.toUpperCase() !== "OPEN") {
    // A maintainer closed the review: refused. Its candidates are blocked for good.
    if (opts.blocked && number)
      for (const [toKey, c] of Object.entries(e.candidates))
        if (c.issue === number && block(opts.blocked, { from: fromKey, to: toKey, at: (opts.now ?? new Date()).toISOString(), why: `review issue #${number} closed`, issue: number }))
          summary.blocked_added = (summary.blocked_added ?? 0) + 1;
    return;
  }
  if (!number) {
    if (!passing) return;
    number = api.create(issueTitle(fromKey), issueBody(fromKey, e));
    summary.issues_opened++;
  } else {
    const body = issueBody(fromKey, e, current?.body ?? "");
    if (body !== current?.body) {
      api.edit(number, body);
      summary.issues_updated++;
    }
  }
  for (const c of Object.values(e.candidates) as Candidate[]) c.issue = number;
}

/** `gh` for the code repo's issues. Arguments go as an array: nothing passes through a shell. */
export function ghIssues(repo = process.env.GITHUB_REPOSITORY): IssueApi {
  if (!repo) throw new Error("GITHUB_REPOSITORY is needed for --issues");
  const gh = (args: string[], input?: string) => execFileSync("gh", args, { encoding: "utf8", ...(input !== undefined ? { input } : {}) });
  return {
    find(title) {
      const out = JSON.parse(gh(["issue", "list", "-R", repo, "--state", "all", "--label", ISSUE_LABEL, "--search", `"${title}" in:title`, "--json", "number,title,state,body", "--limit", "20"])) as {
        number: number;
        title: string;
        state: string;
        body: string;
      }[];
      return out.find((i) => i.title === title) ?? null;
    },
    view(n) {
      try {
        return JSON.parse(gh(["issue", "view", String(n), "-R", repo, "--json", "state,body"])) as { state: string; body: string };
      } catch {
        return null;
      }
    },
    create(title, body) {
      const url = gh(["issue", "create", "-R", repo, "--title", title, "--label", ISSUE_LABEL, "--body-file", "-"], body).trim();
      const n = Number(url.split("/").pop());
      if (!Number.isInteger(n)) throw new Error(`gh issue create: unexpected answer ${url}`);
      return n;
    },
    edit(n, body) {
      gh(["issue", "edit", String(n), "-R", repo, "--body-file", "-"], body);
    },
    close(n, comment) {
      gh(["issue", "close", String(n), "-R", repo, "--comment", comment]);
    },
    comment(n, body) {
      gh(["issue", "comment", String(n), "-R", repo, "--body-file", "-"], body);
    },
  };
}

const readJson = <T>(path: string, fallback: T): T => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback);

/** The Board shape checkBoard wants. */
export const checkerFor = (http: HttpClient) => (b: MoveBoard) => checkBoard(http, { key: boardKey(b), ...b });

async function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const itemsFile = arg("--items");
  const dir = arg("--dir");
  const directoryFile = arg("--directory");
  if (!itemsFile || !dir || !directoryFile) throw new Error("Usage: moves.ts --items items.json --dir directory-repo --directory directory.json [--issues] [--max-minutes N]");
  const pendingFile = join(dir, "moves-pending.json");
  const pending = readJson<PendingFile>(pendingFile, emptyPending());
  if (pending.version !== 1 || typeof pending.moves !== "object") throw new Error(`${pendingFile}: not a version 1 pending file`);
  const movesFile = join(dir, "moves.json");
  const blockedFile = join(dir, "moves-blocked.json");
  const baselinesFile = join(dir, "moves-baselines.json");
  const moves = readJson<MovesFile>(movesFile, emptyMoves());
  const blocked = readJson<BlockedFile>(blockedFile, emptyBlocked());
  const baselines = readJson<BaselinesFile>(baselinesFile, emptyBaselines());
  const directory = (JSON.parse(readFileSync(directoryFile, "utf8")) as { companies: DirRow[] }).companies;
  if (!Array.isArray(directory) || !directory.length) throw new Error(`${directoryFile}: no companies`);
  const http = new HttpClient({ retries: 1, hostDelayMs: 300, timeoutMs: 20_000, userAgent: "RawJobs-catalog/0.1 (open-source job radar; checking shared boards)" });
  const get = safeFetcher({ userAgent: USER_AGENT });

  const summary = await runReview({
    pending,
    moves,
    items: readJson<{ items?: InboxMove[] }>(itemsFile, {}).items ?? [],
    directory,
    contributions: readJson<{ companies: { key: string; added_at?: string }[] }>(join(dir, "contributions.json"), { companies: [] }).companies,
    denied: readDenylist(),
    check: checkerFor(http),
    ...(process.argv.includes("--issues") ? { issues: ghIssues() } : {}),
    maxMs: process.argv.includes("--max-minutes") ? maxMsFromArgs() : Infinity,
    blocked,
    baselines,
    get,
    rdap: rdapLookup(safeFetcher({ userAgent: USER_AGENT, robots: false })),
    nxdomain: (host) => isNxdomain(host),
  });
  const problems = checkMoves(moves);
  if (problems.length) throw new Error(`moves.json would be inconsistent: ${problems.join("; ")}`);
  writeFileAtomic(pendingFile, `${JSON.stringify(pending, null, 1)}\n`);
  writeFileAtomic(movesFile, `${JSON.stringify(moves, null, 1)}\n`);
  writeFileAtomic(blockedFile, `${JSON.stringify(blocked, null, 1)}\n`);
  writeFileAtomic(baselinesFile, `${JSON.stringify(baselines)}\n`);
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
