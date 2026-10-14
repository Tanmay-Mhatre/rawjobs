import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { writeActivity } from "../../../scripts/catalog/lib/activity";
import { KEEP_DIFFS, stateOf, writeFeed, writeFeedV2, type FeedFormat } from "../../../scripts/catalog/lib/feed-v2";
import { parseConfig } from "../src/config";
import { compactHash, compactOf, decodeCompact, decodeRows, encodeCompact, stateOfCompact } from "../src/job-feed-compact";
import { PART_COMPANIES, readDict, readStore, storeApplyDiffs, storeFromSnapshot } from "../src/job-feed-store";
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
/** Runs are 6 hours apart. */
const run = (n: number) => new Date(Date.parse("2026-10-01T04:30:00.000Z") + (n - 1) * 6 * 3_600_000).toISOString();

type Companies = Record<string, { fetched_at: string; jobs: FeedRow[]; partial?: boolean }>;
/** The build's companies on runs 1, 2 and 3. */
const RUN1: Companies = {
  "lever:acme": { fetched_at: run(1), jobs: [row("1", "Engineer"), row("2", "Designer")] },
  "lever:beta": { fetched_at: run(1), jobs: [row("3", "Product Manager", "Berlin")] },
  "lever:gone": { fetched_at: run(1), jobs: [row("4", "Product Manager")] },
};
const RUN2: Companies = {
  // acme posts a PM job in Dubai; gone disappears; new arrives; beta failed this run
  "lever:acme": { fetched_at: run(2), jobs: [row("1", "Engineer"), row("5", "Senior Product Manager")] },
  "lever:beta": { fetched_at: run(1), jobs: [row("3", "Product Manager", "Berlin")] },
  "lever:new": { fetched_at: run(2), jobs: [row("6", "Product Manager")] },
};
const RUN3: Companies = {
  "lever:acme": { fetched_at: run(3), jobs: [row("1", "Engineer")] },
  "lever:beta": { fetched_at: run(3), jobs: [row("3", "Product Manager")] },
  "lever:new": { fetched_at: run(3), jobs: [row("6", "Product Manager")] },
};

describe("change files", () => {
  it("turn one run's state into the next exactly, including who wasn't read", () => {
    const a = stateOf(RUN1);
    const b = stateOf(RUN2);
    const diff = diffFeedStates(a, b, { seq: 2, generated_at: run(2), date: run(2) });
    expect(diff.removed).toEqual(["lever:gone"]);
    expect(diff.stale).toEqual(["lever:beta"]);
    expect(diff.changes).toEqual({ "lever:acme": { remove: ["2"], add: [row("5", "Senior Product Manager")] }, "lever:new": { add: [row("6", "Product Manager")] } });
    const applied: FeedState = { verified: { ...a.verified }, jobs: { ...a.jobs } };
    expect(applyFeedDiff(applied, diff).sort()).toEqual(["lever:acme", "lever:new"]);
    expect(feedStateHash(applied)).toBe(feedStateHash(b));
  });

  it("keep the full time a company was read, not just the day", () => {
    expect(stateOf(RUN2).verified["lever:acme"]).toBe(run(2));
  });

  it("a job whose title or place changed is removed and added again", () => {
    const a = stateOf(RUN2);
    const b = stateOf(RUN3);
    const diff = diffFeedStates(a, b, { seq: 3, generated_at: run(3), date: run(3) });
    expect(diff.changes["lever:beta"]).toEqual({ remove: ["3"], add: [row("3", "Product Manager")] });
    applyFeedDiff(a, diff);
    expect(feedStateHash(a)).toBe(feedStateHash(b));
  });

  it("the fingerprint ignores order", () => {
    const s = stateOf(RUN1);
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

describe("the compact format", () => {
  const rich: Companies = {
    "workday:acme|careers": {
      fetched_at: run(1),
      jobs: [
        ["a/1", "Product Manager", "3 Locations", "hybrid", "2026-09-30", "Dubai; Berlin"],
        ["a/2", "Ingénieur\tlogiciel", "Paris\nFrance", "unknown", null],
      ],
      partial: true,
    },
    "lever:empty": { fetched_at: run(1), jobs: [] },
  };

  it("round-trips every field, partial companies and empty ones, with the same fingerprint", () => {
    const state = stateOf(rich, 3);
    expect(state.jobs["workday:acme|careers"]![1]).toEqual(["a/2", "Ingénieur logiciel", "Paris France", "unknown", null]);
    const back = decodeCompact(encodeCompact(compactOf(state, { seq: 7, generated_at: run(1) })));
    expect(back).toMatchObject({ seq: 7, generated_at: run(1) });
    expect(stateOfCompact(back)).toEqual(state);
    expect(compactHash(back)).toBe(feedStateHash(state));
    expect([...back.partial]).toEqual(["workday:acme|careers"]);
  });

  it("the app's copy, in parts, takes change files like the plain state does", async () => {
    const dir = tmp();
    const a = stateOf(RUN1, 3);
    const b = stateOf({ ...RUN2, "lever:new": { ...RUN2["lever:new"]!, partial: true } }, 3);
    const snap = brotliCompressSync(encodeCompact(compactOf(a, { seq: 1, generated_at: run(1) })));
    const first = await storeFromSnapshot(dir, snap, "1");
    expect(first.hash).toBe(feedStateHash(a));
    const second = storeApplyDiffs(dir, first, [diffFeedStates(a, b, { schema: 3, seq: 2, generated_at: run(2), date: run(2) })], "2");
    expect(second.hash).toBe(feedStateHash(b));
    expect(second.partial).toEqual(["lever:new"]);
    expect(second.touched).toEqual({ "lever:acme": 2, "lever:new": 2 });
    const dict = readDict(dir, second.dict);
    // New titles go on the end of the dictionary; the next full copy drops unused ones.
    expect(dict.titles.at(dict.titles.length - 1)).toBe("Senior Product Manager");
    expect(second.dictSize).toBe(first.dictSize + 1);
    const rows = Object.fromEntries([...readStore(dir, second.parts)].map(({ key, packed }) => [key, decodeRows(dict, packed)]));
    expect(rows).toEqual(b.jobs);
  });

  it("merges new companies into the right place across many parts", async () => {
    const dir = tmp();
    const many = (n: number, step: number, at: string): Companies =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`lever:c${String(i * step).padStart(6, "0")}`, { fetched_at: at, jobs: [row(`j${i}`, `Title ${i % 50}`)] }]));
    const a = stateOf(many(2 * PART_COMPANIES + 10, 2, run(1)), 3);
    // Every other company is new (odd numbers), the first old one is gone.
    const next = many(4 * PART_COMPANIES + 20, 1, run(2));
    delete next["lever:c000000"];
    const b = stateOf(next, 3);
    const first = await storeFromSnapshot(dir, brotliCompressSync(encodeCompact(compactOf(a, { seq: 1, generated_at: run(1) }))), "1");
    expect(first.parts).toHaveLength(3);
    const second = storeApplyDiffs(dir, first, [diffFeedStates(a, b, { schema: 3, seq: 2, generated_at: run(2), date: run(2) })], "2");
    expect(second.hash).toBe(feedStateHash(b));
    expect(second.parts.length).toBeGreaterThan(3);
  });
});

/** The build writing into one folder, served like the release. */
function feedRelease(format: FeedFormat = 3) {
  const out = tmp();
  const files = new Map<string, Buffer>();
  const manifest = `jobs-v${format}-manifest.json`;
  const publish = (companies: Companies, at: string) => {
    const r = writeFeed(out, stateOf(companies, format), at, format);
    for (const f of readdirSync(out)) files.set(f, readFileSync(join(out, f)));
    return r;
  };
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    const name = url.split("/").pop()!;
    if (!name.endsWith(".sig")) calls.push(name);
    if (name === manifest) return json(JSON.parse(files.get(name)!.toString("utf8")));
    if (name === `${manifest}.sig`) return new Response(key.sign(JSON.stringify(JSON.parse(files.get(manifest)!.toString("utf8")))));
    const body = files.get(name);
    return body ? new Response(body) : new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  return { out, files, publish, fetchImpl, calls };
}

describe("the build", () => {
  it("publishes a full copy, then a checked change file each run, and names the previous full copy to keep", () => {
    const rel = feedRelease();
    expect(rel.publish(RUN1, run(1))).toMatchObject({ seq: 1, note: expect.stringMatching(/full copy only/) });
    const r2 = rel.publish(RUN2, run(2));
    expect(r2).toMatchObject({ seq: 2, changedCompanies: 3, previousSnapshot: "jobs-v3-snapshot-1.txt.br" });
    const manifest = JSON.parse(readFileSync(join(rel.out, "jobs-v3-manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ schema: 3, snapshot: { file: "jobs-v3-snapshot-2.txt.br" } });
    expect(manifest.diffs.map((d: { seq: number }) => d.seq)).toEqual([2]);
    expect(r2.diffBytes).toBeGreaterThan(0);
  });

  it("keeps 14 days of change files at 4 runs a day", () => {
    expect(KEEP_DIFFS).toBe(56);
  });

  it("keeps the second format as older apps know it: five columns, no partial companies", () => {
    const out = tmp();
    writeFeedV2(out, stateOf({ "workday:x|y": { fetched_at: run(1), jobs: [["1", "PM", "3 Locations", "onsite", null, "Dubai"]], partial: true } }), run(1));
    const snap = JSON.parse(brotliDecompressSync(readFileSync(join(out, "jobs-v2-snapshot-1.json.br"))).toString("utf8"));
    expect(snap.jobs["workday:x|y"]).toEqual([["1", "PM", "3 Locations", "onsite", null]]);
    expect(snap.partial).toBeUndefined();
  });
});

describe("the app", () => {
  it("takes the full copy once, then only change files, and its copy matches the build's", async () => {
    process.env.JOBHUNTER_JOBS_URL = "https://feed.example/jobs";
    const rel = feedRelease();
    const app = tmp();
    rel.publish(RUN1, run(1));
    expect((await syncJobFeed(app, { fetchImpl: rel.fetchImpl, now: Date.parse(run(1)) })).message).toMatch(/downloaded .*under an hour old/);
    rel.publish(RUN2, run(2));
    rel.publish(RUN3, run(3));
    rel.calls.length = 0;
    expect((await syncJobFeed(app, { fetchImpl: rel.fetchImpl, now: Date.parse(run(3)) + 2 * 3_600_000 })).message).toMatch(/2 change file\(s\).*2 h old/);
    expect(rel.calls).toEqual(["jobs-v3-manifest.json", "jobs-v3-diff-2.json.br", "jobs-v3-diff-3.json.br"]);
    expect((await syncJobFeed(app, { fetchImpl: rel.fetchImpl })).message).toMatch(/up to date/);
    expect(jobFeedStatus(app)).toMatchObject({ companies: 3 });
  });

  it("falls back to the full copy when a change file is missing or wrong", async () => {
    process.env.JOBHUNTER_JOBS_URL = "https://feed.example/jobs";
    const rel = feedRelease();
    const app = tmp();
    rel.publish(RUN1, run(1));
    await syncJobFeed(app, { fetchImpl: rel.fetchImpl });
    rel.publish(RUN2, run(2));
    rel.files.set("jobs-v3-diff-2.json.br", Buffer.from("corrupt"));
    rel.calls.length = 0;
    expect((await syncJobFeed(app, { fetchImpl: rel.fetchImpl })).message).toMatch(/downloaded/);
    expect(rel.calls).toContain("jobs-v3-snapshot-2.txt.br");
  });

  it("matching remembers its answer and rechecks only companies whose jobs changed", async () => {
    process.env.JOBHUNTER_JOBS_URL = "https://feed.example/jobs";
    const rel = feedRelease();
    const app = tmp();
    const at = (n: number) => Date.parse(run(n));
    rel.publish(RUN1, run(1));
    await syncJobFeed(app, { fetchImpl: rel.fetchImpl });
    expect([...feedMatches(app, profile, at(1)).matching]).toEqual(["lever:gone"]);

    rel.publish(RUN2, run(2));
    await syncJobFeed(app, { fetchImpl: rel.fetchImpl });
    const m2 = feedMatches(app, profile, at(2));
    expect([...m2.matching].sort()).toEqual(["lever:acme", "lever:new"]);
    expect(m2.covered.has("lever:beta")).toBe(true); // read a run ago: still fresh

    rel.publish(RUN3, run(3));
    await syncJobFeed(app, { fetchImpl: rel.fetchImpl });
    // Same answer as checking everything from scratch.
    const incremental = [...feedMatches(app, profile, at(3)).matching].sort();
    rmSync(join(app, "catalog", "jobs", "v3-matches.json"));
    expect(incremental).toEqual([...feedMatches(app, profile, at(3)).matching].sort());
    expect(incremental).toEqual(["lever:beta", "lever:new"]);
  });

  it("takes the full copy again once change files have grown its dictionary a lot", async () => {
    process.env.JOBHUNTER_JOBS_URL = "https://feed.example/jobs";
    const rel = feedRelease();
    const app = tmp();
    rel.publish(RUN1, run(1));
    await syncJobFeed(app, { fetchImpl: rel.fetchImpl });
    const titles = (n: number): Companies => ({ "lever:acme": { fetched_at: run(n), jobs: Array.from({ length: 10 }, (_, i) => row(`${n}-${i}`, `Role ${n}-${i}`)) } });
    rel.publish(titles(2), run(2));
    expect((await syncJobFeed(app, { fetchImpl: rel.fetchImpl })).message).toMatch(/1 change file/);
    rel.publish(titles(3), run(3));
    expect((await syncJobFeed(app, { fetchImpl: rel.fetchImpl })).message).toMatch(/downloaded/);
    expect([...feedMatches(app, { ...profile, titles: { include: ["role"], exclude: [] } }, Date.parse(run(3))).matching]).toEqual(["lever:acme"]);
  });

  it("uses where a vague location really is, and fetches capped boards live", async () => {
    process.env.JOBHUNTER_JOBS_URL = "https://feed.example/jobs";
    const rel = feedRelease();
    const app = tmp();
    rel.publish(
      {
        "workday:far|x": { fetched_at: run(1), jobs: [["1", "Product Manager", "3 Locations", "onsite", null, "Berlin; Paris"]] },
        "workday:near|x": { fetched_at: run(1), jobs: [["2", "Product Manager", "2 Locations", "onsite", null, "Dubai; Paris"]] },
        "workday:unknown|x": { fetched_at: run(1), jobs: [["3", "Product Manager", "4 Locations", "onsite", null]] },
        "lever:capped": { fetched_at: run(1), jobs: [row("4", "Engineer")], partial: true },
      },
      run(1),
    );
    await syncJobFeed(app, { fetchImpl: rel.fetchImpl });
    const m = feedMatches(app, profile, Date.parse(run(1)));
    expect([...m.matching].sort()).toEqual(["workday:near|x", "workday:unknown|x"]);
    expect(m.covered.has("workday:far|x")).toBe(true);
    expect(m.covered.has("lever:capped")).toBe(false);
  });

  it("an app whose profile changed checks everything again", async () => {
    process.env.JOBHUNTER_JOBS_URL = "https://feed.example/jobs";
    const rel = feedRelease();
    const app = tmp();
    rel.publish(RUN1, run(1));
    await syncJobFeed(app, { fetchImpl: rel.fetchImpl });
    feedMatches(app, profile, Date.parse(run(1)));
    const designer = { ...profile, titles: { include: ["designer"], exclude: [] } };
    expect([...feedMatches(app, designer, Date.parse(run(1))).matching]).toEqual(["lever:acme"]);
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
    const now = Date.parse(run(2));

    // A feed without it: nothing to show.
    publish(RUN1, run(1), false);
    await syncJobFeed(app, { fetchImpl: rel.fetchImpl });
    expect(readFeedActivity(app, now)).toBeUndefined();

    publish(RUN2, run(2));
    rel.calls.length = 0;
    await syncJobFeed(app, { fetchImpl: rel.fetchImpl });
    expect(rel.calls).toContain("jobs-activity-2.json.br");
    expect(readFeedActivity(app, now)).toMatchObject({ date: "2026-10-01", companies: { "lever:acme": { n: 0 } } });

    // Up to date: not downloaded again.
    rel.calls.length = 0;
    await syncJobFeed(app, { fetchImpl: rel.fetchImpl });
    expect(rel.calls).toEqual(["jobs-v3-manifest.json"]);

    // A day the build couldn't make it: the copy stays.
    publish(RUN3, run(3), false);
    rel.files.delete("jobs-activity-2.json.br");
    await syncJobFeed(app, { fetchImpl: rel.fetchImpl });
    expect(readFeedActivity(app, now)?.date).toBe("2026-10-01");
  });

  it("refuses an activity file that doesn't match the manifest", async () => {
    process.env.JOBHUNTER_JOBS_URL = "https://feed.example/jobs";
    const rel = feedRelease();
    const app = tmp();
    rel.publish(RUN1, run(1));
    writeActivity(rel.out);
    for (const f of readdirSync(rel.out)) rel.files.set(f, readFileSync(join(rel.out, f)));
    rel.files.set("jobs-activity-1.json.br", Buffer.from("tampered"));
    expect((await syncJobFeed(app, { fetchImpl: rel.fetchImpl })).message).toMatch(/downloaded/);
    expect(readFeedActivity(app, Date.parse(run(1)))).toBeUndefined();
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
