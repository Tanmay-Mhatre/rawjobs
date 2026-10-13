import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultDataDir, rawjobsHome } from "../src/paths";
import { readTracking, saveTracking, TRACKING_PATH } from "../src/tracking";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("rawjobsHome", () => {
  it("is RAWJOBS_HOME when set, else the folder RawJobs runs in", () => {
    delete process.env.RAWJOBS_HOME;
    expect(rawjobsHome()).toBe(resolve(process.cwd()));
    process.env.RAWJOBS_HOME = join(tmpdir(), "rj-home");
    expect(rawjobsHome()).toBe(resolve(tmpdir(), "rj-home"));
  });

  it("keeps data in it unless RAWJOBS_DATA points elsewhere", () => {
    delete process.env.RAWJOBS_DATA;
    delete process.env.JOBHUNTER_DATA;
    const home = join(tmpdir(), "rj-home");
    expect(defaultDataDir(home)).toBe(resolve(home, "data"));
    process.env.RAWJOBS_DATA = "out";
    expect(defaultDataDir(home)).toBe(resolve(home, "out"));
    process.env.RAWJOBS_DATA = join(tmpdir(), "elsewhere");
    expect(defaultDataDir(home)).toBe(resolve(tmpdir(), "elsewhere"));
  });
});

describe("tracking", () => {
  const home = () => mkdtempSync(join(tmpdir(), "rj-track-"));

  it("is null until something is saved", () => {
    expect(readTracking(home())).toBeNull();
  });

  it("saves each part and keeps the other", () => {
    const h = home();
    expect(saveTracking({ state: { a: { status: "saved" } } }, h).ok).toBe(true);
    expect(saveTracking({ prefs: { views: [] } }, h).ok).toBe(true);
    const t = readTracking(h)!;
    expect(t.state).toEqual({ a: { status: "saved" } });
    expect(t.prefs).toEqual({ views: [] });
    expect(saveTracking({ browser: { "rawjobs.scanAsk": false } }, h).ok).toBe(true);
    expect(readTracking(h)).toMatchObject({ state: { a: { status: "saved" } }, prefs: { views: [] }, browser: { "rawjobs.scanAsk": false } });
    expect(t.updatedAt).toMatch(/^\d{4}-/);
    // Written whole, never half: no temporary file is left behind.
    expect(readdirSync(join(h, "profile"))).toEqual(["tracking.json"]);
  });

  it("refuses anything that isn't { state?, prefs? } objects, and leaves the file alone", () => {
    const h = home();
    saveTracking({ state: { a: {} } }, h);
    expect(saveTracking([], h).ok).toBe(false);
    expect(saveTracking({ state: [] }, h).ok).toBe(false);
    expect(saveTracking({ prefs: "x" }, h).ok).toBe(false);
    expect(saveTracking({ browser: [] }, h).ok).toBe(false);
    expect(readTracking(h)!.state).toEqual({ a: {} });
  });

  it("reads a broken file as nothing saved", () => {
    const h = home();
    mkdirSync(join(h, "profile"));
    writeFileSync(join(h, TRACKING_PATH), "{ not json");
    expect(readTracking(h)).toBeNull();
    expect(existsSync(join(h, TRACKING_PATH))).toBe(true);
    expect(saveTracking({ state: {} }, h).ok).toBe(true);
    expect(JSON.parse(readFileSync(join(h, TRACKING_PATH), "utf8")).app).toBe("rawjobs");
  });
});
