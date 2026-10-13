/**
 * Review moved careers pages that users reported (record-only): copy the inbox's reports into
 * moves-pending.json in the directory repo, check the old and new boards, run every gate, and open
 * one review issue per old board whose report passes. Nothing is accepted here: a maintainer
 * approves on the issue (moves-approve.ts), which adds the move to moves.json.
 *
 *   pnpm exec tsx scripts/catalog/moves.ts --items moves-inbox.json --dir directory-repo \
 *     --directory live-directory.json [--issues] [--max-minutes 10]
 *
 * --items      { items: [...] } from GET /v1/moves/pending (all pages)
 * --dir        the directory repo checkout: moves-pending.json (written), moves.json, contributions.json
 * --directory  the current directory (the live release's directory.json)
 * --issues     open and update review issues with `gh` (GH_TOKEN, GITHUB_REPOSITORY)
 * DENYLIST_FILE as everywhere else. AUTO_ACCEPT is a placeholder (lib/moves.ts autoAcceptEnabled).
 *
 * Prints a JSON summary; `processed` lists the inbox ids to acknowledge once the file is committed.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { companyKey, HttpClient } from "@rawjobs/core";
import { readDenylist } from "./lib/denylist";
import { writeFileAtomic } from "./lib/fs";
import { checkBoard, type CheckResult } from "./lib/live-check";
import {
  activeMoves,
  autoAcceptEnabled,
  boardKey,
  type Candidate,
  type DirRow,
  emptyMoves,
  emptyPending,
  evaluate,
  expire,
  gateContext,
  type InboxMove,
  ISSUE_LABEL,
  issueBody,
  issuesOf,
  issueTitle,
  MAX_CHECKS_KEPT,
  MAX_CHECKS_PER_RUN,
  type MoveBoard,
  type MovesFile,
  mergeInbox,
  type PendingFile,
  type PendingMove,
  RECHECK_MS,
} from "./lib/moves";
import { sameCompany } from "./lib/slugs";
import { maxMsFromArgs, nextInTime } from "./lib/time-box";

/** New boards checked per old board in one run. */
const MAX_TO_CHECKS = 5;

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
  rejections: { from: string; to: string; reason: string }[];
};

/** What the run needs from GitHub issues (`gh` in production, a fake in tests). */
export type IssueApi = {
  find(title: string): { number: number; state: string; body: string } | null;
  view(n: number): { state: string; body: string } | null;
  create(title: string, body: string): number;
  edit(n: number, body: string): void;
  close(n: number, comment: string): void;
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
    auto_accept: autoAcceptEnabled(),
    rejections: [],
  };

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

  const ctx = gateContext({ now: started, directory: input.directory, denied: input.denied, contributions: input.contributions, moves, pending });

  // Old boards due a check: never checked first, then the longest ago. A rejected candidate is looked at
  // again only after a newer report of it.
  const due = (e: PendingMove) =>
    Object.values(e.candidates).some(open) && (!e.last_check_at || started.getTime() - Date.parse(e.last_check_at) >= RECHECK_MS || Object.values(e.candidates).some((c) => !c.gates));
  const queue = Object.entries(pending.moves)
    .filter(([, e]) => due(e))
    .sort(([, a], [, b]) => (a.last_check_at ?? "").localeCompare(b.last_check_at ?? ""));
  const cap = input.maxChecks ?? MAX_CHECKS_PER_RUN;
  const maxMs = input.maxMs ?? Infinity;

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
    if (fromRow && sameCompany(fromRow.name, e.name)) e.in_directory_at ??= nowIso;
    const cands = Object.entries(e.candidates).filter(([, c]) => open(c));

    // The cheap gates first: no network for a report that fails them anyway.
    const cheap = cands.map(([toKey, c]) => [toKey, c, evaluate(fromKey, e, toKey, c, { ...ctx, now })] as const);
    if (cheap.every(([, , g]) => g.result === "reject" || g.result === "removal")) {
      for (const [, c, g] of cheap) c.gates = g;
      continue;
    }

    const fromCheck = await input.check(e.from);
    e.checks = [...e.checks, { at: nowIso, status: fromCheck.status, ...(fromCheck.http ? { http: fromCheck.http } : isOk(fromCheck) ? { http: 200 } : {}) }].slice(-MAX_CHECKS_KEPT);
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
  }

  // Tally, and review issues for every old board with a passing candidate.
  for (const [fromKey, e] of Object.entries(pending.moves)) {
    for (const [toKey, c] of Object.entries(e.candidates)) {
      const r = c.gates?.result ?? "hold";
      if (r === "pass") summary.passed++;
      else if (r === "hold") summary.held++;
      else if (r === "removal") summary.removals++;
      else {
        summary.rejected++;
        if (summary.rejections.length < 20) summary.rejections.push({ from: fromKey, to: toKey, reason: c.gates?.reason ?? "" });
      }
    }
    if (input.issues) syncIssue(fromKey, e, input.issues, summary);
  }
  summary.pending = Object.keys(pending.moves).length;
  return summary;
}

/**
 * Open or update the one review issue for an old board. Opened only when a candidate passes; a
 * closed issue is never reopened or recreated (a maintainer closed it: refused, or spam).
 */
export function syncIssue(fromKey: string, e: PendingMove, api: IssueApi, summary: Pick<Summary, "issues_opened" | "issues_updated">): void {
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
  if (current && current.state.toUpperCase() !== "OPEN") return;
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
  const moves = readJson<MovesFile>(join(dir, "moves.json"), emptyMoves());
  const directory = (JSON.parse(readFileSync(directoryFile, "utf8")) as { companies: DirRow[] }).companies;
  if (!Array.isArray(directory) || !directory.length) throw new Error(`${directoryFile}: no companies`);
  const http = new HttpClient({ retries: 1, hostDelayMs: 300, timeoutMs: 20_000, userAgent: "RawJobs-catalog/0.1 (open-source job radar; checking shared boards)" });
  if (autoAcceptEnabled()) console.error("AUTO_ACCEPT is set, but auto-accept isn't built yet: every move still goes to review.");

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
  });
  writeFileAtomic(pendingFile, `${JSON.stringify(pending, null, 1)}\n`);
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
