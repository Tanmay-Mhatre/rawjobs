import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadSet } from "../eval/lib";
import { scoreJob } from "../src/score";

describe("scoreJob on the eval set", () => {
  const set = loadSet();
  const scored = set.profiles.flatMap((p) =>
    set.jobs.map((j) => ({ pair: `${p.id} × ${j.id}`, job: j, profile: p.profile, ...scoreJob(j, p.profile, j.industries ? { industries: j.industries } : {}) })),
  );

  it("scores every job that passes the title gate exactly as before (score and the whole why)", () => {
    const passing = scored.filter((s) => s.why.gate !== "title");
    expect(passing.length).toBeGreaterThan(0);
    // A hash of each why keeps the snapshot small; any change to a passing job's score or why shows here.
    expect(Object.fromEntries(passing.map((s) => [s.pair, `${s.score} ${createHash("sha1").update(JSON.stringify(s.why)).digest("hex")}`]))).toMatchSnapshot();
  });

  it("gives a title-gated job 0 and its title's topics only, without reading the description", () => {
    const gated = scored.filter((s) => s.why.gate === "title");
    expect(gated.length).toBeGreaterThan(0);
    for (const s of gated) {
      expect(s.score).toBe(0);
      const titleOnly = scoreJob({ ...s.job, description: undefined }, s.profile, s.job.industries ? { industries: s.job.industries } : {});
      expect(s.why.keywords, s.pair).toEqual(titleOnly.why.keywords);
      expect(s.why.musts).toBeUndefined();
      expect(s.why.years).toBeUndefined();
    }
  });
});
