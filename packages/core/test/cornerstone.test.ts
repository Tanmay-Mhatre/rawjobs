import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp, json } from "./helpers";

const text = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
const homePage = '<script>window.csod = {"endpoints":{"cloud":"https://eu-fra.api.csod.com/","other":"x"},"token":"eyJanon.read.token","cultureID":1,"cultureName":"en-US"};</script>';
const req = (n: number) => ({
  requisitionId: 500 + n,
  displayJobTitle: `Role ${n} `,
  postingEffectiveDate: "10/12/2026",
  locations: [{ city: "Frankfurt am Main", country: "DE" }],
  externalDescription: "<p>Tell <b>stories</b>.</p>",
});

describe("cornerstone", () => {
  it("takes the careers page's API base and read token, then pages the job search 25 at a time", async () => {
    const seen: { url: string; auth?: string; page?: number }[] = [];
    const { http } = fakeHttp((url, init) => {
      if (url.includes("/ux/ats/careersite/")) return text(homePage);
      const page = (JSON.parse(String(init?.body)) as { pageNumber: number }).pageNumber;
      seen.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.authorization, page });
      return json({ data: { totalCount: 26, requisitions: page === 1 ? Array.from({ length: 25 }, (_, i) => req(i + 1)) : [req(26)] } });
    });
    const c = getConnector("cornerstone")!;
    const r = { name: "Nintendo of Europe", enabled: true, ats: "cornerstone", slug: "nintendoeurope" } as CompanyRef;
    const jobs = (await c.fetch(r, { http, now: new Date() })).map((x) => c.normalize(x, r));
    expect(seen).toEqual([
      { url: "https://eu-fra.api.csod.com/rec-job-search/external/jobs", auth: "Bearer eyJanon.read.token", page: 1 },
      { url: "https://eu-fra.api.csod.com/rec-job-search/external/jobs", auth: "Bearer eyJanon.read.token", page: 2 },
    ]);
    expect(jobs).toHaveLength(26);
    expect(jobs[0]).toMatchObject({
      id: "cornerstone:nintendoeurope:501",
      title: "Role 1",
      location: "Frankfurt am Main, Germany",
      country: "Germany",
      postedAt: "2026-10-12T00:00:00.000Z",
      url: "https://nintendoeurope.csod.com/ux/ats/careersite/1/home/requisition/501?c=nintendoeurope",
      description: "Tell stories.",
    });
  });

  it("says so when the careers site has no API settings", async () => {
    const { http } = fakeHttp(() => text("<html>Not here</html>"));
    await expect(getConnector("cornerstone")!.fetch({ name: "x", enabled: true, ats: "cornerstone", slug: "nope" } as CompanyRef, { http, now: new Date() })).rejects.toThrow(/not found/);
  });

  it("is recognised from a careers or requisition link", () => {
    expect(detectCompany("https://worldbankgroup.csod.com/ux/ats/careersite/1/home/requisition/38574?c=worldbankgroup")).toMatchObject({ ats: "cornerstone", slug: "worldbankgroup", supported: true });
    expect(detectCompany("https://www.cornerstoneondemand.com/")).toBeNull();
  });
});
