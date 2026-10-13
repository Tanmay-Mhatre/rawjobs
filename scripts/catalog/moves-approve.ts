/**
 * A maintainer approved a move: the `move-approved` label on a "Move review" issue
 * (.github/workflows/directory-move-approval.yml).
 *
 *   ISSUE_NUMBER=… SENDER=… GITHUB_REPOSITORY=… GH_TOKEN=… DENYLIST_FILE=… \
 *   pnpm exec tsx scripts/catalog/moves-approve.ts --dir directory-repo --directory live-directory.json --out result.json
 *
 * 1. The label counts only if SENDER has maintain or admin access (asked of GitHub, not the event).
 * 2. The move is read from moves-pending.json by the issue number recorded there, never from the
 *    issue's title or body. The body only says which candidate, when several pass (one ticked box,
 *    matched against ids computed from the pending file).
 * 3. Every gate runs again, with fresh checks of both boards.
 * 4. It passes: the move is added to moves.json (by: "review"). The workflow commits it, comments
 *    and closes the issue. It fails: the workflow comments why and takes the label off.
 *
 * result.json: { action: "ignore" | "approve" | "refuse", comment?: string }
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HttpClient } from "@rawjobs/core";
import { readDenylist, type Denylist } from "./lib/denylist";
import { writeFileAtomic } from "./lib/fs";
import type { CheckResult } from "./lib/live-check";
import {
  boardKey,
  canApprove,
  chooseCandidate,
  codeSafe,
  type DirRow,
  emptyMoves,
  emptyPending,
  evaluate,
  findByIssue,
  gateContext,
  MAX_CHECKS_KEPT,
  type MoveBoard,
  type MovesFile,
  type PendingFile,
} from "./lib/moves";
import { checkerFor } from "./moves";

export type ApproveResult = { action: "ignore" | "approve" | "refuse"; comment?: string };

/** The decision, with GitHub and the network passed in (so the rules can be tested). */
export async function approve(input: {
  issue: number;
  sender: string;
  role: { role_name?: unknown; permission?: unknown } | null;
  body: string;
  pending: PendingFile;
  moves: MovesFile;
  directory: DirRow[];
  contributions: { key: string; added_at?: string }[];
  denied: Denylist;
  check: (b: MoveBoard) => Promise<CheckResult>;
  now?: Date;
}): Promise<ApproveResult> {
  if (!canApprove(input.role)) return { action: "ignore" };
  const now = input.now ?? new Date();
  const found = findByIssue(input.pending, input.issue);
  if (!found) return { action: "refuse", comment: "This issue's move isn't in `moves-pending.json` any more (expired, or already handled). Nothing was changed." };
  const [fromKey, stored] = found;
  const choice = chooseCandidate(fromKey, stored, input.issue, input.body);
  if ("error" in choice) return { action: "refuse", comment: `${choice.error} Nothing was changed.` };
  const { toKey } = choice;
  const cand = stored.candidates[toKey]!;

  // Every gate again, with fresh checks (on a copy: the pending file is the scheduled run's to write).
  const fromCheck = await input.check(stored.from);
  const ok = fromCheck.status === "live" || fromCheck.status === "dormant";
  const e = {
    ...stored,
    checks: [...stored.checks, { at: now.toISOString(), status: fromCheck.status, ...(fromCheck.http ? { http: fromCheck.http } : ok ? { http: 200 } : {}) }].slice(-MAX_CHECKS_KEPT),
  };
  const ctx = gateContext({ now, directory: input.directory, denied: input.denied, contributions: input.contributions, moves: input.moves, pending: input.pending });
  // This move's own old board is pending, of course; only other pending old boards make a chain.
  const pendingFrom = new Set(ctx.pendingFrom);
  pendingFrom.delete(fromKey);
  const g = evaluate(fromKey, e, toKey, cand, { ...ctx, pendingFrom }, await input.check(cand.to));
  if (g.result !== "pass") return { action: "refuse", comment: `The gates don't pass any more (${g.result}: ${g.reason ?? "no reason"}). Nothing was changed.` };

  const evidence = [
    `old board: ${g.gone === "proven" ? "gone (404/410 on two checks 24 h apart)" : "not answering for 24 h (not proven gone)"}`,
    `new board: live${g.to_live?.jobs !== null && g.to_live?.jobs !== undefined ? ` with ${g.to_live.jobs} jobs` : ""}`,
    `reports: ${cand.reporters}`,
    `approved in issue #${input.issue}`,
  ];
  input.moves.moves.push({ from: stored.from, to: cand.to, name: stored.name, accepted_at: now.toISOString(), by: "review", evidence, issue: input.issue });
  return {
    action: "approve",
    comment: [
      "Approved: added to `moves.json`. Apps get it with the next directory release.",
      "",
      "```text",
      `from ${codeSafe(fromKey)}`,
      `to   ${codeSafe(boardKey(cand.to))}`,
      "```",
      "",
      ...evidence.map((x) => `- ${x}`),
    ].join("\n"),
  };
}

async function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const dir = arg("--dir");
  const directoryFile = arg("--directory");
  const out = arg("--out");
  const issue = Number(process.env.ISSUE_NUMBER);
  const sender = process.env.SENDER ?? "";
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  if (!dir || !directoryFile || !out || !Number.isInteger(issue) || !sender || !repo) throw new Error("Usage: ISSUE_NUMBER, SENDER, GITHUB_REPOSITORY; moves-approve.ts --dir … --directory … --out …");
  const gh = (args: string[]) => execFileSync("gh", args, { encoding: "utf8" });
  const readJson = <T>(path: string, fallback: T): T => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback);

  let role: { role_name?: unknown; permission?: unknown } | null = null;
  try {
    role = JSON.parse(gh(["api", `repos/${repo}/collaborators/${encodeURIComponent(sender)}/permission`]));
  } catch {
    role = null; // not a collaborator
  }
  if (!canApprove(role)) {
    console.log(`The label was added by someone without maintain or admin access: ignored.`);
    writeFileAtomic(out, JSON.stringify({ action: "ignore" }));
    return;
  }
  const body = (JSON.parse(gh(["issue", "view", String(issue), "-R", repo, "--json", "body"])) as { body: string }).body ?? "";
  const movesFile = join(dir, "moves.json");
  const moves = readJson<MovesFile>(movesFile, emptyMoves());
  const http = new HttpClient({ retries: 1, hostDelayMs: 300, timeoutMs: 20_000, userAgent: "RawJobs-catalog/0.1 (open-source job radar; checking shared boards)" });
  const result = await approve({
    issue,
    sender,
    role,
    body,
    pending: readJson<PendingFile>(join(dir, "moves-pending.json"), emptyPending()),
    moves,
    directory: (JSON.parse(readFileSync(directoryFile, "utf8")) as { companies: DirRow[] }).companies,
    contributions: readJson<{ companies: { key: string; added_at?: string }[] }>(join(dir, "contributions.json"), { companies: [] }).companies,
    denied: readDenylist(),
    check: checkerFor(http),
  });
  if (result.action === "approve") writeFileAtomic(movesFile, `${JSON.stringify(moves, null, 1)}\n`);
  writeFileAtomic(out, JSON.stringify(result));
  console.log(`${result.action}${result.comment ? `: ${result.comment.split("\n")[0]}` : ""}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
