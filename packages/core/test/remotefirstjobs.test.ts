import { beforeEach, describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import { clearRobotsCache } from "../src/robots";
import type { CompanyRef } from "../src/schema";
import { fakeHttp } from "./helpers";

const ROBOTS = "User-Agent: *\nDisallow: /api/search-jobs\nDisallow: /api/\n\nUser-agent: bingbot\nDisallow: /companies/*/jobs/*\n";
const FEED = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Remote Python Jobs RSS - RemoteFirstJobs.com</title>
<item><title>Senior AI Data &amp; Analytics Engineer at Samsara</title>
<link>https://remotefirstjobs.com/companies/samsara/jobs/senior-ai-data-analytics-engineer-871143</link>
<description>&lt;p&gt;&lt;strong&gt;Who we are&lt;/strong&gt;&lt;/p&gt;&#xA;&lt;p&gt;IoT data&lt;/p&gt;</description>
<pubDate>Tue, 13 Oct 2026 23:44:22 +0000</pubDate>
<guid isPermaLink="true">senior-ai-data-analytics-engineer-871143</guid></item>
</channel></rss>`;
const ref = (slug: string) => ({ name: "Remote First Jobs", enabled: true, ats: "remotefirstjobs", slug }) as CompanyRef;

describe("remotefirstjobs", () => {
  beforeEach(() => clearRobotsCache());

  it("reads a skill's RSS feed: title and company split, linked back to the board", async () => {
    const { http, calls } = fakeHttp((url) => new Response(url.endsWith("/robots.txt") ? ROBOTS : FEED, { status: 200 }));
    const c = getConnector("remotefirstjobs")!;
    const jobs = (await c.fetch(ref("python"), { http, now: new Date() })).map((x) => c.normalize(x, ref("python")));
    expect(calls).toEqual(["https://remotefirstjobs.com/robots.txt", "https://remotefirstjobs.com/rss/jobs/python.rss"]);
    expect(jobs).toEqual([
      expect.objectContaining({
        id: "remotefirstjobs:python:senior-ai-data-analytics-engineer-871143",
        company: "Samsara",
        title: "Senior AI Data & Analytics Engineer",
        location: "Remote",
        workplace: "remote",
        postedAt: "2026-10-13T23:44:22.000Z",
        url: "https://remotefirstjobs.com/companies/samsara/jobs/senior-ai-data-analytics-engineer-871143",
      }),
    ]);
    expect(jobs[0]!.description).toContain("IoT data");
    expect(c.minIntervalHours).toBeGreaterThanOrEqual(6);
  });

  it("reads software development for 'all' (there is no all-jobs feed)", async () => {
    const { http, calls } = fakeHttp((url) => new Response(url.endsWith("/robots.txt") ? ROBOTS : FEED, { status: 200 }));
    await getConnector("remotefirstjobs")!.fetch(ref("all"), { http, now: new Date() });
    expect(calls.at(-1)).toBe("https://remotefirstjobs.com/rss/jobs/software-development.rss");
  });

  it("stays off paths robots.txt closes", async () => {
    const { http } = fakeHttp((url) => new Response(url.endsWith("/robots.txt") ? "User-agent: *\nDisallow: /rss/" : FEED, { status: 200 }));
    await expect(getConnector("remotefirstjobs")!.fetch(ref("python"), { http, now: new Date() })).rejects.toThrow(/robots\.txt/);
  });

  it("is recognised from a skill page or feed link", () => {
    expect(detectCompany("https://remotefirstjobs.com/jobs/python")).toMatchObject({ ats: "remotefirstjobs", slug: "python", name: "Remote First Jobs", supported: true });
    expect(detectCompany("https://remotefirstjobs.com/rss/jobs/software-development.rss")).toMatchObject({ slug: "software-development" });
    expect(detectCompany("https://remotefirstjobs.com/")).toMatchObject({ ats: "remotefirstjobs", slug: "all" });
  });
});
