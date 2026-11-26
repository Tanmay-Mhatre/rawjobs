import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module (runs in the signing job without an install), no type declarations
import { check, filesOf, LIMITS } from "./check-manifest.mjs";

const sha = "a".repeat(64);
const dirManifest = (generated_at: string, extra: Record<string, unknown> = {}) => ({
  version: generated_at.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"),
  generated_at,
  companies: 100,
  indexed: 90,
  files: { "directory.json.gz": { sha256: sha, bytes: 1000 }, "index.json.gz": { sha256: sha, bytes: 2000 } },
  ...extra,
});
const feedV3 = (seq: number, generated_at: string) => ({
  schema: 3,
  seq,
  generated_at,
  state_sha256: sha,
  companies: 10,
  jobs: 20,
  snapshot: { file: `jobs-v3-snapshot-${seq}.txt.br`, sha256: sha, bytes: 500 },
  diffs: [{ seq, file: `jobs-v3-diff-${seq}.json.br`, sha256: sha, bytes: 50, state_sha256: sha }],
});

describe("check-manifest", () => {
  it("takes a newer manifest, and one with nothing live yet", () => {
    expect(check(dirManifest("2026-11-24T03:00:00.000Z"), { live: dirManifest("2026-11-17T03:00:00.000Z") })).toEqual([]);
    expect(check(dirManifest("2026-11-24T03:00:00.000Z"))).toEqual([]);
  });

  it("refuses an older or the same manifest", () => {
    expect(check(dirManifest("2026-11-10T03:00:00.000Z"), { live: dirManifest("2026-11-17T03:00:00.000Z") })[0]).toMatch(/is older/);
    expect(check(dirManifest("2026-11-17T03:00:00.000Z"), { live: dirManifest("2026-11-17T03:00:00.000Z") })[0]).toMatch(/nothing new/);
  });

  it("compares a restamped rollback by its published_at", () => {
    const rolledBack = dirManifest("2026-11-10T03:00:00.000Z", { published_at: "2026-11-20T09:00:00.000Z", rolled_back_from: "directory-2026-11-17" });
    expect(check(dirManifest("2026-11-24T03:00:00.000Z"), { live: rolledBack })).toEqual([]);
    expect(check(dirManifest("2026-11-17T03:00:00.000Z"), { live: rolledBack })[0]).toMatch(/is older/);
  });

  it("refuses a job feed that goes back in seq", () => {
    expect(check(feedV3(41, "2026-11-24T06:23:00.000Z"), { live: feedV3(40, "2026-11-24T00:23:00.000Z") })).toEqual([]);
    expect(check(feedV3(39, "2026-11-24T06:23:00.000Z"), { live: feedV3(40, "2026-11-24T00:23:00.000Z") })).toEqual(["goes back to #39 (live: #40)"]);
    expect(filesOf(feedV3(41, "2026-11-24T06:23:00.000Z")).map((f: { name: string }) => f.name)).toEqual(["jobs-v3-snapshot-41.txt.br", "jobs-v3-diff-41.json.br"]);
  });

  it("refuses a manifest that's too big, lists too much, or names odd files", () => {
    expect(check(dirManifest("2026-11-24T03:00:00.000Z"), { bytes: LIMITS.manifestBytes + 1 })[0]).toMatch(/over the/);
    const many = Object.fromEntries(Array.from({ length: LIMITS.files + 1 }, (_, i) => [`f${i}.gz`, { sha256: sha, bytes: 1 }]));
    expect(check(dirManifest("2026-11-24T03:00:00.000Z", { files: many }))).toContain(`lists ${LIMITS.files + 1} files, over the ${LIMITS.files} limit`);
    const huge = { "directory.json.gz": { sha256: sha, bytes: LIMITS.fileBytes + 1 } };
    expect(check(dirManifest("2026-11-24T03:00:00.000Z", { files: huge }))[0]).toMatch(/over the/);
    const odd = { "../manifest.json": { sha256: sha, bytes: 1 } };
    expect(check(dirManifest("2026-11-24T03:00:00.000Z", { files: odd }))[0]).toMatch(/odd name/);
    expect(check(dirManifest("2026-11-24T03:00:00.000Z", { files: {} }))).toEqual(["lists no files"]);
    expect(check([])).toEqual(["isn't a JSON object"]);
    expect(check({ files: { "a.gz": { sha256: sha, bytes: 1 } } })).toEqual(["has no valid generated_at"]);
  });

  it("checks the size and SHA-256 of the files that are there", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-manifest-"));
    writeFileSync(join(dir, "directory.json.gz"), "hello");
    const good = createHash("sha256").update("hello").digest("hex");
    const m = (s: string, bytes: number) => dirManifest("2026-11-24T03:00:00.000Z", { files: { "directory.json.gz": { sha256: s, bytes }, "older.gz": { sha256: sha, bytes: 9 } } });
    expect(check(m(good, 5), { dir })).toEqual([]);
    expect(check(m(sha, 5), { dir })).toEqual(["directory.json.gz: SHA-256 doesn't match the manifest"]);
    expect(check(m(good, 6), { dir })[0]).toMatch(/the file has 5/);
  });

  it("takes the word list on the same day, refuses an older one", () => {
    const words = (version: string) => ({ version, concepts: { kubernetes: ["k8s"] } });
    expect(check(words("2026-11-24"), { live: words("2026-11-17") })).toEqual([]);
    expect(check(words("2026-11-24"), { live: words("2026-11-24") })).toEqual([]);
    expect(check(words("2026-11-10"), { live: words("2026-11-17") })[0]).toMatch(/is older/);
    expect(check({ version: "2026-11-24", concepts: {} })).toEqual([]);
    expect(check({ version: "2026-11-24", concepts: [] })).toEqual(["has no topic table"]);
    expect(check({ version: "24 Nov", concepts: {} })).toEqual(["has no YYYY-MM-DD version"]);
  });

  it("exits 1 for a refused or missing file, 0 when all pass, from the command line", () => {
    const dir = mkdtempSync(join(tmpdir(), "check-manifest-"));
    const write = (name: string, body: unknown) => {
      writeFileSync(join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
      return join(dir, name);
    };
    const run = (...args: string[]) => {
      try {
        execFileSync(process.execPath, [join(__dirname, "check-manifest.mjs"), ...args], { stdio: "pipe" });
        return 0;
      } catch (e) {
        return (e as { status: number }).status;
      }
    };
    const newer = write("new.json", dirManifest("2026-11-24T03:00:00.000Z"));
    const older = write("old.json", dirManifest("2026-11-17T03:00:00.000Z"));
    const empty = write("empty.json", "");
    expect(run(newer, "--live", older)).toBe(0);
    expect(run(newer, "--live", empty)).toBe(0);
    expect(run(newer, "--live", join(dir, "none.json"))).toBe(0);
    expect(run(older, "--live", newer)).toBe(1);
    expect(run(write("bad.json", "{not json"))).toBe(1);
    expect(run(join(dir, "missing.json"))).toBe(1);
    expect(run(newer, "--live", older, older, "--live", newer)).toBe(1);
  });
});
