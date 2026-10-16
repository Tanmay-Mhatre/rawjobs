import { describe, expect, it } from "vitest";
import { demoScore, DEMO_JOB, type DemoState } from "../../../apps/site/src/score.js";
import { ProfileSchema } from "../src/schema";
import { scoreJob } from "../src/score";

// The site's scoring demo (apps/site/src/score.js) must give the same answer as core for every
// choice it offers. Industry "demo" is a made-up id, so it adds no topics of its own.
const TITLES = ["head of product", "product manager", "engineering manager"];
const PLACES = ["dubai", "london", "remote"];
const KEYWORDS = ["crypto", "exchange", "tokenization", "payments", "ai"];
const subsets = <T>(xs: T[]): T[][] => xs.reduce<T[][]>((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);

function core(s: DemoState) {
  const profile = ProfileSchema.parse({
    titles: { include: s.titles.length ? s.titles : ["nothing like this"] },
    seniority_boost: s.seniority ? [s.seniority] : [],
    locations: { include: s.places.filter((p) => p !== "remote"), remote_ok: s.places.filter((p) => p === "remote") },
    industries: ["demo"],
    keywords: Object.fromEntries(s.kw.map((k) => [k, 4])),
  });
  const company = s.industry === "mine" ? { industries: ["demo"] } : s.industry === "other" ? { industries: ["other"] } : {};
  return scoreJob({ ...DEMO_JOB }, profile, company);
}

function expectSame(s: DemoState) {
  const site = demoScore(s);
  const { score, why } = core(s);
  if (site.gated) {
    expect(score, JSON.stringify(s)).toBe(0);
    expect(why.gate, JSON.stringify(s)).toBe(site.gated === "place" ? "location" : "title");
    return;
  }
  expect(why.gate, JSON.stringify(s)).toBeUndefined();
  expect({ total: site.total, t: site.t, p: site.p, k: site.k, i: site.i, matched: site.matched }, JSON.stringify(s)).toEqual({
    total: score,
    t: why.title,
    p: why.location,
    k: why.keywordPoints,
    i: why.industry,
    matched: why.keywords,
  });
}

const DEFAULT: DemoState = { titles: ["head of product", "product manager"], seniority: "head", places: ["dubai", "remote"], kw: ["crypto", "exchange", "payments", "ai"], industry: "mine" };

describe("site scoring demo", () => {
  it("starts at the score the page shows", () => {
    expect(demoScore(DEFAULT)).toMatchObject({ total: 83, t: 30, p: 20, k: 23.3, i: 10 });
    expectSame(DEFAULT);
  });

  it("matches core for every keyword, seniority and industry choice", () => {
    for (const kw of subsets(KEYWORDS))
      for (const seniority of ["head", "lead", ""] as const) for (const industry of ["mine", "unknown", "other"] as const) expectSame({ ...DEFAULT, kw, seniority, industry });
  });

  it("matches core's title and place gates", () => {
    for (const titles of subsets(TITLES)) for (const places of subsets(PLACES)) expectSame({ ...DEFAULT, titles, places });
  });
});
