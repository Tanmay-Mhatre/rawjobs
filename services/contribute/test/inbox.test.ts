import { describe, expect, it } from "vitest";
import { ATS_TYPES } from "../../../packages/core/src/schema";
import { cleanBoard } from "../../../scripts/catalog/contributions";
import worker, { SCANNABLE, type Env } from "../src/index";

function fakeEnv(limitOk = true, extra: Partial<Env> = {}): Env & { store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
    put: async (k: string, v: string) => void store.set(k, v),
    get: async (k: string) => store.get(k) ?? null,
    delete: async (k: string) => void store.delete(k),
    list: async ({ prefix, limit = 1000, cursor }: { prefix: string; limit?: number; cursor?: string }) => {
      const all = [...store.keys()].filter((k) => k.startsWith(prefix));
      const start = cursor ? Number(cursor) : 0;
      const end = start + limit;
      return { keys: all.slice(start, end).map((name) => ({ name })), list_complete: end >= all.length, cursor: String(end) };
    },
  };
  return { store, INBOX_TOKEN: "secret-token", LIMITER: { limit: async () => ({ success: limitOk }) }, INBOX: kv as unknown as Env["INBOX"], ...extra };
}
const call = (env: Env, path: string, init: RequestInit = {}) => worker.fetch(new Request(`https://inbox.test${path}`, init), env);
const post = (env: Env, path: string, body: unknown, headers: Record<string, string> = {}) => call(env, path, { method: "POST", body: JSON.stringify(body), headers });
/** The stored contributions (what the workflow sees), oldest first. */
const contributions = (env: { store: Map<string, string> }) => [...env.store.entries()].filter(([k]) => k.startsWith("c:")).map(([, v]) => JSON.parse(v) as Record<string, unknown>);

describe("contribution inbox", () => {
  it("keeps valid boards only, deduplicated, with no user data", async () => {
    const env = fakeEnv();
    const res = await post(env, "/v1/contributions", {
      boards: [
        { ats: "lever", slug: "acme", name: "Acme <b>" },
        { ats: "lever", slug: "ACME" },
        { ats: "taleo", slug: "x" },
        { ats: "workday", slug: "bank" },
        { ats: "workday", slug: "bank", shard: "wd3", site: "External" },
        { ats: "lever", slug: "other", url: "https://tracker.example/?id=me", email: "me@example.com" },
      ],
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ received: 3, duplicates: 0 });
    const [stored] = contributions(env);
    expect(stored!.boards).toEqual([
      { ats: "lever", slug: "acme", name: "Acme b" },
      { ats: "workday", slug: "bank", shard: "wd3", site: "External" },
      { ats: "lever", slug: "other" },
    ]);
    expect(Object.keys(stored!).sort()).toEqual(["boards", "received_at"]);
  });

  it("takes every hiring system the directory takes, not only the first five", async () => {
    // Was greenhouse/lever/ashby/smartrecruiters/workday only: a Workable board added by link got a 400
    // and the app dropped it, while it said "added to the directory".
    expect([...SCANNABLE].sort()).toEqual([...ATS_TYPES].sort());
    const env = fakeEnv();
    const res = await post(env, "/v1/contributions", {
      boards: [
        { ats: "workable", slug: "huggingface", name: "Hugging Face" },
        { ats: "oracle", slug: "x", shard: "eeho" },
        { ats: "taleo", slug: "acme", site: "careersection" },
        { ats: "hackernews", slug: "jobs" },
      ],
    });
    expect(await res.json()).toEqual({ received: 3, duplicates: 0 });
    expect(contributions(env)[0]!.boards).toEqual([
      { ats: "workable", slug: "huggingface", name: "Hugging Face" },
      { ats: "oracle", slug: "x", shard: "eeho" },
      { ats: "taleo", slug: "acme", site: "careersection" },
    ]);
  });

  it("accepts and refuses the same boards as the directory workflow", async () => {
    const boards = [
      { ats: "workable", slug: "acme" },
      { ats: "recruitee", slug: "acme", site: "jobs" },
      { ats: "workday", slug: "bank" },
      { ats: "workday", slug: "bank", shard: "wd3", site: "External" },
      { ats: "oracle", slug: "x" },
      { ats: "oracle", slug: "x", shard: "BAD SHARD" },
      { ats: "successfactors", slug: "x", shard: "career5.successfactors.eu" },
      { ats: "lever", slug: "acme", shard: "wd1" },
      { ats: "taleo", slug: "acme" },
      { ats: "comeet", slug: "acme", site: "bad site" },
      { ats: "remotive", slug: "all" },
    ];
    for (const b of boards) {
      const env = fakeEnv();
      const res = await post(env, "/v1/contributions", { boards: [b] });
      expect([b, res.status === 202], JSON.stringify(b)).toEqual([b, typeof cleanBoard(b) !== "string"]);
    }
  });

  it("keeps the client field only when it is the app name and version", async () => {
    const env = fakeEnv();
    await post(env, "/v1/contributions", { client: "job-hunter/0.1.0", boards: [{ ats: "lever", slug: "a" }] });
    await post(env, "/v1/contributions", { client: "job-hunter jane@example.com", boards: [{ ats: "lever", slug: "b" }] });
    await post(env, "/v1/contributions", { client: { id: 1 }, boards: [{ ats: "lever", slug: "c" }] });
    await post(env, "/v1/contributions", { client: "job-hunter", boards: [{ ats: "lever", slug: "d" }] });
    await post(env, "/v1/contributions", { client: "rawjobs/0.2.0", boards: [{ ats: "lever", slug: "e" }] });
    const bySlug = Object.fromEntries(contributions(env).map((s) => [(s.boards as { slug: string }[])[0]!.slug, s.client]));
    expect(bySlug).toEqual({ a: "job-hunter/0.1.0", b: undefined, c: undefined, d: "job-hunter", e: "rawjobs/0.2.0" });
  });

  it("skips boards already received this week", async () => {
    const env = fakeEnv();
    await post(env, "/v1/contributions", { boards: [{ ats: "lever", slug: "acme" }] });
    const again = await post(env, "/v1/contributions", {
      boards: [
        { ats: "lever", slug: "Acme" },
        { ats: "ashby", slug: "new" },
      ],
    });
    expect(await again.json()).toEqual({ received: 1, duplicates: 1 });
    const only = await post(env, "/v1/contributions", { boards: [{ ats: "lever", slug: "acme" }] });
    expect(only.status).toBe(202);
    expect(await only.json()).toEqual({ received: 0, duplicates: 1 });
    expect(contributions(env)).toHaveLength(2);
  });

  it("stops accepting at the daily cap, all or nothing", async () => {
    const env = fakeEnv(true, { DAILY_CAP: "3" });
    expect(
      (
        await post(env, "/v1/contributions", {
          boards: [
            { ats: "lever", slug: "a" },
            { ats: "lever", slug: "b" },
          ],
        })
      ).status,
    ).toBe(202);
    expect(
      (
        await post(env, "/v1/contributions", {
          boards: [
            { ats: "lever", slug: "c" },
            { ats: "lever", slug: "d" },
          ],
        })
      ).status,
    ).toBe(429);
    expect((await post(env, "/v1/contributions", { boards: [{ ats: "lever", slug: "c" }] })).status).toBe(202);
    expect((await post(env, "/v1/contributions", { boards: [{ ats: "lever", slug: "e" }] })).status).toBe(429);
    expect(contributions(env)).toHaveLength(2);
  });

  it("rejects junk, oversize bodies and floods", async () => {
    const env = fakeEnv();
    expect((await post(env, "/v1/contributions", { boards: [{ ats: "lever", slug: "../etc" }] })).status).toBe(400);
    expect((await post(env, "/v1/contributions", null)).status).toBe(400);
    expect((await call(env, "/v1/contributions", { method: "POST", body: "x".repeat(30_000) })).status).toBe(413);
    expect((await post(fakeEnv(false), "/v1/contributions", { boards: [{ ats: "lever", slug: "a" }] })).status).toBe(429);
  });

  it("lists and acknowledges pending items only with the token", async () => {
    const env = fakeEnv();
    await post(env, "/v1/contributions", { boards: [{ ats: "ashby", slug: "kraken.com" }] });
    expect((await call(env, "/v1/pending")).status).toBe(401);
    const auth = { authorization: "Bearer secret-token" };
    const pending = (await (await call(env, "/v1/pending", { headers: auth })).json()) as { items: { id: string }[] };
    expect(pending.items).toHaveLength(1);
    expect(await (await post(env, "/v1/ack", { ids: [pending.items[0]!.id] }, auth)).json()).toEqual({ removed: 1 });
    expect(contributions(env)).toHaveLength(0);
  });

  it("pages past 500 with a cursor", async () => {
    const env = fakeEnv();
    for (let i = 0; i < 501; i++) env.store.set(`c:${String(i).padStart(4, "0")}`, JSON.stringify({ boards: [], received_at: "" }));
    const auth = { authorization: "Bearer secret-token" };
    const first = (await (await call(env, "/v1/pending", { headers: auth })).json()) as { items: unknown[]; more: boolean; cursor?: string };
    expect([first.items.length, first.more, typeof first.cursor]).toEqual([500, true, "string"]);
    const second = (await (await call(env, `/v1/pending?cursor=${first.cursor}`, { headers: auth })).json()) as { items: { id: string }[]; more: boolean; cursor?: string };
    expect([second.items.map((i) => i.id), second.more, second.cursor]).toEqual([["c:0500"], false, undefined]);
  });

  it("hands a damaged record over empty instead of failing the whole list", async () => {
    const env = fakeEnv();
    await post(env, "/v1/contributions", { boards: [{ ats: "ashby", slug: "kraken.com" }] });
    env.store.set("c:damaged", '{"boards": [');
    const res = await call(env, "/v1/pending", { headers: { authorization: "Bearer secret-token" } });
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: { id: string; boards: unknown[] }[] };
    expect(items.map((i) => [i.id === "c:damaged", i.boards.length]).sort()).toEqual([
      [false, 1],
      [true, 0],
    ]);
  });
});

describe("move reports", () => {
  const SECRET = "reporter-secret";
  const auth = { authorization: "Bearer secret-token" };
  const fromIp = (ip: string) => ({ "cf-connecting-ip": ip });
  const move = (from = "old", to = "new", name = "Acme") => ({ name, from: { ats: "lever", slug: from }, to: { ats: "ashby", slug: to } });
  /** Counts KV writes, which matter on the free plan. */
  function movesEnv(extra: Partial<Env> = {}) {
    const env = fakeEnv(true, { REPORTER_SECRET: SECRET, ...extra });
    const writes: { key: string; ttl?: number }[] = [];
    const put = env.INBOX.put.bind(env.INBOX);
    (env.INBOX as unknown as { put: unknown }).put = async (k: string, v: string, o?: { expirationTtl?: number }) => {
      writes.push({ key: k, ttl: o?.expirationTtl });
      return put(k, v);
    };
    return Object.assign(env, { writes });
  }
  const records = (env: { store: Map<string, string> }) => [...env.store.entries()].filter(([k]) => k.startsWith("m:")).map(([k, v]) => [k, JSON.parse(v)] as [string, Record<string, unknown>]);

  it("stores a well-shaped move with a keyed reporter hash and no IP", async () => {
    const env = movesEnv();
    const res = await post(
      env,
      "/v1/moves",
      { client: "rawjobs/0.7.0", moves: [{ name: " Acme <Inc>\n", from: { ats: "lever", slug: "acme", name: "x" }, to: { ats: "workday", slug: "acme", shard: "wd3", site: "External" } }] },
      fromIp("203.0.113.7"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 1, skipped: 0 });
    const [[key, record]] = records(env) as [[string, Record<string, unknown>]];
    expect(key).toBe("m:lever:acme||>workday:acme|wd3|external");
    expect(record).toMatchObject({ name: "Acme Inc", from: { ats: "lever", slug: "acme" }, to: { ats: "workday", slug: "acme", shard: "wd3", site: "External" } });
    expect(Object.keys(record).sort()).toEqual(["first_at", "from", "last_at", "name", "reporters", "to"]);
    expect(record.reporters).toEqual([expect.stringMatching(/^[0-9a-f]{16}$/)]);
    expect(env.writes).toEqual([
      { key, ttl: 30 * 86_400 },
      { key: expect.stringMatching(/^md:\d{4}-\d{2}-\d{2}$/), ttl: expect.any(Number) },
    ]);
  });

  it("never stores an IP address in any value", async () => {
    const env = movesEnv();
    const ips = ["203.0.113.7", "198.51.100.23", "2001:db8::1"];
    for (const ip of ips) await post(env, "/v1/moves", { moves: [move(), move("other", "elsewhere")] }, fromIp(ip));
    await post(env, "/v1/contributions", { boards: [{ ats: "lever", slug: "acme" }] }, fromIp(ips[0]!));
    expect(records(env)).toHaveLength(2);
    for (const [k, v] of env.store) for (const ip of ips) expect(`${k} ${v}`).not.toContain(ip);
  });

  it("refuses badly shaped moves", async () => {
    const env = movesEnv();
    const bad = [
      { name: "Acme", from: { ats: "hackernews", slug: "acme" }, to: { ats: "ashby", slug: "acme" } },
      { name: "Acme", from: { ats: "lever", slug: "https://jobs.lever.co/acme" }, to: { ats: "ashby", slug: "acme" } },
      { name: "Acme", from: { ats: "lever", slug: "acme" }, to: { ats: "ashby", slug: "jobs.ashbyhq.com/acme?ref=me" } },
      { name: "Acme", from: { ats: "lever", slug: "acme" }, to: { ats: "lever", slug: "ACME" } },
      { name: "Acme", from: { ats: "workday", slug: "bank" }, to: { ats: "ashby", slug: "bank" } },
      { name: "  <>  ", from: { ats: "lever", slug: "acme" }, to: { ats: "ashby", slug: "acme" } },
      { from: { ats: "lever", slug: "acme" }, to: { ats: "ashby", slug: "acme" } },
      { name: "Acme", from: { ats: "lever", slug: "acme" } },
    ];
    for (const m of bad) expect((await post(env, "/v1/moves", { moves: [m] })).status, JSON.stringify(m)).toBe(400);
    expect((await post(env, "/v1/moves", { moves: Array.from({ length: 11 }, (_, i) => move(`old${i}`)) })).status).toBe(400);
    expect((await post(env, "/v1/moves", { moves: "nope" })).status).toBe(400);
    expect((await post(env, "/v1/moves", null)).status).toBe(400);
    expect((await call(env, "/v1/moves", { method: "POST", body: "x".repeat(11_000) })).status).toBe(400);
    expect(env.writes).toEqual([]);
  });

  it("takes 10 moves, skips the bad and repeated ones, and cuts long names to 120 characters", async () => {
    const env = movesEnv();
    const moves = [...Array.from({ length: 8 }, (_, i) => move(`old${i}`)), move("old0"), { ...move("x"), to: { ats: "lever", slug: "x" } }];
    moves[1] = move("old1", "new", "N".repeat(200));
    expect(await (await post(env, "/v1/moves", { moves })).json()).toEqual({ accepted: 8, skipped: 2 });
    expect(records(env).find(([k]) => k.startsWith("m:lever:old1"))![1].name).toHaveLength(120);
  });

  it("writes nothing for a repeat from the same reporter, and adds a new reporter", async () => {
    const env = movesEnv();
    await post(env, "/v1/moves", { moves: [move()] }, fromIp("203.0.113.7"));
    const before = env.writes.length;
    expect(await (await post(env, "/v1/moves", { moves: [move()] }, fromIp("203.0.113.7"))).json()).toEqual({ accepted: 0, skipped: 1 });
    expect(env.writes.length).toBe(before);
    expect(await (await post(env, "/v1/moves", { moves: [move()] }, fromIp("198.51.100.23"))).json()).toEqual({ accepted: 1, skipped: 0 });
    // One write for the changed record, none for the day counter (no new record).
    expect(env.writes.slice(before).map((w) => w.key)).toEqual(["m:lever:old||>ashby:new||"]);
    const [[, record]] = records(env) as [[string, { reporters: string[] }]];
    expect(new Set(record.reporters).size).toBe(2);
  });

  it("keeps at most 20 reporters", async () => {
    const env = movesEnv();
    for (let i = 0; i < 25; i++) await post(env, "/v1/moves", { moves: [move()] }, fromIp(`203.0.113.${i}`));
    const [[, record]] = records(env) as [[string, { reporters: string[] }]];
    expect(record.reporters).toHaveLength(20);
    expect(env.writes.filter((w) => w.key.startsWith("m:"))).toHaveLength(20);
  });

  it("stops new records at MOVES_DAILY_CAP, all or nothing, but still counts reporters on known ones", async () => {
    const env = movesEnv({ MOVES_DAILY_CAP: "3" });
    expect((await post(env, "/v1/moves", { moves: [move("a"), move("b")] }, fromIp("1.1.1.1"))).status).toBe(200);
    expect((await post(env, "/v1/moves", { moves: [move("c"), move("d")] }, fromIp("1.1.1.1"))).status).toBe(429);
    expect((await post(env, "/v1/moves", { moves: [move("c")] }, fromIp("1.1.1.1"))).status).toBe(200);
    expect((await post(env, "/v1/moves", { moves: [move("e")] }, fromIp("1.1.1.1"))).status).toBe(429);
    expect(await (await post(env, "/v1/moves", { moves: [move("a")] }, fromIp("2.2.2.2"))).json()).toEqual({ accepted: 1, skipped: 0 });
    expect(records(env)).toHaveLength(3);
  });

  it("defaults the daily cap to 100", async () => {
    const env = movesEnv();
    for (let i = 0; i < 10; i++) await post(env, "/v1/moves", { moves: Array.from({ length: 10 }, (_, j) => move(`o${i}-${j}`)) });
    expect((await post(env, "/v1/moves", { moves: [move("one-more")] })).status).toBe(429);
    expect(records(env)).toHaveLength(100);
  });

  it("answers 503 without REPORTER_SECRET and stores nothing", async () => {
    const env = movesEnv({ REPORTER_SECRET: undefined });
    expect((await post(env, "/v1/moves", { moves: [move()] })).status).toBe(503);
    expect(env.store.size).toBe(0);
  });

  it("shares the contributions rate limiter", async () => {
    const env = fakeEnv(false, { REPORTER_SECRET: SECRET });
    expect((await post(env, "/v1/moves", { moves: [move()] })).status).toBe(429);
  });

  it("lists and acknowledges moves only with the token, without the hashes", async () => {
    const env = movesEnv();
    await post(env, "/v1/moves", { moves: [move()] }, fromIp("1.1.1.1"));
    await post(env, "/v1/moves", { moves: [move()] }, fromIp("2.2.2.2"));
    await post(env, "/v1/contributions", { boards: [{ ats: "lever", slug: "acme" }] });
    expect((await call(env, "/v1/moves/pending")).status).toBe(401);
    expect((await call(env, "/v1/moves/pending", { headers: { authorization: "Bearer wrong-token" } })).status).toBe(401);
    expect((await post(env, "/v1/moves/ack", { ids: ["m:lever:old||>ashby:new||"] })).status).toBe(401);
    expect(records(env)).toHaveLength(1);

    const res = (await (await call(env, "/v1/moves/pending", { headers: auth })).json()) as { items: Record<string, unknown>[]; cursor?: string };
    expect(res).toEqual({
      items: [
        {
          id: "m:lever:old||>ashby:new||",
          name: "Acme",
          from: { ats: "lever", slug: "old" },
          to: { ats: "ashby", slug: "new" },
          reporters: 2,
          first_at: expect.any(String),
          last_at: expect.any(String),
        },
      ],
    });
    const [[, stored]] = records(env) as [[string, { reporters: string[] }]];
    for (const h of stored.reporters) expect(JSON.stringify(res)).not.toContain(h);

    // The contributions list and ack don't see moves, and the moves ack doesn't touch contributions.
    const contrib = (await (await call(env, "/v1/pending", { headers: auth })).json()) as { items: { id: string }[] };
    expect(contrib.items.map((i) => i.id.slice(0, 2))).toEqual(["c:"]);
    expect(await (await post(env, "/v1/ack", { ids: ["m:lever:old||>ashby:new||"] }, auth)).json()).toEqual({ removed: 0 });
    expect(await (await post(env, "/v1/moves/ack", { ids: [contrib.items[0]!.id, "m:lever:old||>ashby:new||"] }, auth)).json()).toEqual({ removed: 1 });
    expect(records(env)).toHaveLength(0);
    expect(contributions(env)).toHaveLength(1);
  });

  it("pages past 500 with a cursor", async () => {
    const env = movesEnv();
    const rec = JSON.stringify({ name: "A", from: { ats: "lever", slug: "a" }, to: { ats: "ashby", slug: "a" }, first_at: "", last_at: "", reporters: ["0123456789abcdef"] });
    for (let i = 0; i < 501; i++) env.store.set(`m:${String(i).padStart(4, "0")}`, rec);
    env.store.set("c:x", JSON.stringify({ boards: [], received_at: "" }));
    const first = (await (await call(env, "/v1/moves/pending", { headers: auth })).json()) as { items: unknown[]; cursor?: string };
    expect([first.items.length, typeof first.cursor]).toEqual([500, "string"]);
    const second = (await (await call(env, `/v1/moves/pending?cursor=${first.cursor}`, { headers: auth })).json()) as { items: { id: string }[]; cursor?: string };
    expect([second.items.map((i) => i.id), second.cursor]).toEqual([["m:0500"], undefined]);
  });

  it("acknowledges at most 1,000 ids a request", async () => {
    const env = movesEnv();
    for (let i = 0; i < 1001; i++) env.store.set(`m:${i}`, "{}");
    const ids = [...env.store.keys()];
    expect(await (await post(env, "/v1/moves/ack", { ids }, auth)).json()).toEqual({ removed: 1000 });
    expect(env.store.size).toBe(1);
  });
});
