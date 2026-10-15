import { describe, expect, it } from "vitest";
import { baselineSwap, boardsInPage, decide, emptyBaselines, isNxdomain, judge, type PageEvidence, readCompanyPage, sameBoard, trustedUrlOf, unescapePage, vendorHostOf } from "./lib/evidence";
import type { CheckResult } from "./lib/live-check";
import { boardKey, checkMoves, type DirRow, directoryMoves, emptyBlocked, emptyMoves, emptyPending, goneVerdict, type InboxMove, issueBody, type MoveBoard, type MovesFile } from "./lib/moves";
import { allowedUrl, isPrivateAddress, type SafeGet, type SafeResult, safeFetcher } from "./lib/safe-fetch";
import { type IssueApi, runReview } from "./moves";

const H = 3_600_000;
const T0 = new Date("2026-10-10T00:00:00Z");
const at = (hours: number) => new Date(T0.getTime() + hours * H);
const iso = (hours: number) => at(hours).toISOString();

// ---- safe fetch ----

describe("safe fetch", () => {
  it("refuses private, loopback, link-local, CGNAT and metadata addresses", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.20.1.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "224.0.0.1"])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "87.201.244.163", "2606:4700::1"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("only allows https on port 443 to a host name", () => {
    expect(allowedUrl("https://www.acme.com/careers")).not.toBeNull();
    for (const u of ["http://www.acme.com/", "https://www.acme.com:8443/", "https://127.0.0.1/", "https://user:pw@acme.com/", "file:///etc/passwd", "https://localhost/"])
      expect(allowedUrl(u), u).toBeNull();
  });

  type Route = { status: number; body?: string; location?: string };
  const fakeFetch = (routes: Record<string, Route>) =>
    (async (input: URL | string) => {
      const r = routes[String(input)];
      if (!r) throw new Error(`no route ${String(input)}`);
      return new Response(r.body ?? "", { status: r.status, headers: r.location ? { location: r.location } : {} });
    }) as typeof fetch;
  const publicLookup = async () => ["93.184.216.34"];

  it("follows redirects by hand and reports every hop", async () => {
    const get = safeFetcher({
      userAgent: "test",
      lookup: publicLookup,
      fetchImpl: fakeFetch({
        "https://www.acme.com/robots.txt": { status: 404 },
        "https://www.acme.com/careers": { status: 301, location: "/jobs" },
        "https://www.acme.com/jobs": { status: 200, body: "hello" },
      }),
    });
    const r = await get("https://www.acme.com/careers");
    expect(r).toMatchObject({ kind: "ok", url: "https://www.acme.com/jobs", body: "hello" });
    expect(r.hops.map((h) => h.status)).toEqual([301, 200]);
  });

  it("with stayOn, stops at a redirect off the host without fetching it", async () => {
    const get = safeFetcher({
      userAgent: "test",
      lookup: publicLookup,
      fetchImpl: fakeFetch({
        "https://www.acme.com/robots.txt": { status: 404 },
        "https://www.acme.com/careers": { status: 302, location: "https://jobs.ashbyhq.com/acme" },
      }),
    });
    const r = await get("https://www.acme.com/careers", { stayOn: "www.acme.com" });
    expect(r).toMatchObject({ kind: "ok", url: "https://jobs.ashbyhq.com/acme", body: "" });
    expect(r.hops.map((h) => h.status)).toEqual([302, 0]);
  });

  it("treats a robots.txt that errors (5xx) as disallow, and a missing one (4xx) as allow", async () => {
    const r5 = await safeFetcher({
      userAgent: "test",
      lookup: publicLookup,
      fetchImpl: fakeFetch({ "https://www.acme.com/robots.txt": { status: 503 }, "https://www.acme.com/careers": { status: 200, body: "x" } }),
    })("https://www.acme.com/careers");
    expect(r5).toMatchObject({ kind: "error", reason: "robots" });
    const disallowed = await safeFetcher({
      userAgent: "test",
      lookup: publicLookup,
      fetchImpl: fakeFetch({ "https://www.acme.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /careers" }, "https://www.acme.com/careers": { status: 200 } }),
    })("https://www.acme.com/careers");
    expect(disallowed).toMatchObject({ kind: "error", reason: "robots" });
  });

  it("refuses a host that resolves to a private address, even after a redirect", async () => {
    const lookup = async (h: string) => (h === "internal.acme.com" ? ["10.1.2.3"] : ["93.184.216.34"]);
    const get = safeFetcher({
      userAgent: "test",
      lookup,
      fetchImpl: fakeFetch({ "https://www.acme.com/robots.txt": { status: 404 }, "https://www.acme.com/careers": { status: 302, location: "https://internal.acme.com/admin" } }),
    });
    expect(await get("https://www.acme.com/careers")).toMatchObject({ kind: "error", reason: "private-address" });
  });

  it("stops after 5 hops and cuts the body at the cap", async () => {
    const loop: Record<string, Route> = { "https://www.acme.com/robots.txt": { status: 404 } };
    for (let i = 0; i < 10; i++) loop[`https://www.acme.com/${i}`] = { status: 302, location: `/${i + 1}` };
    expect(await safeFetcher({ userAgent: "t", lookup: publicLookup, fetchImpl: fakeFetch(loop) })("https://www.acme.com/0")).toMatchObject({ kind: "error", reason: "too-many-hops" });
    const big = await safeFetcher({
      userAgent: "t",
      lookup: publicLookup,
      maxBytes: 10,
      fetchImpl: fakeFetch({ "https://www.acme.com/robots.txt": { status: 404 }, "https://www.acme.com/": { status: 200, body: "x".repeat(100) } }),
    })("https://www.acme.com/");
    expect(big).toMatchObject({ kind: "ok", truncated: true });
    expect((big as { body: string }).body.length).toBe(10);
  });
});

// ---- evidence (red-team fixtures from docs/plans/auto-accept-moves.md) ----

/** A pretend fetcher: each URL answers what the test says. */
function pages(map: Record<string, SafeResult | string>): SafeGet {
  return async (url: string) => {
    const r = map[url];
    if (r === undefined) return { kind: "error", reason: "http", detail: url, status: 404, hops: [{ url, status: 404 }] };
    if (typeof r === "string") return { kind: "ok", status: 200, url, hops: [{ url, status: 200 }], body: r, truncated: false };
    return r;
  };
}
const ORACLE: MoveBoard = { ats: "oracle", slug: "hcld", shard: "em2", site: "CX_1" };
const TALEO: MoveBoard = { ats: "taleo", slug: "mashreqbank" };
const ASHBY: MoveBoard = { ats: "ashby", slug: "acme" };

describe("company page evidence", () => {
  it("only trusts a company-hosted https careers URL", () => {
    expect(trustedUrlOf({ careers_url: "https://www.mashreq.com/en/uae/about-us/careers/careers-portal/" })).toBe("https://www.mashreq.com/en/uae/about-us/careers/careers-portal/");
    expect(trustedUrlOf({ careers_url: "https://jobs.lever.co/acme" })).toBeNull();
    expect(trustedUrlOf({ careers_url: "http://www.acme.com/careers" })).toBeNull();
    expect(trustedUrlOf({})).toBeNull();
  });

  it("finds a JSON-escaped board link (Mashreq's real page shape)", () => {
    const body = '{"callToActionTarget":{"href":"https:\\/\\/hcld.fa.em2.oraclecloud.com\\/hcmUI\\/CandidateExperience\\/en\\/sites\\/CX_1\\/requisitions?"}}';
    expect(unescapePage(body)).toContain("https://hcld.fa.em2.oraclecloud.com/hcmUI/");
    const boards = boardsInPage(body);
    expect(boards).toHaveLength(1);
    expect(sameBoard(boards[0]!, ORACLE)).toBe(true);
  });

  it("matches the board, not a prefix: acme-fake is not acme", () => {
    const ev: PageEvidence = { status: "ok", url: "https://www.acme.com/careers", boards: boardsInPage('<a href="https://jobs.ashbyhq.com/acme-fake">Jobs</a>') };
    expect(judge(ev, ASHBY)).toMatchObject({ finding: "other" });
  });

  it("a group page linking several boards is for a person (subsidiaries)", () => {
    const ev: PageEvidence = {
      status: "ok",
      url: "https://www.group.com/careers",
      boards: boardsInPage('<a href="https://jobs.ashbyhq.com/acme">A</a> <a href="https://job-boards.greenhouse.io/acme-uk">B</a>'),
    };
    expect(judge(ev, ASHBY).finding).toBe("several");
  });

  it("a JS-only page with no board in its HTML is no evidence", () => {
    const ev: PageEvidence = { status: "ok", url: "https://www.acme.com/careers", boards: boardsInPage('<div id="root"></div><script src="/app.js"></script>') };
    expect(judge(ev, ASHBY).finding).toBe("none");
  });

  it("an Oracle board on another career site of the same tenant is not the candidate", () => {
    const ev: PageEvidence = { status: "ok", url: "https://x.com/", boards: boardsInPage("https://hcld.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2/") };
    expect(judge(ev, ORACLE).finding).toBe("other");
  });

  it("S2: a redirect counts only when every hop before the last stays on the trusted host", async () => {
    const good = pages({
      "https://www.acme.com/careers": {
        kind: "ok",
        status: 200,
        url: "https://jobs.ashbyhq.com/acme",
        body: "",
        truncated: false,
        hops: [
          { url: "https://www.acme.com/careers", status: 301 },
          { url: "https://jobs.ashbyhq.com/acme", status: 200 },
        ],
      },
    });
    expect(judge(await readCompanyPage("https://www.acme.com/careers", good), ASHBY)).toMatchObject({ finding: "match", kind: "S2" });
    // Off the trusted host to another host first (an open redirect, a link shortener), then a board: no S2.
    const chain = pages({
      "https://www.acme.com/careers": {
        kind: "ok",
        status: 200,
        url: "https://jobs.ashbyhq.com/acme",
        body: "",
        truncated: false,
        hops: [
          { url: "https://www.acme.com/careers", status: 302 },
          { url: "https://short.example/x", status: 302 },
          { url: "https://jobs.ashbyhq.com/acme", status: 200 },
        ],
      },
    });
    expect(judge(await readCompanyPage("https://www.acme.com/careers", chain), ASHBY).finding).toBe("none");
  });

  it("a page that can't be read (bot block, robots) is unknown, never a pass", async () => {
    const blocked = pages({ "https://www.acme.com/careers": { kind: "error", reason: "http", detail: "", status: 403, hops: [] } });
    expect(judge(await readCompanyPage("https://www.acme.com/careers", blocked), ASHBY).finding).toBe("unknown");
  });

  it("also reads the homepage on the same host, and counts its boards too", async () => {
    const get = pages({ "https://www.acme.com/careers": "nothing here", "https://www.acme.com/": '<a href="https://jobs.ashbyhq.com/acme">Careers</a>' });
    expect(judge(await readCompanyPage("https://www.acme.com/careers", get), ASHBY)).toMatchObject({ finding: "match", kind: "S1" });
  });

  it("a before/after swap needs a snapshot from before the report", () => {
    const ev: PageEvidence = { status: "ok", url: "u", boards: [ORACLE] };
    const base = { url: "u", boards: [boardKey(TALEO)], at: iso(-100) };
    expect(baselineSwap(base, iso(0), TALEO, ORACLE, ev)).toBe(true);
    expect(baselineSwap({ ...base, at: iso(1) }, iso(0), TALEO, ORACLE, ev)).toBe(false);
    expect(baselineSwap({ ...base, boards: [] }, iso(0), TALEO, ORACLE, ev)).toBe(false);
  });

  it("knows vendor-provisioned hosts and reads NXDOMAIN", async () => {
    expect(vendorHostOf({ ats: "taleo", slug: "mashreqbank", site: "2" })).toBe("mashreqbank.taleo.net");
    expect(vendorHostOf(ASHBY)).toBeNull();
    expect(await isNxdomain("gone.taleo.net", async () => Promise.reject(Object.assign(new Error("x"), { code: "ENOTFOUND" })))).toBe(true);
    expect(await isNxdomain("flaky.taleo.net", async () => Promise.reject(Object.assign(new Error("x"), { code: "ETIMEOUT" })))).toBe(false);
  });

  it("proves a vendor board gone after two NXDOMAIN checks a day apart", () => {
    const nx = (h: number) => ({ at: iso(h), status: "error" as const, nxdomain: true as const });
    expect(goneVerdict("taleo", [nx(0)])).toBe("waiting");
    expect(goneVerdict("taleo", [nx(0), nx(25)])).toBe("proven");
    expect(goneVerdict("taleo", [nx(0), { at: iso(10), status: "live" }, nx(25)])).toBe("waiting");
  });
});

describe("decide", () => {
  const base = { finding: "match" as const, gone: "proven" as const, baselineSwap: false, registered: { date: "2003-05-23T00:00:00.000Z" }, pack: false, now: at(0) };
  it("auto only with every condition", () => {
    expect(decide(base).verdict).toBe("auto");
    expect(decide({ ...base, finding: "other" }).verdict).toBe("manual");
    expect(decide({ ...base, gone: "not_proven" }).verdict).toBe("fast");
    expect(decide({ ...base, gone: "not_proven", baselineSwap: true }).verdict).toBe("auto");
    expect(decide({ ...base, pack: true }).verdict).toBe("fast");
    expect(decide({ ...base, registered: { unknown: "no RDAP service for .ae" } }).verdict).toBe("fast");
    expect(decide({ ...base, registered: { date: iso(-24 * 30) } }).verdict).toBe("fast");
  });
  it("a domain registered after our first look at the page was re-registered: not auto", () => {
    const d = decide({ ...base, registered: { date: "2026-01-01T00:00:00.000Z" }, firstSeen: "2025-06-01T00:00:00.000Z", now: new Date("2027-06-01T00:00:00Z") });
    expect(d.verdict).toBe("fast");
    expect(d.reasons.join(" ")).toContain("re-registered");
  });
});

// ---- the whole run ----

const ACME_LEVER: MoveBoard = { ats: "lever", slug: "acme" };
const FROM = boardKey(ACME_LEVER);
const TO = boardKey(ASHBY);
const PAGE = "https://www.acme.com/careers";
const DIRECTORY: DirRow[] = [{ key: "lever:acme", name: "Acme", status: "live", careers_url: PAGE }];
const item = (over: Partial<InboxMove> = {}): InboxMove => ({ id: "1", name: "Acme", from: ACME_LEVER, to: ASHBY, reporters: 2, first_at: iso(0), last_at: iso(0), ...over });
const GONE: CheckResult = { status: "dead", jobs: null, http: 404 };
const LIVE: CheckResult = { status: "live", jobs: 14, name: "Acme" };
const check = async (b: MoveBoard) => (boardKey(b) === FROM ? GONE : LIVE);
const rdap = async () => ({ date: "2003-05-23T00:00:00.000Z" });

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
    comment: (n, body) => {
      issues.get(n)!.comments.push(body);
    },
  };
  return { api, issues };
}

/** Two runs a day apart: the old board's 404 is proven by the second. */
async function twoRuns(opts: { autoAccept: boolean; page: string; directory?: DirRow[] }) {
  const pending = emptyPending();
  const moves = emptyMoves();
  const blocked = emptyBlocked();
  const baselines = emptyBaselines();
  const { api, issues } = fakeIssues();
  const common = { pending, moves, blocked, baselines, directory: opts.directory ?? DIRECTORY, contributions: [], denied: () => false, check, issues: api, rdap, autoAccept: opts.autoAccept };
  const get = pages({ [PAGE]: opts.page, "https://www.acme.com/": "" });
  await runReview({ ...common, items: [item()], get, now: () => at(0) });
  const summary = await runReview({ ...common, items: [], get, now: () => at(25) });
  return { pending, moves, blocked, issues, summary, common, get };
}
const LINKS_ASHBY = '<a href="https://jobs.ashbyhq.com/acme">Open roles</a>';

describe("auto-accept run", () => {
  it("shadow mode (off): works out the verdict, pre-ticks the box, accepts nothing", async () => {
    const { moves, issues, summary, pending } = await twoRuns({ autoAccept: false, page: LINKS_ASHBY });
    expect(summary.would_auto).toBe(1);
    expect(moves.moves).toHaveLength(0);
    expect(pending.moves[FROM]!.candidates[TO]!.evidence).toMatchObject({ finding: "match", kind: "S1", verdict: "auto" });
    const body = [...issues.values()][0]!.body;
    expect(body).toMatch(/- \[x\] Approve `m-[0-9a-f]{10}`/);
    expect(body).toContain("### Company evidence");
    expect(body).not.toMatch(/\]\(https?:/); // no markdown links from page text
  });

  it("on: accepts unconfirmed, closes the issue with the evidence, and ships only after a second look a day later", async () => {
    const { moves, issues, summary, pending, common, get } = await twoRuns({ autoAccept: true, page: LINKS_ASHBY });
    expect(summary.accepted).toBe(1);
    expect(moves.moves[0]).toMatchObject({ by: "auto", evidence_url: PAGE });
    expect(moves.moves[0]!.confirmed_at).toBeUndefined();
    expect(pending.moves[FROM]).toBeUndefined();
    expect([...issues.values()][0]!.state).toBe("CLOSED");
    // Not published yet: no delisting, no suggestion.
    expect(directoryMoves(moves, new Set(["ashby:acme"])).moves).toHaveLength(0);
    // A day later the page still points there: confirmed and published.
    const later = await runReview({ ...common, items: [], get, now: () => at(50) });
    expect(later.confirmed).toBe(1);
    expect(directoryMoves(moves, new Set(["ashby:acme"])).moves).toHaveLength(1);
  });

  it("reverts only on a contradiction, and blocks the move for good", async () => {
    const { moves, blocked, common } = await twoRuns({ autoAccept: true, page: LINKS_ASHBY });
    // The page can't be read: keep the move, look again later.
    const unreadable = await runReview({ ...common, items: [], get: pages({}), now: () => at(32) });
    expect(unreadable.reverify_unknown).toBe(1);
    expect(moves.moves[0]!.reverted).toBeUndefined();
    // The page now points at a different board: revert and block.
    const other = pages({ [PAGE]: '<a href="https://jobs.lever.co/acme-new">Jobs</a>', "https://www.acme.com/": "" });
    const r = await runReview({ ...common, items: [], get: other, now: () => at(40) });
    expect(r.reverted).toBe(1);
    expect(moves.moves[0]).toMatchObject({ reverted: true });
    expect(blocked.blocked).toEqual([expect.objectContaining({ from: FROM, to: TO })]);
    // Reported again: rejected at gate 0.
    const again = await runReview({ ...common, items: [item({ id: "2", first_at: iso(41), last_at: iso(41) })], get: other, now: () => at(41) });
    expect(again.rejections[0]?.reason).toContain("blocked");
  });

  it("drops an auto move never confirmed within 30 days, without blocking it", async () => {
    const { moves, blocked, common } = await twoRuns({ autoAccept: true, page: LINKS_ASHBY });
    const r = await runReview({ ...common, items: [], get: pages({}), now: () => at(25 + 31 * 24) });
    expect(r.expired_auto).toBe(1);
    expect(moves.moves[0]).toMatchObject({ reverted: true });
    expect(blocked.blocked).toEqual([]);
  });

  it("pack companies, unknown domain age and no evidence page all wait for a person", async () => {
    const pack = await twoRuns({ autoAccept: true, page: LINKS_ASHBY, directory: [{ ...DIRECTORY[0]!, tags: ["fintech"] }] });
    expect(pack.moves.moves).toHaveLength(0);
    expect(pack.summary.fast_track).toBe(1);
    const noPage = await twoRuns({ autoAccept: true, page: LINKS_ASHBY, directory: [{ ...DIRECTORY[0]!, careers_url: "https://jobs.lever.co/acme" }] });
    expect(noPage.moves.moves).toHaveLength(0);
    expect(noPage.summary.would_auto + noPage.summary.fast_track).toBe(0);
  });

  it("a page pointing at a board no one reported is flagged for a person, not accepted", async () => {
    const { moves, pending, issues } = await twoRuns({ autoAccept: true, page: '<a href="https://job-boards.greenhouse.io/acmecorp">Jobs</a>' });
    expect(moves.moves).toHaveLength(0);
    expect(pending.moves[FROM]!.unreported).toBe("greenhouse:acmecorp||");
    expect([...issues.values()][0]!.body).toContain("which no one reported");
  });

  it("a review a maintainer closed blocks its candidates for good", async () => {
    const { pending, blocked, issues, common, get } = await twoRuns({ autoAccept: false, page: LINKS_ASHBY });
    const [n] = [...issues.keys()];
    issues.get(n!)!.state = "CLOSED";
    const r = await runReview({ ...common, items: [], get, now: () => at(32) });
    expect(r.blocked_added).toBe(1);
    expect(blocked.blocked[0]).toMatchObject({ from: FROM, to: TO, issue: n });
    expect(pending.moves[FROM]).toBeDefined();
  });

  it("respects the per-run cap", async () => {
    const { moves } = await (async () => {
      const pending = emptyPending();
      const moves = emptyMoves();
      const dir: DirRow[] = [];
      const items: InboxMove[] = [];
      const routes: Record<string, string> = {};
      for (let i = 0; i < 3; i++) {
        dir.push({ key: `lever:c${i}`, name: `C${i}`, status: "live", careers_url: `https://www.c${i}.com/careers` });
        items.push({ id: String(i), name: `C${i}`, from: { ats: "lever", slug: `c${i}` }, to: { ats: "ashby", slug: `c${i}` }, reporters: 1, first_at: iso(0), last_at: iso(0) });
        routes[`https://www.c${i}.com/careers`] = `<a href="https://jobs.ashbyhq.com/c${i}">x</a>`;
        routes[`https://www.c${i}.com/`] = "";
      }
      const chk = async (b: MoveBoard) => (b.ats === "lever" ? GONE : LIVE);
      const common = {
        pending,
        moves,
        blocked: emptyBlocked(),
        baselines: emptyBaselines(),
        directory: dir,
        contributions: [],
        denied: () => false,
        check: chk,
        issues: fakeIssues().api,
        rdap,
        autoAccept: true,
        maxAutoPerRun: 2,
        get: pages(routes),
      };
      await runReview({ ...common, items, now: () => at(0) });
      await runReview({ ...common, items: [], now: () => at(25) });
      return { moves };
    })();
    expect(moves.moves).toHaveLength(2);
  });

  it("snapshots company pages as baselines, never one with a pending report", async () => {
    const baselines = emptyBaselines();
    const dir: DirRow[] = [
      { key: "lever:acme", name: "Acme", status: "live", careers_url: PAGE },
      { key: "greenhouse:beta", name: "Beta", status: "live", careers_url: "https://www.beta.com/jobs" },
      { key: "ashby:gamma", name: "Gamma", status: "live", careers_url: "https://jobs.ashbyhq.com/gamma" },
    ];
    const get = pages({ "https://www.beta.com/jobs": '<a href="https://job-boards.greenhouse.io/beta">x</a>', "https://www.beta.com/": "" });
    const s = await runReview({ pending: emptyPending(), moves: emptyMoves(), items: [item()], directory: dir, contributions: [], denied: () => false, check, baselines, get, now: () => at(0) });
    expect(s.baselines_taken).toBe(1);
    expect(Object.keys(baselines.pages)).toEqual(["greenhouse:beta"]);
    expect(baselines.pages["greenhouse:beta"]!.boards).toEqual(["greenhouse:beta||"]);
  });
});

describe("checkMoves", () => {
  it("refuses two active moves for one old board", () => {
    const m = (to: string): MovesFile["moves"][number] => ({ from: ACME_LEVER, to: { ats: "ashby", slug: to }, name: "Acme", accepted_at: iso(0), by: "review", evidence: [] });
    expect(checkMoves({ version: 1, moves: [m("a")] })).toEqual([]);
    expect(checkMoves({ version: 1, moves: [m("a"), m("b")] })).toHaveLength(1);
    expect(checkMoves({ version: 1, moves: [{ ...m("a"), reverted: true }, m("b")] })).toEqual([]);
  });
});

describe("issue body", () => {
  it("never pre-ticks when the company page gives no evidence", () => {
    const p = emptyPending();
    p.moves[FROM] = {
      name: "Acme",
      from: ACME_LEVER,
      checks: [],
      expires_at: iso(100),
      candidates: {
        [TO]: {
          to: ASHBY,
          reporters: 1,
          first_at: iso(0),
          last_at: iso(0),
          gates: { checked_at: iso(0), result: "pass", denylist: true, in_directory: true, gone: "proven", to_company: "new", chain: true },
        },
      },
    };
    expect(issueBody(FROM, p.moves[FROM]!)).toMatch(/- \[ \] Approve/);
  });
});
