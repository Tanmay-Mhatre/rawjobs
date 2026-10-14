import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../../core/src/config";
import { HttpClient } from "../../core/src/http";
import { backgroundCheck, parseScope, wantsBackground, type RunValues } from "../src/commands/run";

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

  it("waits while the computer is on battery, then carries on; runs when the power state can't be told", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jh-bg-"));
    mkdirSync(join(dir, "catalog"));
    writeFileSync(join(dir, "catalog", "directory.json"), JSON.stringify({ companies: [] }));
    const http = new HttpClient({ fetchImpl: (async () => new Response("[]")) as unknown as typeof fetch });
    const states = [true, true, false];
    const events: string[] = [];
    const r = await backgroundCheck(
      config(),
      { dataDir: dir, http, stopped: () => false },
      Date.now(),
      { onPaused: () => events.push("paused"), onResumed: () => events.push("resumed") },
      async () => states.shift() ?? false,
      10,
    );
    expect(events).toEqual(["paused", "resumed"]);
    expect(r?.stopped).toBe(false);
    const free = await backgroundCheck(config(), { dataDir: dir, http, stopped: () => false }, Date.now(), {}, async () => undefined, 10);
    expect(free?.stopped).toBe(false);
  });

  it("stopped while paused: ends without scanning", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jh-bg-"));
    let stop = false;
    setTimeout(() => (stop = true), 30);
    const r = await backgroundCheck(config(), { dataDir: dir, stopped: () => stop }, Date.now(), {}, async () => true, 10);
    expect(r).toBeUndefined();
  });

  it("--scope still takes mine and all, and now yours", () => {
    expect(parseScope(undefined)).toBe("mine");
    expect(parseScope("all")).toBe("all");
    expect(parseScope("yours")).toBe("yours");
    expect(() => parseScope("every")).toThrow(/--scope/);
  });
});
