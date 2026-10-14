import { beforeEach, describe, expect, it } from "vitest";
import { careersUrl, detectCompany, getConnector } from "../src/connectors";
import { clearRobotsCache } from "../src/robots";
import type { CompanyRef } from "../src/schema";
import { fakeHttp } from "./helpers";

const xml = (status: number, body: string, url = "") => {
  const res = new Response(body, { status, headers: { "content-type": "text/xml" } });
  if (url) Object.defineProperty(res, "url", { value: url });
  return res;
};
const FEED = `<?xml version="1.0" encoding="UTF-8" ?>
<rss xmlns:taleo="urn:TBERss" version="2.0"><channel><title>Acme &amp; Co Job Feed</title>
<item>
<title>Senior Paralegal - General Practice</title>
<link>https://phg.tbe.taleo.net/phg04/ats/careers/requisition.jsp?org=ACME&amp;cws=38&amp;rid=1368</link>
<description>SUMMARY plain</description>
<pubDate>Tue, 13 Oct 2026 21:20:16 GMT</pubDate>
<taleo:reqId>1368</taleo:reqId>
<taleo:location>New York</taleo:location>
<taleo:locationCountry>US</taleo:locationCountry>
<taleo:locationState>US-NY</taleo:locationState>
<taleo:locationCity>New York</taleo:locationCity>
<taleo:html-description>&lt;p&gt;Run &lt;b&gt;filings&lt;/b&gt;&lt;/p&gt;</taleo:html-description>
</item></channel></rss>`;
const ref = (extra: Partial<CompanyRef> = {}) => ({ name: "Acme", enabled: true, ats: "taleobe", slug: "ACME", ...extra }) as CompanyRef;

describe("taleobe", () => {
  beforeEach(() => clearRobotsCache());

  it("reads every job from the board's RSS feed, descriptions included", async () => {
    const { http, calls } = fakeHttp((url) => (url.endsWith("/robots.txt") ? xml(404, "") : xml(200, FEED)));
    const c = getConnector("taleobe")!;
    const r = ref({ shard: "phg.tbe.taleo.net/phg04", site: "38" });
    const jobs = (await c.fetch(r, { http, now: new Date() })).map((x) => c.normalize(x, r));
    expect(calls).toEqual(["https://phg.tbe.taleo.net/robots.txt", "https://phg.tbe.taleo.net/phg04/ats/servlet/Rss?org=ACME&cws=38"]);
    expect(jobs).toEqual([
      expect.objectContaining({
        id: "taleobe:acme:1368",
        title: "Senior Paralegal - General Practice",
        location: "New York, NY, United States",
        country: "United States",
        postedAt: "2026-10-13T21:20:16.000Z",
        url: "https://phg.tbe.taleo.net/phg04/ats/careers/requisition.jsp?org=ACME&cws=38&rid=1368",
        description: "Run filings",
      }),
    ]);
  });

  it("finds the board's current pod and careers site when the saved ones are stale", async () => {
    const { http, calls } = fakeHttp((url) => {
      if (url.endsWith("/robots.txt")) return xml(404, "");
      if (url.includes("DispatcherServlet")) return xml(200, "<html></html>", "https://phg.tbe.taleo.net/phg04/ats/careers/v2/jobSearch?act=redirectCws&org=ACME&cws=38");
      if (url.includes("cws=38")) return xml(200, FEED);
      return xml(200, "<html>error</html>", "https://phe.tbe.taleo.net/phe04/ats/rssErrMsg.jsp");
    });
    const items = await getConnector("taleobe")!.fetch(ref({ shard: "phe.tbe.taleo.net/phe04", site: "1" }), { http, now: new Date() });
    expect(items).toHaveLength(1);
    expect(calls).toContain("https://phe.tbe.taleo.net/dispatcher/servlet/DispatcherServlet?org=ACME&act=redirectCws&cws=1");
    expect(calls.at(-1)).toBe("https://phg.tbe.taleo.net/phg04/ats/servlet/Rss?org=ACME&cws=38");
  });

  it("says so when TBE doesn't know the board", async () => {
    const { http } = fakeHttp((url) => (url.endsWith("/robots.txt") ? xml(404, "") : xml(200, "<html></html>", "https://phh.tbe.taleo.net/dispatcher/err.jsp")));
    await expect(getConnector("taleobe")!.fetch(ref(), { http, now: new Date() })).rejects.toThrow(/not found/);
  });

  it("is recognised from a careers or job link, and not as enterprise Taleo", () => {
    const d = detectCompany("https://phg.tbe.taleo.net/phg04/ats/careers/v2/searchResults?org=SULLCROM&cws=38");
    expect(d).toMatchObject({ ats: "taleobe", slug: "SULLCROM", shard: "phg.tbe.taleo.net/phg04", site: "38", supported: true });
    expect(careersUrl(d!)).toBe("https://phg.tbe.taleo.net/phg04/ats/careers/v2/jobSearch?org=SULLCROM&cws=38");
    expect(detectCompany("https://phh.tbe.taleo.net/phh04/ats/careers/requisition.jsp?org=ACME&cws=1&rid=9")).toMatchObject({ ats: "taleobe", slug: "ACME" });
    expect(detectCompany("https://phh.tbe.taleo.net/")).toBeNull();
  });
});
