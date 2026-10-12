import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compact, mergeCheckRow, mergeIndexRow } from "./compact";
import { writeFileAtomic } from "./lib/fs";
import { nextInTime } from "./lib/time-box";

const dir = () => mkdtempSync(join(tmpdir(), "compact-"));
const rows = (path: string) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

describe("compact", () => {
  it("skips a line cut off by a kill instead of failing the state save", () => {
    const d = dir();
    writeFileSync(join(d, "checks.jsonl"), '{"key":"a","status":"live"}\n{"key":"b","status":"dead"}\n{"key":"c","sta');
    compact(d, /^checks(-.+)?\.jsonl$/, "checks.jsonl", mergeCheckRow);
    expect(rows(join(d, "checks.jsonl")).map((r) => r.key)).toEqual(["a", "b"]);
  });

  it("merges every log into the target, keeps a definite answer over a later error, and removes the rest", () => {
    const d = dir();
    writeFileSync(join(d, "checks.jsonl"), '{"key":"a","status":"live"}\n{"key":"a","status":"error","checked_at":"2026-10-11"}\n');
    writeFileSync(join(d, "checks-workday.jsonl"), '{"key":"w","status":"dormant"}\n');
    compact(d, /^checks(-.+)?\.jsonl$/, "checks.jsonl", mergeCheckRow);
    expect(readdirSync(d)).toEqual(["checks.jsonl"]);
    // The definite answer stays; the later error is kept as its streak, for the retry back-off.
    expect(rows(join(d, "checks.jsonl"))).toEqual([
      { key: "w", status: "dormant" },
      { key: "a", status: "live", errors: 1, last_error_at: "2026-10-11" },
    ]);
  });

  it("index: the target is also one of the logs it reads, and the newest success wins", () => {
    const d = dir();
    writeFileSync(join(d, "index-all.jsonl"), '{"key":"a","fetched_at":"2026-10-01"}\n');
    writeFileSync(join(d, "index-greenhouse.jsonl"), '{"key":"a","fetched_at":"2026-10-09"}\n{"key":"a","fetched_at":"2026-10-10","error":"500"}\n');
    compact(d, /^index-.+\.jsonl$/, "index-all.jsonl", mergeIndexRow);
    expect(existsSync(join(d, "index-greenhouse.jsonl"))).toBe(false);
    expect(rows(join(d, "index-all.jsonl"))).toEqual([{ key: "a", fetched_at: "2026-10-09" }]);
  });
});

describe("nextInTime", () => {
  it("hands out work until the time is up, then leaves the rest queued", () => {
    const queue = [1, 2, 3];
    expect(nextInTime(queue, 0, 1000, 500)).toBe(1);
    expect(nextInTime(queue, 0, 1000, 999)).toBe(2);
    expect(nextInTime(queue, 0, 1000, 1000)).toBeUndefined();
    expect(queue).toEqual([3]);
    expect(nextInTime(queue, 0, Infinity, 10 ** 12)).toBe(3);
  });
});

describe("writeFileAtomic", () => {
  it("replaces the file whole, creates its folder and leaves no temporary file", () => {
    const d = dir();
    const path = join(d, "raw", "boards.json");
    writeFileAtomic(path, '{"a":1}');
    writeFileAtomic(path, '{"a":2}');
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ a: 2 });
    expect(readdirSync(join(d, "raw"))).toEqual(["boards.json"]);
  });
});
