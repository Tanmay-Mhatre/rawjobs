import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { dayNumber, diffFeedStates, type ActivityFile, type FeedManifestV2, type FeedRow, type FeedState } from "@rawjobs/core";
import { ACTIVITY_STATE, emptyActivityState, recordActivity, titleMark, toActivityFile, writeActivity, type ActivityState } from "./activity";
import { stateOf, writeFeedV2 } from "./feed-v2";

const row = (id: string, title: string, posted: string | null = null): FeedRow => [id, title, "London", "onsite", posted];
const feed = (jobs: Record<string, FeedRow[]>, date: string): FeedState => ({ verified: Object.fromEntries(Object.keys(jobs).map((k) => [k, date])), jobs });

/** Record a run of days: each state against the one before, as the daily build does. */
function run(days: [date: string, jobs: Record<string, FeedRow[]>][]): ActivityState {
  let state = emptyActivityState();
  let before: FeedState | undefined;
  days.forEach(([date, jobs], i) => {
    const today = feed(jobs, date);
    const diff = before ? diffFeedStates(before, today, { seq: i + 1, generated_at: `${date}T04:00:00Z`, date }) : undefined;
    state = recordActivity(state, today, diff, { seq: i + 1, date });
    before = today;
  });
  return state;
}

describe("recording new roles", () => {
  it("counts new ids from the second day, by kind", () => {
    const state = run([
      ["2026-10-10", { "lever:acme": [row("1", "Engineer")] }],
      ["2026-10-11", { "lever:acme": [row("1", "Engineer"), row("2", "Designer"), row("3", "Data Intern"), row("4", "Graduate Analyst")] }],
    ]);
    expect(state.since).toBe("2026-10-11");
    expect(state.companies["lever:acme"]!.months["2026-10"]).toEqual([3, 1, 1]);
  });

  it("the first day and a new company's first day are starting points, not new roles", () => {
    const state = run([
      ["2026-10-10", { "lever:acme": [row("1", "Engineer")] }],
      ["2026-10-11", { "lever:acme": [row("1", "Engineer")], "lever:beta": [row("9", "Engineer"), row("10", "Designer")] }],
      ["2026-10-12", { "lever:acme": [row("1", "Engineer")], "lever:beta": [row("9", "Engineer"), row("10", "Designer"), row("11", "Writer")] }],
    ]);
    expect(state.companies["lever:acme"]!.months).toEqual({});
    expect(state.companies["lever:beta"]!.first).toBe("2026-10-11");
    expect(state.companies["lever:beta"]!.months["2026-10"]).toEqual([1, 0, 0]);
  });

  it("leaves out reposts, changed jobs and one role posted under several ids", () => {
    const state = run([
      ["2026-10-10", { "lever:acme": [row("1", "Engineer"), row("2", "Designer")] }],
      // 2 closes; 1's date changes (removed and added under the same id).
      ["2026-10-11", { "lever:acme": [row("1", "Engineer", "2026-10-11")] }],
      // 3 reposts the designer role; 4 and 5 are one role in two places ("Sr." is "Senior").
      ["2026-10-12", { "lever:acme": [row("1", "Engineer", "2026-10-11"), row("3", "Designer - London"), row("4", "Sr. Writer"), row("5", "Senior Writer - Remote")] }],
    ]);
    const c = state.companies["lever:acme"]!;
    expect(c.months["2026-10"]).toEqual([1, 0, 0]);
    expect(c.days.map((d) => d.slice(1))).toEqual([[1, 0, 0, 1]]);
  });

  it("a title last listed over 60 days ago is new again", () => {
    let state = run([
      ["2026-07-01", { "lever:acme": [row("1", "Designer"), row("0", "Engineer")] }],
      ["2026-07-02", { "lever:acme": [row("0", "Engineer")] }],
    ]);
    const today = feed({ "lever:acme": [row("0", "Engineer"), row("2", "Designer")] }, "2026-09-15");
    const diff = diffFeedStates(feed({ "lever:acme": [row("0", "Engineer")] }, "2026-09-14"), today, { seq: 3, generated_at: "2026-09-15T04:00:00Z", date: "2026-09-15" });
    state = recordActivity(state, today, diff, { seq: 3, date: "2026-09-15" });
    expect(state.companies["lever:acme"]!.months["2026-09"]).toEqual([1, 0, 0]);
    // Only titles from the last 60 days are kept.
    expect(Object.keys(state.companies["lever:acme"]!.titles).sort()).toEqual([titleMark("Designer"), titleMark("Engineer")].sort());
  });

  it("a company back after it was gone starts again", () => {
    const state = run([
      ["2026-10-10", { "lever:acme": [row("1", "Engineer")] }],
      ["2026-10-11", { "lever:acme": [row("1", "Engineer"), row("2", "Designer")] }],
      ["2026-10-12", {}],
      ["2026-10-13", { "lever:acme": [row("1", "Engineer"), row("2", "Designer"), row("3", "Writer")] }],
    ]);
    const c = state.companies["lever:acme"]!;
    expect(c.first).toBe("2026-10-13");
    expect(c.gone).toBeUndefined();
    expect(c.months["2026-10"]).toEqual([1, 0, 0]);
  });

  it("skips a run already recorded and counts nothing without a change file", () => {
    const state = run([
      ["2026-10-10", { "lever:acme": [row("1", "Engineer")] }],
      ["2026-10-11", { "lever:acme": [row("1", "Engineer"), row("2", "Designer")] }],
    ]);
    const again = recordActivity(state, feed({ "lever:acme": [] }, "2026-10-11"), undefined, { seq: 2, date: "2026-10-11" });
    expect(again).toBe(state);
    const noDiff = recordActivity(structuredClone(state), feed({ "lever:acme": [row("1", "Engineer"), row("2", "Designer"), row("3", "Writer")] }, "2026-10-12"), undefined, {
      seq: 3,
      date: "2026-10-12",
    });
    expect(noDiff.companies["lever:acme"]!.months["2026-10"]).toEqual([1, 0, 0]);
    expect(noDiff.seq).toBe(3);
  });

  it("keeps 13 months and 60 days", () => {
    const state: ActivityState = {
      ...emptyActivityState(),
      seq: 1,
      date: "2026-10-01",
      since: "2025-01-01",
      companies: { "lever:acme": { first: "2025-01-01", titles: { old: 1 }, days: [[1, 1, 0, 0, 0]], months: { "2025-09": [1, 0, 0], "2025-10": [2, 0, 0] } } },
    };
    const next = recordActivity(state, feed({ "lever:acme": [] }, "2026-10-02"), undefined, { seq: 2, date: "2026-10-02" });
    expect(Object.keys(next.companies["lever:acme"]!.months)).toEqual(["2025-10"]);
    expect(next.companies["lever:acme"]!.days).toEqual([]);
    expect(next.companies["lever:acme"]!.titles).toEqual({});
  });
});

describe("the published file", () => {
  const T = dayNumber("2026-10-13");

  it("rolls days up into months, the last 30 days and posted roles", () => {
    const state: ActivityState = {
      ...emptyActivityState(),
      seq: 9,
      date: "2026-10-13",
      since: "2026-08-01",
      companies: {
        "lever:acme": {
          first: "2026-07-31",
          titles: {},
          days: [
            [T - 44, 4, 1, 0, 0], // 30 Aug: outside the window
            [T - 14, 3, 0, 1, 1], // 29 Sep: inside
            [T, 2, 0, 0, 0], // today
          ],
          months: { "2026-08": [9, 1, 0], "2026-09": [3, 0, 1], "2026-10": [2, 0, 0] },
        },
        "lever:late": { first: "2026-10-01", titles: {}, days: [], months: {} },
      },
    };
    const today = feed(
      {
        "lever:acme": [row("1", "Engineer", "2026-10-12"), row("2", "Engineer - Remote", "2026-10-01"), row("3", "Designer", "2026-09-13"), row("4", "Writer", "2026-09-14")],
        "lever:late": [row("5", "Engineer")],
        "lever:unknown": [row("6", "Engineer")],
      },
      "2026-10-13",
    );
    const file = toActivityFile(state, today, "2026-10-13T04:30:00Z");
    expect(file).toMatchObject({ schema: 1, date: "2026-10-13", since: "2026-08-01", first_month: "2025-10" });
    const acme = file.companies["lever:acme"]!;
    expect(acme.m!.slice(-3)).toEqual([9, 3, 2]);
    expect(acme.m).toHaveLength(13);
    expect(acme.i!.slice(-3)).toEqual([1, 0, 0]);
    expect(acme.g!.slice(-3)).toEqual([0, 1, 0]);
    expect(acme.n).toBe(5);
    // Engineer (twice, one role) and Writer; Designer was posted 30 days ago.
    expect(acme.p).toBe(2);
    expect(acme.s).toBeUndefined();
    expect(file.companies["lever:late"]).toEqual({ n: 0, s: "2026-10-02" });
    expect(file.companies["lever:unknown"]).toEqual({ n: 0 });
  });

  it("marks mass posters", () => {
    const many = (n: number, title: (i: number) => string) => Array.from({ length: n }, (_, i) => row(String(i), title(i)));
    const base = (days: ActivityState["companies"][string]["days"]): ActivityState["companies"][string] => ({ first: "2026-01-01", titles: {}, days, months: {} });
    const state: ActivityState = {
      ...emptyActivityState(),
      seq: 2,
      date: "2026-10-13",
      since: "2026-08-01",
      companies: { "lever:reposts": base([[T, 10, 0, 0, 40]]), "lever:churn": base([[T, 400, 0, 0, 0]]), "lever:real": base([[T, 100, 0, 0, 20]]), "lever:small": base([[T, 5, 0, 0, 50]]) },
    };
    const today = feed(
      { "lever:reposts": many(600, (i) => `Role ${i}`), "lever:churn": many(600, (i) => `Role ${i}`), "lever:real": many(600, (i) => `Role ${i}`), "lever:small": many(20, (i) => `Role ${i}`) },
      "2026-10-13",
    );
    const file = toActivityFile(state, today, "2026-10-13T04:30:00Z");
    expect(file.companies["lever:reposts"]!.e).toBe(1);
    expect(file.companies["lever:churn"]!.e).toBe(1);
    expect(file.companies["lever:real"]!.e).toBeUndefined();
    expect(file.companies["lever:small"]!.e).toBeUndefined();
  });
});

describe("writeActivity", () => {
  let dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs = [];
  });
  const day = (d: number) => `2026-10-${String(d).padStart(2, "0")}T04:30:00.000Z`;

  it("publishes the file, lists it with its checksum in the manifest and carries the state", async () => {
    const out = mkdtempSync(join(tmpdir(), "jh-activity-"));
    dirs.push(out);
    const unbrotli = <T>(f: string) => JSON.parse(brotliDecompressSync(readFileSync(join(out, f))).toString("utf8")) as T;

    await writeFeedV2(out, stateOf({ "lever:acme": { fetched_at: day(1), jobs: [row("1", "Engineer", "2026-09-30")] } }), day(1));
    const first = writeActivity(out);
    expect(first.notes).toEqual(["no change file today; today's new roles go uncounted"]);
    expect(first.file.since).toBeNull();

    await writeFeedV2(out, stateOf({ "lever:acme": { fetched_at: day(2), jobs: [row("1", "Engineer", "2026-09-30"), row("2", "Designer", "2026-10-02")] } }), day(2));
    const second = writeActivity(out);
    expect(second.notes).toEqual([]);

    const manifest = JSON.parse(readFileSync(join(out, "jobs-v2-manifest.json"), "utf8")) as FeedManifestV2;
    expect(manifest.activity?.file).toBe("jobs-activity-2.json.br");
    const buf = readFileSync(join(out, manifest.activity!.file));
    expect(manifest.activity!.sha256).toBe(createHash("sha256").update(buf).digest("hex"));
    expect(manifest.activity!.bytes).toBe(buf.length);
    // Yesterday's file is gone locally; the manifest's other fields are as jobs.ts wrote them.
    expect(readdirSync(out).filter((f) => f.startsWith("jobs-activity-"))).toEqual(["jobs-activity-2.json.br"]);
    expect(manifest.seq).toBe(2);

    const file = unbrotli<ActivityFile>(manifest.activity!.file);
    expect(file).toEqual(second.file);
    expect(file.since).toBe("2026-10-02");
    expect(file.companies["lever:acme"]).toMatchObject({ n: 1, p: 2 });
    const state = JSON.parse(readFileSync(join(out, ACTIVITY_STATE), "utf8")) as ActivityState;
    expect(state.seq).toBe(2);
  });
});
