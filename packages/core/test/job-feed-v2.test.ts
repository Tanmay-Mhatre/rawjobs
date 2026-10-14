import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { writeActivity } from "../../../scripts/catalog/lib/activity";
import { stateOf, writeFeedV2 } from "../../../scripts/catalog/lib/feed-v2";
import { parseConfig } from "../src/config";
import { feedMatches, jobFeedStatus, readFeedActivity, syncJobFeed, type FeedRow } from "../src/job-feed";
import { applyFeedDiff, diffFeedStates, feedStateHash, type FeedState } from "../src/job-feed-diff";
import { json, testDataKey } from "./helpers";

const key = testDataKey();
afterAll(key.restore);

const profile = parseConfig(`
profile:
  titles: { include: ["product manager"], exclude: [] }
  locations: { include: ["dubai"], remote_ok: [], remote_exclude: [] }
companies: []
`).profile;

let dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "jh-feed2-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
  delete process.env.JOBHUNTER_JOBS_URL;
});

const row = (id: string, title: string, location = "Dubai"): FeedRow => [id, title, location, "onsite", null];
const day = (d: number) => `2026-10-${String(d).padStart(2, "0")}T04:30:00.000Z`;

/** The daily build's companies on day 1, 2 and 3. */
const DAY1 = {
  "lever:acme": { fetched_at: day(1), jobs: [row("1", "Engineer"), row("2", "Designer")] },
  "lever:beta": { fetched_at: day(1), jobs: [row("3", "Product Manager", "Berlin")] },
  "lever:gone": { fetched_at: day(1), jobs: [row("4", "Product Manager")] },
};
const DAY2 = {
  // acme posts a PM job in Dubai; beta's job moves to Dubai; gone disappears; new arrives; beta failed today
  "lever:acme": { fetched_at: day(2), jobs: [row("1", "Engineer"), row("5", "Senior Product Manager")] },
  "lever:beta": { fetched_at: day(1), jobs: [row("3", "Product Manager", "Berlin")] },
  "lever:new": { fetched_at: day(2), jobs: [row("6", "Product Manager")] },
};
const DAY3 = {
  "lever:acme": { fetched_at: day(3), jobs: [row("1", "Engineer")] },
  "lever:beta": { fetched_at: day(3), jobs: [row("3", "Product Manager")] },
  "lever:new": { fetched_at: day(3), jobs: [row("6", "Product Manager")] },
};

describe("change files", () => {
  it("turn one day's state into the next exactly, including who wasn't read", () => {
    const a = stateOf(DAY1);
    const b = stateOf(DAY2);
    const diff = diffFeedStates(a, b, { seq: 2, generated_at: day(2), date: "2026-10-02" });
    expect(diff.removed).toEqual(["lever:gone"]);
    expect(diff.stale).toEqual(["lever:beta"]);
    expect(diff.changes).toEqual({ "lever:acme": { remove: ["2"], add: [row("5", "Senior Product Manager")] }, "lever:new": { add: [row("6", "Product Manager")] } });
    const applied: FeedState = { verified: { ...a.verified }, jobs: { ...a.jobs } };
    expect(applyFeedDiff(applied, diff).sort()).toEqual(["lever:acme", "lever:new"]);
    expect(feedStateHash(applied)).toBe(feedStateHash(b));
  });

  it("a job whose title or place changed is removed and added again", () => {
    const a = stateOf(DAY2);
    const b = stateOf(DAY3);
    const diff = diffFeedStates(a, b, { seq: 3, generated_at: day(3), date: "2026-10-03" });
    expect(diff.changes["lever:beta"]).toEqual({ remove: ["3"], add: [row("3", "Product Manager")] });
    applyFeedDiff(a, diff);
    expect(feedStateHash(a)).toBe(feedStateHash(b));
  });

  it("the fingerprint ignores order", () => {
    const s = stateOf(DAY1);
    const shuffled: FeedState = {
      verified: { ...s.verified },
      jobs: Object.fromEntries(
        Object.entries(s.jobs)
          .reverse()
          .map(([k, r]) => [k, [...r].reverse()]),
      ),
    };
    expect(feedStateHash(shuffled)).toBe(feedStateHash(s));
  });
});

/** The daily build writing into one folder, served like the release. */
function feedRelease() {
  const out = tmp();
  const files = new Map<string, Buffer>();
  const publish = (companies: Record<string, { fetched_at: string; jobs: FeedRow[] }>, at: string) => {
    const r = writeFeedV2(out, stateOf(companies), at);
    for (const f of readdirSync(out)) files.set(f, readFileSync(join(out, f)));
    return r;
  };
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    const name = url.split("/").pop()!;
    if (!name.endsWith(".sig")) calls.push(name);
    if (name === "jobs-v2-manifest.json") return json(JSON.parse(files.get(name)!.toString("utf8")));
    if (name === "jobs-v2-manifest.json.sig") return new Response(key.sign(JSON.stringify(JSON.parse(files.get("jobs-v2-manifest.json")!.toString("utf8")))));
    const body = files.get(name);
    return body ? new Response(body) : new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  return { out, files, publish, fetchImpl, calls };
}

describe("the second format", () => {
  it("the build publishes a full copy, then a checked change file each day", () => {
    const rel = feedRelease();
    expect(rel.publish(DAY1, day(1))).toMatchObject({ seq: 1, note: expect.stringMatching(/full copy only/) });
    const r2 = rel.publish(DAY2, day(2));
    expect(r2).toMatchObject({ seq: 2, changedCompanies: 3 });
    const manifest = JSON.parse(readFileSync(join(rel.out, "jobs-v2-manifest.json"), "utf8"));
    expect(manifest.diffs.map((d: { seq: number }) => d.seq)).toEqual([2]);
    expect(r2.diffBytes).toBeGreaterThan(0);
  });

  it("an app takes the full copy once, then only change files, and its copy matches the build's", async () => {
    process.env.JOBHUNTER_JOBS_URL = "https://feed.example/jobs";
    const rel = feedRelease();
    const app = tmp();
    rel.publish(DAY1, day(1));
    expect((await syncJobFeed(app, { fetchImpl: rel.fetchImpl })).message).toMatch(/downloaded/);
    rel.publish(DAY2, day(2));
    rel.publish(DAY3, day(3));
    rel.calls.length = 0;
    expect((await syncJobFeed(app, { fetchImpl: rel.fetchImpl })).message).toMatch(/2 day\(s\) of changes/);
    expect(rel.calls).toEqual(["jobs-v2-manifest.json", "jobs-v2-diff-2.json.br", "jobs-v2-diff-3.json.br"]);
    expect((await syncJobFeed(app, { fetchImpl: rel.fetchImpl })).message).toMatch(/up to date/);
    expect(jobFeedStatus(app)).toMatchObject({ companies: 3 });
  });

  it("falls back to the full copy when a change file is missing or wrong", async () => {
    process.env.JOBHUNTER_JOBS_URL = "https://feed.example/jobs";
    const rel = feedRelease();
    const app = tmp();
    rel.publish(DAY1, day(1));
    await syncJobFeed(app, { fetchImpl: rel.fetchImpl });
    rel.publish(DAY2, day(2));
    rel.files.set("jobs-v2-diff-2.json.br", Buffer.from("corrupt"));
    rel.calls.length = 0;
    expect((await syncJobFeed(app, { fetchImpl: rel.fetchImpl })).message).toMatch(/downloaded/);
    expect(rel.calls).toContain("jobs-v2-snapshot-2.json.br");
  });

  it("matching remembers its answer and rechecks only companies whose jobs changed", async () => {
    process.env.JOBHUNTER_JOBS_URL = "https://feed.example/jobs";
    const rel = feedRelease();
    const app = tmp();
    const at = (d: number) => Date.parse(day(d));
    rel.publish(DAY1, day(1));
    await syncJobFeed(app, { fetchImpl: rel.fetchImpl });
    expect([...feedMatches(app, profile, at(1)).matching]).toEqual(["lever:gone"]);

    rel.publish(DAY2, day(2));
    await syncJobFeed(app, { fetchImpl: rel.fetchImpl });
    const m2 = feedMatches(app, profile, at(2));
    expect([...m2.matching].sort()).toEqual(["lever:acme", "lever:new"]);
    expect(m2.covered.has("lever:beta")).toBe(true); // read yesterday: still fresh

    rel.publish(DAY3, day(3));
    await syncJobFeed(app, { fetchImpl: rel.fetchImpl });
    // Same answer as checking everything from scratch.
    const incremental = [...feedMatches(app, profile, at(3)).matching].sort();
    rmSync(join(app, "catalog", "jobs", "v2-matches.json"));
    expect(incremental).toEqual([...feedMatches(app, profile, at(3)).matching].sort());
    expect(incremental).toEqual(["lever:beta", "lever:new"]);
  });

  it("an app whose profile changed checks everything again", async () => {
    process.env.JOBHUNTER_JOBS_URL = "https://feed.example/jobs";
    const rel = feedRelease();
    const app = tmp();
    rel.publish(DAY1, day(1));
    await syncJobFeed(app, { fetchImpl: rel.fetchImpl });
    feedMatches(app, profile, Date.parse(day(1)));
    const designer = { ...profile, titles: { include: ["designer"], exclude: [] } };
    expect([...feedMatches(app, designer, Date.parse(day(1))).matching]).toEqual(["lever:acme"]);
  });
});

describe("hiring activity", () => {
  it("downloads the activity file the signed manifest lists, once, and keeps it when a day has none", async () => {
    process.env.JOBHUNTER_JOBS_URL = "https://feed.example/jobs";
    const rel = feedRelease();
    const app = tmp();
    const publish = (companies: Parameters<typeof rel.publish>[0], at: string, activity = true) => {
      rel.publish(companies, at);
      if (activity) writeActivity(rel.out);
      for (const f of readdirSync(rel.out)) rel.files.set(f, readFileSync(join(rel.out, f)));
    };
    const now = Date.parse(day(2));

    // A feed without it: nothing to show.
    publish(DAY1, day(1), false);
    await syncJobFeed(app, { fetchImpl: rel.fetchImpl });
    expect(readFeedActivity(app, now)).toBeUndefined();

    publish(DAY2, day(2));
    rel.calls.length = 0;
    await syncJobFeed(app, { fetchImpl: rel.fetchImpl });
    expect(rel.calls).toContain("jobs-activity-2.json.br");
    expect(readFeedActivity(app, now)).toMatchObject({ date: "2026-10-02", companies: { "lever:acme": { n: 0 } } });

    // Up to date: not downloaded again.
    rel.calls.length = 0;
    await syncJobFeed(app, { fetchImpl: rel.fetchImpl });
    expect(rel.calls).toEqual(["jobs-v2-manifest.json"]);

    // A day the build couldn't make it: the copy stays.
    publish(DAY3, day(3), false);
    rel.files.delete("jobs-activity-2.json.br");
    await syncJobFeed(app, { fetchImpl: rel.fetchImpl });
    expect(readFeedActivity(app, now)?.date).toBe("2026-10-02");
  });

  it("refuses an activity file that doesn't match the manifest", async () => {
    process.env.JOBHUNTER_JOBS_URL = "https://feed.example/jobs";
    const rel = feedRelease();
    const app = tmp();
    rel.publish(DAY1, day(1));
    writeActivity(rel.out);
    for (const f of readdirSync(rel.out)) rel.files.set(f, readFileSync(join(rel.out, f)));
    rel.files.set("jobs-activity-1.json.br", Buffer.from("tampered"));
    expect((await syncJobFeed(app, { fetchImpl: rel.fetchImpl })).message).toMatch(/downloaded/);
    expect(readFeedActivity(app, Date.parse(day(1)))).toBeUndefined();
  });
});

describe("old feeds", () => {
  it("an app still reads a feed that only has the first format", async () => {
    process.env.JOBHUNTER_JOBS_URL = "https://feed.example/jobs";
    const app = tmp();
    const fetchImpl = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    expect((await syncJobFeed(app, { fetchImpl })).message).toMatch(/unavailable/);
  });
});
