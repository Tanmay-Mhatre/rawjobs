import { beforeEach, describe, expect, it } from "vitest";
import { careersUrl, detectCompany, getConnector } from "../src/connectors";
import { isRadancySite } from "../src/connectors/radancy";
import { clearRobotsCache } from "../src/robots";
import type { CompanyRef } from "../src/schema";
import { fakeHttp } from "./helpers";

const text = (body: string) => new Response(body, { status: 200 });
const robots = (rules = "") => text(`User-agent: *\n${rules}\n`);
const ctx = (http: ReturnType<typeof fakeHttp>["http"], partial?: () => void) => ({ http, now: new Date(), partial });

beforeEach(() => clearRobotsCache());

describe("avature", () => {
  const row = (id: number, title: string, loc?: string) =>
    `<article><h3><a class="link" href="https://bloomberg.avature.net/careers/JobDetail/${title.replace(/\W+/g, "-")}/${id}">\n ${title} \n</a></h3>${
      loc ? `<div class="article__header__text__subtitle"><span class="list-item-location">${loc}</span></div>` : ""
    }<a class="button" href="https://bloomberg.avature.net/careers/SaveJob?jobId=${id}">Save</a></article>`;
  const ref = { name: "Bloomberg", enabled: true, ats: "avature", slug: "bloomberg", site: "careers" } as CompanyRef;

  it("detects tenant and portal, skipping a locale segment", () => {
    expect(detectCompany("https://bloomberg.avature.net/careers/SearchJobs/")).toMatchObject({ ats: "avature", slug: "bloomberg", site: "careers", supported: true });
    expect(detectCompany("https://koch.avature.net/en_US/careers/JobDetail/x/1")).toMatchObject({ ats: "avature", slug: "koch", site: "careers" });
    expect(careersUrl({ ats: "avature", slug: "koch" })).toBe("https://koch.avature.net/careers/SearchJobs/");
  });

  it("pages through the search list by offset until a page adds nothing", async () => {
    const { http, calls } = fakeHttp((url) => {
      if (url.endsWith("/robots.txt")) return robots("Disallow: /careers/*qtvc=");
      const offset = Number(new URL(url).searchParams.get("jobOffset"));
      if (offset === 0) return text(row(1, "Quant Analyst", "New York, New York, United States") + row(2, "Sales &amp; Analytics", "Sao Paulo, Brazil"));
      if (offset === 2) return text(row(3, "Engineer"));
      return text(row(3, "Engineer"));
    });
    const c = getConnector("avature")!;
    const raw = await c.fetch(ref, ctx(http));
    expect(calls.slice(1)).toEqual([0, 2, 3].map((o) => `https://bloomberg.avature.net/careers/SearchJobs/?jobOffset=${o}`));
    const jobs = raw.map((r) => c.normalize(r, ref));
    expect(jobs.map((j) => [j.id, j.title, j.location])).toEqual([
      ["avature:bloomberg:1", "Quant Analyst", "New York, New York, United States"],
      ["avature:bloomberg:2", "Sales & Analytics", "Sao Paulo, Brazil"],
      ["avature:bloomberg:3", "Engineer", ""],
    ]);
    expect(c.vagueLocation!(raw[2])).toBe(true);
    expect(c.vagueLocation!(raw[0])).toBe(false);
  });

  it("reads the description and the Location field from the job page", async () => {
    const page = `<main><article class="article"><div class="article__content"><div class="article__content__view__field__label">\n Location \n</div>\n<div class="article__content__view__field__value">London, United Kingdom</div><div class="article__content__view__field__value"><p>Build models.</p></div></div></article><footer>x</footer></main>`;
    const { http } = fakeHttp(() => text(page));
    const d = await getConnector("avature")!.describe!({ id: "3", title: "Engineer", location: "", url: "https://bloomberg.avature.net/careers/JobDetail/Engineer/3" }, ref, ctx(http));
    expect(d).toMatchObject({ location: "London, United Kingdom" });
    expect(typeof d === "string" ? d : d.description).toContain("Build models.");
  });
});

describe("pageup", () => {
  const feed = `<?xml version="1.0"?><rss version="2.0" xmlns:job="http://pageuppeople.com/"><channel><item><guid>https://careers.pageuppeople.com/513/cw/en/job/699361</guid><link>https://careers.pageuppeople.com/513/cw/en/job/699361</link><title>Education Programs Manager</title><description>Short</description><pubDate>Mon, 19 Oct 2026 04:00:00 Z</pubDate><job:refNo>699361</job:refNo><job:location>Campus|Caulfield campus</job:location><job:workType>Fixed-term (Full-time)</job:workType><job:description>&lt;p&gt;Lead a team.&lt;/p&gt;</job:description></item></channel></rss>`;
  const ref = { name: "Monash University", enabled: true, ats: "pageup", slug: "513", site: "cw/en" } as CompanyRef;

  it("detects client and site", () => {
    expect(detectCompany("https://careers.pageuppeople.com/513/cw/en/listing/")).toMatchObject({ ats: "pageup", slug: "513", site: "cw/en", supported: true });
    expect(careersUrl({ ats: "pageup", slug: "513" })).toBe("https://careers.pageuppeople.com/513/cw/en/listing/");
  });

  it("reads every job from the site's RSS feed", async () => {
    const { http, calls } = fakeHttp((url) => (url.endsWith("/robots.txt") ? robots("Disallow: /admin") : text(feed)));
    const c = getConnector("pageup")!;
    const [job] = (await c.fetch(ref, ctx(http))).map((r) => c.normalize(r, ref));
    expect(calls).toEqual(["https://careers.pageuppeople.com/robots.txt", "https://careers.pageuppeople.com/513/cw/en/latest_jobs.rss"]);
    expect(job).toMatchObject({
      id: "pageup:513:699361",
      title: "Education Programs Manager",
      location: "Caulfield campus",
      postedAt: "2026-10-19T04:00:00.000Z",
      url: "https://careers.pageuppeople.com/513/cw/en/job/699361",
      description: "Lead a team.",
    });
  });
});

describe("radancy", () => {
  const sitemap = `<?xml version="1.0"?><urlset><url><loc>https://jobs.boeing.com</loc></url><url><loc>https://jobs.boeing.com/category/engineering-jobs/185/11125/1</loc></url><url><loc>https://jobs.boeing.com/job/brisbane/engineer-software/185/96915796512</loc></url><url><loc>https://jobs.boeing.com/en/job/st-louis/senior-product-manager/185/1234</loc></url></urlset>`;
  const ref = { name: "Boeing", enabled: true, ats: "radancy", slug: "jobs.boeing.com" } as CompanyRef;

  it("lists jobs from the sitemap (robots.txt closes only /search-jobs/)", async () => {
    const { http, calls } = fakeHttp((url) => (url.endsWith("/robots.txt") ? robots("Disallow:/search-jobs/") : text(sitemap)));
    const c = getConnector("radancy")!;
    const raw = await c.fetch(ref, ctx(http));
    expect(calls).toEqual(["https://jobs.boeing.com/robots.txt", "https://jobs.boeing.com/sitemap.xml"]);
    expect(raw.map((r) => c.normalize(r, ref)).map((j) => [j.id, j.title, j.location])).toEqual([
      ["radancy:jobs.boeing.com:96915796512", "Engineer Software", "Brisbane"],
      ["radancy:jobs.boeing.com:1234", "Senior Product Manager", "St Louis"],
    ]);
    expect(await isRadancySite("jobs.boeing.com", http)).toBe(true);
    expect(careersUrl({ ats: "radancy", slug: "jobs.boeing.com" })).toBe("https://jobs.boeing.com/");
  });

  it("reads place, date and description from the job page's JSON-LD", async () => {
    const ld = {
      "@type": "JobPosting",
      title: "Engineer - Software",
      datePosted: "2026-10-19",
      description: "<p>Write code.</p>",
      jobLocation: { address: { addressLocality: "Brisbane", addressCountry: "Australia" } },
    };
    const { http } = fakeHttp(() => text(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`));
    const d = await getConnector("radancy")!.describe!({ id: "1", title: "Engineer Software", city: "Brisbane", url: "https://jobs.boeing.com/job/brisbane/engineer-software/185/1" }, ref, ctx(http));
    expect(d).toMatchObject({ location: "Brisbane, Australia", postedAt: "2026-10-19T00:00:00.000Z", description: "Write code." });
  });

  it("falls back to TalentBrew's description block when a page has no JSON-LD", async () => {
    const page = `<div data-tm-job-location="Lisbon,  Portugal" data-tm-job-date-posted='10/9/2026'></div><section><div class="ats-description"><p>Sell\tads.</p></div></section><footer>Cookies</footer>`;
    const { http } = fakeHttp(() => text(page));
    const d = await getConnector("radancy")!.describe!({ id: "1", title: "Ad Sales", city: "Lisbon", url: "https://www.disneycareers.com/en/job/lisbon/ad-sales/391/1" }, ref, ctx(http));
    expect(d).toMatchObject({ location: "Lisbon, Portugal", postedAt: "2026-10-09T00:00:00.000Z", description: "Sell ads." });
  });

  it("is not a Radancy site when its sitemap lists no job pages", async () => {
    const { http } = fakeHttp((url) => (url.endsWith("/robots.txt") ? robots() : text("<urlset><url><loc>https://example.com/about</loc></url></urlset>")));
    expect(await isRadancySite("example.com", http)).toBe(false);
  });
});
