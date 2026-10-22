import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp, json } from "./helpers";

const text = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
const openings = readFileSync(new URL("./fixtures/pages/hrmdirect-openings.html", import.meta.url), "utf8");
const jobPage =
  '<div class="reqResult"><h2>Inside Sales</h2><table class="viewFields"><tr>\t<td class="viewFieldName" ><b>Department:</b></td>\n<td class="viewFieldValue">Sales</td></tr><tr>\t<td class="viewFieldName"><b>Location:</b></td>\n<td class="viewFieldValue">Brooklyn, NY<br></td></tr></table><div class="jobDesc"><p>Sell <b>stone</b>.</p><div>Full time</div></div></div>';

describe("hrmdirect", () => {
  it("reads the openings page (a saved real page) row by row, descriptions and the place from each job page", async () => {
    const { http, calls } = fakeHttp((url) => (url.includes("job-opening.php") ? text(jobPage) : text(openings)));
    const c = getConnector("hrmdirect")!;
    const r = { name: "ABC Worldwide Stone", enabled: true, ats: "hrmdirect", slug: "abcworldwidestone" } as CompanyRef;
    const raws = await c.fetch(r, { http, now: new Date() });
    const jobs = raws.map((x) => c.normalize(x, r));
    expect(calls).toEqual(["https://abcworldwidestone.hrmdirect.com/employment/job-openings.php?search=true"]);
    expect(jobs[0]).toMatchObject({
      id: "hrmdirect:abcworldwidestone:3773108-1408712",
      title: "Inside Sales",
      location: "Brooklyn, NY",
      department: "Sales",
      url: "https://abcworldwidestone.hrmdirect.com/employment/job-opening.php?req=3773108&req_loc=1408712",
    });
    expect(c.vagueLocation!(raws[0]!)).toBe(false);
    expect(await c.describe!(raws[0]!, r, { http, now: new Date() })).toMatchObject({ description: "Sell stone.\nFull time", location: "Brooklyn, NY" });
  });

  it("asks the job page for the place when the site hides those columns", async () => {
    const titlesOnly = '<table><tr class="reqitem ReqRowClick"><td id="posTitle0" class="posTitle reqitem"><a href="job-opening.php?req=1&req_loc=2&&amp;#job">Analyst</td></tr></table>';
    const { http } = fakeHttp(() => text(titlesOnly));
    const c = getConnector("hrmdirect")!;
    const [raw] = await c.fetch({ name: "x", enabled: true, ats: "hrmdirect", slug: "healthadvances" } as CompanyRef, { http, now: new Date() });
    expect(raw).toMatchObject({ title: "Analyst", req: "1", loc: "2" });
    expect(c.vagueLocation!(raw!)).toBe(true);
  });

  it("reads an account that moved to ClearCompany from its careers API, and keeps the site id for next time", async () => {
    const site = "69eb7736-6a58-51cd-4177-4fc2d015e896";
    // The old address is followed to apply.clearcompany.com, whose page names the site id.
    const moved = `<div class="cc-widget"><script src="https://careers-content.clearcompany.com/js/v1/career-site.js" data-site-id="${site}" data-default-source="CJB-0"></script></div>`;
    const cc = (n: number) => ({
      id: `job-${n}`,
      positionTitle: ` Server ${n} `,
      description: "<p>Breakfast <b>shifts</b>.</p>",
      postedDate: "2026-10-22T00:00:00",
      departmentName: "Restaurant",
      locations: [{ city: "Uniontown", subdivision: "OH", country: "US", isRemote: false }],
      applyLink: `https://firstwatch.clearcompany.com/careers/jobs/job-${n}/apply?source=CJB-0`,
    });
    const { http, calls } = fakeHttp((url) => {
      if (url.includes("hrmdirect.com")) return text(moved);
      const page = Number(new URL(url).searchParams.get("pageIndex"));
      return json({ results: page === 0 ? Array.from({ length: 100 }, (_, i) => cc(i)) : [cc(100)], totalCount: 101 });
    });
    const kept = new Map<string, string>();
    const ids = { get: (k: string) => kept.get(k), set: (k: string, v: string) => void kept.set(k, v) };
    const c = getConnector("hrmdirect")!;
    const r = { name: "First Watch", enabled: true, ats: "hrmdirect", slug: "firstwatch" } as CompanyRef;

    const raws = await c.fetch(r, { http, now: new Date(), ids });
    expect(raws).toHaveLength(101);
    expect(calls.filter((u) => u.startsWith(`https://careers-api.clearcompany.com/v1/${site}?`))).toHaveLength(2);
    expect(kept.get("hrmdirect:firstwatch")).toBe(site);
    expect(c.normalize(raws[0]!, r)).toMatchObject({
      id: "hrmdirect:firstwatch:job-0",
      title: "Server 0",
      location: "Uniontown, OH",
      department: "Restaurant",
      postedAt: "2026-10-22T00:00:00.000Z",
      url: "https://firstwatch.clearcompany.com/careers/jobs/job-0",
      description: "Breakfast shifts.",
    });
    expect(c.vagueLocation?.(raws[0]!)).toBe(false);

    // Next read: straight to the API, no page.
    calls.length = 0;
    await c.fetch(r, { http, now: new Date(), ids });
    expect(calls.some((u) => u.includes("hrmdirect.com"))).toBe(false);
  });

  it("is recognised from a careers or job link", () => {
    expect(detectCompany("https://abcworldwidestone.hrmdirect.com/employment/job-opening.php?req=1&req_loc=2")).toMatchObject({ ats: "hrmdirect", slug: "abcworldwidestone", supported: true });
    expect(detectCompany("https://www.hrmdirect.com/")).toBeNull();
  });
});
