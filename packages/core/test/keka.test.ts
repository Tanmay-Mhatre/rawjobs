import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp, json } from "./helpers";

const text = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
const ORG = "0e329376-fd32-40b6-afd2-d8fcbcd44435";
const shell = `<script>fetch('/ats/documents/${ORG}/careerportal/e45a7566675e467298f7df2725eb6e43.html')</script>`;
const job = {
  id: 162716,
  title: "Engineer ",
  description: "<div>Crash <b>barrier</b> project</div>",
  departmentName: "Civil - Projects",
  jobLocations: [{ city: "Bhubaneswar", state: "OR", countryCode: "IN", countryName: "India" }],
  salaryRange: { minimum: 250000, maximum: 350000, currency: "INR", salaryPeriod: 0 },
  publishedOn: "2026-10-03T11:20:18.057Z",
};

describe("keka", () => {
  it("reads the org id off the careers page, then every job (salary, place, description) in one call", async () => {
    const { http, calls } = fakeHttp((url) => (url.endsWith("/careers") ? text(shell) : json([job])));
    const c = getConnector("keka")!;
    const r = { name: "KP Group", enabled: true, ats: "keka", slug: "kpgroup" } as CompanyRef;
    const jobs = (await c.fetch(r, { http, now: new Date() })).map((x) => c.normalize(x, r));
    expect(calls).toEqual(["https://kpgroup.keka.com/careers", `https://kpgroup.keka.com/careers/api/embedjobs/default/active/${ORG}`]);
    expect(jobs[0]).toMatchObject({
      id: "keka:kpgroup:162716",
      title: "Engineer",
      location: "Bhubaneswar, India",
      country: "India",
      department: "Civil - Projects",
      salary: { min: 250000, max: 350000, currency: "INR" },
      postedAt: "2026-10-03T11:20:18.057Z",
      url: "https://kpgroup.keka.com/careers/jobdetails/162716",
      description: "Crash barrier project",
    });
  });

  it("uses an org id a list gave, and says so when the careers page has none", async () => {
    const given = fakeHttp(() => json([]));
    await getConnector("keka")!.fetch({ name: "x", enabled: true, ats: "keka", slug: "kpgroup", site: ORG } as CompanyRef, { http: given.http, now: new Date() });
    expect(given.calls).toEqual([`https://kpgroup.keka.com/careers/api/embedjobs/default/active/${ORG}`]);
    const { http } = fakeHttp(() => text("<html>Not found</html>"));
    await expect(getConnector("keka")!.fetch({ name: "x", enabled: true, ats: "keka", slug: "nope" } as CompanyRef, { http, now: new Date() })).rejects.toThrow(/not found/);
  });

  it("is recognised from a careers or job link", () => {
    expect(detectCompany("https://kpgroup.keka.com/careers/jobdetails/162716")).toMatchObject({ ats: "keka", slug: "kpgroup", supported: true });
    expect(detectCompany("https://www.keka.com/")).toBeNull();
  });
});
