import type { CompanyCheck } from "@rawjobs/core/protocol";
import { describe, expect, it } from "vitest";
import { judgeLink, sameName } from "../src/lib/updateLink";

const check = (patch: Partial<CompanyCheck>): CompanyCheck => ({
  input: "https://jobs.ashbyhq.com/deribit",
  status: "live",
  ats: "ashby",
  slug: "deribit",
  careers_url: "https://jobs.ashbyhq.com/deribit",
  open_jobs: 14,
  ...patch,
});
const opts = { name: "Deribit", oldKey: "lever:deribit", yours: new Map([["greenhouse:acme", "Acme"]]) };

describe("sameName", () => {
  it("ignores case, punctuation and extra words after the name", () => {
    expect(sameName("Deribit, Inc.", "deribit")).toBe(true);
    expect(sameName("Deribit Careers", "Deribit")).toBe(true);
    expect(sameName("Deribitz", "Deribit")).toBe(false);
    expect(sameName("", "Deribit")).toBe(false);
  });
});

describe("judgeLink", () => {
  it("takes a live board under the company's own name", () => {
    const v = judgeLink(check({ name: "Deribit", name_source: "ats" }), opts);
    expect(v).toMatchObject({ kind: "ok", to: { name: "Deribit", ats: "ashby", slug: "deribit", careers_url: "https://jobs.ashbyhq.com/deribit" } });
    expect(v.kind === "ok" && v.otherName).toBeFalsy();
  });

  it("warns when the board's own name is another company's, but not for a name guessed from the link", () => {
    expect(judgeLink(check({ name: "Acme Exchange", name_source: "ats" }), opts)).toMatchObject({ kind: "ok", otherName: "Acme Exchange" });
    expect(judgeLink(check({ name: "Acme Exchange", name_source: "slug" }), opts)).not.toHaveProperty("otherName");
  });

  it("refuses the old link, one of your other companies, and links it can't use", () => {
    expect(judgeLink(check({ ats: "lever" }), opts)).toEqual({ kind: "same" });
    expect(judgeLink(check({ ats: "greenhouse", slug: "acme" }), opts)).toEqual({ kind: "yours", name: "Acme" });
    expect(judgeLink(check({ status: "unknown", ats: undefined, slug: undefined }), opts)).toEqual({ kind: "unknown" });
    expect(judgeLink(check({ status: "error", error: "HTTP 404" }), opts)).toEqual({ kind: "error", error: "HTTP 404" });
    expect(judgeLink(check({ ats: "workday", slug: "acme", shard: "wd3", status: "soon" }), opts)).toEqual({ kind: "needsSite" });
  });

  it("takes boards with no openings and systems coming soon", () => {
    expect(judgeLink(check({ status: "dormant", open_jobs: 0 }), opts).kind).toBe("ok");
    expect(judgeLink(check({ status: "soon", ats: "workday", slug: "acme", shard: "wd3", site: "External" }), opts).kind).toBe("ok");
  });
});
