import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { companyIndex, companyIndexAsync } from "../src/company-search";
import { cleanBrowseRequest, directoryBrowser } from "../src/directory-browse";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const row = (name: string, over: Record<string, unknown> = {}) => ({
  key: `lever:${name.toLowerCase().replace(/\W+/g, "")}`,
  name,
  ats: "lever",
  slug: name.toLowerCase().replace(/\W+/g, ""),
  careers_url: `https://jobs.lever.co/${name.toLowerCase()}`,
  tier: "dump",
  status: "live",
  open_jobs: 1,
  indexed: true,
  ...over,
});

function dataDir(companies: unknown[], additions?: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "rawjobs-browse-"));
  dirs.push(dir);
  mkdirSync(join(dir, "catalog"));
  writeFileSync(join(dir, "catalog", "directory.json"), JSON.stringify({ companies }));
  if (additions) writeFileSync(join(dir, "catalog", "additions.json"), JSON.stringify({ companies: additions }));
  return dir;
}

const ask = (o: Record<string, unknown> = {}) => cleanBrowseRequest(o);

describe("directoryBrowser", () => {
  it("pages the live companies, most open jobs first", async () => {
    const many = Array.from({ length: 30 }, (_, i) => row(`Company ${i}`, { open_jobs: i }));
    const b = directoryBrowser(dataDir([...many, row("Sleepy", { status: "dormant", open_jobs: 99 })]));
    const first = await b.search(ask());
    if (first.missing) throw new Error("missing");
    expect(first.total).toBe(30);
    expect(first.rows).toHaveLength(25);
    expect(first.rows[0]!.lead.name).toBe("Company 29");
    const second = await b.search(ask({ page: 2 }));
    if (second.missing) throw new Error("missing");
    expect(second.rows.map((g) => g.lead.name)).toEqual(["Company 4", "Company 3", "Company 2", "Company 1", "Company 0"]);
    // Past the last page: the last page.
    const past = await b.search(ask({ page: 9 }));
    expect(!past.missing && past.page).toBe(2);
  });

  it("searches names (exact first), filters by industry and keeps your companies", async () => {
    const dir = dataDir([row("Revolut", { tags: ["fintech"] }), row("Revolution Foods"), row("Stripe", { tags: ["fintech"] }), row("Dormant Co", { status: "dormant" })]);
    const b = directoryBrowser(dir);
    expect(b.searchReady()).toBe(false);
    const r = await b.search(ask({ q: "revolut" }));
    if (r.missing) throw new Error("missing");
    expect(r.rows.map((g) => g.lead.name)).toEqual(["Revolut", "Revolution Foods"]);
    expect(r.exact).toBe(1);
    expect(r.searchReady).toBe(true);
    const fintech = await b.search(ask({ industry: "fintech" }));
    expect(!fintech.missing && fintech.rows.map((g) => g.lead.name).sort()).toEqual(["Revolut", "Stripe"]);
    // A dormant company is browsed only when it's yours.
    const mine = await b.search(ask({ watched: ["lever:dormantco"] }));
    expect(!mine.missing && mine.rows.some((g) => g.lead.name === "Dormant Co")).toBe(true);
  });

  it("adds companies added by link, and reads the files again when they change", async () => {
    const dir = dataDir([row("Acme")], [row("Acme"), row("Byelo")]);
    const b = directoryBrowser(dir);
    const r = await b.search(ask());
    expect(!r.missing && r.rows.map((g) => [g.lead.name, g.lead.origin])).toEqual([
      ["Acme", undefined],
      ["Byelo", "user"],
    ]);
    writeFileSync(join(dir, "catalog", "directory.json"), JSON.stringify({ companies: [row("Acme"), row("Zeta", { open_jobs: 5 })] }));
    const later = new Date(Date.now() + 5000);
    utimesSync(join(dir, "catalog", "directory.json"), later, later);
    const again = await b.search(ask());
    expect(!again.missing && again.rows.map((g) => g.lead.name)).toEqual(["Zeta", "Acme", "Byelo"]);
    expect(b.names(["lever:zeta", "lever:nope"])).toEqual({ "lever:zeta": "Zeta" });
  });

  it("says when there's no directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rawjobs-browse-"));
    dirs.push(dir);
    const b = directoryBrowser(dir);
    expect(await b.search(ask())).toEqual({ missing: true });
    expect(b.warm()).toBe(false);
    expect(b.names(["lever:a"])).toEqual({});
  });
});

describe("cleanBrowseRequest", () => {
  it("keeps what's sensible and drops the rest", () => {
    expect(cleanBrowseRequest({ q: 5, system: "evil", page: -3, pageSize: 1000, watched: ["a", 2], fit: { a: 1, b: "x" } })).toEqual({
      q: "",
      industry: "",
      system: "all",
      page: 1,
      pageSize: 100,
      watched: ["a"],
      fit: { a: 1 },
    });
    expect(cleanBrowseRequest(null).page).toBe(1);
  });
});

describe("companyIndexAsync", () => {
  it("builds the same index as companyIndex, a slice at a time", async () => {
    const items = Array.from({ length: 23 }, (_, i) => ({ name: `Firm ${i} Labs`, slug: `firm${i}` }));
    const slow = await companyIndexAsync(items, 5);
    const fast = companyIndex(items);
    expect(slow.lower).toEqual(fast.lower);
    expect(slow.search.search("firm 7").map((h) => h.id)).toEqual(fast.search.search("firm 7").map((h) => h.id));
  });
});
