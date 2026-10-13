import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp, json } from "./helpers";

const feed = {
  "@type": "DataFeed",
  dataFeedElement: [
    {
      "@type": "DataFeedItem",
      item: {
        "@type": "JobPosting",
        title: "Space Specialist (m/w/d) ",
        url: "https://moll.career.softgarden.de/jobs/63337904/Space-Specialist-m-w-d-/",
        datePosted: "2026-10-10T15:54:13.350+02:00",
        identifier: { "@type": "PropertyValue", value: 63337904 },
        description: "<p>Plan <b>showrooms</b>.</p>",
        jobLocation: { "@type": "Place", address: { addressLocality: "Bochum", addressRegion: "Nordrhein-Westfalen", addressCountry: "Deutschland" } },
      },
    },
    { "@type": "DataFeedItem", item: { "@type": "JobPosting", title: "Remote Developer", url: "https://moll.career.softgarden.de/jobs/2/x/", jobLocationType: "TELECOMMUTE" } },
  ],
};

describe("softgarden", () => {
  it("reads the site's JSON-LD job feed: every ad with its place and description in one request", async () => {
    const { http, calls } = fakeHttp(() => json(feed));
    const c = getConnector("softgarden")!;
    const r = { name: "Autohaus Moll", enabled: true, ats: "softgarden", slug: "moll" } as CompanyRef;
    const jobs = (await c.fetch(r, { http, now: new Date() })).map((x) => c.normalize(x, r));
    expect(calls).toEqual(["https://moll.career.softgarden.de/jobs.feed.json"]);
    expect(jobs[0]).toMatchObject({
      id: "softgarden:moll:63337904",
      title: "Space Specialist (m/w/d)",
      location: "Bochum, Nordrhein-Westfalen, Deutschland",
      postedAt: "2026-10-10T13:54:13.350Z",
      url: "https://moll.career.softgarden.de/jobs/63337904/Space-Specialist-m-w-d-/",
      description: "Plan showrooms.",
    });
    expect(jobs[1]).toMatchObject({ id: "softgarden:moll:2", location: "Remote", workplace: "remote" });
  });

  it("says so when the site has no job feed", async () => {
    const { http } = fakeHttp(() => json({ error: "not found" }));
    await expect(getConnector("softgarden")!.fetch({ name: "x", enabled: true, ats: "softgarden", slug: "nope" } as CompanyRef, { http, now: new Date() })).rejects.toThrow(/no job feed/);
    const bad = fakeHttp(() => json({ error: "Bad Request" }, 400));
    await expect(getConnector("softgarden")!.fetch({ name: "x", enabled: true, ats: "softgarden", slug: "nope" } as CompanyRef, { http: bad.http, now: new Date() })).rejects.toThrow(/not found/);
  });

  it("is recognised from a careers or job link", () => {
    expect(detectCompany("https://moll.career.softgarden.de/jobs/63337904/x/")).toMatchObject({ ats: "softgarden", slug: "moll", supported: true });
    expect(detectCompany("https://softgarden.com/")).toBeNull();
  });
});
