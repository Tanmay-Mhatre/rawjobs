import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultDataDir, rawjobsHome } from "../src/paths";
import {
  BACKUPS_DIR,
  BACKUPS_KEPT,
  backUp,
  parseTrackingTag,
  patchTracking,
  readTracking,
  readTrackingStrict,
  saveTracking,
  TRACKING_PATH,
  TrackingUnreadable,
  trackingRevFromHead,
} from "../src/tracking";

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
    expect(saveTracking({ appearance: { theme: "dark" } }, h).ok).toBe(true);
    expect(readTracking(h)).toMatchObject({ state: { a: { status: "saved" } }, prefs: { views: [] }, appearance: { theme: "dark" } });
    expect(saveTracking({ browser: { "rawjobs.scanAsk": false } }, h).ok).toBe(true);
    expect(readTracking(h)).toMatchObject({ state: { a: { status: "saved" } }, prefs: { views: [] }, browser: { "rawjobs.scanAsk": false } });
    expect(t.updatedAt).toMatch(/^\d{4}-/);
    // Written whole, never half: no temporary file is left behind.
    expect(readdirSync(join(h, "profile")).filter((f) => f !== "backups")).toEqual(["tracking.json"]);
  });

  it("copies the file to backups once a day, keeping the newest 7", () => {
    const h = home();
    saveTracking({ state: { a: { status: "saved" } } }, h);
    // Nothing to back up before the first file existed.
    expect(existsSync(join(h, BACKUPS_DIR))).toBe(false);
    saveTracking({ state: { a: { status: "applied" } } }, h);
    saveTracking({ state: { a: { status: "offer" } } }, h);
    const backups = readdirSync(join(h, BACKUPS_DIR));
    expect(backups).toHaveLength(1);
    // The copy is the file as it was before the day's first change.
    expect(JSON.parse(readFileSync(join(h, BACKUPS_DIR, backups[0]!), "utf8")).state).toEqual({ a: { status: "saved" } });
    for (let d = 1; d <= 9; d++) backUp(join(h, TRACKING_PATH), h, new Date(2026, 0, d, 12));
    const kept = readdirSync(join(h, BACKUPS_DIR));
    expect(kept).toHaveLength(BACKUPS_KEPT);
    expect(kept).not.toContain("tracking-2026-01-01.json");
  });

  it("refuses anything that isn't { state?, prefs?, appearance? } objects, and leaves the file alone", () => {
    const h = home();
    saveTracking({ state: { a: {} } }, h);
    expect(saveTracking([], h).ok).toBe(false);
    expect(saveTracking({ state: [] }, h).ok).toBe(false);
    expect(saveTracking({ prefs: "x" }, h).ok).toBe(false);
    expect(saveTracking({ appearance: "dark" }, h).ok).toBe(false);
    expect(saveTracking({ browser: [] }, h).ok).toBe(false);
    expect(readTracking(h)!.state).toEqual({ a: {} });
  });

  it("reads a broken file as nothing saved (a save sets it aside)", () => {
    const h = home();
    mkdirSync(join(h, "profile"));
    writeFileSync(join(h, TRACKING_PATH), "{ not json");
    expect(readTracking(h)).toBeNull();
    expect(existsSync(join(h, TRACKING_PATH))).toBe(true);
    expect(saveTracking({ state: {} }, h).ok).toBe(true);
    expect(JSON.parse(readFileSync(join(h, TRACKING_PATH), "utf8")).app).toBe("rawjobs");
    expect(readdirSync(join(h, "profile")).some((f) => f.startsWith("tracking.json.bad-"))).toBe(true);
  });
});

describe("tracking revisions", () => {
  const home = () => mkdtempSync(join(tmpdir(), "rj-revs-"));
  const strict = (h: string) => readTrackingStrict(h).doc!;
  const raw = (h: string) => JSON.parse(readFileSync(join(h, TRACKING_PATH), "utf8"));
  const busy = (): string => {
    throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
  };

  it("file without rev reads as rev 0 with a new epoch, the same on every read", () => {
    const h = home();
    mkdirSync(join(h, "profile"));
    writeFileSync(join(h, TRACKING_PATH), JSON.stringify({ app: "rawjobs", version: 1, updatedAt: "x", state: { a: {} } }));
    const doc = strict(h);
    expect(doc.rev).toBe(0);
    expect(doc.revs).toEqual({});
    expect(doc.epoch).toMatch(/^c[0-9a-f]{11}$/);
    expect(strict(h).epoch).toBe(doc.epoch);
    // The first change from a page that read it applies.
    expect(patchTracking({ changes: { state: { set: { b: { status: "saved" } } } } }, doc, h)).toMatchObject({ ok: true, rev: 1, epoch: doc.epoch });
    expect(raw(h).state).toEqual({ a: {}, b: { status: "saved" } });
  });

  it("rev increments once per save, and health reads it from the file's first bytes", () => {
    const h = home();
    const first = patchTracking({ changes: { state: { set: { a: 1, b: 2 } }, prefs: { set: { views: [] } } } }, { epoch: "", rev: 0 }, h);
    expect(first).toMatchObject({ ok: true, rev: 1 });
    expect(saveTracking({ appearance: { theme: "dark" } }, h)).toMatchObject({ ok: true, rev: 2 });
    const doc = strict(h);
    expect(doc.rev).toBe(2);
    expect(doc.revs).toEqual({ state: { a: 1, b: 1 }, prefs: { views: 1 }, appearance: { theme: 2 } });
    expect(trackingRevFromHead(readFileSync(join(h, TRACKING_PATH), "utf8").slice(0, 256))).toBe(2);
    expect(trackingRevFromHead('{"app":"rawjobs","version":1,"updatedAt":"","state":{"rev":9}}')).toBe(0);
    // The page never gets the revisions.
    expect(doc.tracking).not.toHaveProperty("revs");
    expect(readTracking(h)).not.toHaveProperty("revs");
  });

  it("patch on different keys from stale base both apply", () => {
    const h = home();
    const start = patchTracking({ changes: { state: { set: { a: { n: 1 }, b: { n: 1 } } } } }, { epoch: "", rev: 0 }, h);
    if (!start.ok) throw new Error("setup");
    const base = { epoch: start.epoch, rev: start.rev };
    expect(patchTracking({ changes: { state: { set: { a: { n: 2 } } } } }, base, h).ok).toBe(true);
    expect(patchTracking({ changes: { state: { set: { b: { n: 2 } }, del: [] } } }, base, h).ok).toBe(true);
    expect(raw(h).state).toEqual({ a: { n: 2 }, b: { n: 2 } });
    expect(strict(h).rev).toBe(3);
  });

  it("patch on a key changed since base → 409 with conflicts and nothing applied", () => {
    const h = home();
    const start = patchTracking({ changes: { state: { set: { a: 1, b: 1 } } } }, { epoch: "", rev: 0 }, h);
    if (!start.ok) throw new Error("setup");
    const base = { epoch: start.epoch, rev: start.rev };
    expect(patchTracking({ changes: { state: { set: { a: 2 } } } }, base, h).ok).toBe(true);
    const before = readFileSync(join(h, TRACKING_PATH), "utf8");
    const r = patchTracking({ changes: { state: { set: { a: 3, b: 3 } }, prefs: { set: { x: 1 } } } }, base, h);
    expect(r).toMatchObject({ ok: false, status: 409, rev: 2, epoch: start.epoch, conflicts: [{ part: "state", key: "a" }] });
    if (r.ok || r.status !== 409) throw new Error("expected 409");
    expect(r.tracking.state).toEqual({ a: 2, b: 1 });
    // All or nothing: b and prefs weren't saved either.
    expect(readFileSync(join(h, TRACKING_PATH), "utf8")).toBe(before);
  });

  it("del of a key changed since base → 409; a removed key keeps its revision", () => {
    const h = home();
    const start = patchTracking({ changes: { state: { set: { a: 1 } } } }, { epoch: "", rev: 0 }, h);
    if (!start.ok) throw new Error("setup");
    const base = { epoch: start.epoch, rev: start.rev };
    expect(patchTracking({ changes: { state: { set: { a: 2 } } } }, base, h).ok).toBe(true);
    expect(patchTracking({ changes: { state: { del: ["a"] } } }, base, h)).toMatchObject({ status: 409, conflicts: [{ part: "state", key: "a" }] });
    // Undo from the latest base removes it; an old page can't then set it again unseen.
    expect(patchTracking({ changes: { state: { del: ["a"] } } }, { epoch: start.epoch, rev: 2 }, h)).toMatchObject({ ok: true, rev: 3 });
    expect(raw(h).state).toEqual({});
    expect(patchTracking({ changes: { state: { set: { a: 1 } } } }, base, h)).toMatchObject({ status: 409 });
  });

  it("PATCH with an old epoch → 409 on every key", () => {
    const h = home();
    const start = patchTracking({ changes: { state: { set: { a: 1 } } } }, { epoch: "", rev: 0 }, h);
    if (!start.ok) throw new Error("setup");
    // An older version rewrote the file without revisions (a rollback).
    writeFileSync(join(h, TRACKING_PATH), JSON.stringify({ app: "rawjobs", version: 1, updatedAt: "y", state: { a: 1 } }));
    const r = patchTracking({ changes: { state: { set: { z: 1 } }, prefs: { del: ["q"] } } }, { epoch: start.epoch, rev: 5 }, h);
    expect(r).toMatchObject({
      status: 409,
      conflicts: [
        { part: "state", key: "z" },
        { part: "prefs", key: "q" },
      ],
    });
  });

  it("refuses bad changes and leaves the file alone", () => {
    const h = home();
    const base = { epoch: "", rev: 0 };
    expect(patchTracking({}, base, h)).toMatchObject({ status: 400 });
    expect(patchTracking({ changes: { other: {} } }, base, h)).toMatchObject({ status: 400 });
    expect(patchTracking({ changes: { state: { set: [] } } }, base, h)).toMatchObject({ status: 400 });
    expect(patchTracking({ changes: { state: { del: [1] } } }, base, h)).toMatchObject({ status: 400 });
    expect(patchTracking({ changes: { state: { set: { a: 1 }, del: ["a"] } } }, base, h)).toMatchObject({ status: 400 });
    expect(patchTracking(JSON.parse('{"changes":{"state":{"set":{"__proto__":{"x":1}}}}}'), base, h)).toMatchObject({ status: 400 });
    expect(existsSync(join(h, TRACKING_PATH))).toBe(false);
    expect(parseTrackingTag('"k3f9:42"')).toEqual({ epoch: "k3f9", rev: 42 });
    expect(parseTrackingTag('W/"k3f9:42"')).toEqual({ epoch: "k3f9", rev: 42 });
    expect(parseTrackingTag(undefined)).toBeNull();
    expect(parseTrackingTag("42")).toBeNull();
  });

  it("legacy PUT still replaces parts and bumps revs for changed keys", () => {
    const h = home();
    saveTracking({ state: { a: 1, b: 1, c: 1 }, prefs: { v: 1 } }, h);
    const doc = strict(h);
    expect(doc.revs.state).toEqual({ a: 1, b: 1, c: 1 });
    // An old page sends the whole part: b changed, c gone, d new, a the same.
    expect(saveTracking({ state: { a: 1, b: 2, d: 1 } }, h).ok).toBe(true);
    const after = strict(h);
    expect(after.tracking.state).toEqual({ a: 1, b: 2, d: 1 });
    expect(after.tracking.prefs).toEqual({ v: 1 });
    expect(after.revs.state).toEqual({ a: 1, b: 2, c: 2, d: 2 });
    // A new page that read rev 1 and changed b now sees the conflict instead of overwriting it.
    expect(patchTracking({ changes: { state: { set: { b: 9, a: 9 } } } }, { epoch: doc.epoch, rev: 1 }, h)).toMatchObject({
      status: 409,
      conflicts: [{ part: "state", key: "b" }],
    });
  });

  it("saveTracking refuses (503) when the file is locked, and leaves it alone", () => {
    const h = home();
    saveTracking({ state: { a: 1 }, prefs: { v: 1 } }, h);
    const before = readFileSync(join(h, TRACKING_PATH), "utf8");
    const io = { readFile: busy, waitsMs: [1, 1] };
    expect(saveTracking({ state: {} }, h, io)).toMatchObject({ ok: false, status: 503 });
    expect(patchTracking({ changes: { state: { del: ["a"] } } }, { epoch: "", rev: 0 }, h, io)).toMatchObject({ ok: false, status: 503 });
    expect(() => readTrackingStrict(h, io)).toThrow(TrackingUnreadable);
    expect(readFileSync(join(h, TRACKING_PATH), "utf8")).toBe(before);
  });

  it("waits out a lock that lets go", () => {
    const h = home();
    saveTracking({ state: { a: 1 } }, h);
    let tries = 0;
    const io = { readFile: (p: string) => (++tries < 3 ? busy() : readFileSync(p, "utf8")), waitsMs: [1, 1, 1] };
    expect(readTrackingStrict(h, io).doc?.tracking.state).toEqual({ a: 1 });
    expect(tries).toBe(3);
  });

  it("damaged file is set aside and the newest valid backup used", () => {
    const h = home();
    saveTracking({ state: { a: 1 } }, h);
    const old = strict(h);
    mkdirSync(join(h, BACKUPS_DIR), { recursive: true });
    writeFileSync(join(h, BACKUPS_DIR, "tracking-2026-01-01.json"), JSON.stringify({ app: "rawjobs", version: 1, updatedAt: "", state: { old: 1 } }));
    writeFileSync(join(h, BACKUPS_DIR, "tracking-2026-01-02.json"), readFileSync(join(h, TRACKING_PATH)));
    writeFileSync(join(h, BACKUPS_DIR, "tracking-2026-01-03.json"), "{ also broken");
    writeFileSync(join(h, TRACKING_PATH), "{ not json");
    const r = readTrackingStrict(h);
    expect(r.restoredFrom).toBe("tracking-2026-01-02.json");
    expect(r.doc?.tracking.state).toEqual({ a: 1 });
    // A new epoch: every open page rebases on the restored copy.
    expect(r.doc?.epoch).not.toBe(old.epoch);
    expect(raw(h).state).toEqual({ a: 1 });
    const bad = readdirSync(join(h, "profile")).filter((f) => f.startsWith("tracking.json.bad-"));
    expect(bad).toHaveLength(1);
    expect(readFileSync(join(h, "profile", bad[0]!), "utf8")).toBe("{ not json");
  });
});
