import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp } from "./helpers";

const text = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
const listing = readFileSync(new URL("./fixtures/pages/paycor-listing.html", import.meta.url), "utf8");
const ID = "4028f88b24c330a20124eb33b4ad1653";

describe("paycor", () => {
  it("reads every job off the career listing (a saved real page), descriptions from each job page", async () => {
    const { http, calls } = fakeHttp((url) =>
      url.includes("JobIntroduction")
        ? text('<div id="gnewtonJobDescription"><div id="gnewtonJobDescriptionText"><p>Provide <b>care</b>.</p><div>40 hours</div></div><div>Apply</div></div>')
        : text(listing),
    );
    const c = getConnector("paycor")!;
    const r = { name: "Day Kimball Health", enabled: true, ats: "paycor", slug: ID } as CompanyRef;
    const raws = await c.fetch(r, { http, now: new Date() });
    const jobs = raws.map((x) => c.normalize(x, r));
    expect(calls).toEqual([`https://recruitingbypaycor.com/career/CareerHome.action?clientId=${ID}`]);
    expect(jobs.map((j) => [j.title, j.location, j.department])).toEqual([
      ["APRN - Inpatient Behavioral Health - Day Shift | 40 Hours", "Putnam, CT", "Behavioral Health Services"],
      ["APRN - Outpatient Behavioral Health - Day Shift | 40 Hours", "Putnam, CT", "Behavioral Health Services"],
      ["Clinical Coordinator RN - Inpatient Behavioral Health - Evening Shift | 40 hours", "Putnam, CT", "Behavioral Health Services"],
    ]);
    expect(jobs[0]).toMatchObject({
      id: `paycor:${ID}:8a7887a1a0f425da01a0fea977cc2966`,
      url: `https://recruitingbypaycor.com/career/JobIntroduction.action?clientId=${ID}&id=8a7887a1a0f425da01a0fea977cc2966&lang=en`,
    });
    expect(await c.describe!(raws[0]!, r, { http, now: new Date() })).toBe("Provide care.\n40 hours");
  });

  it("says so when the career site doesn't exist, and wants a real clientId", async () => {
    const { http } = fakeHttp(() => text("<html>Oops</html>"));
    const c = getConnector("paycor")!;
    await expect(c.fetch({ name: "x", enabled: true, ats: "paycor", slug: ID } as CompanyRef, { http, now: new Date() })).rejects.toThrow(/not found/);
    await expect(c.fetch({ name: "x", enabled: true, ats: "paycor", slug: "acme" } as CompanyRef, { http, now: new Date() })).rejects.toThrow(/32 hex/);
  });

  it("is recognised from a listing or job link", () => {
    expect(detectCompany(`https://recruitingbypaycor.com/career/CareerHome.action?clientId=${ID.toUpperCase()}`)).toMatchObject({ ats: "paycor", slug: ID, supported: true });
    expect(detectCompany(`https://recruitingbypaycor.com/career/JobIntroduction.action?clientId=${ID}&id=1`)).toMatchObject({ slug: ID });
    expect(detectCompany("https://www.paycor.com/")).toBeNull();
  });
});
