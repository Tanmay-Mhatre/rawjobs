import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp } from "./helpers";

const text = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
const GUID = "7186761b-1318-47f2-b709-d7e7995cd3f3";
const listPage = (jobs: unknown[]) => `<html><script>window.pageData = ${JSON.stringify({ Departments: ["All Departments"], Jobs: jobs, ModuleId: 46078 })};\n</script></html>`;

async function run(route: (url: string) => Response, slug = GUID) {
  const { http, calls } = fakeHttp(route);
  const c = getConnector("paylocity")!;
  const r = { name: "Cabot Properties", enabled: true, ats: "paylocity", slug } as CompanyRef;
  const raws = await c.fetch(r, { http, now: new Date() });
  return { jobs: raws.map((x) => c.normalize(x, r)), raws, calls, c, r, http };
}

describe("paylocity", () => {
  it("reads every job from the careers page's window.pageData, the description from the job page", async () => {
    const { jobs, raws, calls, c, r, http } = await run((url) =>
      url.includes("/Details/")
        ? text(
            '<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Assistant Property Manager","description":"<p><strong>Company Overview</strong></p><p>We invest.</p>"}</script>',
          )
        : text(
            listPage([
              {
                JobId: 4553411,
                JobTitle: "Assistant Property Manager",
                LocationName: "Irvine, CA",
                PublishedDate: "2026-10-02T10:51:13-05:00",
                HiringDepartment: "Property Management",
                IsRemote: false,
                JobLocation: { City: "Irvine", State: "CA", Country: "USA" },
              },
              { JobId: 4553412, JobTitle: "Remote Accountant ", LocationName: "Remote", IsRemote: true, JobLocation: null },
            ]),
          ),
    );
    expect(calls).toEqual([`https://recruiting.paylocity.com/Recruiting/Jobs/All/${GUID}`]);
    expect(jobs[0]).toMatchObject({
      id: `paylocity:${GUID}:4553411`,
      title: "Assistant Property Manager",
      location: "Irvine, CA",
      country: "United States",
      workplace: "unknown",
      department: "Property Management",
      postedAt: "2026-10-02T15:51:13.000Z",
      url: "https://recruiting.paylocity.com/Recruiting/Jobs/Details/4553411",
    });
    expect(jobs[1]).toMatchObject({ title: "Remote Accountant", location: "Remote", workplace: "remote" });
    expect(await c.describe!(raws[0]!, r, { http, now: new Date() })).toBe("Company Overview\nWe invest.");
  });

  it("refuses a page without the job list, and an id that isn't a GUID", async () => {
    await expect(run(() => text("<html>Page not found</html>"))).rejects.toThrow(/no job list/);
    await expect(run(() => text(listPage([])), "acme")).rejects.toThrow(/should be a GUID/);
  });

  it("is recognised from a careers or job link", () => {
    expect(detectCompany(`https://recruiting.paylocity.com/Recruiting/Jobs/All/${GUID.toUpperCase()}`)).toMatchObject({ ats: "paylocity", slug: GUID, supported: true });
    expect(detectCompany(`https://recruiting.paylocity.com/recruiting/jobs/All/${GUID}/Cabot-Properties`)).toMatchObject({ slug: GUID });
    expect(detectCompany("https://www.paylocity.com/")).toBeNull();
  });
});
