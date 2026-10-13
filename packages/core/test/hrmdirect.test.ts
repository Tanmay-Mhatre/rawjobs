import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp } from "./helpers";

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

  it("is recognised from a careers or job link", () => {
    expect(detectCompany("https://abcworldwidestone.hrmdirect.com/employment/job-opening.php?req=1&req_loc=2")).toMatchObject({ ats: "hrmdirect", slug: "abcworldwidestone", supported: true });
    expect(detectCompany("https://www.hrmdirect.com/")).toBeNull();
  });
});
