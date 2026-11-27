import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../../core/src/config";
import { HttpClient } from "../../core/src/http";
import { JOB_FEED_SCHEMA } from "../../core/src/job-feed";
import { alertText, backgroundCheck, notifyScan, parseDeadline, parseScope, progressEvents, stopSignal, wantsBackground, type RunValues } from "../src/commands/run";

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

describe("scan alerts written ahead (scheduled, terminal and page scans)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("the scan keeps its alert in the outbox before saving, and notifyScan sends it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jh-alert-"));
    mkdirSync(join(dir, "catalog"));
    writeFileSync(join(dir, "catalog", "directory.json"), JSON.stringify({ companies: [] }));
    const http = new HttpClient({ fetchImpl: (async () => new Response("[]")) as unknown as typeof fetch });
    const r = await backgroundCheck(config(), { dataDir: dir, http, stopped: () => false, alert: () => "1 new job" }, Date.now());
    expect(r.alertQueued).toBe(true);
    const outbox = JSON.parse(readFileSync(join(dir, "telegram-outbox.json"), "utf8")) as { messages: { text: string; run?: string }[] };
    expect(outbox.messages).toEqual([expect.objectContaining({ text: "1 new job", run: r.result.finishedAt })]);

    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:abc");
    vi.stubEnv("TELEGRAM_CHAT_ID", "42");
    const sent: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)).text);
      return new Response(JSON.stringify({ ok: true, result: {} }));
    });
    expect(await notifyScan(config("alerts: { telegram: true }"), dir, true)).toBe("sent");
    expect(sent).toEqual(["1 new job"]);
    expect(existsSync(join(dir, "telegram-outbox.json"))).toBe(false);
  });

  it("no alert text while alerts are off", () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const merged = { jobs: [], newIds: new Set<string>(), closedIds: new Set<string>() } as unknown as Parameters<typeof alertText>[2];
    expect(alertText(config(), { jobs: [] } as unknown as Parameters<typeof alertText>[1], merged, "mine")).toBeUndefined();
  });
});

describe("stopping a scan from outside", () => {
  it("stops at its deadline on the wall clock, at the stop file, or on SIGTERM, and says why", () => {
    const dir = mkdtempSync(join(tmpdir(), "jh-stop-"));
    let t = 1_000;
    const byDeadline = stopSignal(dir, { deadlineAt: 5_000, now: () => t });
    expect(byDeadline()).toBe(false);
    t = 5_000;
    expect(byDeadline()).toBe(true);
    expect(byDeadline.reason()).toBe("deadline");

    const byFile = stopSignal(dir);
    expect(byFile()).toBe(false);
    writeFileSync(join(dir, "scan-stop"), "");
    expect(byFile()).toBe(true);
    expect(byFile.reason()).toBe("stop");

    const bySignal = stopSignal(dir);
    process.emit("SIGTERM");
    expect(bySignal()).toBe(true);
    expect(bySignal.reason()).toBe("stop");
  });

  it("reads --deadline as minutes from the start or a time, and refuses anything else", () => {
    expect(parseDeadline(undefined)).toBeUndefined();
    expect(parseDeadline("170", 0)).toBe(170 * 60_000);
    expect(parseDeadline("2026-11-27T06:00:00Z")).toBe(Date.parse("2026-11-27T06:00:00Z"));
    expect(() => parseDeadline("soon")).toThrow(/--deadline/);
    expect(() => parseDeadline("0")).toThrow(/--deadline/);
  });
});
