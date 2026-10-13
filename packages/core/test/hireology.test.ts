import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp, json } from "./helpers";

async function run(route: (url: string) => Response) {
  const { http, calls } = fakeHttp(route);
  const c = getConnector("hireology")!;
  const r = { name: "Al Cioni Ford", enabled: true, ats: "hireology", slug: "alcionifordinc" } as CompanyRef;
  const raws = await c.fetch(r, { http, now: new Date() });
  return { jobs: raws.map((x) => c.normalize(x, r)), calls };
}

const posting = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "careers",
  attributes: { id: Number(id), name, remote: false, "job-description": "<p>Fix <b>cars</b>.</p>", locations: ["Granville, IL"], status: "Open", "job-family": { id: 9, name: "General" }, ...extra },
});

describe("hireology", () => {
  it("reads every open posting, descriptions included, in one call", async () => {
    const { jobs, calls } = await run(() =>
      json({
        data: [
          posting("2426410", "Automotive Service Technician", { "career-site-url": "https://careers.hireology.com/alcionifordinc/2426411/description" }),
          posting("2426412", "BDC Agent", { remote: true, locations: [], "job-family": { name: "Sales" } }),
          posting("2426413", "Old role", { status: "Closed" }),
        ],
      }),
    );
    expect(calls).toEqual(["https://api.hireology.com/v1/careers/alcionifordinc"]);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      id: "hireology:alcionifordinc:2426410",
      title: "Automotive Service Technician",
      location: "Granville, IL",
      department: undefined,
      url: "https://careers.hireology.com/alcionifordinc/2426411/description",
      description: "Fix cars.",
    });
    expect(jobs[1]).toMatchObject({ location: "Remote", workplace: "remote", department: "Sales", url: "https://careers.hireology.com/alcionifordinc/2426412/description" });
  });

  it("reports a company Hireology doesn't know", async () => {
    await expect(run(() => json({ errors: [{ title: "Record not found", status: "404" }] }, 404))).rejects.toThrow();
  });

  it("is recognised from a careers, job or API link", () => {
    expect(detectCompany("https://careers.hireology.com/alcionifordinc")).toMatchObject({ ats: "hireology", slug: "alcionifordinc", supported: true });
    expect(detectCompany("careers.hireology.com/AlCioniFordInc/2426411/description")).toMatchObject({ slug: "alcionifordinc" });
    expect(detectCompany("https://api.hireology.com/v1/careers/alcionifordinc")).toMatchObject({ slug: "alcionifordinc" });
    expect(detectCompany("https://www.hireology.com/")).toBeNull();
  });
});
