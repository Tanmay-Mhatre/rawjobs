import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../../core/src/config";
import { HttpClient } from "../../core/src/http";
import { JOB_FEED_SCHEMA } from "../../core/src/job-feed";
import { backgroundCheck, parseScope, progressEvents, wantsBackground, type RunValues } from "../src/commands/run";

const config = (yaml = "") =>
  parseConfig(`
profile:
  titles: { include: ["product manager"] }
  locations: { include: ["dubai"] }
${yaml}`);
const values: RunValues = { data: "", "dry-run": false, offline: true, fresh: false, full: false };

describe("the background check", () => {
  it("runs after a Scan now that finished, when it's on; never after a stopped, stale-feed or narrowed scan", () => {
    expect(wantsBackground(config(), values, "mine", { stopped: false })).toBe(true);
    expect(wantsBackground(config("scans: { background: false }"), values, "mine", { stopped: false })).toBe(false);
    expect(wantsBackground(config(), values, "mine", { stopped: true })).toBe(false);
    expect(wantsBackground(config(), values, "mine", { stopped: false, fallback: true })).toBe(false);
    expect(wantsBackground(config(), values, "yours", { stopped: false })).toBe(false);
    expect(wantsBackground(config(), { ...values, only: ["acme"] }, "mine", { stopped: false })).toBe(false);
    expect(wantsBackground(config(), { ...values, "no-background": true }, "mine", { stopped: false })).toBe(false);
  });

  it("runs to the end whatever the power state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jh-bg-"));
    mkdirSync(join(dir, "catalog"));
    writeFileSync(join(dir, "catalog", "directory.json"), JSON.stringify({ companies: [] }));
    const http = new HttpClient({ fetchImpl: (async () => new Response("[]")) as unknown as typeof fetch });
    const r = await backgroundCheck(config(), { dataDir: dir, http, stopped: () => false }, Date.now());
    expect(r.stopped).toBe(false);
  });

  it("leaves out the companies a fresh job feed shows nothing for you at; checks them all once the feed is over 3 days old", async () => {
    const NOW = Date.parse("2026-10-09T12:00:00Z");
    const fetched = async (feedAgeDays: number) => {
      const dir = mkdtempSync(join(tmpdir(), "jh-bg-"));
      mkdirSync(join(dir, "catalog", "jobs"), { recursive: true });
      const entry = (slug: string) => ({ key: `lever:${slug}`, name: slug, ats: "lever", slug, careers_url: "", open_jobs: 3, status: "live" });
      writeFileSync(join(dir, "catalog", "directory.json"), JSON.stringify({ companies: [entry("match"), entry("nothing"), entry("uncovered")] }));
      const at = new Date(NOW - feedAgeDays * 86_400_000).toISOString();
      const companies = {
        "lever:match": { fetched_at: at, jobs: [["1", "Product Manager", "Dubai", "onsite", null]] },
        "lever:nothing": { fetched_at: at, jobs: [["2", "Engineer", "Dubai", "onsite", null]] },
      };
      writeFileSync(join(dir, "catalog", "jobs", "lever.json"), JSON.stringify({ schema: JOB_FEED_SCHEMA, ats: "lever", generated_at: at, companies }));
      writeFileSync(join(dir, "catalog", "jobs", "manifest.json"), JSON.stringify({ schema: JOB_FEED_SCHEMA, generated_at: at, shards: { lever: {} } }));
      const calls: string[] = [];
      const http = new HttpClient({
        hostDelayMs: 0,
        sleep: async () => {},
        fetchImpl: (async (url: string) => {
          calls.push(String(url));
          return new Response("[]");
        }) as unknown as typeof fetch,
      });
      await backgroundCheck(config(), { dataDir: dir, http, now: new Date(NOW), stopped: () => false }, NOW);
      return ["match", "nothing", "uncovered"].filter((slug) => calls.some((u) => u.includes(`/${slug}`)));
    };
    expect(await fetched(0)).toEqual(["match", "uncovered"]);
    expect(await fetched(4)).toEqual(["match", "nothing", "uncovered"]);
  });

  it("--scope still takes mine and all, and now yours", () => {
    expect(parseScope(undefined)).toBe("mine");
    expect(parseScope("all")).toBe("all");
    expect(parseScope("yours")).toBe("yours");
    expect(() => parseScope("every")).toThrow(/--scope/);
  });
});

describe("a scan's progress lines", () => {
  it("are the same for the dashboard's scans and the live file: start, then a line per company", () => {
    const sent: { type: string; done?: number }[] = [];
    const p = progressEvents(config("companies:\n  - { name: Acme, ats: greenhouse, slug: acme }"), (e) => sent.push(e as (typeof sent)[number]));
    const quick = p.hooks("quick");
    type Start = Parameters<NonNullable<typeof quick.onStart>>[0];
    type Health = Parameters<NonNullable<typeof quick.onCompanyDone>>[0];
    quick.onStart?.({ yours: ["Acme"], total: 2, extra: 1, resumed: 0, scope: "mine", seconds: 60, byAts: { greenhouse: 2 }, resumedByAts: {}, fallback: true } as unknown as Start);
    quick.onCompanyDone?.({ company: "Acme", ats: "greenhouse", slug: "acme", ok: true, matches: 0 } as unknown as Health);
    expect(p.state.fallback).toBe(true);
    expect(sent.map((e) => e.type)).toEqual(["start", "company"]);
    expect(sent[1]).toMatchObject({ done: 1 });
  });
});
