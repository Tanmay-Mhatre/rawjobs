import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp, json } from "./helpers";

const text = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
const job = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: "Depot Cafe Attendant ",
  city: "Hill City",
  abbreviation: "SD",
  iso3: "USA",
  classification: "Operations",
  startDateRef: "Sep 18, 2026",
  workplaceType: "Onsite",
  payType: "Hourly",
  minSalary: "15.00",
  maxSalary: "18.50",
  jobUrl: `https://1880train.isolvedhire.com/jobs/${id}`,
  ...extra,
});

async function run(ref: Partial<CompanyRef>, route: (url: string) => Response) {
  const { http, calls } = fakeHttp(route);
  const c = getConnector("applicantpro")!;
  const r = { name: "1880 Train", enabled: true, ats: "applicantpro", slug: "1880train", shard: "isolvedhire.com", ...ref } as CompanyRef;
  const raws = await c.fetch(r, { http, now: new Date() });
  return { jobs: raws.map((x) => c.normalize(x, r)), raws, calls, c, r, http };
}

describe("applicantpro (and iSolved Hire)", () => {
  it("reads the site id off the careers page, then every job from /core/jobs, descriptions from each job page", async () => {
    const { jobs, raws, calls, c, r, http } = await run({}, (url) => {
      if (url.endsWith("/jobs/")) return text("<script>var domain_id = '11220';</script>");
      if (url.includes("/core/jobs/"))
        return json({
          success: true,
          data: { jobs: [job(1868048), job(1868049, { city: "Toronto", abbreviation: "ON", iso3: "CAN", workplaceType: "Remote", minSalary: "", maxSalary: "", payType: "Salary" })] },
        });
      return text('<script type="application/ld+json">{"@type":"JobPosting","title":"x","description":"<p>Serve <b>coffee</b>.</p>"}</script>');
    });
    expect(calls).toEqual(["https://1880train.isolvedhire.com/jobs/", "https://1880train.isolvedhire.com/core/jobs/11220?getParams=%7B%22isInternal%22%3A0%7D"]);
    expect(jobs[0]).toMatchObject({
      id: "applicantpro:1880train:1868048",
      title: "Depot Cafe Attendant",
      location: "Hill City, SD",
      country: "United States",
      workplace: "onsite",
      department: "Operations",
      salary: { min: 15, max: 18.5, currency: "USD", period: "hour" },
      postedAt: "2026-09-18T00:00:00.000Z",
      url: "https://1880train.isolvedhire.com/jobs/1868048",
    });
    expect(jobs[1]).toMatchObject({ location: "Toronto, ON, Canada, Remote", country: "Canada", workplace: "remote" });
    expect(jobs[1]!.salary).toBeUndefined();
    expect(await c.describe!(raws[0]!, r, { http, now: new Date() })).toBe("Serve coffee.");
  });

  it("uses a site id a list gave, without loading the careers page", async () => {
    const { calls } = await run({ slug: "amenair", shard: "applicantpro.com", site: "20012" }, () => json({ success: true, data: { jobs: [] } }));
    expect(calls).toEqual(["https://amenair.applicantpro.com/core/jobs/20012?getParams=%7B%22isInternal%22%3A0%7D"]);
  });

  it("says so when the account doesn't exist", async () => {
    await expect(run({}, () => text("<html>Not found</html>"))).rejects.toThrow(/not found/);
  });

  it("is recognised on both domains", () => {
    expect(detectCompany("https://1880train.isolvedhire.com/jobs/1868048")).toMatchObject({ ats: "applicantpro", slug: "1880train", shard: "isolvedhire.com", supported: true });
    expect(detectCompany("https://amenair.applicantpro.com/jobs/")).toMatchObject({ ats: "applicantpro", slug: "amenair", shard: "applicantpro.com" });
    expect(detectCompany("https://www.applicantpro.com/")).toBeNull();
  });
});
