// The scoring demo's rules: packages/core/src/score.ts cut down to the one example job on the page.
// build.mjs inlines this file into the page (without the `export`s); test/site-score.test.ts checks
// it against core's scoreJob for every choice the demo offers, so the two can't drift apart.

/** The example job in the demo. */
export const DEMO_JOB = {
  title: "Head of Product, Exchange",
  location: "Dubai, Abu Dhabi",
  workplace: "hybrid",
  description: "Own the roadmap for our regulated crypto exchange: spot trading, custody and tokenization of real-world assets. You'll work with compliance on KYC and launch new markets.",
};

/** The title's level (Head) against your seniority word: same level +10, one level away (Lead) +5. */
export const SENIORITY_POINTS = { head: 10, lead: 5, "": 0 };
/** Your industry 10, not known 5, another one 0. */
export const INDUSTRY_POINTS = { mine: 10, unknown: 5, other: 0 };

/**
 * state: { titles: string[], seniority: "head" | "lead" | "", places: string[], kw: string[], industry: "mine" | "unknown" | "other" }
 * Every keyword has weight 4, so three matches fill the bar.
 * Returns { gated: "title" | "place" } or { total, t, p, k, i, matched, noKw }.
 */
export function demoScore(state, job) {
  job = job || DEMO_JOB;
  var word = function (hay, term) {
    return new RegExp("(^|[^\\p{L}\\p{N}])" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^\\p{L}\\p{N}])", "iu").test(hay);
  };
  if (
    !state.titles.some(function (t) {
      return word(job.title, t);
    })
  )
    return { gated: "title" };
  var placeHit = state.places.some(function (p) {
    return p !== "remote" && word(job.location, p);
  });
  var remoteHit = job.workplace === "remote" && state.places.indexOf("remote") > -1;
  if (!placeHit && !remoteHit) return { gated: "place" };
  var t = 20 + SENIORITY_POINTS[state.seniority];
  var p = placeHit ? 20 : 15;
  var i = INDUSTRY_POINTS[state.industry];
  if (!state.kw.length) {
    /* no keywords: title + place + industry, out of 60, scaled to 0..100 */
    return { total: Math.min(100, Math.round((t + p + i) * (100 / 60))), t: t, p: p, k: 0, i: i, matched: [], noKw: true };
  }
  var W = 4;
  /* equal weights, so core lists them alphabetically */
  var matched = state.kw
    .filter(function (k) {
      return word(job.title, k) || word(job.description, k);
    })
    .sort();
  var inTitle = matched.filter(function (k) {
    return word(job.title, k);
  });
  var k = Math.max(
    Math.round(40 * Math.min(1, (matched.length * W) / Math.min(state.kw.length * W, 12))),
    /* a keyword in the title is worth up to 20 on its own: 20 x its weight / your largest weight */
    Math.round(20 * Math.min(1, (inTitle.length * W) / W)),
  );
  return { total: Math.min(100, t + p + k + i), t: t, p: p, k: k, i: i, matched: matched };
}
