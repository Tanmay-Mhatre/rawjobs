import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { suggestCacheDir, suggestCompaniesCached } from "../src/suggest-cache";
import { type IndexedCompany, type IndexRow, suggestCompanies } from "../src/suggest";
import { profile } from "./helpers";

const now = new Date("2026-10-04T12:00:00Z");

const co = (key: string, rows: IndexRow[], extra: Partial<IndexedCompany> = {}): IndexedCompany => ({
  key,
  name: key.split(":")[1]!,
  ats: key.split(":")[0]!,
  slug: key.split(":")[1]!,
  careers_url: `https://example.com/${key}`,
  open_jobs: rows.reduce((s, r) => s + r[4], 0),
  rows,
  ...extra,
});
const pm = (location: string, count = 1): IndexRow => ["Senior Product Manager", location, "onsite", 2, count];

/** A data folder with an index file the cache stamps. */
function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "rawjobs-suggest-cache-"));
  const index = join(dataDir, "index.json");
  writeFileSync(index, "{}");
  return { dataDir, index, files: [index] };
}

const companies = [co("greenhouse:a", [pm("Dubai", 3)]), co("greenhouse:b", [pm("Dubai")]), co("lever:c", [pm("Berlin")]), co("ashby:d", [pm("Abu Dhabi", 2)])];

describe("suggestCompaniesCached", () => {
  it("works the ranking out once, then answers from disk the same as suggestCompanies", () => {
    const { dataDir, files } = setup();
    const first = suggestCompaniesCached(profile(), companies, { now, dataDir, files });
    expect(first.cached).toBe(false);
    expect(readdirSync(suggestCacheDir(dataDir)).filter((f) => f.startsWith("ranked-"))).toHaveLength(1);
    const again = suggestCompaniesCached(profile(), companies, { now, dataDir, files });
    expect(again.cached).toBe(true);
    expect(again.result).toEqual(first.result);
    expect(again.result).toEqual(suggestCompanies(profile(), companies, { now }));
  });

  it("leaves out your companies after the cached ranking, so adding one doesn't redo it", () => {
    const { dataDir, files } = setup();
    suggestCompaniesCached(profile(), companies, { now, dataDir, files });
    const exclude = new Set(["greenhouse:a"]);
    const r = suggestCompaniesCached(profile(), companies, { now, dataDir, files, exclude });
    expect(r.cached).toBe(true);
    expect(r.result).toEqual(suggestCompanies(profile(), companies, { now, exclude }));
    expect(r.result.hiringNow.map((s) => s.key)).not.toContain("greenhouse:a");
  });

  it("works it out again when the profile, the index or the day changes", () => {
    const { dataDir, files, index } = setup();
    suggestCompaniesCached(profile(), companies, { now, dataDir, files });

    const berlin = profile({ locations: { include: ["berlin"], remote_ok: [], remote_exclude: [], workplace: [] } });
    const moved = suggestCompaniesCached(berlin, companies, { now, dataDir, files });
    expect(moved.cached).toBe(false);
    expect(moved.result.hiringNow.map((s) => s.key)).toEqual(["lever:c"]);

    writeFileSync(index, '{"generated_at":"newer"}');
    utimesSync(index, new Date(), new Date(Date.now() + 5000));
    const reindexed = [...companies, co("greenhouse:e", [pm("Dubai", 9)])];
    const fresh = suggestCompaniesCached(profile(), reindexed, { now, dataDir, files });
    expect(fresh.cached).toBe(false);
    expect(fresh.result.hiringNow.map((s) => s.key)).toContain("greenhouse:e");

    const tomorrow = new Date(now.getTime() + 86_400_000);
    expect(suggestCompaniesCached(profile(), reindexed, { now: tomorrow, dataDir, files }).cached).toBe(false);
    expect(suggestCompaniesCached(profile(), reindexed, { now: tomorrow, dataDir, files }).cached).toBe(true);
  });

  it("works it out in full when leaving your companies out empties a cut ranking", () => {
    const { dataDir, files } = setup();
    const many = Array.from({ length: 12 }, (_, i) => co(`greenhouse:c${String(i).padStart(2, "0")}`, [pm("Dubai", 12 - i)]));
    suggestCompaniesCached(profile(), many, { now, dataDir, files, limit: 3, keep: 5 });
    // The first four are yours: only one of the five kept is left, so the cut ranking can't fill 3.
    const exclude = new Set(many.slice(0, 4).map((c) => c.key));
    const r = suggestCompaniesCached(profile(), many, { now, dataDir, files, limit: 3, keep: 5, exclude });
    expect(r.cached).toBe(false);
    expect(r.result).toEqual(suggestCompanies(profile(), many, { now, limit: 3, exclude }));
    // Two of yours still leave three of the five kept: the cut ranking does.
    const fewer = new Set(many.slice(0, 2).map((c) => c.key));
    const ok = suggestCompaniesCached(profile(), many, { now, dataDir, files, limit: 3, keep: 5, exclude: fewer });
    expect(ok.cached).toBe(true);
    expect(ok.result).toEqual(suggestCompanies(profile(), many, { now, limit: 3, exclude: fewer }));
  });

  it("treats a damaged cache file as a miss", () => {
    const { dataDir, files } = setup();
    suggestCompaniesCached(profile(), companies, { now, dataDir, files });
    const dir = suggestCacheDir(dataDir);
    for (const f of readdirSync(dir)) writeFileSync(join(dir, f), "{not json");
    const r = suggestCompaniesCached(profile(), companies, { now, dataDir, files });
    expect(r.cached).toBe(false);
    expect(r.result).toEqual(suggestCompanies(profile(), companies, { now }));
  });

  it("keeps only the newest few rankings", () => {
    const { dataDir, files } = setup();
    for (let d = 0; d < 9; d++) suggestCompaniesCached(profile(), companies, { now: new Date(now.getTime() + d * 86_400_000), dataDir, files });
    expect(readdirSync(suggestCacheDir(dataDir)).length).toBeLessThanOrEqual(6);
  });
});
