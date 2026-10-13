import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp } from "./helpers";

const xml = (body: string) => new Response(body, { status: 200, headers: { "content-type": "application/rss+xml" } });
const feed = readFileSync(new URL("./fixtures/trakstar-feed.xml", import.meta.url), "utf8");

describe("trakstar", () => {
  it("reads the site's job feed (a saved real feed), descriptions and places included", async () => {
    const { http, calls } = fakeHttp(() => xml(feed));
    const c = getConnector("trakstar")!;
    const r = { name: "1FORCE", enabled: true, ats: "trakstar", slug: "1force" } as CompanyRef;
    const jobs = (await c.fetch(r, { http, now: new Date() })).map((x) => c.normalize(x, r));
    expect(calls).toEqual(["https://1force.hire.trakstar.com/jobfeeds/1force"]);
    expect(jobs[0]).toMatchObject({
      id: "trakstar:1force:fk0xpy5",
      title: "Background Investigator: Independent Contractor/1099 (Experienced)",
      location: "United States - Nationwide",
      postedAt: "2026-09-24T18:30:00.000Z",
      url: "https://1force.hire.trakstar.com/jobs/fk0xpy5",
      description: "Conduct background investigations.",
    });
  });

  it("says so when the account has no job feed", async () => {
    const { http } = fakeHttp(() => new Response("<html>nope</html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(getConnector("trakstar")!.fetch({ name: "x", enabled: true, ats: "trakstar", slug: "nope" } as CompanyRef, { http, now: new Date() })).rejects.toThrow(/no job feed/);
  });

  it("is recognised from a careers or job link", () => {
    expect(detectCompany("https://1force.hire.trakstar.com/jobs/fk0xpy5")).toMatchObject({ ats: "trakstar", slug: "1force", supported: true });
    expect(detectCompany("https://www.trakstar.com/")).toBeNull();
  });
});
