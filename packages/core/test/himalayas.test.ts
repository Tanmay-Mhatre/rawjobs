import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp, json } from "./helpers";

const job = (n: number, extra: Record<string, unknown> = {}) => ({
  title: `Principal Product Manager ${n} `,
  companyName: "Legion ",
  employmentType: "Full Time",
  minSalary: 280000,
  maxSalary: 300000,
  salaryPeriod: "annual",
  currency: "USD",
  locationRestrictions: ["United States"],
  parentCategories: ["Product"],
  pubDate: 1791907647,
  applicationLink: `https://himalayas.app/companies/legion/jobs/principal-product-manager-${n}`,
  description: "<p>Own the <b>roadmap</b>.</p>",
  ...extra,
});

async function run(slug: string, route: (url: string) => Response) {
  const { http, calls } = fakeHttp(route);
  const c = getConnector("himalayas")!;
  const r = { name: "Himalayas", enabled: true, ats: "himalayas", slug } as CompanyRef;
  const jobs = (await c.fetch(r, { http, now: new Date() })).map((x) => c.normalize(x, r));
  return { jobs, calls, c };
}

describe("himalayas", () => {
  it("searches newest-first for the slug's phrase, crediting and linking every job back to Himalayas", async () => {
    const { jobs, calls } = await run("product manager", (url) => json({ jobs: url.endsWith("page=1") ? [job(1), job(2, { locationRestrictions: [], minSalary: null, maxSalary: null })] : [] }));
    expect(calls).toEqual(["https://himalayas.app/jobs/api/search?q=product%20manager&sort=recent&page=1", "https://himalayas.app/jobs/api/search?q=product%20manager&sort=recent&page=2"]);
    expect(jobs[0]).toMatchObject({
      id: "himalayas:product manager:companies/legion/jobs/principal-product-manager-1",
      company: "Legion",
      title: "Principal Product Manager 1",
      location: "Remote (United States)",
      country: "United States",
      workplace: "remote",
      department: "Product",
      salary: { min: 280000, max: 300000, currency: "USD", period: "year" },
      postedAt: new Date(1791907647 * 1000).toISOString(),
      url: "https://himalayas.app/companies/legion/jobs/principal-product-manager-1",
      description: "Own the roadmap.",
    });
    expect(jobs[1]).toMatchObject({ location: "Remote" });
    expect(jobs[1]!.salary).toBeUndefined();
  });

  it('reads the newest jobs with the cursor for "all", and asks at most once a day', async () => {
    const { jobs, calls, c } = await run("all", (url) => json(url.includes("cursor=") ? { jobs: [job(3)] } : { jobs: [job(1), job(2)], nextCursor: "abc=" }));
    expect(calls).toEqual(["https://himalayas.app/jobs/api?limit=20", "https://himalayas.app/jobs/api?limit=20&cursor=abc%3D"]);
    expect(jobs).toHaveLength(3);
    expect(c.minIntervalHours).toBe(24);
    expect(c.label).toBe("Himalayas");
  });

  it("is added from a himalayas.app link, a search link keeping its phrase", () => {
    expect(detectCompany("https://himalayas.app/jobs?q=Product%20Manager")).toMatchObject({ ats: "himalayas", slug: "product manager", supported: true });
    expect(detectCompany("https://himalayas.app/")).toMatchObject({ ats: "himalayas", slug: "all" });
  });
});
