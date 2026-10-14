import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { parseConfig } from "../src/config";
import { feedMatches, JOB_FEED_SCHEMA, jobFeedStatus, syncJobFeed, type JobFeedManifest, type JobFeedShard } from "../src/job-feed";
import { writeBoardHealth } from "../src/board-health";
import { writeLedger } from "../src/discover";
import { scan, type ScanStart } from "../src/scan";
import { fakeHttp, fixture, json, testDataKey } from "./helpers";

const key = testDataKey();
afterAll(key.restore);

const NOW = Date.parse("2026-10-09T12:00:00Z");
const config = parseConfig(`
profile:
  titles: { include: ["product manager"], exclude: [] }
  locations: { include: ["dubai"], remote_ok: [], remote_exclude: [] }
companies:
  - { name: "Mine", ats: greenhouse, slug: "mine" }
`);

const shard = (companies: JobFeedShard["companies"]): JobFeedShard => ({ schema: JOB_FEED_SCHEMA, ats: "lever", generated_at: new Date(NOW).toISOString(), companies });
const at = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();

let dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "jh-feed-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
  delete process.env.RAWJOBS_JOBS_URL;
});

/** Serve a manifest and its shards like the release does. */
function feedServer(shards: Record<string, JobFeedShard>, schema = JOB_FEED_SCHEMA) {
  const files = new Map<string, Buffer>();
  const manifest: JobFeedManifest = { schema, generated_at: new Date(NOW).toISOString(), shards: {} };
  for (const [ats, s] of Object.entries(shards)) {
    const gz = gzipSync(JSON.stringify(s));
    files.set(`jobs-${ats}.json.gz`, gz);
    manifest.shards[ats] = { file: `jobs-${ats}.json.gz`, sha256: createHash("sha256").update(gz).digest("hex"), bytes: gz.length, companies: Object.keys(s.companies).length, jobs: 0 };
  }
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    const name = url.split("/").pop()!;
    if (name === "jobs-manifest.json") return json(manifest);
    if (name === "jobs-manifest.json.sig") return new Response(key.sign(JSON.stringify(manifest)));
    const body = files.get(name);
    return body ? new Response(body) : new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("syncJobFeed", () => {
  it("downloads the shards, then only ones that changed", async () => {
    process.env.RAWJOBS_JOBS_URL = "https://feed.example/jobs";
    const dir = tmp();
    const s = shard({ "lever:acme": { fetched_at: at(0), jobs: [["1", "Product Manager", "Dubai", "onsite", null]] } });
    const server = feedServer({ lever: s });
    expect(await syncJobFeed(dir, { fetchImpl: server.fetchImpl, now: NOW })).toMatchObject({ updated: true });
    expect(jobFeedStatus(dir, NOW)).toMatchObject({ companies: 1, ageDays: 0 });
    server.calls.length = 0;
    expect(await syncJobFeed(dir, { fetchImpl: server.fetchImpl, now: NOW })).toMatchObject({ updated: false });
    // No third-format feed here (404), so the first format is read: just its manifest.
    expect(server.calls.sort()).toEqual([
      "https://feed.example/jobs/jobs-manifest.json",
      "https://feed.example/jobs/jobs-manifest.json.sig",
      "https://feed.example/jobs/jobs-v3-manifest.json",
      "https://feed.example/jobs/jobs-v3-manifest.json.sig",
    ]);
  });

  it("ignores a feed in a format it doesn't know, and never throws offline", async () => {
    const dir = tmp();
    expect((await syncJobFeed(dir, { fetchImpl: feedServer({}, 99).fetchImpl })).message).toMatch(/newer format/);
    const offline = (async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch;
    expect((await syncJobFeed(dir, { fetchImpl: offline })).message).toMatch(/Couldn't reach/);
  });
});

describe("syncJobFeed with a tampered manifest", () => {
  it("refuses a shard name that would write outside the feed folder", async () => {
    process.env.RAWJOBS_JOBS_URL = "https://feed.example/jobs";
    const dir = tmp();
    const s = shard({ "lever:acme": { fetched_at: at(0), jobs: [] } });
    const server = feedServer({ "../../../updates": s });
    const r = await syncJobFeed(dir, { fetchImpl: server.fetchImpl, now: NOW });
    expect(r).toMatchObject({ updated: false, message: expect.stringMatching(/unsafe/) });
    expect(existsSync(join(dir, "updates.json"))).toBe(false);
    expect(server.calls.some((u) => u.includes(".."))).toBe(false);
  });
});

describe("syncJobFeed signatures", () => {
  it("refuses a manifest whose signature doesn't match, and doesn't fall back to the other format", async () => {
    process.env.RAWJOBS_JOBS_URL = "https://feed.example/jobs";
    const dir = tmp();
    const server = feedServer({ lever: shard({ "lever:acme": { fetched_at: at(0), jobs: [] } }) });
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      // A third-format manifest with a signature that isn't the data key's.
      if (url.endsWith("jobs-v3-manifest.json")) return json({ schema: 3 });
      if (url.endsWith("jobs-v3-manifest.json.sig")) return new Response("bm90IGEgc2lnbmF0dXJl");
      return server.fetchImpl(url);
    }) as unknown as typeof fetch;
    expect(await syncJobFeed(dir, { fetchImpl, now: NOW })).toMatchObject({ updated: false, message: expect.stringMatching(/signature isn't valid/) });
    expect(calls.some((u) => u.endsWith("jobs-manifest.json"))).toBe(false);
  });
});

describe("feedMatches", () => {
  const write = (dir: string, s: JobFeedShard) => {
    mkdirSync(join(dir, "catalog", "jobs"), { recursive: true });
    writeFileSync(join(dir, "catalog", "jobs", "lever.json"), JSON.stringify(s));
    writeFileSync(join(dir, "catalog", "jobs", "manifest.json"), JSON.stringify({ schema: JOB_FEED_SCHEMA, generated_at: at(0), shards: { lever: {} } }));
  };

  it("covers fresh companies and marks those with a job passing your filters", () => {
    const dir = tmp();
    write(
      dir,
      shard({
        "lever:yes": { fetched_at: at(0), jobs: [["1", "Senior Product Manager", "Dubai", "onsite", null]] },
        "lever:no": { fetched_at: at(0), jobs: [["2", "Engineer", "Dubai", "onsite", null]] },
        "lever:vague": { fetched_at: at(0), jobs: [["3", "Product Manager", "3 Locations", "unknown", null]] },
        "lever:old": { fetched_at: at(5), jobs: [] },
      }),
    );
    const m = feedMatches(dir, config.profile, NOW);
    expect([...m.covered].sort()).toEqual(["lever:no", "lever:vague", "lever:yes"]);
    expect([...m.matching].sort()).toEqual(["lever:vague", "lever:yes"]);
  });

  it("scan fetches only directory companies the feed doesn't rule out; yours always", async () => {
    const dir = tmp();
    mkdirSync(join(dir, "catalog"), { recursive: true });
    const entry = (slug: string) => ({ key: `lever:${slug}`, name: slug, ats: "lever", slug, careers_url: "", open_jobs: 3, status: "live" });
    writeFileSync(join(dir, "catalog", "directory.json"), JSON.stringify({ companies: [entry("leverco"), entry("nothing"), entry("unknown")] }));
    write(
      dir,
      shard({
        "lever:leverco": { fetched_at: at(0), jobs: [["1", "Product Manager", "Dubai", "onsite", null]] },
        "lever:nothing": { fetched_at: at(0), jobs: [["2", "Engineer", "Dubai", "onsite", null]] },
      }),
    );
    const { http, calls } = fakeHttp((url) => (url.includes("lever.co/v0/postings/leverco") ? json(fixture("lever.json")) : url.includes("greenhouse") ? json({ jobs: [] }) : json([])));
    let skipped: number | undefined;
    await scan(config, { dataDir: dir, scope: "all", http, now: new Date(NOW), onStart: (s) => (skipped = s.skippedByFeed) });
    expect(skipped).toBe(1);
    expect(calls.some((u) => u.includes("/mine/"))).toBe(true);
    expect(calls.some((u) => u.includes("leverco"))).toBe(true);
    expect(calls.some((u) => u.includes("unknown"))).toBe(true);
    expect(calls.some((u) => u.includes("nothing"))).toBe(false);
  });

  it("Scan now fetches yours, past matches and the feed's picks; the background check then does the rest", async () => {
    const dir = tmp();
    mkdirSync(join(dir, "catalog"), { recursive: true });
    const entry = (slug: string) => ({ key: `lever:${slug}`, name: slug, ats: "lever", slug, careers_url: "", open_jobs: 3, status: "live" });
    writeFileSync(join(dir, "catalog", "directory.json"), JSON.stringify({ companies: [entry("leverco"), entry("nothing"), entry("unknown"), entry("past")] }));
    write(
      dir,
      shard({
        "lever:leverco": { fetched_at: at(0), jobs: [["1", "Product Manager", "Dubai", "onsite", null]] },
        "lever:nothing": { fetched_at: at(0), jobs: [["2", "Engineer", "Dubai", "onsite", null]] },
        "lever:past": { fetched_at: at(0), jobs: [["3", "Engineer", "Dubai", "onsite", null]] },
      }),
    );
    // Matched you at the last check, though the feed shows nothing for you there now.
    writeLedger(dir, { version: 1, companies: { "lever:past": { name: "past", ats: "lever", slug: "past", lastChecked: at(1), matches: 2 } } });
    const routes = (url: string) => (url.includes("lever.co/v0/postings/leverco") ? json(fixture("lever.json")) : url.includes("greenhouse") ? json({ jobs: [] }) : json([]));
    const quick = fakeHttp(routes);
    let start: ScanStart | undefined;
    await scan(config, { dataDir: dir, scope: "mine", http: quick.http, now: new Date(NOW), onStart: (s) => (start = s) });
    expect(start).toMatchObject({ scope: "mine", extra: 2, sources: { "lever:past": "past", "lever:leverco": "feed" } });
    expect(start?.fallback).toBeUndefined();
    expect(quick.calls.some((u) => u.includes("/mine/"))).toBe(true);
    expect(quick.calls.some((u) => u.includes("unknown") || u.includes("nothing"))).toBe(false);

    // The background check: every company Scan now didn't just fetch, live, without the feed choosing.
    const rest = fakeHttp(routes);
    const r = await scan(config, { dataDir: dir, scope: "all", feed: false, skipFetchedSince: NOW, http: rest.http, now: new Date(NOW) });
    expect(r.checks.map((c) => c.slug).sort()).toEqual(["nothing", "unknown"]);
    expect(rest.calls.some((u) => u.includes("/mine/") || u.includes("leverco") || u.includes("/past"))).toBe(false);
    expect(r.result.everyCompany).toBe(true);
  });

  it("Scan now checks every company when the feed is too old to pick", async () => {
    const dir = tmp();
    mkdirSync(join(dir, "catalog"), { recursive: true });
    const entry = (slug: string) => ({ key: `lever:${slug}`, name: slug, ats: "lever", slug, careers_url: "", open_jobs: 3, status: "live" });
    writeFileSync(join(dir, "catalog", "directory.json"), JSON.stringify({ companies: [entry("leverco"), entry("nothing")] }));
    write(dir, shard({ "lever:leverco": { fetched_at: at(5), jobs: [["1", "Product Manager", "Dubai", "onsite", null]] } }));
    let start: ScanStart | undefined;
    const r = await scan(config, { dataDir: dir, scope: "mine", http: fakeHttp(() => json([])).http, now: new Date(NOW), onStart: (s) => (start = s) });
    expect(start).toMatchObject({ fallback: true, extra: 2 });
    expect(r.result.everyCompany).toBe(true);
  });

  it("quiet boards are skipped on top of the feed's, each counted once", async () => {
    const dir = tmp();
    mkdirSync(join(dir, "catalog"), { recursive: true });
    const entry = (slug: string) => ({ key: `lever:${slug}`, name: slug, ats: "lever", slug, careers_url: "", open_jobs: 3, status: "live" });
    writeFileSync(join(dir, "catalog", "directory.json"), JSON.stringify({ companies: [entry("leverco"), entry("nothing"), entry("unknown"), entry("other")] }));
    write(
      dir,
      shard({
        "lever:leverco": { fetched_at: at(0), jobs: [["1", "Product Manager", "Dubai", "onsite", null]] },
        "lever:nothing": { fetched_at: at(0), jobs: [["2", "Engineer", "Dubai", "onsite", null]] },
      }),
    );
    // Unchanged for 20 days and fetched an hour ago: quiet (the feed already rules out "nothing").
    const steady = { okAt: NOW - 3_600_000, ids: "abcd1234", changedAt: NOW - 20 * 86_400_000 };
    writeBoardHealth(dir, { version: 1, boards: { "lever:nothing": steady, "lever:unknown": steady } });
    const { http, calls } = fakeHttp((url) => (url.includes("lever.co/v0/postings/leverco") ? json(fixture("lever.json")) : url.includes("greenhouse") ? json({ jobs: [] }) : json([])));
    let start: ScanStart | undefined;
    await scan(config, { dataDir: dir, scope: "all", http, now: new Date(NOW), onStart: (s) => (start = s) });
    expect(start).toMatchObject({ skippedByFeed: 1, quiet: 1, extra: 2 });
    expect(calls.some((u) => u.includes("leverco"))).toBe(true);
    expect(calls.some((u) => u.includes("other"))).toBe(true);
    expect(calls.some((u) => u.includes("unknown") || u.includes("nothing"))).toBe(false);
  });
});
