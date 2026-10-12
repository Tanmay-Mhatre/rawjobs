import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { matchesTitle, mayMatchTitle } from "../src/text";

/**
 * 12,449 real job titles from the shared job feed (2026-10-09), weighted toward tricky ones: punctuation,
 * slashes, abbreviations, times of day. The quick check must never rule out a title the full reading accepts.
 */
const TITLES = gunzipSync(readFileSync(new URL("./fixtures/job-titles.txt.gz", import.meta.url)))
  .toString("utf8")
  .split("\n")
  .filter(Boolean);

const PROFILES: string[][] = [
  ["product manager", "head of product", "product lead", "group product", "director of product"],
  ["software engineer", "backend engineer", "full stack"],
  ["data scientist", "machine learning engineer"],
  ["product designer", "ux designer"],
  ["account executive", "sales manager"],
  ["devops", "site reliability engineer", "platform engineer"],
  ["frontend engineer", "react developer"],
  ["marketing manager", "growth"],
  ["Sr. PM", "SWE", "VP Eng"],
  ["front end developer", "c++ developer", "c#"],
  ["ux/ui designer", "ui designer"],
  ["engineering manager", "head of engineering", "eng manager"],
  ["designers", "analysts"],
  ["nurse", "registered nurse"],
  ["accountant", "controller", "cfo"],
  ["business development", "bizdev"],
  ["qa engineer", "test automation"],
  ["recruiter", "talent acquisition"],
  ["chief of staff"],
  ["solutions architect", "solution engineer"],
  ["customer success manager", "csm"],
  ["ml engineer", "ai engineer"],
];

describe("mayMatchTitle (the quick check before matchesTitle)", () => {
  it("never rules out a title the full reading accepts, on real titles", () => {
    expect(TITLES.length).toBeGreaterThan(10_000);
    for (const terms of PROFILES) {
      const dropped = TITLES.filter((t) => matchesTitle(t, terms) && !mayMatchTitle(t, terms));
      expect(dropped, JSON.stringify(terms)).toEqual([]);
    }
  });

  it("rules out most titles, which is the point", () => {
    const terms = PROFILES[0]!;
    const kept = TITLES.filter((t) => mayMatchTitle(t, terms)).length;
    expect(kept / TITLES.length).toBeLessThan(0.1);
  });

  it("keeps titles split by punctuation, abbreviations and glued symbols", () => {
    expect(mayMatchTitle("Sr.Product Manager – Commerce Growth", ["product manager"])).toBe(true);
    expect(mayMatchTitle("01.Backend Engineer", ["backend engineer"])).toBe(true);
    expect(mayMatchTitle("Senior PM, Payments", ["product manager"])).toBe(true);
    expect(mayMatchTitle("C/C++Software Engineer", ["software engineer"])).toBe(true);
    expect(mayMatchTitle("VP Eng", ["head of engineering", "vice president of engineering"])).toBe(true);
    expect(mayMatchTitle("Barista", ["product manager"])).toBe(false);
  });
});

describe("times of day aren't the PM title", () => {
  it("'3:00 P.M.' and '7 pm' don't read as product manager; 'PM' and 'Sr. PM' still do", () => {
    expect(matchesTitle("2nd Shift Machine Operator 03:00 P.M. - 11:30 P.M.", ["product manager"])).toBe(false);
    expect(matchesTitle("Cook – Full-Time | 10:30 a.m.–7 p.m.", ["product manager"])).toBe(false);
    expect(matchesTitle("Night Cleaner 11pm - 7am", ["product manager"])).toBe(false);
    expect(matchesTitle("Senior PM, Payments", ["product manager"])).toBe(true);
    expect(matchesTitle("Sr. PM", ["product manager"])).toBe(true);
  });
});
