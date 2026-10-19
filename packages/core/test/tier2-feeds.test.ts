import { beforeEach, describe, expect, it } from "vitest";
import { bullhorn, bullhornFromPortal } from "../src/connectors/bullhorn";
import { emply } from "../src/connectors/emply";
import { homerun } from "../src/connectors/homerun";
import { jobylon, jsLiteral } from "../src/connectors/jobylon";
import { clearRobotsCache } from "../src/robots";
import type { CompanyRef } from "../src/schema";
import { fakeHttp, json } from "./helpers";

const text = (body: string, status = 200) => new Response(body, { status });
const robots = (rules = "") => text(`User-agent: *\n${rules}\n`);
const ctx = (http: ReturnType<typeof fakeHttp>["http"], partial?: () => void) => ({ http, now: new Date(), partial });
const ref = (ats: CompanyRef["ats"], slug: string, extra: Partial<CompanyRef> = {}) => ({ name: "Acme", enabled: true, ats, slug, ...extra }) as CompanyRef;

beforeEach(() => clearRobotsCache());

describe("jobylon", () => {
  const embed = `<script>
    JBL.embed_v2['is_company_group'] = false;
    JBL.embed_v2['jobs'] = [
      {
        id: '391162',
        url: '/jobs/391162-rusta-produktchef-interior-lighting/',
        title: 'Produktchef \\u002D Interior Lighting',
        klass: { 'job-id-391162': true, 'internal': false, },
        layers: { 'layers_1': [ 'Sweden', ], },
        locations: [ 'Upplands Väsby', ],
        locations_text: 'Upplands Väsby',
        departments: [ 'HQ Stockholm', ],
        workspace: 'Hybrid',
        employment_type: 'Full-time',
        summary: 'None',
        is_internal: false
      },
      { id: '391006', url: '/jobs/391006-rusta-saljare/', title: 'S\\u00e4ljare', locations: [ 'Strömstad' ], workspace: 'Arbete på plats', },
    ];
    JBL.embed_v2['departments'] = [];
  </script>`;
  const r = ref("jobylon", "3402");

  it("detects the company number from company pages and the widget", () => {
    expect(jobylon.detect(new URL("https://emp.jobylon.com/companies/3402-rusta/"))).toEqual({ ats: "jobylon", slug: "3402" });
    expect(jobylon.detect(new URL("https://cdn.jobylon.com/jobs/companies/3402/embed/v2/?target=x"))).toEqual({ ats: "jobylon", slug: "3402" });
    expect(jobylon.detect(new URL("https://emp.jobylon.com/jobs/391006-rusta-saljare/"))).toBeNull();
  });

  it("reads the widget's JavaScript job list without running it", async () => {
    const { http, calls } = fakeHttp((url) => (url.endsWith("/robots.txt") ? robots("Allow: /\nDisallow: /jobs/*/preview/") : text(embed)));
    const raw = await jobylon.fetch(r, ctx(http));
    expect(calls[1]).toBe("https://cdn.jobylon.com/jobs/companies/3402/embed/v2/?target=x");
    const jobs = raw.map((j) => jobylon.normalize(j, r));
    expect(jobs.map((j) => [j.id, j.title, j.location, j.workplace, j.department, j.employmentType])).toEqual([
      ["jobylon:3402:391162", "Produktchef - Interior Lighting", "Upplands Väsby", "hybrid", "HQ Stockholm", "full-time"],
      ["jobylon:3402:391006", "Säljare", "Strömstad", "onsite", undefined, undefined],
    ]);
    expect(jobs[0]!.url).toBe("https://emp.jobylon.com/jobs/391162-rusta-produktchef-interior-lighting/");
  });

  it("refuses code in the literal and treats a 404 as a closed board", async () => {
    expect(() => jsLiteral("[{ id: alert(1) }]", 0)).toThrow(/unexpected/);
    const { http } = fakeHttp((url) => (url.endsWith("/robots.txt") ? robots() : text("", 404)));
    await expect(jobylon.fetch(r, ctx(http))).rejects.toThrow(/board not found/);
  });

  it("reads the description and date from the job page's JSON-LD", async () => {
    const page = `<script type="application/ld+json">{"@type":"JobPosting","datePosted":"2026-10-18T18:05:43+00:00","description":"<p>Sell things.</p>"}</script>`;
    const { http, calls } = fakeHttp(() => text(page));
    const d = await jobylon.describe!({ id: "391006", url: "/jobs/391006-rusta-saljare/", title: "Säljare" }, r, ctx(http));
    expect(calls).toEqual(["https://emp.jobylon.com/jobs/391006-rusta-saljare/"]);
    expect(d).toEqual({ description: "Sell things.", postedAt: "2026-10-18T18:05:43.000Z" });
  });
});

describe("homerun", () => {
  const feed = `<?xml version="1.0" encoding="UTF-8" ?><feed xmlns="http://www.w3.org/2005/Atom"><title type="text">ACE</title><updated>2026-10-02T08:22:21+00:00</updated>
    <entry><author><name>ACE</name></author><title type="text">Growth Marketeer</title><link rel="alternate" type="text/html" href="https://ace.homerun.co/growth-marketeer"></link><id>job_abc</id>
    <description type="html"><![CDATA[<p>Grow us.</p>]]></description><department><name>Marketing</name></department><location><name>Amsterdam</name></location><type><name>Full-time</name></type><updated>2026-09-30 10:00:00</updated></entry></feed>`;
  const r = ref("homerun", "ace");

  it("detects the subdomain and the feed, not Homerun's own hosts", () => {
    expect(homerun.detect(new URL("https://ace.homerun.co/growth-marketeer"))).toEqual({ ats: "homerun", slug: "ace" });
    expect(homerun.detect(new URL("https://feed.homerun.co/ace"))).toEqual({ ats: "homerun", slug: "ace" });
    expect(homerun.detect(new URL("https://app.homerun.co/login"))).toBeNull();
    expect(homerun.detect(new URL("https://www.homerun.co/"))).toBeNull();
  });

  it("reads every job from the Atom feed", async () => {
    const { http, calls } = fakeHttp((url) => (url.endsWith("/robots.txt") ? text("", 404) : text(feed)));
    const raw = await homerun.fetch(r, ctx(http));
    expect(calls[1]).toBe("https://feed.homerun.co/ace");
    expect(homerun.normalize(raw[0]!, r)).toMatchObject({
      id: "homerun:ace:job_abc",
      title: "Growth Marketeer",
      location: "Amsterdam",
      department: "Marketing",
      employmentType: "full-time",
      postedAt: "2026-09-30T10:00:00.000Z",
      url: "https://ace.homerun.co/growth-marketeer",
      description: "Grow us.",
    });
  });

  it("treats a 404 as a closed board", async () => {
    const { http } = fakeHttp(() => text("", 404));
    await expect(homerun.fetch(r, ctx(http))).rejects.toThrow(/board not found/);
  });
});

describe("emply", () => {
  const front = `<script>var languageKey = 'da-DK'; var config = { count: 6, sectionId: 'sec-1', }; var adLink = '/da/ad/' + vacancy.titleAsUrl + '/' + vacancy.shortId;</script>`;
  const vacancy = (n: number) => ({
    id: `v${n}`,
    title: `Job ${n}`,
    titleAsUrl: `job-${n}`,
    shortId: `s${n}`,
    published: "2026-10-13T11:26:10.0982826Z",
    department: "Børnehuset",
    location: "Denmark",
    translations: [{ languageKey: "da-DK", title: `Job ${n}`, content: "<p>Pas på børn.</p>" }],
  });
  const r = ref("emply", "albertslund");

  it("detects the tenant", () => {
    expect(emply.detect(new URL("https://albertslund.career.emply.com/da/ad/job-1/s1"))).toEqual({ ats: "emply", slug: "albertslund" });
    expect(emply.detect(new URL("https://www.emply.com/"))).toBeNull();
  });

  it("reads the section from the front page, then pages the vacancy API by offset", async () => {
    const bodies: unknown[] = [];
    const { http, calls } = fakeHttp((url, init) => {
      if (url.endsWith("/robots.txt")) return robots("Allow: /");
      if (!init?.body) return text(front);
      const body = JSON.parse(String(init.body)) as { offset: number };
      bodies.push(body);
      const all = Array.from({ length: 201 }, (_, i) => vacancy(i));
      return json({ vacancies: all.slice(body.offset, body.offset + 200), count: 201 });
    });
    const raw = await emply.fetch(r, ctx(http));
    expect(calls.filter((u) => u.endsWith("get-page"))).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ count: 200, offset: 0, langCode: "da-DK", sectionId: "sec-1", siteId: null });
    expect(bodies[1]).toMatchObject({ offset: 200 });
    expect(raw).toHaveLength(201);
    expect(emply.normalize(raw[1]!, r)).toMatchObject({
      id: "emply:albertslund:v1",
      title: "Job 1",
      location: "Denmark",
      department: "Børnehuset",
      postedAt: "2026-10-13T11:26:10.098Z",
      url: "https://albertslund.career.emply.com/da/ad/job-1/s1",
      description: "Pas på børn.",
    });
  });
});

describe("bullhorn", () => {
  const r = ref("bullhorn", "1VCNF4", { shard: "91" });
  const job = (id: number) => ({
    id,
    title: "Registered Nurse (RN) Emergency Room",
    publishedCategory: { id: 2030646, name: "Registered Nurse" },
    address: { zip: "30308", city: "Atlanta", state: "GA", countryName: "United States" },
    employmentType: "Temporary",
    dateLastPublished: 1792004600333,
    publicDescription: "<p>Join the ER.</p>",
  });

  it("detects the token and swimlane from REST URLs", () => {
    expect(bullhorn.detect(new URL("https://public-rest91.bullhornstaffing.com/rest-services/1VCNF4/search/JobOrder?query=x"))).toEqual({ ats: "bullhorn", slug: "1VCNF4", shard: "91" });
    expect(bullhorn.detect(new URL("https://www.bullhorn.com/"))).toBeNull();
  });

  it("pages the public search by start", async () => {
    const { http, calls } = fakeHttp((url) => {
      if (url.endsWith("/robots.txt")) return text("Not Found", 404);
      const start = Number(new URL(url).searchParams.get("start"));
      const ids = start === 0 ? Array.from({ length: 500 }, (_, i) => i + 1) : [501];
      return json({ total: 501, start, count: ids.length, data: ids.map(job) });
    });
    const raw = await bullhorn.fetch(r, ctx(http));
    expect(raw).toHaveLength(501);
    expect(calls[1]).toContain("https://public-rest91.bullhornstaffing.com/rest-services/1VCNF4/search/JobOrder?query=(isOpen:1)%20AND%20(isDeleted:0)&fields=");
    expect(calls[2]).toContain("&start=500&");
    expect(bullhorn.normalize(raw[0]!, r)).toMatchObject({
      id: "bullhorn:1vcnf4:1",
      location: "Atlanta, GA, United States",
      department: "Registered Nurse",
      employmentType: "temporary",
      postedAt: new Date(1792004600333).toISOString(),
      url: "https://public-rest91.bullhornstaffing.com/rest-services/1VCNF4/query/JobBoardPost?where=(id=1)&fields=id,title,publishedCategory(id,name),address(city,state,zip,countryName),employmentType,dateLastPublished,publicDescription",
      description: "Join the ER.",
    });
    expect(bullhorn.normalize(raw[0]!, { ...r, site: "jobs.acme.com" }).url).toBe("https://jobs.acme.com/#/jobs/1");
  });

  it("treats a bad corp token as a closed board", async () => {
    const { http } = fakeHttp((url) => (url.endsWith("/robots.txt") ? text("", 404) : json({ errorMessage: "Bad corp token" }, 400)));
    await expect(bullhorn.fetch(r, ctx(http))).rejects.toThrow(/board not found/);
  });

  it("reads a portal's app.json", async () => {
    const { http } = fakeHttp((url) => (url.endsWith("/robots.txt") ? robots() : json({ service: { corpToken: "1VCNF4", swimlane: "91" } })));
    expect(await bullhornFromPortal("jobs.acme.com", http)).toEqual({ slug: "1VCNF4", shard: "91" });
    const none = fakeHttp(() => text("<html></html>"));
    expect(await bullhornFromPortal("www.acme.com", none.http)).toBeNull();
  });
});
