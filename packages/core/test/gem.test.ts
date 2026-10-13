import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { checkCompanies } from "../src/setup";
import { fakeHttp, json } from "./helpers";

const body = (init?: RequestInit) => JSON.parse(String(init?.body)) as { operationName: string; variables: Record<string, string> };

describe("gem", () => {
  it("lists a board through Gem's public GraphQL, descriptions and dates from the detail query", async () => {
    const seen: { op: string; vars: Record<string, string> }[] = [];
    const { http } = fakeHttp((_url, init) => {
      const b = body(init);
      seen.push({ op: b.operationName, vars: b.variables });
      if (b.operationName === "ExternalJobPostingQuery") return json({ data: { oatsExternalJobPosting: { descriptionHtml: "<p>Close <b>deals</b>.</p>", firstPublishedTsSec: 1791000000 } } });
      return json({
        data: {
          oatsExternalJobPostings: {
            jobPostings: [
              { extId: "am9i1", title: "Account Executive (London) ", locations: [{ city: "London", isoCountry: "GBR", isRemote: false }], job: { locationType: "IN_OFFICE" } },
              { extId: "am9i2", title: "Engineer", locations: [{ city: "", isoCountry: null, isRemote: true }], job: { locationType: "REMOTE" } },
            ],
          },
        },
      });
    });
    const c = getConnector("gem")!;
    const r = { name: "11x", enabled: true, ats: "gem", slug: "11x-ai" } as CompanyRef;
    const raws = await c.fetch(r, { http, now: new Date() });
    const jobs = raws.map((x) => c.normalize(x, r));
    expect(jobs[0]).toMatchObject({
      id: "gem:11x-ai:am9i1",
      title: "Account Executive (London)",
      location: "London, United Kingdom",
      country: "United Kingdom",
      workplace: "onsite",
      url: "https://jobs.gem.com/11x-ai/am9i1",
    });
    expect(jobs[1]).toMatchObject({ location: "Remote", workplace: "remote" });
    expect(await c.describe!(raws[0]!, r, { http, now: new Date() })).toEqual({ description: "Close deals.", postedAt: "2026-10-03T04:00:00.000Z" });
    expect(seen.map((s) => [s.op, s.vars])).toEqual([
      ["JobBoardList", { boardId: "11x-ai" }],
      ["ExternalJobPostingQuery", { boardId: "11x-ai", extId: "am9i1" }],
    ]);
  });

  it("says so when Gem doesn't know the board", async () => {
    const { http } = fakeHttp(() => json({ data: { oatsExternalJobPostings: null }, errors: [{ message: "Board not found" }] }));
    await expect(getConnector("gem")!.fetch({ name: "x", enabled: true, ats: "gem", slug: "nope" } as CompanyRef, { http, now: new Date() })).rejects.toThrow(/not found/);
  });

  it("Add by link can't tell an empty Gem board from a wrong name, so it says to check the link", async () => {
    const { http } = fakeHttp(() => json({ data: { oatsExternalJobPostings: { jobPostings: [] } } }));
    const [r] = await checkCompanies(["https://jobs.gem.com/zz-made-up"], { http });
    expect(r).toMatchObject({ status: "error", error: expect.stringMatching(/Check the link: Gem/) });
  });

  it("is recognised from a board or job link", () => {
    expect(detectCompany("https://jobs.gem.com/11x-ai/am9icG9zdDq8")).toMatchObject({ ats: "gem", slug: "11x-ai", supported: true });
    expect(detectCompany("https://www.gem.com/")).toBeNull();
  });
});
