import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readJsonOrSetAside, renameWithRetry, writeFileAtomic } from "../src/atomic";
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

  it("doesn't retry other errors", () => {
    const rename = vi.fn(() => {
      throw busy("ENOENT");
    });
    expect(() => renameWithRetry("a.tmp", "a", rename)).toThrow("ENOENT");
    expect(rename).toHaveBeenCalledTimes(1);
  });
});
