import { describe, expect, it } from "vitest";
import type { Job } from "../src/lib/data";
import {
  roleCount,
  evergreenReason,
  isOlder,
  activeChips,
  applyFilters,
  hasNewTag,
  isNewJob,
  DEFAULT_FILTERS,
  facetCounts,
  foldCompanies,
  fromQuery,
  groupJobs,
  sortJobs,
  suggestRelax,
  toQuery,
  type Ctx,
  type Filters,
} from "../src/lib/filters";
import { makeJob } from "./helpers";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

let n = 0;
const job = (o: Partial<Job> = {}): Job => {
  n++;
  return makeJob({
    id: `greenhouse:acme:${n}`,
    url: "https://example.com",
    firstSeen: daysAgo(1),
    lastSeen: daysAgo(0),
    postedAt: daysAgo(1),
    why: { title: 30, location: 20, keywords: ["crypto"], keywordPoints: 5, industry: 10 },
    group: `Acme|senior product manager|${n}`,
    hasDescription: true,
    ...o,
  });
};

const ctx: Ctx = { user: {}, min: 70, industriesOf: (c) => (c === "Kraken" ? ["crypto-exchange"] : []), hiddenCompanies: new Set(), now: NOW };
const f = (o: Partial<Filters> = {}): Filters => ({ ...DEFAULT_FILTERS, ...o });

const jobs = [
  job({ id: "a", company: "Kraken", score: 90, postedAt: daysAgo(1) }),
  job({ id: "b", company: "Rain", score: 60, countries: ["United Kingdom"], cities: ["London, United Kingdom"], location: "London", postedAt: daysAgo(20), firstSeen: daysAgo(20) }),
  job({ id: "c", company: "OKX", score: 80, workplace: "remote", countries: [], cities: [], location: "Remote - EMEA", seniority: "leadership", postedAt: daysAgo(5), firstSeen: daysAgo(5) }),
  job({ id: "d", company: "Acme", score: 0, why: { title: 0, location: 20, keywords: [], keywordPoints: 0, industry: 10, gate: "title" } }),
];

describe("applyFilters", () => {
  it("hides jobs that failed your filters unless asked", () => {
    expect(applyFilters(jobs, f(), ctx).map((j) => j.id)).toEqual(["a", "b", "c"]);
    expect(applyFilters(jobs, f({ showFailed: true }), ctx)).toHaveLength(4);
  });

  it("combines facets: OR within a facet, AND across facets", () => {
    expect(applyFilters(jobs, f({ countries: ["United Arab Emirates", "United Kingdom"] }), ctx).map((j) => j.id)).toEqual(["a", "b"]);
    expect(applyFilters(jobs, f({ countries: ["Remote"] }), ctx).map((j) => j.id)).toEqual(["c"]);
    expect(applyFilters(jobs, f({ posted: 7, match: "strong" }), ctx).map((j) => j.id)).toEqual(["a", "c"]);
    expect(applyFilters(jobs, f({ industries: ["crypto-exchange"] }), ctx).map((j) => j.id)).toEqual(["a"]);
    expect(applyFilters(jobs, f({ seniority: ["leadership"] }), ctx).map((j) => j.id)).toEqual(["c"]);
  });

  it("hides dismissed jobs and hidden companies, and filters by tracking status", () => {
    const tracked: Ctx = {
      ...ctx,
      user: {
        a: { status: "saved", updatedAt: "", snapshot: {} as never },
        b: { status: "dismissed", updatedAt: "", snapshot: {} as never },
        c: { status: "interviewing", updatedAt: "", snapshot: {} as never },
      },
      hiddenCompanies: new Set(["OKX"]),
    };
    expect(applyFilters(jobs, f(), tracked).map((j) => j.id)).toEqual(["a"]);
    expect(applyFilters(jobs, f({ status: "saved" }), tracked).map((j) => j.id)).toEqual(["a"]);
    expect(applyFilters(jobs, f({ status: "applied", showHidden: true }), tracked).map((j) => j.id)).toEqual(["c"]);
    expect(applyFilters(jobs, f({ status: "new" }), ctx).map((j) => j.id)).toEqual(["a"]);
  });
});

describe("facetCounts", () => {
  it("counts each facet with every other filter applied, but not its own", () => {
    const counts = facetCounts(jobs, f({ countries: ["United Kingdom"], posted: 7 }), ctx);
    // Countries ignore the country pick but apply "past week": a (UAE) and c (Remote) remain.
    expect(Object.fromEntries(counts.countries.map((o) => [o.value, o.count]))).toEqual({ "United Arab Emirates": 1, Remote: 1, "United Kingdom": 0 });
    // Posted ignores the posted pick but applies the UK pick: only b, posted 20 days ago.
    expect(Object.fromEntries(counts.posted.map((o) => [o.value, o.count]))).toEqual({ "1": 0, "3": 0, "7": 0, "14": 0, "30": 1, "90": 1 });
  });
});

describe("sorting, grouping, chips, suggestions, URL", () => {
  it("sorts by best match, newest, salary and company", () => {
    expect(sortJobs(jobs.slice(0, 3), "best").map((j) => j.id)).toEqual(["a", "c", "b"]);
    expect(sortJobs(jobs.slice(0, 3), "newest").map((j) => j.id)).toEqual(["a", "c", "b"]);
    const paid = [job({ id: "x", salary: { min: 100 } }), job({ id: "y", salary: { min: 90, max: 200 } }), job({ id: "z" })];
    expect(sortJobs(paid, "salary").map((j) => j.id)).toEqual(["y", "x", "z"]);
    expect(sortJobs(jobs.slice(0, 3), "company").map((j) => j.company)).toEqual(["Kraken", "OKX", "Rain"]);
  });

  it("breaks a tie on best match by topics mentioned", () => {
    const tied = [
      job({ id: "few", score: 100, postedAt: daysAgo(1), why: { title: 30, location: 20, keywords: ["api"], keywordPoints: 40, industry: 10 } }),
      job({ id: "many", score: 100, postedAt: daysAgo(1), why: { title: 30, location: 20, keywords: ["api", "payments", "b2b"], keywordPoints: 40, industry: 10 } }),
    ];
    expect(sortJobs(tied, "best", undefined, NOW).map((j) => j.id)).toEqual(["many", "few"]);
  });

  it("best match counts freshness: an equal fit posted today beats last week's, a weak fresh one never leaps a strong one", () => {
    const list = [
      job({ id: "old", score: 60, postedAt: daysAgo(7) }),
      job({ id: "today", score: 60, postedAt: daysAgo(0.4) }),
      job({ id: "strong-old", score: 85, postedAt: daysAgo(20) }),
      job({ id: "weak-today", score: 45, postedAt: daysAgo(0) }),
    ];
    expect(sortJobs(list, "best", undefined, NOW).map((j) => j.id)).toEqual(["strong-old", "today", "old", "weak-today"]);
  });

  it("groups one role posted in several places, best posting first", () => {
    const g = groupJobs([job({ id: "1", company: "K", title: "PM", location: "Dubai" }), job({ id: "2", company: "K", title: "PM", location: "London" }), job({ id: "3", company: "R", title: "PM" })]);
    expect(g.map((x) => [x.lead.id, x.jobs.length])).toEqual([
      ["1", 2],
      ["3", 1],
    ]);
  });

  it("lists active filters as chips and suggests which one to drop", () => {
    const strict = f({ posted: 1, countries: ["United Kingdom"] });
    expect(activeChips(strict, ctx).map((c) => c.label)).toEqual(["Past 24 hours", "United Kingdom"]);
    expect(applyFilters(jobs, strict, ctx)).toEqual([]);
    expect(suggestRelax(jobs, strict, ctx)[0]).toMatchObject({ label: "Past 24 hours", count: 1 });
  });

  it("round-trips filters and sort through the URL", () => {
    const filters = f({ posted: 7, countries: ["United Arab Emirates", "Remote"], match: "strong", salaryOnly: true });
    const q = toQuery(filters, "newest");
    expect(q).toContain("posted=7");
    expect(fromQuery(q)).toEqual({ filters, sort: "newest" });
    expect(fromQuery("")).toBeNull();
  });

  it("writes links against your profile, and fills in what a link leaves out from it", () => {
    const profile = f({ countries: ["United Arab Emirates", "Remote"] });
    // A hand-written search link keeps your places.
    expect(fromQuery("q=kraken", profile)!.filters).toEqual({ ...profile, q: "kraken" });
    // Your places aren't repeated in the link...
    expect(toQuery({ ...profile, posted: 7 }, "best", profile)).toBe("posted=7");
    // ...and "everywhere" is said out loud, so it survives the trip.
    const everywhere = { ...profile, countries: [] };
    const q = toQuery(everywhere, "best", profile);
    expect(q).toBe("countries=");
    expect(fromQuery(q, profile)!.filters).toEqual(everywhere);
  });

  it("counts roles, not postings: one role in three cities is one", () => {
    const role = (city: string) => job({ title: "Head of Product", company: "Bybit", cities: [`${city}, United Arab Emirates`], countries: ["United Arab Emirates"] });
    const postings = [role("Dubai"), role("Abu Dhabi"), role("Sharjah"), job({ title: "Product Manager", company: "Bybit", cities: ["Abu Dhabi, United Arab Emirates"] })];
    expect(roleCount(postings)).toBe(2);
    expect(groupJobs(postings)).toHaveLength(2);
    const counts = facetCounts(postings, f(), ctx);
    expect(counts.countries.find((o) => o.value === "United Arab Emirates")?.count).toBe(2);
    expect(counts.locations.find((o) => o.value === "Dubai, United Arab Emirates")?.count).toBe(1);
    expect(counts.match.find((o) => o.value === "strong")?.count).toBe(2);
  });
});

describe("location facet", () => {
  it("filters by city (OR within), combines with country (AND), and counts without its own pick", () => {
    expect(applyFilters(jobs, f({ locations: ["Dubai, United Arab Emirates", "London, United Kingdom"] }), ctx).map((j) => j.id)).toEqual(["a", "b"]);
    expect(applyFilters(jobs, f({ locations: ["London, United Kingdom"], countries: ["United Arab Emirates"] }), ctx)).toEqual([]);
    const counts = facetCounts(jobs, f({ locations: ["London, United Kingdom"] }), ctx);
    expect(counts.locations.map((o) => [o.value, o.label, o.count])).toEqual([
      ["Dubai, United Arab Emirates", "Dubai · United Arab Emirates", 1],
      ["London, United Kingdom", "London · United Kingdom", 1],
    ]);
    // Country counts respect the location pick.
    expect(Object.fromEntries(counts.countries.map((o) => [o.value, o.count]))).toEqual({ "United Kingdom": 1 });
    expect(activeChips(f({ locations: ["Dubai, United Arab Emirates"] }), ctx).map((c) => c.label)).toEqual(["Dubai"]);
  });
});

describe("your companies and directory jobs", () => {
  const mine: Ctx = { ...ctx, isYours: (j) => j.company === "Rain" };
  const directory = job({ id: "index:lever:far:1", company: "Far", score: 56, estimated: true, companyKey: "lever:far", postedAt: daysAgo(3), firstSeen: daysAgo(3) });
  const stale = job({ id: "index:lever:old:1", company: "Old", score: 56, estimated: true, companyKey: "lever:old", postedAt: daysAgo(45), firstSeen: daysAgo(45) });

  it("never pins your companies: every sort means what it says, Best match gives them +10", () => {
    const list = applyFilters(jobs, f(), mine);
    // b (Rain, yours) is 60 and 20 days old: +10 isn't enough to pass a (90) or c (80).
    expect(sortJobs(list, "best", mine.isYours, NOW).map((j) => j.id)).toEqual(["a", "c", "b"]);
    expect(sortJobs(list, "newest", mine.isYours, NOW).map((j) => j.id)).toEqual(["a", "c", "b"]);
    // ...but it decides between two equal jobs.
    const tie = [job({ id: "other", company: "Acme", score: 70, postedAt: daysAgo(2) }), job({ id: "yours", company: "Rain", score: 70, postedAt: daysAgo(2) })];
    expect(sortJobs(tie, "best", mine.isYours, NOW).map((j) => j.id)).toEqual(["yours", "other"]);
  });

  it("groups one role posted per city, whichever side of the title the city is on", () => {
    const sp = (id: string, title: string) => job({ id, company: "Speechify", title });
    const g = groupJobs([
      sp("1", "Team Lead, Android Core Product - Manchester, United Kingdom"),
      sp("2", "Team Lead, Android Core Product - Oxford, United Kingdom"),
      sp("3", "Dubai - Team Lead, Android Core Product"),
      sp("4", "Team Lead, Android Core Product (Remote)"),
      sp("5", "Product Manager - Payments"),
    ]);
    expect(g.map((x) => x.jobs.length)).toEqual([4, 1]);
  });

  it("groups a job board's copy with the company's own posting, and shows the company's", () => {
    const board = job({ id: "himalayas:acme:1", ats: "himalayas", company: "Acme Inc.", title: "Sr. Software Engineer", score: 90 });
    const own = job({ id: "greenhouse:acme:1", ats: "greenhouse", company: "ACME", title: "Senior Software Engineer - Remote", score: 80 });
    const other = job({ id: "greenhouse:acme:2", ats: "greenhouse", company: "Acme", title: "Senior Software Engineer II", score: 85 });
    const g = groupJobs([board, other, own]);
    expect(g.map((x) => [x.lead.id, x.jobs.length])).toEqual([
      ["greenhouse:acme:1", 2],
      ["greenhouse:acme:2", 1],
    ]);
    expect(roleCount([board, own, other])).toBe(2);
    // A board's copy still leads when it's the only posting.
    expect(groupJobs([board])[0]!.lead.id).toBe("himalayas:acme:1");
  });

  it("folds a company's roles after the first two into one row, until opened", () => {
    const role = (company: string, n: number) => ({ key: `${company}${n}`, lead: job({ id: `${company}${n}`, company }), jobs: [] });
    const groups = [role("S", 1), role("S", 2), role("K", 1), role("S", 3), role("S", 4), role("K", 2)];
    const rows = foldCompanies(groups);
    expect(rows.map((r) => (r.kind === "group" ? r.group.key : `+${r.groups.length} ${r.company}`))).toEqual(["S1", "S2", "K1", "+2 S", "K2"]);
    expect(foldCompanies(groups, new Set(["S"]))).toHaveLength(6);
  });

  it("'My companies' shows only theirs", () => {
    expect(applyFilters(jobs, f({ mine: true }), mine).map((j) => j.id)).toEqual(["b"]);
    expect(applyFilters(jobs, f({ mine: true }), ctx)).toEqual([]);
    expect(activeChips(f({ mine: true }), ctx).map((c) => c.label)).toContain("My companies");
  });

  it("hides directory jobs older than 30 days unless asked, and never calls them new", () => {
    expect(applyFilters([directory, stale], f(), ctx).map((j) => j.id)).toEqual([directory.id]);
    expect(applyFilters([directory, stale], f({ olderIndex: true }), ctx)).toHaveLength(2);
    expect(applyFilters([directory], f({ status: "new" }), ctx)).toEqual([]);
  });

  it("New = first found since the previous scan (2 days without one), posted within a month; never on the first scan", () => {
    const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
    const found = (h: number) => job({ id: `h${h}`, firstSeen: hoursAgo(h), postedAt: hoursAgo(h) });
    // No previous scan time: the last 48 hours count. The tag uses the same rule as the New view.
    expect([2, 30, 47, 50].map((h) => [h, isNewJob(found(h), ctx), hasNewTag(found(h), ctx)])).toEqual([
      [2, true, true],
      [30, true, true],
      [47, true, true],
      [50, false, false],
    ]);
    // Since the previous scan finished 10 hours ago.
    const since = { ...ctx, newSince: NOW - 10 * 3_600_000 };
    expect([2, 12].map((h) => isNewJob(found(h), since))).toEqual([true, false]);
    // First scan: nothing is new.
    expect(isNewJob(found(2), { ...ctx, firstScan: true })).toBe(false);
    // An old posting a scan only just found isn't new.
    expect(isNewJob(job({ firstSeen: hoursAgo(1), postedAt: daysAgo(120) }), ctx)).toBe(false);
    // Closed jobs aren't new, however recent.
    expect(isNewJob(job({ firstSeen: hoursAgo(1), status: "closed" }), ctx)).toBe(false);
  });

  it("hides postings older than 3 months unless asked, or your own limit", () => {
    const old = job({ id: "old", postedAt: daysAgo(100), firstSeen: daysAgo(100) });
    expect(applyFilters([old], f(), ctx)).toEqual([]);
    expect(applyFilters([old], f({ showOld: true }), ctx)).toHaveLength(1);
    expect(applyFilters([old], f(), { ...ctx, maxAgeDays: 180 })).toHaveLength(1);
    expect(applyFilters([old], f(), { ...ctx, maxAgeDays: 0 })).toHaveLength(1);
    expect(applyFilters([job({ postedAt: daysAgo(40) })], f(), { ...ctx, maxAgeDays: 30 })).toEqual([]);
  });

  it("never hides a job you saved or applied to for its age, and keeps closed ones in those views", () => {
    const old = job({ id: "old", postedAt: daysAgo(200), firstSeen: daysAgo(200) });
    const closed = job({ id: "gone", status: "closed" });
    const mine = { ...ctx, user: { old: { status: "saved" as const, updatedAt: daysAgo(1) }, gone: { status: "applied" as const, updatedAt: daysAgo(1) } } };
    expect(applyFilters([old], f(), mine)).toHaveLength(1);
    expect(applyFilters([closed], f({ status: "applied" }), mine)).toHaveLength(1);
    // Closed jobs stay out of the main list.
    expect(applyFilters([closed], f(), mine)).toEqual([]);
  });

  it("spots talent pools and reposts, ranks them lower, and can hide them", () => {
    expect(evergreenReason({ title: "Join our Talent Community!" })).toBe("pool");
    expect(evergreenReason({ title: "Investment Advisor (For Future Openings)" })).toBe("pool");
    expect(evergreenReason({ title: "Open Application" })).toBe("pool");
    expect(evergreenReason({ title: "Product Manager", repostedAt: daysAgo(1) })).toBe("reposted");
    expect(evergreenReason({ title: "Senior Product Manager, Payments" })).toBeUndefined();
    const pool = job({ id: "pool", title: "Product Talent Pool", score: 80 });
    const real = job({ id: "real", title: "Product Manager", score: 70 });
    expect(sortJobs([pool, real], "best", undefined, NOW).map((j) => j.id)).toEqual(["real", "pool"]);
    expect(applyFilters([pool, real], f({ hideEvergreen: true }), ctx).map((j) => j.id)).toEqual(["real"]);
  });

  it("keeps only companies that sponsor visas in the job's country, when asked", () => {
    const uk = job({ id: "uk", countries: ["United Kingdom"], visa: { GB: "2026-10-09" } });
    const elsewhere = job({ id: "de", countries: ["Germany"], visa: { GB: "2026-10-09" } });
    const none = job({ id: "none", countries: ["United Kingdom"] });
    expect(applyFilters([uk, elsewhere, none], f(), ctx)).toHaveLength(3);
    expect(applyFilters([uk, elsewhere, none], f({ visaOnly: true }), ctx).map((j) => j.id)).toEqual(["uk"]);
    expect(activeChips(f({ visaOnly: true }), ctx)).toEqual([{ key: "visa", label: "Sponsors visas", remove: { visaOnly: false } }]);
    expect(fromQuery(toQuery(f({ visaOnly: true }), "best"))!.filters.visaOnly).toBe(true);
  });

  it("ranks jobs that may be stale lower, and No talent pools or stale jobs hides them", () => {
    const stale = job({ id: "stale", score: 85, repostedAt: daysAgo(3), repostCount: 2 });
    const real = job({ id: "real", score: 80 });
    expect(sortJobs([stale, real], "best", undefined, NOW).map((j) => j.id)).toEqual(["real", "stale"]);
    expect(applyFilters([stale, real], f({ hideEvergreen: true }), ctx).map((j) => j.id)).toEqual(["real"]);
    expect(activeChips(f({ hideEvergreen: true }), ctx).map((c) => c.label)).toContain("No talent pools or stale jobs");
  });

  it("a fresh posting of a role leads its row over a stale one, and the filter drops only the stale posting", () => {
    const stale = job({ id: "stale", company: "K", title: "PM", location: "Dubai", score: 99, repostedAt: daysAgo(3), repostCount: 2 });
    const fresh = job({ id: "fresh", company: "K", title: "PM", location: "London", score: 70 });
    const other = job({ id: "other", company: "R", title: "PM", score: 80 });
    // Best match still puts the stale one first (99 less its cost beats 80 and 70): the row is the role's place in the list.
    const sorted = sortJobs([fresh, other, stale], "best", undefined, NOW);
    expect(sorted.map((j) => j.id)).toEqual(["stale", "other", "fresh"]);
    const g = groupJobs(sorted, NOW);
    expect(g.map((x) => [x.lead.id, x.jobs.map((j) => j.id)])).toEqual([
      ["fresh", ["stale", "fresh"]],
      ["other", ["other"]],
    ]);
    expect(roleCount(sorted)).toBe(2);
    expect(foldCompanies(g)).toHaveLength(2);
    // All stale: the first still leads.
    const stale2 = job({ id: "stale2", company: "K", title: "PM", location: "London", repostedAt: daysAgo(3), repostCount: 2 });
    expect(groupJobs([stale, stale2], NOW)[0]!.lead.id).toBe("stale");
    // No talent pools or stale jobs works per posting, before grouping: the role stays, with its fresh posting.
    const kept = groupJobs(applyFilters([stale, fresh], f({ hideEvergreen: true }), ctx), NOW);
    expect(kept.map((x) => [x.lead.id, x.jobs.length])).toEqual([["fresh", 1]]);
  });

  it("marks postings over two months old", () => {
    expect(isOlder(job({ postedAt: daysAgo(61) }), NOW)).toBe(true);
    expect(isOlder(job({ postedAt: daysAgo(59) }), NOW)).toBe(false);
  });

  it("round-trips the new filters through the URL", () => {
    const q = toQuery(f({ mine: true, olderIndex: true }), "best");
    expect(fromQuery(q)!.filters).toMatchObject({ mine: true, olderIndex: true });
  });
});
