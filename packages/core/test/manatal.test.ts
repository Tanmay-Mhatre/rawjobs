import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp, json } from "./helpers";

const job = (n: number, extra: Record<string, unknown> = {}) => ({
  id: 4374690 + n,
  hash: `7X57R6${n}`,
  position_name: `AML Operations Associate ${n} `,
  description: "<p>Review <b>alerts</b>.</p>",
  location_display: "Gurugram, Haryana, India",
  country: "India",
  is_remote: false,
  ...extra,
});

describe("manatal", () => {
  it("pages Manatal's open career-page API, descriptions included", async () => {
    const { http, calls } = fakeHttp((url) =>
      url.includes("page=1&")
        ? json({ count: 2, next: "https://open.api.manatal.com/open/v3/career-page/syfe/jobs/?page=2&page_size=100", results: [job(1)] })
        : json({ count: 2, next: null, results: [job(2, { is_remote: true, location_display: "Singapore" })] }),
    );
    const c = getConnector("manatal")!;
    const r = { name: "Syfe", enabled: true, ats: "manatal", slug: "syfe" } as CompanyRef;
    const jobs = (await c.fetch(r, { http, now: new Date() })).map((x) => c.normalize(x, r));
    expect(calls).toEqual(["https://open.api.manatal.com/open/v3/career-page/syfe/jobs/?page=1&page_size=100", "https://open.api.manatal.com/open/v3/career-page/syfe/jobs/?page=2&page_size=100"]);
    expect(jobs[0]).toMatchObject({
      id: "manatal:syfe:7X57R61",
      title: "AML Operations Associate 1",
      location: "Gurugram, Haryana, India",
      country: "India",
      url: "https://www.careers-page.com/syfe/job/7X57R61",
      description: "Review alerts.",
    });
    expect(jobs[1]).toMatchObject({ location: "Singapore, Remote", workplace: "remote" });
  });

  it("reports a careers page Manatal doesn't know", async () => {
    const { http } = fakeHttp(() => json({ detail: "No ClientPortalSettings matches the given query." }, 404));
    await expect(getConnector("manatal")!.fetch({ name: "x", enabled: true, ats: "manatal", slug: "nope" } as CompanyRef, { http, now: new Date() })).rejects.toThrow();
  });

  it("is recognised from a careers-page.com link", () => {
    expect(detectCompany("https://www.careers-page.com/syfe/job/7X57R633")).toMatchObject({ ats: "manatal", slug: "syfe", supported: true });
    expect(detectCompany("https://www.manatal.com/")).toBeNull();
  });
});
