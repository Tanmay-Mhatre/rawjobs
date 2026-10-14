import { describe, expect, it } from "vitest";
import { type BoardHealth, deadRestDays, isResting, knownFirstPages, recordBoards } from "../src/board-health";
import { parseConfig } from "../src/config";
import { HttpClient, paceOf } from "../src/http";
import { runRadar } from "../src/run";
import type { CompanyHealth, CompanyRef } from "../src/schema";
import { liveDespiteFeed } from "../src/scan";
import { byMatchChance } from "../src/scope";
import { json } from "./helpers";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T = Date.parse("2026-10-14T00:00:00Z");

/** An adaptive client on a fake fetch: `status(n)` answers the nth request. Records every wait. */
function paced(status: (n: number) => number = () => 200) {
  let n = 0;
  const waits: number[] = [];
  const http = new HttpClient({
    adaptive: true,
    retries: 1,
    backoffMs: 1,
    sleep: async (ms) => {
      waits.push(ms);
    },
    fetchImpl: (async () => json({ ok: true }, status(n++))) as unknown as typeof fetch,
  });
  return { http, waits };
}

describe("adaptive pacing per API", () => {
  it("knows the shared APIs and each Workday shard; other hosts aren't paced as a group", () => {
    expect(paceOf("api.smartrecruiters.com")).toMatchObject({ key: "smartrecruiters", ceiling: 5 });
    expect(paceOf("boards-api.greenhouse.io")).toMatchObject({ key: "greenhouse", ceiling: 8 });
    expect(paceOf("recruiting.paylocity.com")).toMatchObject({ key: "paylocity", ceiling: 3 });
    expect(paceOf("acme.wd5.myworkdayjobs.com")).toMatchObject({ key: "workday:wd5", hostGap: true });
    expect(paceOf("bank.wd3.myworkdayjobs.com")?.key).toBe("workday:wd3");
    expect(paceOf("acme.bamboohr.com")).toBeUndefined();
  });

  it("speeds up while the API keeps up, to its ceiling and no further", async () => {
    const { http } = paced();
    for (let i = 0; i < 60; i++) await http.getJson("https://api.smartrecruiters.com/v1/companies/a/postings");
    expect(http.stats.paces?.smartrecruiters).toEqual({ rate: 5, downs: 0 });
  });

  it("halves on a 429 and on a 503", async () => {
    const { http } = paced((n) => (n === 40 ? 429 : 200));
    for (let i = 0; i < 40; i++) await http.getJson("https://boards-api.greenhouse.io/v1/boards/a/jobs");
    expect(http.stats.paces?.greenhouse?.rate).toBe(8);
    await http.getJson("https://boards-api.greenhouse.io/v1/boards/a/jobs");
    expect(http.stats.paces?.greenhouse?.downs).toBe(1);
    expect(http.stats.paces?.greenhouse?.rate).toBeLessThan(5);

    const busy = paced((n) => (n === 0 ? 503 : 200));
    await busy.http.getJson("https://api.lever.co/v0/postings/a");
    expect(busy.http.stats.paces?.lever?.downs).toBe(1);
  });

  it("takes Paylocity's 403 as 'slow down': retried, not a missing board", async () => {
    const { http } = paced((n) => (n === 0 ? 403 : 200));
    await expect(http.getText("https://recruiting.paylocity.com/Recruiting/Jobs/All/x")).resolves.toBeTruthy();
    expect(http.stats.rateLimited).toBe(1);
    expect(http.stats.paces?.paylocity?.downs).toBe(1);
    // Anywhere else a 403 is the URL's answer.
    const other = paced(() => 403);
    await expect(other.http.getText("https://api.lever.co/v0/postings/x")).rejects.toThrow("HTTP 403");
  });

  it("paces a shared API as one host: no per-host second between its requests", async () => {
    const { http, waits } = paced();
    for (let i = 0; i < 3; i++) await http.getJson("https://boards-api.greenhouse.io/v1/boards/a/jobs");
    // Greenhouse starts at 4/s: the third request's slot is under 0.5 s away, not the 2 s a 1 s host gap would make it.
    expect(Math.max(...waits)).toBeLessThan(500);
  });

  it("leaves pacing off unless asked (the CI crawl keeps its own settings)", async () => {
    const http = new HttpClient({ sleep: async () => {}, fetchImpl: (async () => json({})) as unknown as typeof fetch });
    await http.getJson("https://api.smartrecruiters.com/v1/companies/a/postings");
    expect(http.stats.paces).toBeUndefined();
  });
});

const config = parseConfig(`
profile:
  titles: { include: ["product manager"] }
  locations: { include: ["dubai"] }
companies:
  - { name: "Bank Co", ats: workday, slug: "bank", shard: "wd3", site: "External" }
`);
const now = new Date("2026-10-14T12:00:00Z");

/** A Workday board of `total` postings (newest first); counts the pages asked for. */
function workdayBoard(total: number, opts: { first?: string; noPath?: number } = {}) {
  let pages = 0;
  const http = new HttpClient({
    hostDelayMs: 0,
    sleep: async () => {},
    fetchImpl: (async (_url: string, init?: RequestInit) => {
      // A job's own page (describe): not a page of the list.
      if (init?.method !== "POST") return json({ jobPostingInfo: { jobDescription: "<p>Role</p>", location: "Dubai" } });
      pages++;
      const offset = (JSON.parse(String(init?.body ?? "{}")) as { offset: number }).offset;
      const postings = Array.from({ length: Math.max(0, Math.min(20, total - offset)) }, (_, i) => {
        const n = offset + i;
        const title = n % 2 ? "Product Manager" : "Accountant";
        const req = n === 0 && opts.first ? opts.first : `R${n}`;
        return { title, ...(n === opts.noPath ? {} : { externalPath: `/job/Dubai/Role_${req}` }), locationsText: "Dubai" };
      });
      return json({ total: offset === 0 ? total : 0, jobPostings: postings });
    }) as unknown as typeof fetch,
  });
  return { http, pages: () => pages };
}

describe("Workday first-page check", () => {
  it("reads only page 1 of a board that's as the last full read saw it, and keeps that read's jobs", async () => {
    const first = workdayBoard(50);
    const full = await runRadar(config, { http: first.http, now });
    expect(first.pages()).toBe(3);
    const h = full.health[0]!;
    expect(h.fingerprint).toBeTruthy();
    expect(full.jobs).toHaveLength(50);

    const again = workdayBoard(50);
    const later = new Date(now.getTime() + 6 * HOUR);
    const second = await runRadar(config, { http: again.http, now: later, previous: full.jobs, firstPages: new Map([[h.key!, h.fingerprint!]]) });
    expect(again.pages()).toBe(1);
    expect(second.health[0]).toMatchObject({ ok: true, unchanged: true, jobsFound: 50, matches: h.matches });
    expect(second.jobs).toHaveLength(50);
    expect(second.jobs.every((j) => j.lastSeen === later.toISOString())).toBe(true);
    // Not a full read: the quiet-board fingerprint isn't touched.
    expect(second.health[0]!.idsHash).toBeUndefined();
  });

  it("reads the whole list when page 1 changed, or when your company's stored jobs don't add up", async () => {
    const full = await runRadar(config, { http: workdayBoard(50).http, now });
    const h = full.health[0]!;
    const known = new Map([[h.key!, h.fingerprint!]]);
    const changed = workdayBoard(50, { first: "R999" });
    await runRadar(config, { http: changed.http, now, previous: full.jobs, firstPages: known });
    expect(changed.pages()).toBe(3);
    const missing = workdayBoard(50);
    await runRadar(config, { http: missing.http, now, previous: full.jobs.slice(1), firstPages: known });
    expect(missing.pages()).toBe(3);
  });

  it("a different profile never reuses a first page", async () => {
    const full = await runRadar(config, { http: workdayBoard(50).http, now });
    const h = full.health[0]!;
    const other = { ...config, profile: { ...config.profile, titles: { ...config.profile.titles, include: ["accountant"] } } };
    const again = workdayBoard(50);
    await runRadar(other, { http: again.http, now, previous: full.jobs, firstPages: new Map([[h.key!, h.fingerprint!]]) });
    expect(again.pages()).toBe(3);
  });

  it("a posting with no path is left out; the board's other jobs still count", async () => {
    const r = await runRadar(config, { http: workdayBoard(30, { noPath: 3 }).http, now });
    expect(r.health[0]).toMatchObject({ ok: true, skipped: 1, jobsFound: 29 });
    expect(r.jobs).toHaveLength(29);
  });
});

const health = (key: string, extra: Partial<CompanyHealth>): CompanyHealth => {
  const [ats, slug] = key.split(":") as [CompanyRef["ats"], string];
  return { company: slug, ats, slug, key, ok: true, jobsFound: 1, matches: 0, durationMs: 1, ...extra };
};

describe("board records", () => {
  it("rests a dead board 1, 3, 7, 14, then 30 days while it stays dead", () => {
    let h: BoardHealth = { version: 1, boards: {} };
    const gone = (at: number) => {
      h = recordBoards(h, [health("greenhouse:a", { ok: false, failure: "gone" })], at);
      return h.boards["greenhouse:a"]!;
    };
    expect(gone(T).deadAt).toBeUndefined();
    let at = T + HOUR;
    const rests: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = gone(at);
      rests.push(deadRestDays(r));
      expect(isResting(r, at + deadRestDays(r) * DAY - HOUR)).toBe(true);
      expect(isResting(r, at + deadRestDays(r) * DAY)).toBe(false);
      at += deadRestDays(r) * DAY;
    }
    expect(rests).toEqual([1, 3, 7, 14, 30, 30]);
    // One 404, or two less than an hour apart, isn't dead.
    const once = recordBoards({ version: 1, boards: {} }, [health("greenhouse:b", { ok: false, failure: "gone" })], T);
    expect(recordBoards(once, [health("greenhouse:b", { ok: false, failure: "gone" })], T + 30 * 60_000).boards["greenhouse:b"]?.deadAt).toBeUndefined();
  });

  it("keeps a full read's first page for 72 hours; a reused one doesn't restart the clock", () => {
    let h = recordBoards({ version: 1, boards: {} }, [health("workday:bank|ext", { fingerprint: "p/50:abc" })], T);
    expect(knownFirstPages(h, T + HOUR).get("workday:bank|ext")).toBe("p/50:abc");
    h = recordBoards(h, [health("workday:bank|ext", { fingerprint: "p/50:abc", unchanged: true })], T + 48 * HOUR);
    expect(h.boards["workday:bank|ext"]?.fpAt).toBe(T);
    expect(knownFirstPages(h, T + 72 * HOUR).size).toBe(0);
    // A capped (partial) read, or one without a first page, forgets it.
    h = recordBoards(h, [health("workday:bank|ext", { fingerprint: "p/9:zzz", partial: true })], T + 73 * HOUR);
    expect(h.boards["workday:bank|ext"]?.fp).toBeUndefined();
  });
});

describe("what to fetch first", () => {
  const c = (ats: CompanyRef["ats"], slug: string): CompanyRef => ({ name: slug, ats, slug, enabled: true });

  it("past matchers, then your industries, then hiring systems that match more often; ties keep their order", () => {
    const list = [c("lever", "big"), c("greenhouse", "g1"), c("greenhouse", "g2"), c("lever", "ind"), c("ashby", "old"), c("greenhouse", "g3")];
    const order = byMatchChance(list, { matchedBefore: (x) => x.slug === "old" || x.slug === "g1", inIndustry: (x) => x.slug === "ind" }).map((x) => x.slug);
    expect(order).toEqual(["old", "g1", "ind", "g2", "g3", "big"]);
  });
});

describe("an older job feed leaves more to the live fetch", () => {
  const likely = { matchedBefore: true, inIndustry: false };
  const unlikely = { matchedBefore: false, inIndustry: false };
  it("trusts a fresh feed; past 12 h re-checks the likeliest companies; past 3 days, all", () => {
    expect(liveDespiteFeed(6, likely)).toBe(false);
    expect(liveDespiteFeed(13, likely)).toBe(true);
    expect(liveDespiteFeed(13, { matchedBefore: false, inIndustry: true })).toBe(true);
    expect(liveDespiteFeed(13, unlikely)).toBe(false);
    expect(liveDespiteFeed(73, unlikely)).toBe(true);
  });
});
