import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp } from "./helpers";

const text = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
const page1 = readFileSync(new URL("./fixtures/pages/careerplug-jobs.html", import.meta.url), "utf8");
const lastPage =
  '<html class="careerplug"><div id="job_table"><a aria-label="Shift Lead in Austin, TX" href="/jobs/42"><div class="row"><div class="job-title col-sm-7"><span class="name">Shift Lead</span></div><div class="job-location col-md-3">\n<div>\n<span class=\'job-row-title\'>Location:</span>\nTX-Austin-78701\n</div>\n</div><div class="job-post-date col-md-2">\n<div>\nPost Date:\n10-01-26\n</div>\n</div></div></a></div></html>';

async function run(route: (url: string) => Response) {
  const { http, calls } = fakeHttp(route);
  const c = getConnector("careerplug")!;
  const r = { name: "360clean", enabled: true, ats: "careerplug", slug: "360clean-careers" } as CompanyRef;
  const raws = await c.fetch(r, { http, now: new Date() });
  return { jobs: raws.map((x) => c.normalize(x, r)), raws, calls, c, r, http };
}

describe("careerplug", () => {
  it("reads the job list page by page (a saved real page), descriptions from each job's JSON-LD", async () => {
    const { jobs, raws, calls, c, r, http } = await run((url) =>
      url.endsWith("?page=2")
        ? text(lastPage)
        : url.includes("/jobs/")
          ? text('<script type="application/ld+json">{"@type":"JobPosting","title":"x","description":"<p>Clean <b>offices</b>.</p>"}</script>')
          : text(page1),
    );
    expect(calls).toEqual(["https://360clean-careers.careerplug.com/jobs", "https://360clean-careers.careerplug.com/jobs?page=2"]);
    expect(jobs.map((j) => [j.title, j.location, j.postedAt])).toEqual([
      ["Commercial Cleaning Technician", "Naples, FL", "2026-10-13T00:00:00.000Z"],
      ["URGENTE Dawsonville busca personal de limpieza Need a Cleaner", "Dawsonville, GA", "2026-10-12T00:00:00.000Z"],
      ["Janitorial Work Part Time", "Myrtle Beach, SC", "2026-10-09T00:00:00.000Z"],
      ["Shift Lead", "Austin, TX", "2026-10-01T00:00:00.000Z"],
    ]);
    expect(jobs[0]).toMatchObject({ id: "careerplug:360clean-careers:3639102", url: "https://360clean-careers.careerplug.com/jobs/3639102" });
    expect(await c.describe!(raws[0]!, r, { http, now: new Date() })).toBe("Clean offices.");
  });

  it("says so when the account doesn't exist", async () => {
    await expect(run(() => text("<html>Not here</html>"))).rejects.toThrow(/not found/);
  });

  it("is recognised from a careers or job link", () => {
    expect(detectCompany("https://360clean-careers.careerplug.com/jobs/3639102")).toMatchObject({ ats: "careerplug", slug: "360clean-careers", supported: true });
    expect(detectCompany("https://www.careerplug.com/")).toBeNull();
  });
});
