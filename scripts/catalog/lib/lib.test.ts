import { describe, expect, it } from "vitest";
import { chao2 } from "./estimate";
import { sameCompany, slugCandidates } from "./slugs";
import { BoardSet, boardFromUrl } from "./url-boards";

describe("boardFromUrl", () => {
  it("reduces crawled URLs to boards", () => {
    expect(boardFromUrl("https://job-boards.greenhouse.io/acme/jobs/123?gh_src=x")).toEqual({ ats: "greenhouse", slug: "acme" });
    expect(boardFromUrl("https://boards-api.greenhouse.io/v1/boards/acme/jobs")).toEqual({ ats: "greenhouse", slug: "acme" });
    expect(boardFromUrl("https://jobs.eu.lever.co/acme/abc")).toEqual({ ats: "lever", slug: "acme", region: "eu" });
    expect(boardFromUrl("https://bank.wd5.myworkdayjobs.com/en-US/Careers/job/x")).toEqual({ ats: "workday", slug: "bank", shard: "wd5", site: "Careers" });
    expect(boardFromUrl("https://apply.workable.com/acme/j/ABC123")).toEqual({ ats: "workable", slug: "acme" });
    expect(boardFromUrl("https://aa010.taleo.net/careersection/swd_external/jobdetail.ftl?job=1")).toEqual({ ats: "taleo", slug: "aa010", site: "swd_external" });
    expect(boardFromUrl("https://career2.successfactors.eu/career?company=Acme")).toEqual({ ats: "successfactors", slug: "Acme", shard: "career2.successfactors.eu" });
  });
  it("drops host pages, incomplete boards and junk", () => {
    expect(boardFromUrl("https://jobs.lever.co/favicon.ico")).toBeNull();
    expect(boardFromUrl("https://jobs.ashbyhq.com/api/non-user-graphql")).toBeNull();
    expect(boardFromUrl("https://bank.wd5.myworkdayjobs.com/")).toBeNull();
    // Real Workday sites named like host pages (PayPal's is "jobs", Parsons' is "search").
    expect(boardFromUrl("https://paypal.wd1.myworkdayjobs.com/jobs")).toEqual({ ats: "workday", slug: "paypal", shard: "wd1", site: "jobs" });
    expect(boardFromUrl("https://parsons.wd5.myworkdayjobs.com/search")).toEqual({ ats: "workday", slug: "parsons", shard: "wd5", site: "search" });
    expect(boardFromUrl("https://bank.wd5.myworkdayjobs.com/robots.txt")).toBeNull();
    expect(boardFromUrl("https://wd1.myworkdaysite.com/recruiting/bank/External")).toEqual({ ats: "workday", slug: "bank", shard: "wd1", site: "External" });
    expect(boardFromUrl("https://acme.zohorecruit.eu/jobs/Careers")).toEqual({ ats: "zoho", slug: "acme", shard: "eu", site: "Careers" });
    // A Taleo pod without a career section isn't one company's board.
    expect(boardFromUrl("https://aa010.taleo.net/smartorg/smartorg/common/toc.jsf")).toBeNull();
    expect(boardFromUrl("https://jobs.lever.co/acme%22%3E")).toBeNull();
  });
  it("records which crawls saw each board, merging with earlier runs", () => {
    const set = new BoardSet([{ ats: "lever", slug: "acme", seen: ["CC-1"] }]);
    set.add("https://jobs.lever.co/acme/1", "CC-2");
    set.add("https://jobs.lever.co/acme/2", "CC-2");
    set.add("https://example.com/", "CC-2");
    expect(set.list()).toEqual([{ ats: "lever", slug: "acme", seen: ["CC-1", "CC-2"] }]);
  });
});

describe("chao2", () => {
  it("adds the unseen share from singletons vs doubletons", () => {
    // 10 boards: 4 seen once, 2 twice, 4 by three families; 3 families.
    const r = chao2([1, 1, 1, 1, 2, 2, 3, 3, 3, 3], 3);
    expect(r).toMatchObject({ observed: 10, q1: 4, q2: 2 });
    expect(r.estimate).toBe(10 + Math.round(((2 / 3) * 16) / 4));
  });
  it("handles no doubletons and full agreement", () => {
    expect(chao2([1, 1, 3], 3).estimate).toBe(3 + Math.round((2 / 3) * 1));
    expect(chao2([3, 3, 3], 3).estimate).toBe(3);
  });
});

describe("slugCandidates", () => {
  it("tries the known slug, then name forms", () => {
    expect(slugCandidates("Acme Labs, Inc.", "acmelabs")).toEqual(["acmelabs", "acme-labs", "acme", "acmehq", "acmeinc"]);
    expect(slugCandidates("Crypto.com")).toContain("crypto");
    expect(slugCandidates("!!")).toEqual([]);
  });
});

describe("sameCompany", () => {
  it("matches names that differ only in suffixes or spacing", () => {
    expect(sameCompany("Acme Labs, Inc.", "acme")).toBe(true);
    expect(sameCompany("DoorDash", "Door Dash")).toBe(true);
    expect(sameCompany("Stripe", "Stripe Payments Europe")).toBe(true);
  });
  it("rejects short or partial matches", () => {
    expect(sameCompany("Rain", "Rain Industries")).toBe(false);
    expect(sameCompany("Kraken", "Kraken Robotics")).toBe(true); // whole-word match ≥ 5 letters: needs a second check
    expect(sameCompany("Ramp", "Rampart Security")).toBe(false);
    expect(sameCompany("Acme", undefined)).toBe(false);
  });
});

describe("universe", () => {
  it("measures sample coverage on URL sources only, and lists unique boards per source", async () => {
    const { universe } = await import("./universe");
    const boards = [
      { key: "lever:a", ats: "lever", families: ["latmay", "kalil"] },
      { key: "lever:b", ats: "lever", families: ["latmay"] },
      { key: "lever:c", ats: "lever", families: ["seeds"] },
      { key: "lever:d", ats: "lever", families: ["kalil"] },
    ];
    const status = new Map([
      ["lever:a", "live"],
      ["lever:b", "live"],
      ["lever:c", "live"],
      ["lever:d", "dead"],
    ]);
    const u = universe({ boards, status, sample: ["lever:a", "lever:c", "lever:d"], restrictedOnly: { lever: 5 } });
    const lever = u.rows.find((r) => r.ats === "lever")!;
    // d is dead so it's out of the sample; c was only found company-first.
    expect(lever).toMatchObject({ ours: 3, sampleBoards: 2, sampleKnown: 1, restrictedOnly: 5 });
    expect(lever.estimate).toBeGreaterThanOrEqual(3);
    expect(u.holdOut).toEqual([
      { family: "latmay", boards: 2, unique: 1 },
      { family: "kalil", boards: 1, unique: 0 },
    ]);
  });
});
