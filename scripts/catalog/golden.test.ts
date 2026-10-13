import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The weekly directory build, end to end on a small known input (test-fixtures/golden): merge, then
 * build, publish and release, run as the real scripts (CATALOG_DIR points them at a temp copy).
 * expected.json is what they must produce. Refresh it on purpose when the output should change:
 *   UPDATE_GOLDEN=1 pnpm vitest run scripts/catalog/golden.test.ts
 */
const here = fileURLToPath(new URL(".", import.meta.url));
const root = join(here, "..", "..");
const fixtures = join(here, "test-fixtures", "golden");
let dir: string;

function run(script: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [join(root, "node_modules/tsx/dist/cli.mjs"), join(here, `${script}.ts`), ...args], {
    encoding: "utf8",
    env: { ...process.env, CATALOG_DIR: dir, CATALOG_DATA_DIR: join(dir, "data"), DENYLIST_FILE: join(dir, "denylist.json"), CONTRIBUTIONS_FILE: "" },
  });
  if (r.status !== 0) throw new Error(`${script} failed (${r.status}):\n${r.stderr}`);
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rawjobs-golden-"));
  cpSync(fixtures, dir, { recursive: true });
  mkdirSync(join(dir, "data"));
  run("merge");
  run("build");
  run("publish", "--data", join(dir, "data"));
  run("release", "--data", join(dir, "data"), "--out", join(dir, "dist"));
}, 120_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const json = (...p: string[]) => JSON.parse(readFileSync(join(dir, ...p), "utf8"));

describe("the directory build, on known input", () => {
  it("merges, checks, filters and tags exactly as expected", async () => {
    const published = json("data", "catalog", "directory.json");
    const actual = {
      merged: (json("out", "merged.json").boards as { key: string; confidence: string; families: string[] }[]).map(({ key, confidence, families }) => ({ key, confidence, families })),
      directory: { count: published.count, industries: published.industries, companies: published.companies },
    };
    if (process.env.UPDATE_GOLDEN) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(fixtures, "expected.json"), `${JSON.stringify(actual, null, 1)}\n`);
    }
    expect(actual).toEqual(JSON.parse(readFileSync(join(fixtures, "expected.json"), "utf8")));
  });

  it("spells out the rules behind that output", () => {
    const merged = json("out", "merged.json").boards as { key: string; confidence: string }[];
    // The same board from two sources (and in two spellings) is one board, which they agree on.
    expect(merged.filter((b) => b.key === "lever:acme")).toEqual([expect.objectContaining({ confidence: "high" })]);
    const companies = json("data", "catalog", "directory.json").companies as { key: string; status: string; tier: string; tags?: string[] }[];
    const by = new Map(companies.map((c) => [c.key, c]));
    // Dead boards, sandbox boards and denylisted companies stay out.
    expect([...by.keys()].sort()).toEqual(["ashby:gammapay", "greenhouse:betapay", "lever:acme"]);
    // A later error doesn't undo a definite answer; a later answer replaces an error.
    expect(by.get("lever:acme")!.status).toBe("live");
    expect(by.get("greenhouse:betapay")!.status).toBe("live");
    // The hand-reviewed list sets the tier and its segment a tag; a source list's category tags too.
    expect(by.get("greenhouse:betapay")).toMatchObject({ tier: "curated", tags: ["fintech"] });
    expect(by.get("ashby:gammapay")!.tags).toEqual(["payments"]);
    // Titles a live check read tag what the company hires for, marked as such; Wikidata tags what it is,
    // matched by name and a board named like its website (Acme Corporation, acme.com).
    expect(by.get("greenhouse:betapay")).toMatchObject({ tags: ["fintech"], title_tags: ["payments"], tag_src: { payments: "titles" } });
    expect(by.get("lever:acme")).toMatchObject({ tags: ["banking"], tag_src: { banking: "wikidata" } });
    // Same name, but a website its board isn't named after: no Wikidata tag (Beta Pay isn't an insurer).
    expect(by.get("greenhouse:betapay")!.tags).not.toContain("insurtech");
  });

  it("releases files whose checksums match the manifest and whose contents are what was published", () => {
    const manifest = json("dist", "manifest.json") as { companies: number; files: Record<string, { sha256: string; bytes: number }> };
    expect(Object.keys(manifest.files).sort()).toEqual(["directory.json.gz", "index.json.gz"]);
    for (const [name, meta] of Object.entries(manifest.files)) {
      const gz = readFileSync(join(dir, "dist", name));
      expect(createHash("sha256").update(gz).digest("hex"), name).toBe(meta.sha256);
      expect(gz.length, name).toBe(meta.bytes);
    }
    const shipped = JSON.parse(gunzipSync(readFileSync(join(dir, "dist", "directory.json.gz"))).toString("utf8"));
    expect(shipped).toEqual(json("data", "catalog", "directory.json"));
    expect(manifest.companies).toBe(shipped.count);
  });
});
