import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fsOps, readJsonOrSetAside, renameWithRetry, writeFileAtomic } from "../src/atomic";
import { readJobs, readMeta } from "../src/store";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("writeFileAtomic", () => {
  it("replaces the file whole and leaves no temp file behind", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-atomic-"));
    const file = join(dir, "history.json");
    writeFileSync(file, "old");
    writeFileAtomic(file, "new");
    expect(readFileSync(file, "utf8")).toBe("new");
    expect(readdirSync(dir)).toEqual(["history.json"]);
  });

  it("keeps the old file when the write fails", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-atomic-"));
    const file = join(dir, "history.json");
    writeFileSync(file, "old");
    expect(() => writeFileAtomic(join(dir, "missing-folder", "x.json"), "new")).toThrow();
    expect(readFileSync(file, "utf8")).toBe("old");
    expect(readdirSync(dir)).toEqual(["history.json"]);
  });

  it("with fsync calls fsyncSync before rename", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-atomic-"));
    const file = join(dir, "tracking.json");
    writeFileSync(file, "old");
    const order: string[] = [];
    const sync = vi.spyOn(fsOps, "fsyncSync").mockImplementation(() => {
      order.push(readFileSync(file, "utf8"));
    });
    writeFileAtomic(file, "new ✓", undefined, { fsync: true });
    expect(order[0]).toBe("old");
    expect(sync).toHaveBeenCalledTimes(process.platform === "win32" ? 1 : 2);
    sync.mockRestore();
    expect(readFileSync(file, "utf8")).toBe("new ✓");
    expect(readdirSync(dir)).toEqual(["tracking.json"]);
  });
});

describe("readJsonOrSetAside", () => {
  it("moves a file that doesn't parse to .bad and reads it as missing", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-atomic-"));
    const file = join(dir, "meta.json");
    writeFileSync(file, '{"version": 1, "runs": [');
    const seen: string[] = [];
    expect(readJsonOrSetAside(file, (bad) => seen.push(bad))).toBeUndefined();
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(`${file}.bad`, "utf8")).toBe('{"version": 1, "runs": [');
    expect(seen).toEqual([`${file}.bad`]);
    expect(readJsonOrSetAside(join(dir, "nothing.json"))).toBeUndefined();
  });

  it("lets the next scan start fresh after a half-written history", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-atomic-"));
    writeFileSync(join(dir, "history.json"), '{"version":1,"jobs":[{"id":"lever:acme:1"');
    writeFileSync(join(dir, "meta.json"), "{");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readJobs(dir)).toEqual([]);
    expect(readMeta(dir)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    expect(existsSync(join(dir, "history.json.bad"))).toBe(true);
  });

  it("survives EPERM on the set-aside rename", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-atomic-"));
    const file = join(dir, "discovery.json");
    writeFileSync(file, "{");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: string[] = [];
    const rename = vi.fn(() => {
      throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    });
    expect(readJsonOrSetAside(file, (bad) => seen.push(bad), rename)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    expect(seen).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe("{");
  });
});

describe("renameWithRetry", () => {
  const busy = (code: string) => Object.assign(new Error(code), { code });

  it("tries again while the file is briefly held open", () => {
    const rename = vi
      .fn()
      .mockImplementationOnce(() => {
        throw busy("EPERM");
      })
      .mockImplementationOnce(() => {
        throw busy("EBUSY");
      })
      .mockImplementation(() => undefined);
    renameWithRetry("a.tmp", "a", rename);
    expect(rename).toHaveBeenCalledTimes(3);
  });

  it("gives up after a while and throws the last error", () => {
    const rename = vi.fn(() => {
      throw busy("EPERM");
    });
    expect(() => renameWithRetry("a.tmp", "a", rename)).toThrow("EPERM");
    expect(rename).toHaveBeenCalledTimes(8);
  });

  it("keeps trying up to maxMs", () => {
    const rename = vi.fn(() => {
      throw busy("EBUSY");
    });
    const start = Date.now();
    expect(() => renameWithRetry("a.tmp", "a", rename, { maxMs: 40 })).toThrow("EBUSY");
    expect(rename).toHaveBeenCalledTimes(4);
    expect(Date.now() - start).toBeLessThan(1_000);
  });

  it("doesn't retry other errors", () => {
    const rename = vi.fn(() => {
      throw busy("ENOENT");
    });
    expect(() => renameWithRetry("a.tmp", "a", rename)).toThrow("ENOENT");
    expect(rename).toHaveBeenCalledTimes(1);
  });
});
