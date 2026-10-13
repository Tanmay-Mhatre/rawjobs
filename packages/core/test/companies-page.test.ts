import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addedCounts, companyExtras, PACK_MORE, PACK_SIZE, recordAdditions } from "../src/companies-page";
import { suggestCompanies, type IndexedCompany } from "../src/suggest";
import { profile } from "./helpers";
import type { CompanyCheck } from "../src/protocol";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const check = (slug: string, extra: Partial<CompanyCheck> = {}): CompanyCheck => ({
  input: `https://jobs.lever.co/${slug}`,
  status: "live",
  key: `lever:${slug}`,
  name: slug,
  ats: "lever",
  slug,
  careers_url: `https://jobs.lever.co/${slug}`,
  open_jobs: 3,
  ...extra,
});

describe("recordAdditions", () => {
  it("keeps live and dormant boards the directory doesn't have, and their first added date", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-additions-"));
    recordAdditions(dir, [check("acme"), check("quiet", { status: "dormant", open_jobs: 0 }), check("known", { in_directory: true }), check("broken", { status: "error" })]);
    const read = () => (JSON.parse(readFileSync(join(dir, "catalog", "additions.json"), "utf8")) as { companies: { key: string; added_at: string; open_jobs: number | null }[] }).companies;
    expect(read().map((c) => c.key)).toEqual(["lever:acme", "lever:quiet"]);
    const first = read()[0]!.added_at;
    recordAdditions(dir, [check("acme", { open_jobs: 9 })]);
    expect(read()[0]).toMatchObject({ key: "lever:acme", open_jobs: 9, added_at: first });
  });
});

describe("companyExtras packs", () => {
  it("returns the best 8 per industry and the next few as extras, in score order", () => {
    dir = mkdtempSync(join(tmpdir(), "rj-packs-"));
    const now = new Date("2026-10-04T12:00:00Z");
    // More Dubai PM roles rank higher: company 1 has 15, company 15 has 1.
    const indexed: IndexedCompany[] = Array.from({ length: 15 }, (_, i) => {
      const n = 15 - i;
      return {
        key: `lever:c${i + 1}`,
        name: `C${i + 1}`,
        ats: "lever",
        slug: `c${i + 1}`,
        careers_url: `https://jobs.lever.co/c${i + 1}`,
        open_jobs: n,
        rows: [["Senior Product Manager", "Dubai", "onsite", 2, n]],
        tags: ["fintech"],
      };
    });
    const p = profile({ industries: ["fintech"] });
    const pool = suggestCompanies(p, indexed, { now, limit: 400 });
    const { packs } = companyExtras(p, pool, indexed, [], new Set(), "");
    expect(packs).toHaveLength(1);
    expect(packs[0]!.items.map((s) => s.name)).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"]);
    expect(packs[0]!.items).toHaveLength(PACK_SIZE);
    expect(packs[0]!.more.map((s) => s.name)).toEqual(["C9", "C10", "C11", "C12"]);
    expect(packs[0]!.more).toHaveLength(PACK_MORE);
    expect(packs[0]!.items[0]!.hires_in).toEqual({ remote: false, countries: ["United Arab Emirates"] });
  });
});

describe("addedCounts", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const fintech = (i: number): IndexedCompany => ({
    key: `lever:c${i}`,
    name: `C${i}`,
    ats: "lever",
    slug: `c${i}`,
    careers_url: `https://jobs.lever.co/c${i}`,
    open_jobs: 20 - i,
    rows: [["Senior Product Manager", "Dubai", "onsite", 2, 20 - i]],
    tags: ["fintech"],
  });

  it("counts your companies the way each list and pack picks them, and per past employer", () => {
    const indexed = Array.from({ length: 14 }, (_, i) => fintech(i + 1));
    // Your past employer, in the directory: its lookalikes are the fintech companies hiring PMs.
    const seed = { ...fintech(99), name: "Seedco", key: "lever:seedco", slug: "seedco" };
    const p = profile({ industries: ["fintech"], past_employers: ["Seedco"] });
    const mine = suggestCompanies(p, indexed, { now, limit: indexed.length });
    const added = addedCounts(p, mine, [...indexed, seed], [seed], "");
    expect(added.hiring).toBe(14);
    expect(added.watching).toBe(0);
    expect(added.soon).toBe(0);
    // A pack holds the best 8 and the next 4.
    expect(added.packs.fintech).toHaveLength(PACK_SIZE + PACK_MORE);
    expect(added.packs.fintech![0]).toBe("lever:c1");
    expect(added.like).toEqual({ Seedco: 6 });
  });

  it("is all zeros with no companies", () => {
    const p = profile({ industries: ["fintech"] });
    const mine = suggestCompanies(p, [], { now, limit: 0 });
    expect(addedCounts(p, mine, [], [], "")).toEqual({ hiring: 0, watching: 0, soon: 0, like: {}, packs: {} });
  });
});
