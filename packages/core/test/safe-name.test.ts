import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSafeName, safeJoin } from "../src/safe-name";

describe("isSafeName", () => {
  it("accepts the names the releases publish", () => {
    for (const ok of ["directory.json.gz", "index.json.gz", "jobs-lever-20261012T0300.json.gz", "greenhouse", "smartrecruiters.json.tmp"]) expect(isSafeName(ok)).toBe(true);
  });
  it("refuses paths, parent folders and odd characters", () => {
    for (const bad of ["../x.json", "..", ".", "a/b.json", "a\b.json", "/etc/passwd", "C:x", ".hidden", "x..json", "a b", ""]) expect(isSafeName(bad)).toBe(false);
  });
});

describe("safeJoin", () => {
  it("joins safe names and throws on the rest", () => {
    expect(safeJoin("/data/catalog", "directory.json")).toBe(join("/data/catalog", "directory.json"));
    expect(() => safeJoin("/data/catalog", "../../bin/rawjobs")).toThrow(/unsafe/);
  });
});
