import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module (runs in CI without an install), no type declarations
import { LEAD_MS, cronsOf, cronMatches as guardCronMatches, slotStart } from "../../../scripts/catalog/slot-covered.mjs";
import { cronMatches, dispatch, dueEntries, SCHEDULE, tick } from "../src/index";

const env = { GITHUB_TOKEN: "t", REPO: "o/r", REF: "main" };
const t = (iso: string) => Date.parse(iso);
const workflowFile = (name: string) => readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), "utf8");

type Call = { url: string; init: RequestInit };
const fakeFetch = (calls: Call[], status = (_url: string) => 204) =>
  (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const s = status(url);
    return new Response(s === 204 ? null : "Bad credentials", { status: s });
  }) as unknown as typeof fetch;

describe("the cron matcher", () => {
  it("matches numbers, lists, ranges and steps", () => {
    expect(cronMatches("13 */6 * * *", t("2026-11-05T18:13:00Z"))).toBe(true);
    expect(cronMatches("13 */6 * * *", t("2026-11-05T19:13:00Z"))).toBe(false);
    expect(cronMatches("27 11,23 * * *", t("2026-11-05T23:27:00Z"))).toBe(true);
    expect(cronMatches("27 11,23 * * *", t("2026-11-05T12:27:00Z"))).toBe(false);
    expect(cronMatches("0 9-17 * * *", t("2026-11-05T17:00:00Z"))).toBe(true);
    expect(cronMatches("0 9-17 * * *", t("2026-11-05T18:00:00Z"))).toBe(false);
    expect(cronMatches("10-50/20 * * * *", t("2026-11-05T18:30:00Z"))).toBe(true);
    expect(cronMatches("10-50/20 * * * *", t("2026-11-05T18:40:00Z"))).toBe(false);
  });

  it("starts day-of-month steps at 1 and accepts 7 for Sunday", () => {
    expect(cronMatches("0 0 */2 * *", t("2026-11-01T00:00:00Z"))).toBe(true);
    expect(cronMatches("0 0 */2 * *", t("2026-11-02T00:00:00Z"))).toBe(false);
    expect(cronMatches("31 3 * * 0", t("2026-11-08T03:31:00Z"))).toBe(true); // a Sunday
    expect(cronMatches("31 3 * * 7", t("2026-11-08T03:31:00Z"))).toBe(true);
    expect(cronMatches("31 3 * * 0", t("2026-11-09T03:31:00Z"))).toBe(false);
  });

  it("treats two restricted day fields as either-or, like cron", () => {
    expect(cronMatches("0 0 1 * 1", t("2026-11-01T00:00:00Z"))).toBe(true); // the 1st, a Sunday
    expect(cronMatches("0 0 1 * 1", t("2026-11-02T00:00:00Z"))).toBe(true); // a Monday
    expect(cronMatches("0 0 1 * 1", t("2026-11-03T00:00:00Z"))).toBe(false);
  });

  it("rejects what it can't read", () => {
    expect(() => cronMatches("0 0 * *", 0)).toThrow(/Bad cron/);
    expect(() => cronMatches("x 0 * * *", 0)).toThrow(/Bad cron field/);
  });
});

describe("the schedule", () => {
  it("dispatches each entry on exactly one tick", () => {
    const fired: Record<string, number> = {};
    // Two weeks of 5-minute ticks.
    for (let ms = t("2026-11-02T00:00:00Z"); ms < t("2026-11-16T00:00:00Z"); ms += 5 * 60000) for (const e of dueEntries(SCHEDULE, ms)) fired[e.workflow] = (fired[e.workflow] ?? 0) + 1;
    expect(fired).toEqual({
      "jobs-daily.yml": 14 * 4,
      "directory-contributions.yml": 14 * 8,
      "data-health.yml": 14 * 2,
      "connector-health.yml": 14,
      "directory-commoncrawl.yml": 14,
      "concepts-weekly.yml": 2,
    });
  });

  it("picks the entries due in the 5 minutes ending at the tick", () => {
    expect(dueEntries(SCHEDULE, t("2026-11-05T18:15:00Z")).map((e) => e.workflow)).toEqual(["jobs-daily.yml"]);
    expect(dueEntries(SCHEDULE, t("2026-11-05T18:10:00Z")).map((e) => e.workflow)).toEqual(["directory-contributions.yml"]);
    expect(dueEntries(SCHEDULE, t("2026-11-05T18:20:00Z"))).toEqual([]);
    // Cloudflare's scheduledTime can carry seconds; still the same window.
    expect(dueEntries(SCHEDULE, t("2026-11-05T13:30:02Z")).map((e) => e.workflow)).toEqual(["directory-commoncrawl.yml"]);
  });

  for (const entry of SCHEDULE) {
    describe(entry.workflow, () => {
      const yaml = workflowFile(entry.workflow);
      const crons: string[] = cronsOf(yaml);

      it("fires 10 minutes before each of the workflow's GitHub crons, and only then", () => {
        expect(crons.length).toBeGreaterThan(0);
        for (let ms = t("2026-11-02T00:00:00Z"); ms < t("2026-11-09T00:00:00Z"); ms += 60000) {
          const github = crons.some((c) => guardCronMatches(c, ms + LEAD_MS));
          expect(cronMatches(entry.cron, ms), new Date(ms).toISOString()).toBe(github);
        }
      });

      it("lands in the same slot as the GitHub cron run, even when that one is hours late", () => {
        for (let ms = t("2026-11-02T00:00:00Z"); ms < t("2026-11-09T00:00:00Z"); ms += 5 * 60000) {
          if (!dueEntries([entry], ms).length) continue;
          const start = slotStart(crons, ms);
          // The scheduler run is created at the tick (up to 4 minutes after the entry's time), at or after the slot's start...
          expect(start).not.toBeNull();
          expect(ms).toBeGreaterThanOrEqual(start);
          // ...and GitHub's cron run for the same slot, on time or 2 hours late, finds the same start.
          const githubTime = Array.from({ length: 16 }, (_, m) => ms + m * 60000).find((x) => crons.some((c) => guardCronMatches(c, x)));
          expect(githubTime).toBeDefined();
          expect(slotStart(crons, githubTime!)).toBe(start);
          expect(slotStart(crons, githubTime! + 2 * 3600000)).toBe(start);
        }
      });

      it("sends only inputs the workflow declares", () => {
        const dispatchBlock = yaml.split("workflow_dispatch:")[1]?.split(/\n\S/)[0] ?? "";
        for (const name of ["source", ...Object.keys(entry.inputs ?? {})]) expect(dispatchBlock).toMatch(new RegExp(`\\n {6}${name}:`));
        expect(yaml).toContain("inputs.source == 'scheduler'");
      });
    });
  }
});

describe("dispatching", () => {
  it("starts the workflow on main, tagged as the scheduler's", async () => {
    const calls: Call[] = [];
    await dispatch(env, { workflow: "jobs-daily.yml", cron: "13 */6 * * *" }, fakeFetch(calls));
    expect(calls[0]!.url).toBe("https://api.github.com/repos/o/r/actions/workflows/jobs-daily.yml/dispatches");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ ref: "main", inputs: { source: "scheduler" } });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer t");
  });

  it("adds an entry's own inputs", async () => {
    const calls: Call[] = [];
    await dispatch(env, { workflow: "x.yml", cron: "0 0 * * *", inputs: { due_only: "true" } }, fakeFetch(calls));
    expect(JSON.parse(String(calls[0]!.init.body)).inputs).toEqual({ due_only: "true", source: "scheduler" });
  });

  it("fails loudly when GitHub refuses", async () => {
    await expect(
      dispatch(
        env,
        SCHEDULE[0]!,
        fakeFetch([], () => 401),
      ),
    ).rejects.toThrow(/jobs-daily\.yml: workflow_dispatch failed: HTTP 401/);
  });

  it("still dispatches the others when one fails, then throws", async () => {
    const calls: Call[] = [];
    const errors: unknown[] = [];
    const schedule = [
      { workflow: "a.yml", cron: "15 18 * * *" },
      { workflow: "b.yml", cron: "13 18 * * *" },
      { workflow: "c.yml", cron: "11 18 * * *" },
    ];
    const original = console.error;
    console.error = (m: unknown) => errors.push(m);
    try {
      await expect(
        tick(
          env,
          t("2026-11-05T18:15:00Z"),
          fakeFetch(calls, (url) => (url.includes("/a.yml/") ? 422 : 204)),
          schedule,
        ),
      ).rejects.toThrow(/1 of 3 dispatches failed/);
    } finally {
      console.error = original;
    }
    expect(calls).toHaveLength(3);
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toMatch(/a\.yml: workflow_dispatch failed: HTTP 422/);
  });

  it("returns what it started", async () => {
    expect(await tick(env, t("2026-11-05T18:15:00Z"), fakeFetch([]))).toEqual(["jobs-daily.yml"]);
    expect(await tick(env, t("2026-11-05T18:20:00Z"), fakeFetch([]))).toEqual([]);
  });
});
