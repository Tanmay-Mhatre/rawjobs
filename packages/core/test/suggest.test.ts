import { describe, expect, it } from "vitest";
import { suggestCompanies, type DirectoryCompany, type IndexedCompany, type IndexRow } from "../src/suggest";
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

const pm = (location: string, age = 2, count = 1, workplace = "onsite"): IndexRow => ["Senior Product Manager", location, workplace, age, count];
const eng = (location: string): IndexRow => ["Software Engineer", location, "onsite", 2, 1];

describe("suggestCompanies", () => {
  it("never suggests sandbox or training boards", () => {
    const r = suggestCompanies(
      profile(),
      [
        co("lever:leverdemo", [pm("Dubai")], { name: "Lever Implementation Training Environment" }),
        co("greenhouse:rhaegal", [pm("Riyadh, Saudi Arabia")], { name: "Rhaegal - Arago Sandbox" }),
        co("ashby:sandboxvr", [pm("Dubai")], { name: "Sandbox VR" }),
      ],
      { now, others: [{ key: "lever:sandbox2", name: "Acme Sandbox", ats: "lever", slug: "sandbox2", careers_url: "https://x", open_jobs: null, tier: "curated" }] },
    );
    const keys = [...r.hiringNow, ...r.worthWatching, ...r.notScannable].map((s) => s.key);
    expect(keys).toEqual(["ashby:sandboxvr"]);
  });

  it("ignores postings older than about six months", () => {
    const r = suggestCompanies(profile(), [co("lever:stale", [pm("Dubai", 2000), pm("Riyadh, Saudi Arabia", 400)]), co("lever:fresh", [pm("Dubai", 2000), pm("Dubai", 90)])], { now });
    expect(r.hiringNow.map((s) => s.key)).toEqual(["lever:fresh"]);
    expect(r.hiringNow[0]).toMatchObject({ matches: 1 });
    expect(r.worthWatching.map((s) => s.key)).not.toContain("lever:stale");
  });

  it("ranks companies by how many open jobs pass the user's own filters", () => {
    const r = suggestCompanies(
      profile(),
      [
        co("greenhouse:one", [pm("Dubai"), eng("Dubai")]),
        co("lever:three", [pm("Dubai"), pm("Abu Dhabi"), pm("Dubai, UAE", 30)]),
        co("ashby:none", [eng("Dubai"), pm("Berlin")]),
      ],
      { now },
    );
    expect(r.hiringNow.map((s) => s.key)).toEqual(["lever:three", "greenhouse:one"]);
    expect(r.hiringNow[0]).toMatchObject({ matches: 3, new_matches: 2 });
    expect(r.hiringNow[0]!.reasons).toEqual(["3 open roles match you", "2 new this week"]);
    expect(r.hiringNow[0]!.examples[0]).toBe("Senior Product Manager (Dubai)");
    expect(r.scanned).toBe(3);
  });

  it("counts row ages from when the index was built, not from now", () => {
    // Posted 2 days before an index built 6 days ago: 8 days old today, so not "new this week".
    const indexGeneratedAt = new Date(now.getTime() - 6 * 86_400_000);
    const r = suggestCompanies(profile(), [co("greenhouse:one", [pm("Dubai", 2)])], { now, indexGeneratedAt });
    expect(r.hiringNow[0]).toMatchObject({ matches: 1, new_matches: 0 });
    expect(suggestCompanies(profile(), [co("greenhouse:one", [pm("Dubai", 2)])], { now }).hiringNow[0]).toMatchObject({ new_matches: 1 });
  });

  it("puts right-title, nearby-place roles in Worth watching", () => {
    // profile() targets UAE places, so other GCC countries are "near"; Berlin is not.
    const r = suggestCompanies(profile(), [co("greenhouse:riyadh", [pm("Riyadh, Saudi Arabia")]), co("greenhouse:berlin", [pm("Berlin")])], { now });
    expect(r.hiringNow).toEqual([]);
    expect(r.worthWatching.map((s) => s.key)).toEqual(["greenhouse:riyadh", "greenhouse:berlin"]);
    expect(r.worthWatching[0]!.reasons).toEqual(["1 similar role nearby or remote"]);
  });

  it("watches companies hiring your role elsewhere, or other roles in your places", () => {
    const r = suggestCompanies(
      profile(),
      [co("lever:elsewhere", [pm("London, UK"), pm("Singapore"), pm("London")]), co("ashby:office", [eng("Dubai"), eng("Abu Dhabi, UAE")]), co("ashby:nothing", [eng("Berlin")])],
      { now },
    );
    const byKey = Object.fromEntries(r.worthWatching.map((s) => [s.key, s]));
    expect(Object.keys(byKey).sort()).toEqual(["ashby:office", "lever:elsewhere"]);
    expect(byKey["lever:elsewhere"]).toMatchObject({ elsewhere: 3, reasons: ["Hires for your roles in London, Singapore"] });
    expect(byKey["lever:elsewhere"]!.examples[0]).toBe("Senior Product Manager (London, UK)");
    expect(byKey["ashby:office"]).toMatchObject({ in_your_places: 2, reasons: ["Hiring in Dubai, Abu Dhabi (other roles)"] });
  });

  it("finds your topics in job titles, ignoring one stray title at a big company", () => {
    const small = co("ashby:pay", [["Payments Engineer", "Berlin", "onsite", 2, 1], eng("Berlin")]);
    const bigRows = Array.from({ length: 40 }, (_, i): IndexRow => [`Engineer ${i}`, "Berlin", "onsite", 2, 1]);
    const big = co("greenhouse:big", [["Payments Analyst", "Berlin", "onsite", 2, 1], ...bigRows]);
    const r = suggestCompanies(profile(), [small, big], { now });
    expect(r.worthWatching.map((s) => s.key)).toEqual(["ashby:pay"]);
    expect(r.worthWatching[0]!.reasons).toEqual(["Your topics: payments"]);
  });

  it("suggests companies with no openings from a matching source tag, and gives a hand-reviewed one no head start", () => {
    const dir = (key: string, extra: Partial<DirectoryCompany> = {}): DirectoryCompany => ({
      key,
      name: key.split(":")[1]!,
      ats: key.split(":")[0]!,
      slug: key.split(":")[1]!,
      careers_url: `https://example.com/${key}`,
      open_jobs: 0,
      ...extra,
    });
    const r = suggestCompanies(profile({ keywords: { web3: 5, payments: 3 } }), [], {
      now,
      others: [dir("lever:shortlisted", { tier: "curated" }), dir("ashby:cryptoco", { tags: ["crypto"] }), dir("ashby:random"), dir("lever:gone", { tier: "curated" })],
      exclude: new Set(["lever:gone"]),
    });
    // "curated" only says a board was checked by hand; it says nothing about what this user wants.
    expect(r.worthWatching.map((s) => [s.key, s.reasons])).toEqual([["ashby:cryptoco", ["Your topics: web3"]]]);
    expect(r.scanned).toBe(4);
  });

  it("returns up to `limit` companies in each section", () => {
    const many = Array.from({ length: 8 }, (_, i) => co(`lever:c${i}`, [pm(i % 2 ? "Dubai" : "London")]));
    const r = suggestCompanies(profile(), many, { now, limit: 3 });
    expect(r.hiringNow).toHaveLength(3);
    expect(r.worthWatching).toHaveLength(3);
  });

  it("leaves out excluded (watched or hidden) companies", () => {
    const r = suggestCompanies(profile(), [co("greenhouse:a", [pm("Dubai")]), co("greenhouse:b", [pm("Dubai")])], { now, exclude: new Set(["greenhouse:a"]) });
    expect(r.hiringNow.map((s) => s.key)).toEqual(["greenhouse:b"]);
  });

  it("counts merged duplicate rows and log-scales volume so giants don't win on size alone", () => {
    const giant = co("workday:giant", [pm("Dubai", 2, 40)]);
    const small = co("ashby:small", [pm("Dubai"), pm("Abu Dhabi")]);
    const r = suggestCompanies(profile(), [giant, small], { now });
    expect(r.hiringNow.find((s) => s.key === "workday:giant")!.matches).toBe(40);
    const scores = Object.fromEntries(r.hiringNow.map((s) => [s.key, s.score]));
    // 40 matches vs 2: a modest lead, not a landslide.
    expect(scores["workday:giant"]! - scores["ashby:small"]!).toBeLessThanOrEqual(25);
  });

  it("caps very large employers at 3 in any 12 consecutive suggestions", () => {
    const big = Array.from({ length: 6 }, (_, i) => co(`greenhouse:big${i}`, [pm("Dubai", 1, 6), eng("Dubai")], { open_jobs: 500 }));
    const smallOnes = Array.from({ length: 12 }, (_, i) => co(`lever:small${i}`, [pm("Dubai", 20)], { open_jobs: 10 }));
    const r = suggestCompanies(profile(), [...big, ...smallOnes], { now });
    const first12 = r.hiringNow.slice(0, 12);
    expect(first12.filter((s) => (s.open_jobs ?? 0) > 300)).toHaveLength(3);
    // The other giants are pushed further down, not dropped.
    expect(r.hiringNow).toHaveLength(18);
    expect(r.hiringNow.slice(12).filter((s) => (s.open_jobs ?? 0) > 300)).toHaveLength(3);
  });

  it("lets a giant that doesn't fit the window take the next free slot, not the end", () => {
    // The OKX case: a big exchange ranked just below three other giants used to fall to the bottom.
    const giants = Array.from({ length: 4 }, (_, i) => co(`greenhouse:giant${i}`, [pm("Dubai", 1, 6 - i)], { open_jobs: 400 }));
    const smallOnes = Array.from({ length: 40 }, (_, i) => co(`lever:s${i}`, [pm("Dubai", 30)], { open_jobs: 5 }));
    const r = suggestCompanies(profile(), [...giants, ...smallOnes], { now, limit: 100 });
    const pos = r.hiringNow.findIndex((s) => s.key === "greenhouse:giant3");
    expect(pos).toBeGreaterThanOrEqual(3);
    expect(pos).toBeLessThan(15);
  });

  it("puts companies in the user's industries first, with the industry as the first reason", () => {
    const exchange = co("lever:exchange", [pm("Dubai")], { tags: ["crypto", "crypto-exchange"], open_jobs: 400 });
    const media = co("greenhouse:media", [pm("Dubai"), pm("Dubai"), pm("Abu Dhabi"), pm("Dubai, UAE"), pm("Dubai", 1, 9)]);
    const r = suggestCompanies(profile({ industries: ["crypto-exchange", "brokerage"] }), [media, exchange], { now });
    expect(r.hiringNow.map((s) => s.key)).toEqual(["lever:exchange", "greenhouse:media"]);
    expect(r.hiringNow[0]!.industries).toEqual(["crypto-exchange"]);
    expect(r.hiringNow[0]!.reasons[0]).toBe("Your industry: Crypto exchange");
    // Without industries picked, volume wins as before.
    expect(suggestCompanies(profile(), [media, exchange], { now }).hiringNow[0]!.key).toBe("greenhouse:media");
  });

  it("treats an industry only job titles point to as 'hires for', not as the company's industry", () => {
    const label = co("lever:label", [pm("Dubai")], { title_tags: ["ai"] });
    const lab = co("ashby:lab", [pm("Dubai")], { tags: ["ai"] });
    const plain = co("greenhouse:plain", [pm("Dubai")]);
    const r = suggestCompanies(profile({ industries: ["ai"] }), [plain, label, lab], { now });
    expect(r.hiringNow.map((s) => s.key)).toEqual(["ashby:lab", "lever:label", "greenhouse:plain"]);
    const byKey = Object.fromEntries(r.hiringNow.map((s) => [s.key, s]));
    expect(byKey["lever:label"]).toMatchObject({ industries: [], hires_for: ["ai"] });
    expect(byKey["lever:label"]!.reasons[0]).toBe("Hires for AI & machine learning roles");
    expect(byKey["ashby:lab"]!.reasons[0]).toBe("Your industry: AI & machine learning");
    // Hiring for it is worth something, but less than being in it.
    expect(byKey["ashby:lab"]!.score).toBeGreaterThan(byKey["lever:label"]!.score);
    expect(byKey["lever:label"]!.score).toBeGreaterThan(byKey["greenhouse:plain"]!.score);
  });

  it("lists industry companies on hiring systems we can't scan yet separately", () => {
    const dir = (key: string, tags: string[]): DirectoryCompany => ({ key, name: key, ats: key.split(":")[0]!, slug: "x", careers_url: "https://x", open_jobs: 12, tags });
    const r = suggestCompanies(profile({ industries: ["brokerage"] }), [], {
      now,
      others: [dir("kenexa:cmc", ["brokerage"]), dir("kenexa:other", ["healthtech"]), dir("lever:quiet", ["brokerage"])],
    });
    expect(r.notScannable.map((s) => s.key)).toEqual(["kenexa:cmc"]);
    expect(r.worthWatching.map((s) => s.key)).toEqual(["lever:quiet"]);
  });

  it("uses topic data when present and rescales when it isn't", () => {
    const withTerms = co("greenhouse:t", [pm("Dubai")], { terms: { crypto: 0.6, payments: 0.4 } });
    const r = suggestCompanies(profile(), [withTerms], { now });
    expect(r.hiringNow[0]!.topics).toEqual(["crypto", "payments"]);
    expect(r.hiringNow[0]!.reasons).toContain("Your topics: crypto, payments");
  });
});
