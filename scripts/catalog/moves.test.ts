import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CheckResult } from "./lib/live-check";
import {
  boardKey,
  canApprove,
  candidateId,
  chooseCandidate,
  type DirRow,
  directoryMoves,
  emptyMoves,
  emptyPending,
  evaluate,
  expire,
  gateContext,
  goneVerdict,
  type InboxMove,
  issueBody,
  mergeInbox,
  type MoveBoard,
  type MoveCheck,
  type MovesFile,
  type PendingFile,
  parseBoardKey,
  tickedIds,
} from "./lib/moves";
import { approve } from "./moves-approve";
import { type IssueApi, runReview } from "./moves";

const H = 3_600_000;
const T0 = new Date("2026-10-10T00:00:00Z");
const at = (hours: number) => new Date(T0.getTime() + hours * H);
const iso = (hours: number) => at(hours).toISOString();

const ACME_LEVER: MoveBoard = { ats: "lever", slug: "acme" };
const ACME_ASHBY: MoveBoard = { ats: "ashby", slug: "acme" };
const FROM = boardKey(ACME_LEVER); // lever:acme||
const TO = boardKey(ACME_ASHBY);

const DIRECTORY: DirRow[] = [
  { key: "lever:acme", name: "Acme", status: "live" },
  { key: "greenhouse:other", name: "Other Corp", status: "live" },
  { key: "ashby:otherco", name: "Kraken Robotics", status: "live" },
];
const item = (over: Partial<InboxMove> = {}): InboxMove => ({ id: "1", name: "Acme", from: ACME_LEVER, to: ACME_ASHBY, reporters: 2, first_at: iso(0), last_at: iso(0), ...over });
const noDeny = () => false;

/** A pretend network: each board key answers what the test says, in turn (the last answer repeats). */
function network(answers: Record<string, CheckResult[]>) {
  const calls: string[] = [];
  const check = async (b: MoveBoard) => {
    const k = boardKey(b);
    calls.push(k);
    const list = answers[k] ?? [{ status: "error", jobs: null, error: "no answer set" }];
    return list.length > 1 ? list.shift()! : list[0]!;
  };
  return { check, calls };
}
const GONE: CheckResult = { status: "dead", jobs: null, http: 404 };
const LIVE: CheckResult = { status: "live", jobs: 14, name: "Acme" };

function fakeIssues() {
  const issues = new Map<number, { title: string; body: string; state: string; comments: string[] }>();
  let next = 100;
  const api: IssueApi = {
    find: (title) => {
      for (const [number, i] of issues) if (i.title === title) return { number, state: i.state, body: i.body };
      return null;
    },
    view: (n) => (issues.has(n) ? { state: issues.get(n)!.state, body: issues.get(n)!.body } : null),
    create: (title, body) => {
      issues.set(++next, { title, body, state: "OPEN", comments: [] });
      return next;
    },
    edit: (n, body) => {
      issues.get(n)!.body = body;
    },
    close: (n, comment) => {
      issues.get(n)!.state = "CLOSED";
      issues.get(n)!.comments.push(comment);
    },
  };
  return { api, issues };
}

function setup(pending: PendingFile = emptyPending(), moves: MovesFile = emptyMoves()) {
  return { pending, moves };
}

describe("board keys", () => {
  it("are the inbox Worker's keys and parse back", () => {
    expect(FROM).toBe("lever:acme||");
    expect(boardKey({ ats: "workday", slug: "Bank", shard: "wd1", site: "Ext" })).toBe("workday:bank|wd1|ext");
    expect(parseBoardKey("workday:bank|wd1|ext")).toEqual({ ats: "workday", slug: "bank", shard: "wd1", site: "ext" });
    expect(parseBoardKey("lever:acme||")).toEqual({ ats: "lever", slug: "acme" });
    expect(parseBoardKey("nonsense")).toBeNull();
  });
});

describe("mergeInbox", () => {
  it("keys reports by the old board with a set of candidates, and drops bad ones", () => {
    const p = emptyPending();
    const r = mergeInbox(
      p,
      [
        item(),
        item({ id: "2", reporters: 5, last_at: iso(5) }),
        item({ id: "3", to: { ats: "greenhouse", slug: "acme" }, reporters: 1 }),
        item({ id: "4", to: { ats: "lever", slug: "../x" } }),
        item({ id: "5", to: ACME_LEVER }),
        item({ id: "6", name: " <>" }),
        item({ id: "7", from: { ats: "kenexa", slug: "acme" } }),
      ],
      T0,
    );
    expect(r.added).toBe(2);
    expect(r.invalid.map((i) => [i.id, i.reason])).toEqual([
      ["4", "bad to"],
      ["5", "from is to"],
      ["6", "no name"],
      ["7", "bad from"],
    ]);
    const e = p.moves[FROM]!;
    expect(Object.keys(e.candidates).sort()).toEqual(["ashby:acme||", "greenhouse:acme||"]);
    // The largest count the inbox reported, not a sum (it forgets reporters once acknowledged).
    expect(e.candidates[TO]).toMatchObject({ reporters: 5, first_at: iso(0), last_at: iso(5) });
    expect(e.expires_at).toBe(iso(30 * 24));
  });
});

describe("gate 3: is the old board gone?", () => {
  const c = (h: number, status: MoveCheck["status"], http?: number): MoveCheck => ({ at: iso(h), status, ...(http ? { http } : {}) });
  it("needs a 404/410 on two checks at least 24 h apart, with no answer in between", () => {
    expect(goneVerdict("lever", [])).toBe("unchecked");
    expect(goneVerdict("lever", [c(0, "dead", 404)])).toBe("waiting");
    expect(goneVerdict("lever", [c(0, "dead", 404), c(23, "dead", 404)])).toBe("waiting");
    expect(goneVerdict("lever", [c(0, "dead", 404), c(24, "dead", 410)])).toBe("proven");
    expect(goneVerdict("lever", [c(0, "dead", 404), c(6, "error"), c(24, "dead", 404)])).toBe("proven");
    // A 200 in between starts over.
    expect(goneVerdict("lever", [c(0, "dead", 404), c(12, "live", 200), c(24, "dead", 404)])).toBe("waiting");
    expect(goneVerdict("lever", [c(0, "dead", 404), c(24, "dead", 404), c(30, "live", 200)])).toBe("live");
  });
  it("calls the rest not proven: timeouts, SmartRecruiters' 0 jobs, page reads, Workday", () => {
    expect(goneVerdict("lever", [c(0, "error"), c(24, "error")])).toBe("not_proven");
    expect(goneVerdict("smartrecruiters", [c(0, "dead"), c(24, "dead")])).toBe("not_proven");
    expect(goneVerdict("teamtailor", [c(0, "dead"), c(30, "dead")])).toBe("not_proven");
    expect(goneVerdict("workday", [c(0, "dead", 404), c(24, "dead", 404)])).toBe("not_proven");
  });
});

describe("the gates", () => {
  const entry = (over = {}) => {
    const p = emptyPending();
    mergeInbox(p, [item()], T0);
    const e = p.moves[FROM]!;
    e.checks = [
      { at: iso(0), status: "dead", http: 404 },
      { at: iso(24), status: "dead", http: 404 },
    ];
    Object.assign(e, over);
    return { p, e, c: e.candidates[TO]! };
  };
  const ctxFor = (p: PendingFile, over: Partial<Parameters<typeof gateContext>[0]> = {}) =>
    gateContext({ now: at(24), directory: DIRECTORY, denied: noDeny, moves: emptyMoves(), pending: p, ...over });

  it("passes a gone board moving to a live one", () => {
    const { p, e, c } = entry();
    expect(evaluate(FROM, e, TO, c, ctxFor(p), LIVE)).toMatchObject({ result: "pass", gone: "proven", to_live: { status: "live", jobs: 14 }, to_company: "new" });
  });

  it("1. denylist: either board or the name", () => {
    const { p, e, c } = entry();
    expect(evaluate(FROM, e, TO, c, ctxFor(p, { denied: (x) => x.key === "lever:acme" }), LIVE)).toMatchObject({ result: "reject", reason: "denylist" });
    expect(evaluate(FROM, e, TO, c, ctxFor(p, { denied: (x) => x.key === "ashby:acme" }), LIVE)).toMatchObject({ result: "reject", denylist: false });
    expect(evaluate(FROM, e, TO, c, ctxFor(p, { denied: (x) => x.name === "Acme" }), LIVE).result).toBe("reject");
  });

  it("2. the old board is in the directory under that name (or was when first seen)", () => {
    const { p, e, c } = entry({ name: "Globex" });
    expect(evaluate(FROM, e, TO, c, ctxFor(p), LIVE)).toMatchObject({ result: "reject", in_directory: false });
    const gone = entry();
    const without = ctxFor(gone.p, { directory: DIRECTORY.filter((r) => r.key !== "lever:acme") });
    expect(evaluate(FROM, gone.e, TO, gone.c, without, LIVE).result).toBe("reject");
    gone.e.in_directory_at = iso(0);
    expect(evaluate(FROM, gone.e, TO, gone.c, without, LIVE).result).toBe("pass");
  });

  it("3. holds while the old board answers or isn't proven gone yet", () => {
    const live = entry({ checks: [{ at: iso(24), status: "live", http: 200 }] });
    expect(evaluate(FROM, live.e, TO, live.c, ctxFor(live.p), LIVE)).toMatchObject({ result: "hold", gone: "live" });
    const once = entry({ checks: [{ at: iso(24), status: "dead", http: 404 }] });
    expect(evaluate(FROM, once.e, TO, once.c, ctxFor(once.p), LIVE)).toMatchObject({ result: "hold", gone: "waiting" });
    // Not proven still goes on: a maintainer decides.
    const timeouts = entry({
      checks: [
        { at: iso(0), status: "error" },
        { at: iso(24), status: "error" },
      ],
    });
    expect(evaluate(FROM, timeouts.e, TO, timeouts.c, ctxFor(timeouts.p), LIVE)).toMatchObject({ result: "pass", gone: "not_proven" });
  });

  it("4. the new board is live with jobs", () => {
    const { p, e, c } = entry();
    expect(evaluate(FROM, e, TO, c, ctxFor(p))).toMatchObject({ result: "hold", reason: "to not checked yet" });
    expect(evaluate(FROM, e, TO, c, ctxFor(p), { status: "dormant", jobs: 0 })).toMatchObject({ result: "reject", reason: "to is dormant" });
    expect(evaluate(FROM, e, TO, c, ctxFor(p), GONE).result).toBe("reject");
  });

  it("5. the new board isn't a different company, and wasn't contributed under 30 days ago", () => {
    const { p, e } = entry();
    const other: MoveBoard = { ats: "ashby", slug: "otherco" };
    const c2 = { to: other, reporters: 1, first_at: iso(0), last_at: iso(0) };
    expect(evaluate(FROM, e, boardKey(other), c2, ctxFor(p), LIVE)).toMatchObject({ result: "reject", to_company: "different" });
    const same = ctxFor(p, { directory: [...DIRECTORY, { key: "ashby:acme", name: "Acme Inc.", status: "live" }] });
    expect(evaluate(FROM, e, TO, e.candidates[TO]!, same, LIVE)).toMatchObject({ result: "pass", to_company: "same" });
    const fresh = ctxFor(p, { contributions: [{ key: "ashby:acme", added_at: iso(-28 * 24) }] });
    expect(evaluate(FROM, e, TO, e.candidates[TO]!, fresh, LIVE)).toMatchObject({ result: "reject", to_company: "too_new" });
    const old = ctxFor(p, { contributions: [{ key: "ashby:acme", added_at: iso(-31 * 24) }] });
    expect(evaluate(FROM, e, TO, e.candidates[TO]!, old, LIVE).result).toBe("pass");
  });

  it("6. refuses chains and cycles", () => {
    const { p, e, c } = entry();
    // The new board is itself reported as moved.
    mergeInbox(p, [item({ id: "9", from: ACME_ASHBY, to: { ats: "greenhouse", slug: "acme" } })], T0);
    expect(evaluate(FROM, e, TO, c, ctxFor(p), LIVE)).toMatchObject({ result: "reject", chain: false });
    const q = entry();
    const accepted = (from: MoveBoard, to: MoveBoard): MovesFile => ({ version: 1, moves: [{ from, to, name: "Acme", accepted_at: iso(0), by: "review", evidence: [] }] });
    // Already moved.
    expect(evaluate(FROM, q.e, TO, q.c, ctxFor(q.p, { moves: accepted(ACME_LEVER, { ats: "greenhouse", slug: "acme" }) }), LIVE).reason).toMatch(/already moved/);
    // Something already moved here (A -> B accepted, then B -> C).
    expect(evaluate(FROM, q.e, TO, q.c, ctxFor(q.p, { moves: accepted({ ats: "greenhouse", slug: "acme" }, ACME_LEVER) }), LIVE).reason).toMatch(/chain/);
    // A reverted move doesn't count.
    const reverted = accepted(ACME_LEVER, { ats: "greenhouse", slug: "acme" });
    reverted.moves[0]!.reverted = true;
    expect(evaluate(FROM, q.e, TO, q.c, ctxFor(q.p, { moves: reverted }), LIVE).result).toBe("pass");
  });

  it("7. another live board of the same company makes it a removal", () => {
    const { p, e, c } = entry();
    const two = ctxFor(p, { directory: [...DIRECTORY, { key: "greenhouse:acme", name: "Acme", status: "live" }] });
    expect(evaluate(FROM, e, TO, c, two, LIVE)).toMatchObject({ result: "removal", other_live_board: "greenhouse:acme" });
  });
});

describe("a review run", () => {
  it("holds a report until the old board is gone on two runs 24 h apart, then opens one issue", async () => {
    const { pending, moves } = setup();
    const { api, issues } = fakeIssues();
    const net = network({ [FROM]: [GONE], [TO]: [LIVE] });
    const base = { pending, moves, directory: DIRECTORY, contributions: [], denied: noDeny, check: net.check, issues: api };

    const first = await runReview({ ...base, items: [item()], now: () => at(0) });
    expect(first).toMatchObject({ inbox: 1, processed: ["1"], new_candidates: 1, checked: 1, held: 1, passed: 0, issues_opened: 0, accepted: 0 });
    expect(pending.moves[FROM]!.first_gone_at).toBe(iso(0));
    expect(pending.moves[FROM]!.in_directory_at).toBe(iso(0));

    // Three hours later: not due again yet.
    expect((await runReview({ ...base, items: [], now: () => at(3) })).checked).toBe(0);

    const second = await runReview({ ...base, items: [], now: () => at(24) });
    expect(second).toMatchObject({ checked: 1, passed: 1, held: 0, issues_opened: 1 });
    expect(pending.moves[FROM]!.candidates[TO]).toMatchObject({ issue: 101, gates: { result: "pass", gone: "proven" } });
    expect(issues.get(101)!.title).toBe("Move review: lever:acme||");
    expect(net.calls).toEqual([FROM, FROM, TO]);

    // Later runs update the same issue, never a second one.
    await runReview({ ...base, items: [item({ id: "2", reporters: 4 })], now: () => at(31) });
    expect(issues.size).toBe(1);
    expect(issues.get(101)!.body).toMatch(/4 reports/);
  });

  it("puts every candidate in the one issue, with a box to tick for each that passes", async () => {
    const { pending, moves } = setup();
    const { api, issues } = fakeIssues();
    const GH: MoveBoard = { ats: "greenhouse", slug: "acme" };
    pending.moves[FROM] = {
      name: "Acme",
      from: ACME_LEVER,
      checks: [{ at: iso(0), status: "dead", http: 404 }],
      candidates: {},
      expires_at: iso(30 * 24),
    };
    const net = network({ [FROM]: [GONE], [TO]: [LIVE], [boardKey(GH)]: [{ status: "live", jobs: 3 }] });
    const s = await runReview({
      pending,
      moves,
      items: [item(), item({ id: "2", to: GH }), item({ id: "3", to: { ats: "ashby", slug: "otherco" } })],
      directory: DIRECTORY,
      contributions: [],
      denied: noDeny,
      check: net.check,
      issues: api,
      now: () => at(24),
    });
    expect(s).toMatchObject({ passed: 2, rejected: 1, issues_opened: 1 });
    const body = issues.get(101)!.body;
    expect(body.match(/- \[ \] Approve `m-[0-9a-f]{10}`/g)).toHaveLength(2);
    expect(body).toMatch(/Tick exactly one box/);
    expect(body).toContain(`\`${candidateId(FROM, "ashby:otherco||")}\`: `);
  });

  it("caps the checks per run and says so", async () => {
    const { pending, moves } = setup();
    const items = ["a", "b", "c"].map((s, i) => item({ id: String(i), name: s, from: { ats: "lever", slug: s } }));
    const dir = ["a", "b", "c"].map((s) => ({ key: `lever:${s}`, name: s, status: "live" }));
    const net = network({});
    const s = await runReview({ pending, moves, items, directory: dir, contributions: [], denied: noDeny, check: net.check, maxChecks: 2, now: () => at(0) });
    expect(s).toMatchObject({ checked: 2, cap_hit: true, pending: 3 });
  });

  it("stops at the time box", async () => {
    const { pending, moves } = setup();
    let t = 0;
    const s = await runReview({
      pending,
      moves,
      items: [item(), item({ id: "2", name: "Other Corp", from: { ats: "greenhouse", slug: "other" } })],
      directory: DIRECTORY,
      contributions: [],
      denied: noDeny,
      check: network({}).check,
      maxMs: 10 * 60_000,
      now: () => at((t++ * 4) / 60),
    });
    expect(s).toMatchObject({ checked: 1, timed_out: true });
  });

  it("rejects without a network check when the cheap gates fail, and doesn't look again until a new report", async () => {
    const { pending, moves } = setup();
    const net = network({});
    const base = { pending, moves, directory: DIRECTORY, contributions: [], denied: (x: { key?: string }) => x.key === "ashby:acme", check: net.check };
    const s = await runReview({ ...base, items: [item()], now: () => at(0) });
    expect(s).toMatchObject({ rejected: 1, rejections: [{ from: FROM, to: TO, reason: "denylist" }] });
    expect(net.calls).toEqual([]);
    expect((await runReview({ ...base, items: [], now: () => at(12) })).checked).toBe(0);
  });

  it("expires holds after 30 days and closes their open issue", async () => {
    const { pending, moves } = setup();
    const { api, issues } = fakeIssues();
    mergeInbox(pending, [item()], T0);
    const n = api.create("Move review: lever:acme||", "x");
    pending.moves[FROM]!.candidates[TO]!.issue = n;
    const s = await runReview({ pending, moves, items: [], directory: DIRECTORY, contributions: [], denied: noDeny, check: network({}).check, issues: api, now: () => at(30 * 24 + 1) });
    expect(s).toMatchObject({ expired: 1, pending: 0 });
    expect(issues.get(n)).toMatchObject({ state: "CLOSED" });
    expect(expire(emptyPending(), T0)).toEqual([]);
  });

  it("never reopens or recreates a closed review issue (refused, or spam)", async () => {
    const { pending, moves } = setup();
    const { api, issues } = fakeIssues();
    const n = api.create("Move review: lever:acme||", "x");
    api.close(n, "spam");
    pending.moves[FROM] = { name: "Acme", from: ACME_LEVER, checks: [{ at: iso(0), status: "dead", http: 404 }], candidates: {}, expires_at: iso(30 * 24) };
    const s = await runReview({
      pending,
      moves,
      items: [item()],
      directory: DIRECTORY,
      contributions: [],
      denied: noDeny,
      check: network({ [FROM]: [GONE], [TO]: [LIVE] }).check,
      issues: api,
      now: () => at(24),
    });
    expect(s).toMatchObject({ passed: 1, issues_opened: 0, issues_updated: 0 });
    expect(issues.size).toBe(1);
    expect(issues.get(n)!.state).toBe("CLOSED");
  });

  it("clears reports a maintainer approved since the last run", async () => {
    const { pending } = setup();
    mergeInbox(pending, [item()], T0);
    const moves: MovesFile = { version: 1, moves: [{ from: ACME_LEVER, to: ACME_ASHBY, name: "Acme", accepted_at: iso(1), by: "review", evidence: [] }] };
    const s = await runReview({ pending, moves, items: [], directory: DIRECTORY, contributions: [], denied: noDeny, check: network({}).check, now: () => at(2) });
    expect(s).toMatchObject({ cleared_approved: 1, pending: 0 });
  });
});

describe("the review issue", () => {
  it("keeps names and slugs in a code block, strips mentions and backticks, and links only computed URLs", () => {
    const p = emptyPending();
    mergeInbox(p, [item({ name: "@everyone ```\n[click](https://evil.example) <script>" })], T0);
    const e = p.moves[FROM]!;
    const body = issueBody(FROM, e);
    expect(body).not.toContain("@");
    expect(body.match(/```/g)).toHaveLength(2);
    const outside = body.replace(/```text[\s\S]*?```/, "");
    expect(outside).not.toContain("evil.example");
    expect(outside).not.toContain("everyone");
    expect([...outside.matchAll(/https?:\/\/[^\s>)]+/g)].map((m) => m[0])).toEqual(["https://jobs.lever.co/acme", "https://jobs.ashbyhq.com/acme"]);
  });

  it("keeps a maintainer's ticks when it's updated", () => {
    const p = emptyPending();
    mergeInbox(p, [item(), item({ id: "2", to: { ats: "greenhouse", slug: "acme" } })], T0);
    const e = p.moves[FROM]!;
    for (const c of Object.values(e.candidates)) c.gates = { checked_at: iso(0), result: "pass", denylist: true, in_directory: true, gone: "proven", to_company: "new", chain: true };
    const id = candidateId(FROM, TO);
    const ticked = issueBody(FROM, e).replace(`- [ ] Approve \`${id}\``, `- [x] Approve \`${id}\``);
    expect(tickedIds(issueBody(FROM, e, ticked))).toEqual([id]);
  });
});

describe("approval", () => {
  const passing = (n = 7) => {
    const p = emptyPending();
    mergeInbox(p, [item(), item({ id: "2", to: { ats: "greenhouse", slug: "acme" } })], T0);
    const e = p.moves[FROM]!;
    e.checks = [
      { at: iso(0), status: "dead", http: 404 },
      { at: iso(24), status: "dead", http: 404 },
    ];
    e.in_directory_at = iso(0);
    for (const c of Object.values(e.candidates)) {
      c.gates = { checked_at: iso(24), result: "pass", denylist: true, in_directory: true, gone: "proven", to_company: "new", chain: true };
      c.issue = n;
    }
    return { p, e };
  };

  it("counts only maintainers and admins", () => {
    expect(canApprove({ role_name: "admin", permission: "admin" })).toBe(true);
    expect(canApprove({ role_name: "maintain", permission: "write" })).toBe(true);
    expect(canApprove({ role_name: "write", permission: "write" })).toBe(false);
    expect(canApprove({ role_name: "triage", permission: "read" })).toBe(false);
    expect(canApprove({ role_name: "read", permission: "read" })).toBe(false);
    expect(canApprove(null)).toBe(false);
    expect(canApprove({ role_name: ["admin"] })).toBe(false);
  });

  it("picks the only passing candidate, or exactly one ticked box", () => {
    const { e } = passing();
    expect(chooseCandidate(FROM, e, 7, "")).toEqual({ error: expect.stringMatching(/Tick exactly one candidate \(0 ticked\)/) });
    const id = candidateId(FROM, TO);
    expect(chooseCandidate(FROM, e, 7, `- [x] Approve \`${id}\``)).toEqual({ toKey: TO });
    const both = `- [x] Approve \`${id}\`\n- [x] Approve \`${candidateId(FROM, "greenhouse:acme||")}\``;
    expect(chooseCandidate(FROM, e, 7, both)).toEqual({ error: expect.stringMatching(/2 ticked/) });
    expect(chooseCandidate(FROM, e, 7, "- [x] Approve `m-0000000000`")).toEqual({ error: expect.stringMatching(/doesn't pass/) });
    delete e.candidates["greenhouse:acme||"];
    expect(chooseCandidate(FROM, e, 7, "")).toEqual({ toKey: TO });
    expect(chooseCandidate(FROM, e, 8, "")).toEqual({ error: expect.stringMatching(/No candidate/) });
  });

  const base = (p: PendingFile, moves: MovesFile, check: (b: MoveBoard) => Promise<CheckResult>) => ({
    issue: 7,
    sender: "someone",
    body: `- [x] Approve \`${candidateId(FROM, TO)}\``,
    pending: p,
    moves,
    directory: DIRECTORY,
    contributions: [],
    denied: noDeny,
    check,
    now: at(30),
  });

  it("ignores a label from anyone else, and changes nothing", async () => {
    const { p } = passing();
    const moves = emptyMoves();
    const net = network({ [FROM]: [GONE], [TO]: [LIVE] });
    expect(await approve({ ...base(p, moves, net.check), role: { role_name: "write" } })).toEqual({ action: "ignore" });
    expect(moves.moves).toEqual([]);
    expect(net.calls).toEqual([]);
  });

  it("re-runs the gates, then records the move as approved by review", async () => {
    const { p } = passing();
    const moves = emptyMoves();
    const r = await approve({ ...base(p, moves, network({ [FROM]: [GONE], [TO]: [LIVE] }).check), role: { role_name: "maintain" } });
    expect(r.action).toBe("approve");
    expect(moves.moves).toEqual([
      expect.objectContaining({ from: ACME_LEVER, to: ACME_ASHBY, name: "Acme", by: "review", issue: 7, accepted_at: iso(30), evidence: expect.arrayContaining(["reports: 2"]) }),
    ]);
    // A second approval of the same old board is refused (one candidate per old board).
    const again = await approve({ ...base(p, moves, network({ [FROM]: [GONE], [TO]: [LIVE] }).check), role: { role_name: "admin" } });
    expect(again).toMatchObject({ action: "refuse", comment: expect.stringMatching(/already moved/) });
  });

  it("refuses when the old board answers again or the issue isn't in the pending file", async () => {
    const { p } = passing();
    const moves = emptyMoves();
    const back = await approve({ ...base(p, moves, network({ [FROM]: [LIVE], [TO]: [LIVE] }).check), role: { role_name: "admin" } });
    expect(back).toMatchObject({ action: "refuse", comment: expect.stringMatching(/hold/) });
    const unknown = await approve({ ...base(p, moves, network({}).check), issue: 99, role: { role_name: "admin" } });
    expect(unknown).toMatchObject({ action: "refuse", comment: expect.stringMatching(/isn't in `moves-pending.json`/) });
    expect(moves.moves).toEqual([]);
  });
});

describe("the build", () => {
  it("lists accepted, not reverted moves whose new board is in the directory", () => {
    const file: MovesFile = {
      version: 1,
      moves: [
        { from: ACME_LEVER, to: ACME_ASHBY, name: "Acme", accepted_at: iso(0), by: "review", evidence: [] },
        { from: { ats: "lever", slug: "beta" }, to: { ats: "ashby", slug: "beta" }, name: "Beta", accepted_at: iso(0), by: "review", evidence: [], reverted: true, reverted_at: iso(5) },
        { from: { ats: "lever", slug: "gamma" }, to: { ats: "ashby", slug: "gone" }, name: "Gamma", accepted_at: iso(0), by: "review", evidence: [] },
      ],
    };
    const r = directoryMoves(file, new Set(["ashby:acme", "lever:beta"]));
    expect(r.moves).toEqual([{ from: FROM, to: TO, name: "Acme", accepted_at: iso(0) }]);
    expect([...r.movedAway].sort()).toEqual(["lever:acme", "lever:gamma"]);
    expect(r.missingTo).toEqual(["ashby:gone||"]);
  });

  it("emits `moves` in directory.json, not as companies, and leaves the old board out", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const root = join(here, "..", "..");
    const dir = mkdtempSync(join(tmpdir(), "rawjobs-moves-"));
    try {
      cpSync(join(here, "test-fixtures", "golden"), dir, { recursive: true });
      mkdirSync(join(dir, "data"));
      const movesFile = join(dir, "moves.json");
      const accepted: MovesFile = {
        version: 1,
        moves: [{ from: { ats: "lever", slug: "acme" }, to: { ats: "greenhouse", slug: "betapay" }, name: "Acme", accepted_at: iso(0), by: "review", evidence: ["test"] }],
      };
      writeFileSync(movesFile, JSON.stringify(accepted));
      const env = { ...process.env, CATALOG_DIR: dir, CATALOG_DATA_DIR: join(dir, "data"), DENYLIST_FILE: join(dir, "denylist.json"), CONTRIBUTIONS_FILE: "", MOVES_FILE: movesFile };
      for (const [script, ...args] of [["merge"], ["build"], ["publish", "--data", join(dir, "data")]] as const) {
        const r = spawnSync(process.execPath, [join(root, "node_modules/tsx/dist/cli.mjs"), join(here, `${script}.ts`), ...args], { encoding: "utf8", env });
        if (r.status !== 0) throw new Error(`${script} failed:\n${r.stderr}`);
      }
      const published = JSON.parse(readFileSync(join(dir, "data", "catalog", "directory.json"), "utf8")) as { count: number; companies: { key: string }[]; moves: unknown[] };
      expect(published.moves).toEqual([{ from: "lever:acme||", to: "greenhouse:betapay||", name: "Acme", accepted_at: iso(0) }]);
      expect(published.companies.map((c) => c.key).sort()).toEqual(["ashby:gammapay", "greenhouse:betapay"]);
      expect(published.count).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
