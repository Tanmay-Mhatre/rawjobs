/**
 * Moved careers pages, as users report them ("Acme's Lever board is gone; it's on Ashby now"):
 * the shapes kept in the directory repo, and the gates every report must pass. Shared by
 * moves.ts (the scheduled review), moves-approve.ts (a maintainer's approval), build.ts and guard.ts.
 *
 * Contract (docs/plans/update-careers-link-plan.md, "Appendix: shared contract (v1)"):
 *   moves-pending.json  { version: 1, moves: { [fromKey]: PendingMove } }
 *   moves.json          { version: 1, moves: MoveRecord[] }
 *   directory.json      moves: [{ from: fromKey, to: toKey, name, accepted_at }] (accepted, not reverted)
 * A board key is `ats:slug|shard|site`, lowercased (the inbox Worker's boardKey).
 *
 *   moves-blocked.json  { version: 1, blocked: BlockedMove[] }   refused or reverted: never reviewed again
 *   moves-baselines.json { version: 1, pages: { [dirKey]: Baseline } } (lib/evidence.ts)
 *
 * A move reaches moves.json through a maintainer's approval (moves-approve.ts, by: "review"), or, with
 * AUTO_ACCEPT on, through company-owned evidence (moves.ts, by: "auto"; docs/plans/archive/auto-accept-moves.md).
 * An auto move ships only once a second check of that evidence, a day later, confirms it (confirmed_at).
 */
import { createHash } from "node:crypto";
import { careersUrl, companyKey } from "@rawjobs/core";
import { cleanBoard, type SharedBoard } from "../contributions";
import type { Denylist } from "./denylist";
import type { CheckResult } from "./live-check";
import { normalizeName, sameCompany } from "./slugs";

export type MoveBoard = { ats: string; slug: string; region?: string; shard?: string; site?: string };
export type MoveCheck = {
  at: string;
  status: CheckResult["status"];
  http?: number;
  /** The board's own host (a vendor-provisioned one) doesn't exist in DNS. */
  nxdomain?: true;
};
export type GoneVerdict = "proven" | "not_proven" | "waiting" | "live" | "unchecked";
export type GateResult = "pass" | "hold" | "reject" | "removal";
export type Gates = {
  checked_at: string;
  result: GateResult;
  reason?: string;
  /** 1. Neither board nor the name is on the denylist. */
  denylist: boolean;
  /** 2. `from` is (or was, when first seen) in the directory under that name. */
  in_directory: boolean;
  /** 3. Is the old board gone? */
  gone: GoneVerdict;
  /** 4. The new board's own live check (only once the old one is gone or not proven). */
  to_live?: { status: CheckResult["status"]; jobs: number | null; name?: string };
  /** 5. `to` in the directory: not there, the same company, a different company, or contributed under 30 days ago. */
  to_company: "new" | "same" | "different" | "too_new";
  /** 6. No chains or cycles. */
  chain: boolean;
  /** 7. Another live board of the same company (then it's a removal, not a move). */
  other_live_board?: string;
};
/** What the company's own page says about a candidate, and what that allows (lib/evidence.ts decide). */
export type CandidateEvidence = {
  at: string;
  finding: "match" | "other" | "several" | "none" | "unknown";
  kind?: "S1" | "S2";
  /** auto: accepted without a person (when AUTO_ACCEPT is on); fast: the evidence holds, a person approves; manual: no usable evidence. */
  verdict: "auto" | "fast" | "manual";
  /** Why not auto (or not fast). */
  reasons: string[];
  /** The board the page points at, when it isn't this candidate. */
  points?: string;
  registered?: string;
  baseline_swap?: boolean;
};
export type Candidate = { to: MoveBoard; reporters: number; first_at: string; last_at: string; gates?: Gates; issue?: number; evidence?: CandidateEvidence };
export type PendingMove = {
  name: string;
  from: MoveBoard;
  first_gone_at?: string;
  last_check_at?: string;
  checks: MoveCheck[];
  candidates: Record<string, Candidate>;
  expires_at: string;
  /** When `from` was last seen in the directory under this name (the build drops dead boards, so it may be gone since). */
  in_directory_at?: string;
  /** The company-hosted careers page the directory had for `from` (lib/evidence.ts trustedUrlOf), kept from the first sight. */
  trusted_url?: string;
  /** The company page points at a board no one reported (a person checks it). */
  unreported?: string;
};
export type PendingFile = { version: 1; moves: Record<string, PendingMove> };
export type MoveRecord = {
  from: MoveBoard;
  to: MoveBoard;
  name: string;
  accepted_at: string;
  by: "auto" | "review";
  evidence: string[];
  issue?: number;
  reverted?: true;
  reverted_at?: string;
  /** Auto moves: the company page the evidence came from, each time it was seen to still hold, and when a check a day later confirmed it (only then is it published). */
  evidence_url?: string;
  verified?: string[];
  confirmed_at?: string;
};
export type MovesFile = { version: 1; moves: MoveRecord[] };
export type DirectoryMove = { from: string; to: string; name: string; accepted_at: string };
/** One row of the published directory, as far as the gates need it. */
export type DirRow = { key: string; name: string; status?: string; careers_url?: string; tags?: string[] };
/** A move nobody may make again: a maintainer closed its review, or an auto move was reverted. Lifted only by editing the file. */
export type BlockedMove = { from: string; to: string; at: string; why: string; issue?: number };
export type BlockedFile = { version: 1; blocked: BlockedMove[] };
/** An inbox item from GET /v1/moves/pending. */
export type InboxMove = { id: string; name?: unknown; from?: unknown; to?: unknown; reporters?: unknown; first_at?: unknown; last_at?: unknown };

export const DAY_MS = 86_400_000;
/** Holds (and rejected reports) are dropped this long after the move was first reported. */
export const HOLD_DAYS = 30;
/** A `to` contributed more recently than this can't be a move target (a pre-planted fake "Acme"). */
export const MIN_TO_AGE_DAYS = 30;
/** Network checks per run: one per old board (plus its candidates' new boards). */
export const MAX_CHECKS_PER_RUN = 50;
/** An old board is checked again at most this often (two checks ≥ 24 h apart prove it's gone). */
export const RECHECK_MS = 6 * 60 * 60_000;
/** Kept per pending move. */
export const MAX_CHECKS_KEPT = 20;
export const MAX_CANDIDATES = 10;
/** Systems where a 404/410 really means the board was deleted. Elsewhere (SmartRecruiters, Workday, page reads) it isn't proof. */
export const PROVABLE_GONE = new Set(["greenhouse", "lever", "ashby"]);

/** The inbox Worker's board key: `ats:slug|shard|site`, lowercased. */
export const boardKey = (b: MoveBoard): string => `${b.ats}:${b.slug}|${b.shard ?? ""}|${b.site ?? ""}`.toLowerCase();

/** A board key back to the parts companyKey needs (slugs never contain ":" or "|"). */
export function parseBoardKey(key: string): MoveBoard | null {
  const m = /^([a-z0-9]+):([^|:]+)\|([^|]*)\|([^|]*)$/.exec(key);
  if (!m) return null;
  return { ats: m[1]!, slug: m[2]!, ...(m[3] ? { shard: m[3] } : {}), ...(m[4] ? { site: m[4] } : {}) };
}

/** The directory key (companyKey) of a board key. */
export const dirKeyOf = (key: string): string | null => {
  const b = parseBoardKey(key);
  return b ? companyKey(b) : null;
};

/** A short, stable id for one candidate, used in the review issue's checkboxes. */
export const candidateId = (fromKey: string, toKey: string): string => `m-${createHash("sha256").update(`${fromKey}>${toKey}`).digest("hex").slice(0, 10)}`;

export function cleanName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const n = name
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .trim()
    .slice(0, 120);
  return n || null;
}

const asBoard = (raw: unknown): MoveBoard | null => {
  const b = cleanBoard(raw as SharedBoard);
  if (typeof b === "string") return null;
  const { name: _drop, ...board } = b;
  return board;
};
const isoOr = (v: unknown, fallback: string) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : fallback);

export const emptyPending = (): PendingFile => ({ version: 1, moves: {} });
export const emptyMoves = (): MovesFile => ({ version: 1, moves: [] });
export const emptyBlocked = (): BlockedFile => ({ version: 1, blocked: [] });
const pairKey = (from: string, to: string) => `${from}>${to}`;
/** Block a move for good (once). Returns whether it was new. */
export function block(file: BlockedFile, entry: BlockedMove): boolean {
  if (file.blocked.some((b) => b.from === entry.from && b.to === entry.to)) return false;
  file.blocked.push(entry);
  return true;
}

/**
 * Copy inbox items into the pending file, keyed by the old board, with a set of candidate new
 * boards. Items that aren't well-shaped are dropped (and still acknowledged). The reporter count
 * per candidate is the largest the inbox has reported: the inbox forgets its reporter hashes when
 * an item is acknowledged, so adding counts up would count the same person again.
 */
export function mergeInbox(pending: PendingFile, items: readonly InboxMove[], now: Date): { added: number; invalid: { id: string; reason: string }[] } {
  const nowIso = now.toISOString();
  const invalid: { id: string; reason: string }[] = [];
  let added = 0;
  for (const item of items) {
    const id = String(item.id);
    const name = cleanName(item.name);
    const from = asBoard(item.from);
    const to = asBoard(item.to);
    if (!name || !from || !to) {
      invalid.push({ id, reason: !name ? "no name" : !from ? "bad from" : "bad to" });
      continue;
    }
    const fromKey = boardKey(from);
    const toKey = boardKey(to);
    if (fromKey === toKey) {
      invalid.push({ id, reason: "from is to" });
      continue;
    }
    const entry = (pending.moves[fromKey] ??= { name, from, checks: [], candidates: {}, expires_at: new Date(now.getTime() + HOLD_DAYS * DAY_MS).toISOString() });
    const reporters = typeof item.reporters === "number" && Number.isFinite(item.reporters) ? Math.max(0, Math.min(1000, Math.floor(item.reporters))) : 1;
    const first = isoOr(item.first_at, nowIso);
    const last = isoOr(item.last_at, nowIso);
    const c = entry.candidates[toKey];
    if (c) {
      c.reporters = Math.max(c.reporters, reporters);
      if (first < c.first_at) c.first_at = first;
      if (last > c.last_at) c.last_at = last;
      continue;
    }
    if (Object.keys(entry.candidates).length >= MAX_CANDIDATES) {
      invalid.push({ id, reason: "too many candidates" });
      continue;
    }
    entry.candidates[toKey] = { to, reporters, first_at: first, last_at: last };
    added++;
  }
  return { added, invalid };
}

/** Drop holds past their date. Returns what was dropped (with any review issues to close). */
export function expire(pending: PendingFile, now: Date): { fromKey: string; issues: number[] }[] {
  const out: { fromKey: string; issues: number[] }[] = [];
  for (const [fromKey, e] of Object.entries(pending.moves)) {
    if (Date.parse(e.expires_at) > now.getTime()) continue;
    out.push({ fromKey, issues: issuesOf(e) });
    delete pending.moves[fromKey];
  }
  return out;
}

export const issuesOf = (e: PendingMove): number[] => [...new Set(Object.values(e.candidates).flatMap((c) => (c.issue ? [c.issue] : [])))];

/** Accepted moves that weren't reverted. */
export const activeMoves = (file: MovesFile): MoveRecord[] => file.moves.filter((m) => !m.reverted);

/**
 * Gate 3: is the old board gone? Looks at the checks since the last one that answered (200).
 * Proven: a 404/410 on two checks at least 24 h apart, on a system where that means deleted, or a
 * vendor-provisioned host (lib/evidence.ts VENDOR_HOST_SUFFIXES) that is NXDOMAIN on two checks 24 h apart.
 * Not proven: no answer for 24 h, but not that kind of proof (SmartRecruiters' 0 jobs, a page read's
 * "not found", Workday, timeouts): a maintainer decides. Waiting: not 24 h yet. Live: it answers.
 */
export function goneVerdict(ats: string, checks: readonly MoveCheck[]): GoneVerdict {
  if (!checks.length) return "unchecked";
  let lastOk = -1;
  checks.forEach((c, i) => {
    if (c.status === "live" || c.status === "dormant") lastOk = i;
  });
  const tail = checks.slice(lastOk + 1);
  if (!tail.length) return "live";
  const t = (c: MoveCheck) => Date.parse(c.at);
  const hard = tail.filter((c) => PROVABLE_GONE.has(ats) && c.status === "dead" && (c.http === 404 || c.http === 410));
  if (hard.length >= 2 && t(hard[hard.length - 1]!) - t(hard[0]!) >= DAY_MS) return "proven";
  // A vendor-provisioned host (Taleo, Workday, Oracle, SuccessFactors) that doesn't exist in DNS, twice, a day apart.
  const nx = tail.filter((c) => c.nxdomain);
  if (nx.length >= 2 && t(nx[nx.length - 1]!) - t(nx[0]!) >= DAY_MS) return "proven";
  if (t(tail[tail.length - 1]!) - t(tail[0]!) >= DAY_MS) return "not_proven";
  return "waiting";
}

export type GateContext = {
  now: Date;
  /** The directory, by companyKey. */
  directory: Map<string, DirRow>;
  denied: Denylist;
  /** When each contributed board (by companyKey) was first added. */
  contributedAt: Map<string, string>;
  /** Accepted, not reverted. */
  accepted: readonly MoveRecord[];
  /** Every old board with a pending report. */
  pendingFrom: ReadonlySet<string>;
  /** Blocked moves, as "from>to" board keys. */
  blocked: ReadonlySet<string>;
};

export function gateContext(opts: {
  now: Date;
  directory: readonly DirRow[];
  denied: Denylist;
  contributions?: readonly { key: string; added_at?: string }[];
  moves: MovesFile;
  pending: PendingFile;
  blocked?: BlockedFile;
}): GateContext {
  const contributedAt = new Map<string, string>();
  for (const c of opts.contributions ?? []) if (c.key && c.added_at && !contributedAt.has(c.key)) contributedAt.set(c.key, c.added_at);
  return {
    now: opts.now,
    directory: new Map(opts.directory.map((r) => [r.key, r])),
    denied: opts.denied,
    contributedAt,
    accepted: activeMoves(opts.moves),
    pendingFrom: new Set(Object.keys(opts.pending.moves)),
    blocked: new Set((opts.blocked?.blocked ?? []).map((b) => pairKey(b.from, b.to))),
  };
}

/**
 * Every gate for one candidate. `toCheck` is the new board's live check, when one was made (only
 * once the old board is gone or not proven). Gates run cheapest first and stop at the first refusal.
 */
export function evaluate(fromKey: string, entry: PendingMove, toKey: string, cand: Candidate, ctx: GateContext, toCheck?: CheckResult): Gates {
  const gates: Gates = {
    checked_at: ctx.now.toISOString(),
    result: "pass",
    denylist: true,
    in_directory: true,
    gone: goneVerdict(entry.from.ats, entry.checks),
    to_company: "new",
    chain: true,
  };
  const done = (result: GateResult, reason: string): Gates => ({ ...gates, result, reason });
  const fromDir = companyKey(entry.from);
  const toDir = companyKey(cand.to);

  // 0. Refused or reverted before: never again (lifted only by editing moves-blocked.json).
  if (ctx.blocked.has(pairKey(fromKey, toKey))) return done("reject", "blocked: refused or reverted before");

  // 1. Denylist: neither side, nor the name.
  if (
    ctx.denied({ key: fromDir, name: entry.name, careers_url: careersUrl(entry.from as never) }) ||
    ctx.denied({ key: toDir, careers_url: careersUrl(cand.to as never) }) ||
    (ctx.directory.get(toDir) && ctx.denied({ name: ctx.directory.get(toDir)!.name }))
  ) {
    gates.denylist = false;
    return done("reject", "denylist");
  }

  // 2. `from` is in the directory under that name (now, or when it was first seen: the build drops dead boards).
  const row = ctx.directory.get(fromDir);
  if (!(row && sameCompany(row.name, entry.name)) && !entry.in_directory_at) {
    gates.in_directory = false;
    return done("reject", row ? "from is in the directory under another name" : "from is not in the directory");
  }

  // 6. No chains or cycles: `to` isn't an old board itself, `from` hasn't moved already, and `from` isn't where something moved to.
  const acceptedFrom = new Set(ctx.accepted.map((m) => boardKey(m.from)));
  const acceptedTo = new Set(ctx.accepted.map((m) => boardKey(m.to)));
  if (acceptedFrom.has(fromKey)) {
    gates.chain = false;
    return done("reject", "from has already moved");
  }
  if (acceptedFrom.has(toKey) || ctx.pendingFrom.has(toKey)) {
    gates.chain = false;
    return done("reject", "to is itself reported as moved (chain)");
  }
  if (acceptedTo.has(fromKey)) {
    gates.chain = false;
    return done("reject", "from is where another company moved to (chain)");
  }

  // 5. `to` isn't a different company; a same-name entry is fine; a recent contribution isn't.
  const toRow = ctx.directory.get(toDir);
  if (toRow) gates.to_company = sameCompany(toRow.name, entry.name) ? "same" : "different";
  if (gates.to_company === "different") return done("reject", "to is a different company in the directory");
  const contributed = ctx.contributedAt.get(toDir);
  if (contributed && ctx.now.getTime() - Date.parse(contributed) < MIN_TO_AGE_DAYS * DAY_MS) {
    gates.to_company = "too_new";
    return done("reject", `to was first contributed under ${MIN_TO_AGE_DAYS} days ago`);
  }

  // 7. Another live board of the same company: that's a removal, not a move.
  const name = normalizeName(entry.name);
  for (const r of ctx.directory.values()) {
    if (r.status === "live" && r.key !== fromDir && r.key !== toDir && normalizeName(r.name) === name) {
      gates.other_live_board = r.key;
      return done("removal", `the company has another live board (${r.key})`);
    }
  }

  // 3. The old board is gone (or not provably: then a maintainer decides).
  if (gates.gone === "live") return done("hold", "from still answers");
  if (gates.gone === "waiting" || gates.gone === "unchecked") return done("hold", "waiting for a second check 24 h later");

  // 4. The new board is live with open jobs.
  if (!toCheck) return done("hold", "to not checked yet");
  gates.to_live = { status: toCheck.status, jobs: toCheck.jobs, ...(toCheck.name ? { name: toCheck.name } : {}) };
  if (toCheck.status !== "live") return done("reject", `to is ${toCheck.status}`);
  return gates;
}

/**
 * AUTO_ACCEPT=1|true (the MOVES_AUTO_ACCEPT repo variable): accept moves whose verdict is "auto"
 * without a person. Off, the verdict is still worked out and shown on the review issue (shadow mode).
 */
export function autoAcceptEnabled(env = process.env): boolean {
  return env.AUTO_ACCEPT === "1" || env.AUTO_ACCEPT === "true";
}

// ---- review issues ----

export const ISSUE_LABEL = "move-review";
export const APPROVE_LABEL = "move-approved";
export const issueTitle = (fromKey: string) => `Move review: ${fromKey}`;

/** Text that only ever goes inside a code block: no mentions, no backticks, no control characters. */
export function codeSafe(s: string): string {
  return (
    s
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/[@`]/g, "")
      .slice(0, 120)
  );
}

const boardLine = (b: MoveBoard) => codeSafe([b.ats, b.slug, b.region === "eu" ? "region eu" : "", b.shard ? `shard ${b.shard}` : "", b.site ? `site ${b.site}` : ""].filter(Boolean).join(" "));
/** Only links we compute from a checked board shape (never anything a reporter typed). */
const link = (b: MoveBoard) => {
  const url = careersUrl(b as never);
  return /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~/?=&%-]*)?$/.test(url) ? `<${url}>` : "(no link)";
};
const goneText: Record<GoneVerdict, string> = {
  proven: "gone (404/410, or its host missing from DNS, on two checks 24 h apart)",
  not_proven: "not answering for 24 h, but not proven gone: check it",
  waiting: "waiting for a second check",
  live: "still answers",
  unchecked: "not checked yet",
};
function gatesText(g: Gates | undefined): string {
  if (!g) return "not checked yet";
  const parts = [
    g.result === "pass" ? "**passes the gates**" : `**${g.result}**${g.reason ? `: ${g.reason}` : ""}`,
    `old board ${goneText[g.gone]}`,
    g.to_live ? `new board ${g.to_live.status}${g.to_live.jobs !== null ? ` (${g.to_live.jobs} jobs)` : ""}` : "",
    g.to_company === "same" ? "new board already in the directory under the same name" : g.to_company === "new" ? "new board not in the directory yet" : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

/** Ticked candidate ids in an issue body ("- [x] Approve `m-…`"). */
export function tickedIds(body: string): string[] {
  return [...body.matchAll(/^\s*[-*] \[[xX]\] .*?`(m-[0-9a-f]{10})`/gm)].map((m) => m[1]!);
}

/** The review issue's body for one old board. Ticks already in `previousBody` are kept. */
export function issueBody(fromKey: string, e: PendingMove, previousBody = ""): string {
  const ticked = new Set(tickedIds(previousBody));
  const cands = Object.entries(e.candidates).sort(([, a], [, b]) => b.reporters - a.reporters);
  const passing = cands.filter(([, c]) => c.gates?.result === "pass");
  // Fast-track: the company's own page points at exactly one passing candidate; its box starts ticked.
  const fast = passing.filter(([, c]) => c.evidence && c.evidence.verdict !== "manual");
  if (!tickedIds(previousBody).length && fast.length === 1) ticked.add(candidateId(fromKey, fast[0]![0]));
  const code = [
    `name: ${codeSafe(e.name)}`,
    `from: ${boardLine(e.from)}`,
    `      key ${codeSafe(fromKey)}`,
    ...cands.flatMap(([toKey, c]) => [`${candidateId(fromKey, toKey)} -> ${boardLine(c.to)}`, `      key ${codeSafe(toKey)}`]),
  ];
  const lines = [
    "<!-- rawjobs move review v1 -->",
    "Users reported that this company's careers page moved. Nothing changes until a maintainer approves it, or, with auto-accept on, the company's own careers page proves it.",
    "",
    "Reported names and boards (as sent, not links):",
    "",
    "```text",
    ...code,
    "```",
    "",
    `Old page (computed): ${link(e.from)}`,
    `Checks of the old page: ${e.checks.length}${e.first_gone_at ? `, first not answering ${e.first_gone_at.slice(0, 16).replace("T", " ")} UTC` : ""}.`,
    "",
    "### Candidates",
    "",
    ...cands.map(([toKey, c]) => {
      const id = candidateId(fromKey, toKey);
      const head = c.gates?.result === "pass" ? `- [${ticked.has(id) ? "x" : " "}] Approve \`${id}\`` : `- \`${id}\``;
      return `${head}: ${link(c.to)} · ${c.reporters} report${c.reporters === 1 ? "" : "s"} · ${gatesText(c.gates)}`;
    }),
    "",
    ...evidenceLines(fromKey, e, cands),
    "### To approve",
    "",
    passing.length > 1
      ? `More than one candidate passes. Tick exactly one box above, then add the \`${APPROVE_LABEL}\` label.`
      : `Add the \`${APPROVE_LABEL}\` label${passing.length === 1 ? "" : " once a candidate passes"}.`,
    "Only a label added by someone with maintain or admin access counts. The approval reads the move from",
    "`moves-pending.json` in the directory repo (never from this text), checks every gate again, then adds it",
    "to `moves.json`; it reaches apps with the next directory release. To refuse, close this issue.",
    "",
  ];
  return lines.join("\n");
}

const verdictText: Record<CandidateEvidence["verdict"], string> = {
  auto: "would be accepted automatically (when auto-accept is on)",
  fast: "fast-track: the company's own page points here; approve if it looks right",
  manual: "no usable company evidence",
};
const findingText: Record<CandidateEvidence["finding"], string> = {
  match: "the company page points at this board",
  other: "the company page points at another board",
  several: "the company page links several boards",
  none: "the company page links no board",
  unknown: "the company page couldn't be read",
};

/** The evidence section of a review issue: computed values only, inside a code block, no links. */
function evidenceLines(fromKey: string, e: PendingMove, cands: [string, Candidate][]): string[] {
  const withEv = cands.filter(([, c]) => c.evidence);
  if (!withEv.length && !e.unreported) return [];
  const code: string[] = [];
  if (e.trusted_url) code.push(`company page: ${codeSafe(e.trusted_url)}`);
  for (const [toKey, c] of withEv) {
    const ev = c.evidence!;
    code.push(`${candidateId(fromKey, toKey)}: ${findingText[ev.finding]}${ev.kind ? ` (${ev.kind})` : ""}`);
    code.push(`      ${verdictText[ev.verdict]}`);
    if (ev.points) code.push(`      points at ${codeSafe(ev.points)}`);
    if (ev.registered) code.push(`      domain registered ${ev.registered.slice(0, 10)}`);
    if (ev.baseline_swap) code.push("      the page linked the old board before the report, and only this one now");
    for (const r of ev.reasons.slice(0, 6)) code.push(`      not auto: ${codeSafe(r)}`);
  }
  if (e.unreported) code.push(`the company page points at ${codeSafe(e.unreported)}, which no one reported: check it by hand`);
  return ["### Company evidence", "", "```text", ...code, "```", ""];
}

/**
 * Which candidate an approval is for: the only passing one, or the one ticked in the issue body
 * (exactly one, and it must be a passing candidate of this old board).
 */
export function chooseCandidate(fromKey: string, e: PendingMove, issue: number, body: string): { toKey: string } | { error: string } {
  const passing = Object.entries(e.candidates).filter(([, c]) => c.issue === issue && c.gates?.result === "pass");
  if (!passing.length) return { error: "No candidate on this issue passes the gates now." };
  if (passing.length === 1 && !tickedIds(body).length) return { toKey: passing[0]![0] };
  const byId = new Map(passing.map(([toKey]) => [candidateId(fromKey, toKey), toKey]));
  const ticked = [...new Set(tickedIds(body))];
  if (ticked.length !== 1) return { error: `Tick exactly one candidate (${ticked.length} ticked), then add the label again.` };
  const toKey = byId.get(ticked[0]!);
  return toKey ? { toKey } : { error: "The ticked candidate doesn't pass the gates (or isn't on this issue)." };
}

/**
 * Who may approve: maintain or admin on the code repo. `role` is the answer of
 * GET /repos/{owner}/{repo}/collaborators/{user}/permission.
 */
export function canApprove(role: { role_name?: unknown; permission?: unknown } | null | undefined): boolean {
  if (!role) return false;
  return role.role_name === "admin" || role.role_name === "maintain" || role.permission === "admin";
}

/** Find the pending move a review issue is about (by the issue number recorded on its candidates). */
export function findByIssue(pending: PendingFile, issue: number): [string, PendingMove] | null {
  for (const [fromKey, e] of Object.entries(pending.moves)) if (Object.values(e.candidates).some((c) => c.issue === issue)) return [fromKey, e];
  return null;
}

// ---- build and guard ----

/**
 * The `moves` list for directory.json: accepted, not reverted, and only those whose new board is
 * in the directory being built. Also returns the directory keys of every moved-away board, which
 * the build leaves out (never scanned or indexed again).
 */
export function directoryMoves(file: MovesFile, companyKeys: ReadonlySet<string>): { moves: DirectoryMove[]; movedAway: Set<string>; missingTo: string[] } {
  const moves: DirectoryMove[] = [];
  const movedAway = new Set<string>();
  const missingTo: string[] = [];
  const seen = new Set<string>();
  for (const m of activeMoves(file)) {
    // An auto move ships only once a second look at the company page, a day later, confirmed it.
    if (m.by === "auto" && !m.confirmed_at) continue;
    const from = boardKey(m.from);
    if (seen.has(from)) continue; // one move per old board: the first accepted wins
    seen.add(from);
    movedAway.add(companyKey(m.from));
    if (!companyKeys.has(companyKey(m.to))) {
      missingTo.push(boardKey(m.to));
      continue;
    }
    moves.push({ from, to: boardKey(m.to), name: m.name, accepted_at: m.accepted_at });
  }
  return { moves, movedAway, missingTo };
}

/**
 * moves.json is consistent: at most one active move per old board. The approval and the scheduled run
 * both write it and rebase before pushing, so this runs again after every rebase (moves-lint.ts).
 */
export function checkMoves(file: MovesFile): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const m of activeMoves(file)) {
    const from = boardKey(m.from);
    const to = boardKey(m.to);
    const earlier = seen.get(from);
    if (earlier !== undefined && earlier !== to) problems.push(`${from} has two active moves (${earlier}, ${to})`);
    seen.set(from, to);
  }
  return problems;
}
