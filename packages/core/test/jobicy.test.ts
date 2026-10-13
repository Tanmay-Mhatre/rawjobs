import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp, json } from "./helpers";

const job = {
  id: 155217,
  url: "https://jobicy.com/jobs/155217-business-development-representative-dutch-speaker",
  jobTitle: "Business Development Representative &#8211; Dutch Speaker",
  companyName: "Algolia",
  jobIndustry: ["Business Development"],
  jobGeo: "France",
  pubDate: "2026-10-13T11:55:03+00:00",
  salaryMin: 51000,
  salaryMax: 67000,
  salaryCurrency: "EUR",
  salaryPeriod: "yearly",
  jobDescription: "<p>Grow <b>accounts</b>.</p>",
};

describe("jobicy", () => {
  it("reads the newest 100 jobs for a tag, linking and crediting each to Jobicy", async () => {
    const { http, calls } = fakeHttp(() => json({ success: true, jobs: [job, { ...job, id: 2, jobGeo: "Anywhere", salaryMin: null, salaryMax: null }] }));
    const c = getConnector("jobicy")!;
    const r = { name: "Jobicy", enabled: true, ats: "jobicy", slug: "business development" } as CompanyRef;
    const jobs = (await c.fetch(r, { http, now: new Date() })).map((x) => c.normalize(x, r));
    expect(calls).toEqual(["https://jobicy.com/api/v2/remote-jobs?count=100&tag=business%20development"]);
    expect(jobs[0]).toMatchObject({
      id: "jobicy:business development:155217",
      company: "Algolia",
      title: "Business Development Representative – Dutch Speaker",
      location: "Remote (France)",
      workplace: "remote",
      department: "Business Development",
      salary: { min: 51000, max: 67000, currency: "EUR", period: "year" },
      postedAt: "2026-10-13T11:55:03.000Z",
      url: "https://jobicy.com/jobs/155217-business-development-representative-dutch-speaker",
      description: "Grow accounts.",
    });
    expect(jobs[1]).toMatchObject({ location: "Remote" });
    expect(c.label).toBe("Jobicy");
  });

  it("is added from a jobicy.com link, a search keeping its keywords", () => {
    expect(detectCompany("https://jobicy.com/?search_keywords=Product+Manager")).toMatchObject({ ats: "jobicy", slug: "product manager", supported: true });
    expect(detectCompany("https://jobicy.com/")).toMatchObject({ slug: "all" });
  });
});
