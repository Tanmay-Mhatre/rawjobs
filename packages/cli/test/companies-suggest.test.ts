import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { profile } from "../../core/test/helpers";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "rawjobs-suggest-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Answer = {
  hiringNow: { key: string }[];
  packs: { industry: string; items: { key: string }[] }[];
  added: { hiring: number; watching: number; soon: number; like: Record<string, number>; packs: Record<string, string[]> };
};

/** `rawjobs companies suggest --json --stdin` as the server runs it, with what the page sends. */
function suggest(body: { watched?: string[]; hidden?: string[] }): Answer {
  const r = spawnSync(
    process.execPath,
    [join(root, "node_modules/tsx/dist/cli.mjs"), join(root, "packages/cli/src/index.ts"), "companies", "suggest", "--json", "--stdin", "--data", join(dir, "data")],
    { cwd: dir, encoding: "utf8", env: { ...process.env, RAWJOBS_HOME: dir }, input: JSON.stringify({ profile: profile({ industries: ["fintech"] }), ...body }) },
  );
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as Answer;
}

const keys = Array.from({ length: 6 }, (_, i) => `lever:c${i + 1}`);

beforeAll(() => {
  mkdirSync(join(dir, "data", "catalog"), { recursive: true });
  const companies = keys.map((key, i) => ({
    key,
    name: `C${i + 1}`,
    ats: "lever",
    slug: `c${i + 1}`,
    careers_url: `https://jobs.lever.co/c${i + 1}`,
    open_jobs: 6 - i,
    rows: [["Senior Product Manager", "Dubai", "onsite", 2, 6 - i]],
    tags: ["fintech"],
  }));
  writeFileSync(join(dir, "data", "catalog", "index.json"), JSON.stringify({ generated_at: new Date().toISOString(), companies }));
});

describe("companies suggest: what it left out because it's in My companies", () => {
  it("counts nothing when you have no companies", () => {
    const a = suggest({});
    expect(a.hiringNow).toHaveLength(6);
    expect(a.added).toEqual({ hiring: 0, watching: 0, soon: 0, like: {}, packs: {} });
  });

  it("leaves your companies out of the lists and counts them per list and per pack", () => {
    const a = suggest({ watched: keys.slice(0, 2) });
    expect(a.hiringNow.map((s) => s.key)).toEqual(keys.slice(2));
    expect(a.packs[0]!.items.map((s) => s.key)).toEqual(keys.slice(2));
    expect(a.added.hiring).toBe(2);
    expect(a.added.packs).toEqual({ fintech: keys.slice(0, 2) });
  });

  it("says the lists are empty because you added every company, not because none fit", () => {
    const a = suggest({ watched: keys });
    expect(a.hiringNow).toEqual([]);
    expect(a.packs).toEqual([]);
    expect(a.added.hiring).toBe(6);
    expect(a.added.packs.fintech).toEqual(keys);
  });

  it("never counts a company you hid", () => {
    const a = suggest({ watched: keys.slice(0, 3), hidden: [keys[0]!] });
    expect(a.added.hiring).toBe(2);
    expect(a.added.packs.fintech).toEqual(keys.slice(1, 3));
  });
});
