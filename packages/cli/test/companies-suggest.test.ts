import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { profile } from "../../core/test/helpers";

// What the server writes to the command's stdin.
const stdin = vi.hoisted(() => ({ text: "" }));
vi.mock("../src/util", async (orig) => ({ ...(await orig<typeof import("../src/util")>()), readStdin: async () => stdin.text }));
const { runCli } = await import("../src/main");

const dir = mkdtempSync(join(tmpdir(), "rawjobs-suggest-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Answer = {
  cached: boolean;
  hiringNow: { key: string }[];
  packs: { industry: string; items: { key: string }[] }[];
  added: { hiring: number; watching: number; soon: number; like: Record<string, number>; packs: Record<string, string[]> };
};

/** `rawjobs companies suggest --json --stdin` as the server runs it, with what the page sends (in-process). */
async function suggest(body: { watched?: string[]; hidden?: string[] }): Promise<Answer> {
  stdin.text = JSON.stringify({ profile: profile({ industries: ["fintech"] }), ...body });
  vi.stubEnv("RAWJOBS_HOME", dir);
  const out: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  try {
    expect(await runCli(["companies", "suggest", "--json", "--stdin", "--data", join(dir, "data")])).toBe(0);
  } finally {
    log.mockRestore();
    vi.unstubAllEnvs();
  }
  return JSON.parse(out.join("\n")) as Answer;
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
  it("counts nothing when you have no companies", async () => {
    const a = await suggest({});
    expect(a.hiringNow).toHaveLength(6);
    expect(a.added).toEqual({ hiring: 0, watching: 0, soon: 0, like: {}, packs: {} });
  });

  it("leaves your companies out of the lists and counts them per list and per pack", async () => {
    const a = await suggest({ watched: keys.slice(0, 2) });
    expect(a.hiringNow.map((s) => s.key)).toEqual(keys.slice(2));
    expect(a.packs[0]!.items.map((s) => s.key)).toEqual(keys.slice(2));
    expect(a.added.hiring).toBe(2);
    expect(a.added.packs).toEqual({ fintech: keys.slice(0, 2) });
  });

  it("says the lists are empty because you added every company, not because none fit", async () => {
    const a = await suggest({ watched: keys });
    expect(a.hiringNow).toEqual([]);
    expect(a.packs).toEqual([]);
    expect(a.added.hiring).toBe(6);
    expect(a.added.packs.fintech).toEqual(keys);
  });

  it("counts the same from a ranking kept on disk", async () => {
    const first = await suggest({ watched: keys.slice(0, 4) });
    const again = await suggest({ watched: keys.slice(0, 4) });
    expect(again.cached).toBe(true);
    expect(again.added).toEqual(first.added);
    expect(again.added.hiring).toBe(4);
  });

  it("never counts a company you hid", async () => {
    const a = await suggest({ watched: keys.slice(0, 3), hidden: [keys[0]!] });
    expect(a.added.hiring).toBe(2);
    expect(a.added.packs.fintech).toEqual(keys.slice(1, 3));
  });
});
