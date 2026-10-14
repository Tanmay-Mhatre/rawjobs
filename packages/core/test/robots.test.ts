import { beforeEach, describe, expect, it } from "vitest";
import { assertRobotsAllow, clearRobotsCache, parseRobots, robotsAllows, robotsAllowsPath } from "../src/robots";
import { fakeHttp } from "./helpers";

const txt = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/plain" } });

describe("robots", () => {
  beforeEach(() => clearRobotsCache());

  it("uses the * group, longest rule wins, Allow wins a tie, * and $ wildcards", () => {
    const r = parseRobots("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /services/\nDisallow: /*.pdf$\nAllow: /services/public\nCrawl-delay: 5\n");
    expect(r.crawlDelay).toBe(5);
    expect(robotsAllowsPath(r, "/search/?q=&startrow=10")).toBe(true);
    expect(robotsAllowsPath(r, "/services/recruiting/v1/jobs")).toBe(false);
    expect(robotsAllowsPath(r, "/services/public/x")).toBe(true);
    expect(robotsAllowsPath(r, "/files/a.pdf")).toBe(false);
    expect(robotsAllowsPath(r, "/files/a.pdf?x=1")).toBe(true);
  });

  it("prefers a group naming RawJobs, shared agent lines, empty Disallow", () => {
    const r = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: Other\nUser-agent: RawJobs\nDisallow:\n");
    expect(robotsAllowsPath(r, "/anything")).toBe(true);
  });

  it("reads robots.txt served as an HTML page", () => {
    const r = parseRobots("<html><body><pre>User-agent: *<br>Disallow: /api/</pre></body></html>");
    expect(robotsAllowsPath(r, "/api/search-jobs")).toBe(false);
    expect(robotsAllowsPath(r, "/rss/jobs/python.rss")).toBe(true);
  });

  it("fetches once per host; a missing robots.txt allows everything", async () => {
    const { http, calls } = fakeHttp((url) => (url.startsWith("https://a.test") ? txt("User-agent: *\nDisallow: /api/") : txt("nope", 404)));
    expect(await robotsAllows(http, "https://a.test/rss/x.rss")).toBe(true);
    await expect(assertRobotsAllow(http, "https://a.test/api/jobs")).rejects.toThrow(/robots\.txt/);
    expect(await robotsAllows(http, "https://b.test/api/jobs")).toBe(true);
    expect(calls).toEqual(["https://a.test/robots.txt", "https://b.test/robots.txt"]);
  });
});
