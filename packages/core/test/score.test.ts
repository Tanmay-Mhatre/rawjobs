import { describe, expect, it } from "vitest";
import { locationFit, rankScore, scoreJob, topicsOf } from "../src/score";
import { profile } from "./helpers";

const now = new Date("2026-10-03T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

const job = (o: Partial<Parameters<typeof scoreJob>[0]> = {}) => ({
  title: "Senior Product Manager",
  location: "Dubai",
  workplace: "onsite" as const,
  description: "",
  ...o,
});

describe("scoreJob", () => {
  it("workplace preference gates office jobs of the other kind, never remote or unknown ones", () => {
    const base = profile();
    const onsiteOnly = profile({ locations: { ...base.locations, workplace: ["onsite"] } });
    expect(scoreJob(job({ workplace: "hybrid" }), onsiteOnly).why).toMatchObject({ gate: "location", locationNote: "Hybrid role: you asked for on-site only." });
    expect(scoreJob(job({ workplace: "onsite" }), onsiteOnly).why.gate).toBeUndefined();
    expect(scoreJob(job({ workplace: "unknown" }), onsiteOnly).why.gate).toBeUndefined();
    expect(scoreJob(job({ workplace: "hybrid" }), base).why.gate).toBeUndefined();
  });

  it("adds up title, location, keywords and industry", () => {
    const r = scoreJob(job({ description: "Crypto exchange, payments and KYC." }), profile());
    expect(r.why).toMatchObject({
      title: 30,
      level: 10,
      focus: 1,
      location: 20,
      keywords: ["crypto", "exchange", "payments", "kyc"],
      // Each named once: three quarters of its weight.
      keywordPoints: 35,
      industry: 10,
      checks: [
        { id: "place", status: "met" },
        { id: "level", status: "met" },
      ],
    });
    expect(r.score).toBe(95);
  });

  it("topic points are the share of min(total weight, 12) matched", () => {
    // Weight 5, named once (three quarters), of 12: 40 * 3.75/12 = 12.5.
    const r = scoreJob(job({ description: "A crypto company." }), profile());
    expect(r.why).toMatchObject({ keywords: ["crypto"], keywordPoints: 12.5 });
    expect(r.why.scale).toBeUndefined();
    expect(r.score).toBe(Math.round(30 + 20 + 12.5 + 10));
  });

  it("three topics at weight 3 can fill the topic bar", () => {
    const three = profile({ keywords: { crypto: 3, payments: 3, kyc: 3 } });
    const thrice = "crypto payments kyc. ".repeat(3);
    expect(scoreJob(job({ description: thrice }), three)).toMatchObject({ score: 100, why: { keywordPoints: 40 } });
    // Named once each: three quarters of the bar.
    expect(scoreJob(job({ description: "crypto payments kyc" }), three)).toMatchObject({ score: 90, why: { keywordPoints: 30 } });
    expect(scoreJob(job({ description: "crypto payments" }), three)).toMatchObject({ score: 80, why: { keywordPoints: 20, missing: ["kyc"] } });
    expect(scoreJob(job({ title: "Product Manager", location: "Remote - EMEA", description: "crypto" }), three).score).toBe(25 + 15 + 10 + 10);
  });

  it("with no topics, title + location + industry are scaled to 0..100", () => {
    const none = profile({ keywords: {} });
    const best = scoreJob(job(), none);
    expect(best.why).toMatchObject({ keywordPoints: 0, scale: 100 / 60 });
    expect(best.score).toBe(100);
    // Right title and place: a strong match.
    expect(scoreJob(job({ title: "Product Manager" }), none).score).toBe(Math.round((25 + 20 + 10) * (100 / 60)));
    expect(scoreJob(job({ title: "Product Manager", location: "Remote - EMEA" }), none).score).toBe(83);
    expect(scoreJob(job({ location: "London" }), none).score).toBe(0);
  });

  describe("seniority is a distance from your level", () => {
    // The helper profile's words: senior, head, group -> levels senior and leadership.
    it("+10 at your level, +5 one step away", () => {
      expect(scoreJob(job({ title: "Senior Product Manager" }), profile()).why.title).toBe(30);
      expect(scoreJob(job({ title: "Director of Product Management, Product Manager" }), profile()).why.title).toBe(30);
      // Principal sits between senior and leadership; a plain title is one below senior.
      expect(scoreJob(job({ title: "Principal Product Manager" }), profile()).why.title).toBe(25);
      expect(scoreJob(job({ title: "Product Manager" }), profile()).why.title).toBe(25);
    });

    it("nothing two or more steps away", () => {
      const senior = profile({ seniority_boost: ["senior"] });
      expect(scoreJob(job({ title: "Director, Product Manager" }), senior).why.title).toBe(20);
      expect(scoreJob(job({ title: "Junior Product Manager" }), senior).why.title).toBe(20);
      expect(scoreJob(job({ title: "Staff Product Manager" }), senior).why.title).toBe(25);
    });

    it("words with no level only count as words, and no words add nothing", () => {
      expect(scoreJob(job({ title: "Product Manager" }), profile({ seniority_boost: ["group"] })).why.title).toBe(20);
      expect(scoreJob(job({ title: "Group Product Manager" }), profile({ seniority_boost: ["group"] })).why.title).toBe(30);
      expect(scoreJob(job({ title: "Product Manager" }), profile({ seniority_boost: [] })).why.title).toBe(20);
    });
  });

  it("caps keyword points at 40", () => {
    const heavy = profile({ keywords: { crypto: 5, tokenization: 5, stablecoin: 5, exchange: 5, payments: 5, fintech: 5, ai: 5, kyc: 5, defi: 5 } });
    const r = scoreJob(job({ description: "crypto tokenization stablecoin exchange payments fintech ai kyc defi" }), heavy);
    expect(r.why.keywordPoints).toBe(40);
    expect(r.score).toBe(100);
  });

  it("scores 0 with gate=title when the title misses include or hits exclude", () => {
    expect(scoreJob(job({ title: "Software Engineer" }), profile())).toMatchObject({ score: 0, why: { gate: "title" } });
    expect(scoreJob(job({ title: "Senior Product Marketing Manager" }), profile())).toMatchObject({
      score: 0,
      why: { gate: "title" },
    });
  });

  it("scores 0 with gate=location when the location doesn't fit", () => {
    expect(scoreJob(job({ location: "London" }), profile())).toMatchObject({ score: 0, why: { gate: "location" } });
  });

  it("accepts remote regions but not excluded ones", () => {
    expect(scoreJob(job({ location: "Remote - EMEA" }), profile()).why.location).toBe(15);
    expect(scoreJob(job({ location: "Remote (US)" }), profile()).why.gate).toBe("location");
    expect(scoreJob(job({ location: "SF, NYC, Remote (US)" }), profile()).why.gate).toBe("location");
  });

  it("an included city wins even if an excluded region is also listed", () => {
    expect(scoreJob(job({ location: "Dubai; Remote (US)" }), profile()).why.location).toBe(20);
  });

  it("treats workplace=remote as remote even when the location text doesn't say so", () => {
    expect(scoreJob(job({ location: "", workplace: "remote" }), profile()).why.location).toBe(15);
    expect(scoreJob(job({ location: "Canada", workplace: "remote" }), profile()).why.gate).toBe("location");
  });

  it("industry: 10 yours or one of your companies, 5 not known, 0 another one; full when you picked none", () => {
    const fintech = profile({ industries: ["payments", "crypto"] });
    const industry = (fit: Parameters<typeof scoreJob>[2]) => scoreJob(job(), fintech, fit).why.industry;
    expect(industry({ industries: ["payments"] })).toBe(10);
    expect(industry({ industries: ["health"] })).toBe(0);
    expect(industry({ industries: [] })).toBe(5);
    expect(industry({})).toBe(5);
    expect(industry({ industries: ["health"], tracked: true })).toBe(10);
    expect(scoreJob(job(), profile(), { industries: ["health"] }).why.industry).toBe(10);
  });

  it("the score is fit only: the same job scores the same whenever it was posted", () => {
    const a = scoreJob({ ...job(), postedAt: daysAgo(0) } as ReturnType<typeof job>, profile());
    const b = scoreJob({ ...job(), postedAt: daysAgo(90) } as ReturnType<typeof job>, profile());
    expect(a).toEqual(b);
    expect(a.why.freshness).toBeUndefined();
  });

  it("your industries add their topics at a low weight, so a payments role counts for a crypto-topic profile", () => {
    const crypto = profile({ keywords: { crypto: 5, defi: 4, web3: 4 }, industries: ["crypto", "payments"] });
    expect(topicsOf(crypto)).toMatchObject({ crypto: 5, payments: 2, merchant: 2 });
    const r = scoreJob(job({ title: "VP Product (Payments)" }), crypto);
    expect(r.why.keywords).toEqual(["payments"]);
    expect(r.why.keywordPoints).toBeGreaterThan(0);
    // Together they're a lift, never a full bar: at most two topics' worth of weight.
    const full = scoreJob(job({ description: "payments checkout merchant acquiring issuing remittance" }), crypto);
    expect(full.why.keywordPoints).toBe(Math.round((40 * 4 * 10) / 12) / 10);
    // Topics you listed keep your weight, and with no topics of your own none are added.
    expect(topicsOf(profile({ keywords: { payments: 5 }, industries: ["payments"] })).payments).toBe(5);
    expect(topicsOf(profile({ keywords: {}, industries: ["payments"] }))).toEqual({});
  });
});

describe("location: only places the user picked", () => {
  // Like the real profile that leaked: UAE, UK, US, Ireland, plus remote in a few regions and plain "remote".
  const wide = profile({
    locations: {
      include: ["dubai", "uae", "united arab emirates", "emirates", "united kingdom", "uk", "wales", "london", "united states", "us", "america", "new york", "ireland"],
      remote_ok: ["emea", "mena", "gcc", "europe", "eu", "anywhere", "worldwide", "global", "remote"],
      remote_exclude: [],
    },
  });
  const loc = (location: string, workplace: "onsite" | "remote" | "hybrid" | "unknown" = "remote", p = wide) => scoreJob(job({ location, workplace }), p).why;

  it.each(["India", "Asia; Hong Kong; Taiwan, Taipei", "Portugal", "Argentina", "Remote, Ontario; Remote, British Columbia", "AMER - Remote", "LatAm", "Chennai or Remote, India", "Bogota"])(
    "drops remote jobs tied to somewhere else: %s",
    (where) => expect(loc(where).gate).toBe("location"),
  );

  it("explains why, naming the place", () => {
    expect(loc("Chennai or Remote, India").locationNote).toBe("Remote, but only in India: not one of your places.");
    expect(loc("AMER - Remote").locationNote).toBe("Remote, but only in Americas: not one of your places.");
    expect(loc("Remote (async)", "unknown").locationNote).toMatch(/limited to "async"/);
    expect(loc("Berlin", "onsite").locationNote).toBeUndefined();
  });

  it.each([
    ["Remote", 15],
    ["Fully remote, any time zone", 15],
    ["Remote - EMEA", 15],
    ["Remote - Global", 15],
    ["Amsterdam, Netherlands; Remote - Europe", 15],
    ["Remote (US)", 20],
    ["Dubai", 20],
    ["London, England, United Kingdom", 20],
  ] as const)("keeps %s", (where, points) => expect(loc(where).location).toBe(points));

  it("lets the longest place name win", () => {
    expect(loc("North America", "onsite").gate).toBe("location"); // not "america"
    expect(loc("Sydney, New South Wales", "onsite").gate).toBe("location"); // not "wales"
    expect(loc("Cardiff, Wales", "onsite").location).toBe(20);
    const york = profile({ locations: { include: ["york"], remote_ok: [], remote_exclude: [] } });
    expect(loc("New York, NY", "onsite", york).gate).toBe("location");
    expect(loc("York, England", "onsite", york).location).toBe(20);
    // Names of the same place never hide each other.
    const emirates = profile({ locations: { include: ["emirates"], remote_ok: [], remote_exclude: [] } });
    expect(loc("Abu Dhabi, United Arab Emirates", "onsite", emirates).location).toBe(20);
  });

  it("counts states, provinces, their codes and U.S. spellings for a country the user picked", () => {
    for (const where of ["Santa Monica, CA/Remote", "California", "Remote-Friendly | Washington, DC (Washington, D.C.)", "U.S. Remote", "AMER - Remote (Tampa, FL)"]) {
      expect(loc(where).location).toBe(20);
    }
    // Canada wasn't picked, so its provinces still don't count.
    expect(loc("Remote, Ontario; Remote, British Columbia").gate).toBe("location");
    const canada = profile({ locations: { include: ["canada"], remote_ok: [], remote_exclude: [] } });
    expect(loc("Remote, Ontario", "remote", canada).location).toBe(20);
    expect(loc("Toronto, ON", "onsite", canada).location).toBe(20);
    // Codes count only in capitals after a comma or bracket.
    expect(loc("Dubai, ca", "onsite", canada).gate).toBe("location");
  });

  it("doesn't count a picked city that the job places in another country", () => {
    const ukIe = profile({ locations: { include: ["united kingdom", "uk", "london", "cambridge", "ireland", "dublin"], remote_ok: [], remote_exclude: [] } });
    expect(loc("Cambridge, MA USA; San Francisco, CA USA", "onsite", ukIe).gate).toBe("location");
    expect(loc("London, Ontario, Canada", "onsite", ukIe).gate).toBe("location");
    expect(loc("Cambridge, England", "onsite", ukIe).location).toBe(20);
    expect(loc("Cambridge", "onsite", ukIe).location).toBe(20);
    // A place inside brackets is its own location.
    expect(loc("Amsterdam, Netherlands (London; Tel Aviv)", "onsite", ukIe).location).toBe(20);
  });

  it("is strict for a UAE-only profile", () => {
    const uae = profile({ locations: { include: ["dubai", "uae", "united arab emirates"], remote_ok: ["mena", "gcc", "remote"], remote_exclude: [] } });
    expect(loc("U.S. Remote", "remote", uae).gate).toBe("location");
    expect(loc("Santa Monica, CA/Remote", "remote", uae).gate).toBe("location");
    expect(loc("Remote - GCC", "remote", uae).location).toBe(15);
    expect(loc("Remote", "remote", uae).location).toBe(15);
  });

  it("an office job counts for a remote region only when the region is a part of its location", () => {
    const emea = profile({ locations: { include: ["dubai"], remote_ok: ["remote", "eu", "gulf", "europe"], remote_exclude: [] } });
    expect(locationFit("FXE-EU/GBR/Stansted", emea).points).toBe(0);
    expect(locationFit("Holmes Beach - Gulf", emea).points).toBe(0);
    expect(locationFit("Dubai - Gulf", emea).points).toBe(20);
    expect(locationFit("Berlin - Europe", emea).points).toBe(15);
    expect(locationFit("FRA - Bois-Colombes, 17 Avenue de l'Europe", emea).points).toBe(0);
    expect(locationFit("Europe (Hybrid)", emea).points).toBe(15);
    expect(locationFit("Home based - Europe", emea).points).toBe(15);
    expect(locationFit("EU > BEL > Antwerp", emea).points).toBe(15);
    expect(locationFit("Stein, EU", emea).points).toBe(15);
    expect(locationFit("Novi Sad, South Backa, Serbia, Europe", emea).points).toBe(15);
    expect(locationFit("Remote - EU", emea).points).toBe(15);
  });

  it("still honours remote exclusions, and needs plain remote to be allowed", () => {
    const noUs = profile({ locations: { include: [], remote_ok: ["remote", "emea"], remote_exclude: ["emea"] } });
    expect(loc("Remote - EMEA", "remote", noUs).gate).toBe("location");
    const regionsOnly = profile({ locations: { include: [], remote_ok: ["emea"], remote_exclude: [] } });
    expect(loc("Remote", "remote", regionsOnly).gate).toBe("location");
    expect(loc("Remote - EMEA", "remote", regionsOnly).location).toBe(15);
  });
});

describe("rankScore", () => {
  const t = now.getTime();
  it("adds freshness that halves every three days, and a nudge for your companies", () => {
    expect(rankScore(60, daysAgo(0), t)).toBe(75);
    expect(rankScore(60, daysAgo(3), t)).toBeCloseTo(67.5);
    expect(rankScore(60, daysAgo(6), t)).toBeCloseTo(63.75);
    expect(rankScore(60, daysAgo(0), t, true)).toBe(85);
    expect(rankScore(60, undefined, t)).toBe(60);
    // A date in the future counts as today.
    expect(rankScore(60, daysAgo(-2), t)).toBe(75);
  });

  it("a fresh fit beats an older equal one, but a weak fresh job never leaps a strong one", () => {
    expect(rankScore(60, daysAgo(0.4), t)).toBeGreaterThan(rankScore(60, daysAgo(3), t, false));
    expect(rankScore(45, daysAgo(0), t)).toBeLessThan(rankScore(70, daysAgo(10), t));
  });

  it("takes a little off postings older than a month, up to 12 points", () => {
    expect(rankScore(60, daysAgo(30), t)).toBeCloseTo(60, 0);
    expect(rankScore(60, daysAgo(70), t)).toBeCloseTo(54, 1);
    expect(rankScore(60, daysAgo(200), t)).toBeCloseTo(48, 1);
    // A month-old job a few points better no longer beats a 5-month-old one only by being better.
    expect(rankScore(70, daysAgo(5), t)).toBeGreaterThan(rankScore(75, daysAgo(150), t));
  });
});

describe("scoreJob requirements", () => {
  const desc = (nice: string, must = "Payments experience") => `What you'll do\n- Build the product\n\nRequirements\n- 5+ years of product management\n- ${must}\n\nNice to have\n- ${nice}`;

  it("counts a topic named only among the nice-to-haves at half", () => {
    const p = profile({ keywords: { payments: 3, kyc: 3 } });
    const must = scoreJob(job({ description: desc("SQL", "Payments and KYC experience") }), p);
    const nice = scoreJob(job({ description: desc("KYC") }), p);
    expect(nice.why.keywords).toContain("kyc");
    expect(nice.why.keywordPoints).toBeLessThan(must.why.keywordPoints);
  });

  it("says how many checkable must-haves name your topics", () => {
    const s = scoreJob(job({ description: desc("SQL") }), profile({ keywords: { payments: 3 } }));
    // SQL is a word RawJobs knows (catalog/concepts.ts), so its line can be checked too: it isn't yours.
    expect(s.why.musts).toEqual({ met: 1, of: 2 });
    expect(s.why.checks).toContainEqual({ id: "musts", status: "near", note: "Names 1 of 2 must-haves you can check" });
    // With no topics of your own there's nothing to check them against.
    expect(scoreJob(job({ description: desc("SQL") }), profile({ keywords: {} })).why.musts).toBeUndefined();
  });

  it("checks the years asked against yours, and takes points off past one year short", () => {
    const d = desc("SQL");
    expect(scoreJob(job({ description: d }), profile()).why.checks).toContainEqual(expect.objectContaining({ id: "experience", status: "unknown" }));
    const met = scoreJob(job({ description: d }), profile({ experience_years: 6 }));
    const near = scoreJob(job({ description: d }), profile({ experience_years: 4 }));
    const far = scoreJob(job({ description: d }), profile({ experience_years: 2 }));
    expect(met.why.checks).toContainEqual({ id: "experience", status: "met", note: "Asks for 5+ years; you have 6" });
    expect(near.score).toBe(met.score);
    expect(far.why.checks).toContainEqual(expect.objectContaining({ id: "experience", status: "missed" }));
    expect(far.why.yearsGap).toBe(6);
    expect(far.why.level).toBe(5);
    expect(far.score).toBeLessThan(met.score - 10);
  });

  it("counts unknown topics as part of the bar when there's no description", () => {
    const p = profile();
    expect(scoreJob(job({ title: "Senior Product Manager" }), p).why.keywordPoints).toBe(15);
    expect(scoreJob(job({ title: "Senior Product Manager, Payments" }), p).why.keywordPoints).toBe(21);
    // A described job that names your topics still beats one with no description.
    expect(scoreJob(job({ description: "Payments, crypto and stablecoin work on our exchange, tokenization of fintech." }), p).score).toBeGreaterThan(scoreJob(job(), p).score);
  });
});
