import { beforeEach, describe, expect, it } from "vitest";
import { isJobtrainSite, jobtrain } from "../src/connectors/jobtrain";
import { oleeo } from "../src/connectors/oleeo";
import { reachmee } from "../src/connectors/reachmee";
import { varbi } from "../src/connectors/varbi";
import { clearRobotsCache } from "../src/robots";
import type { CompanyRef } from "../src/schema";
import { fakeHttp } from "./helpers";

const text = (body: string, status = 200) => new Response(body, { status });
const robots = (rules = "") => text(`User-agent: *\n${rules}\n`);
const ctx = (http: ReturnType<typeof fakeHttp>["http"], partial?: () => void) => ({ http, now: new Date(), partial });
const desc = (d: string | { description?: string }) => (typeof d === "string" ? d : (d.description ?? ""));

beforeEach(() => clearRobotsCache());

describe("oleeo", () => {
  const row = (id: number, title: string, loc: string) =>
    `<tr class="opp_${id} search_res details_row" data-oppid="${id}" data-title="${title}"><td class="comm_list_tbody"><a class="subject" href="https://fcdo.tal.net/vx/lang-en-GB/mobile-0/appcentre-1/brand-2/candidate/so/pm/4/pl/1/opp/${id}-${title.replace(/\W+/g, "-")}/en-GB">\n ${title} </a></td><td class="comm_list_tbody">\n ${loc} </td><td class="comm_list_tbody">19 Oct 2026 11:55 PM EAT</td></tr>`;
  const page = (total: number, rows: string) => `<h2 role="alert">${total} Opportunities found.</h2><table>${rows}</table>`;
  const ref = { name: "FCDO", enabled: true, ats: "oleeo", slug: "fcdo", site: "1" } as CompanyRef;
  const base = "https://fcdo.tal.net/vx/lang-en-GB/candidate/jobboard/vacancy/1/adv/";

  it("detects tenant and board", () => {
    expect(oleeo.detect(new URL(base))).toEqual({ ats: "oleeo", slug: "fcdo", site: "1" });
    expect(oleeo.detect(new URL("https://justice.tal.net/vx/candidate/jobboard/vacancy/3/adv/"))).toEqual({ ats: "oleeo", slug: "justice", site: "3" });
    expect(oleeo.detect(new URL("https://example.com/vx/"))).toBeNull();
  });

  it("pages by ?start= until the stated total", async () => {
    const { http, calls } = fakeHttp((url) => {
      if (url.endsWith("/robots.txt")) return robots("Disallow: /*/agent/\nCrawl-delay: 10");
      return text(url.includes("start=50") ? page(3, row(3, "Policy Officer", "London")) : page(3, row(1, "Finance Analyst HEO DAR", "Dar Es Salaam") + row(2, "Intern", "Sao Paulo")));
    });
    const raw = await oleeo.fetch(ref, ctx(http));
    expect(calls.slice(1)).toEqual([base, `${base}?start=50`]);
    expect(raw.map((r) => oleeo.normalize(r, ref)).map((j) => [j.id, j.title, j.location])).toEqual([
      ["oleeo:fcdo:1", "Finance Analyst HEO DAR", "Dar Es Salaam"],
      ["oleeo:fcdo:2", "Intern", "Sao Paulo"],
      ["oleeo:fcdo:3", "Policy Officer", "London"],
    ]);
  });

  it("stops at the page cap and says the read is partial", async () => {
    let n = 0;
    const { http } = fakeHttp((url) => (url.endsWith("/robots.txt") ? robots() : text(page(5000, row(++n, `Job ${n}`, "London")))));
    let partial = false;
    const raw = await oleeo.fetch(
      ref,
      ctx(http, () => (partial = true)),
    );
    expect(raw).toHaveLength(20);
    expect(partial).toBe(true);
  });

  it("reads the description and the Location field from the job page", async () => {
    const html = `<h1>View Vacancy</h1><div class="eform form-view"><form class="form-view form-horizontal"><span class="hform_lbl_text"  >Job Description</span><div class="form-control-static" role="definition"><p>Lead audits.</p></div><span class="hform_lbl_text"  >Location (City)</span></label><div class="form-control-static" role="definition"\n data-field_value="x" >\nKingston\n</div></form><footer>Cookies</footer>`;
    const { http } = fakeHttp(() => text(html));
    const d = await oleeo.describe!({ id: "1", title: "Officer", location: "", url: "https://fcdo.tal.net/x" }, ref, ctx(http));
    expect(d).toMatchObject({ location: "Kingston" });
    expect(desc(d)).toContain("Lead audits.");
    expect(desc(d)).not.toContain("Cookies");
  });
});

describe("jobtrain", () => {
  const card = (id: number, title: string) =>
    `<div class="job-card"><a tabindex="0" class="mb-15" href="/Job/JobDetail?JobId=${id}" data-testid="a-job-detail-${title}">\n ${title}\n</a><p class="jobdetailsitem salary"><strong>Salary:</strong> Band 2 (&#xA3;26,696)</p><p class="jobdetailsitem location">\n<strong>Location:</strong>\nWestern General Hospital </p><p class="jobdetailsitem employmenttype"><strong>Employment type:</strong> Permanent</p><p class="jobdetailsitem livedate"><strong>Live date:</strong> 19/10/2026</p><p class="jobdetailsitem school"><strong>Employer (NHS Board):</strong> NHS Lothian </p><a class="job-card__link" href="/Job/JobDetail?JobId=${id}">More..</a></div>`;
  const frag = (total: number, cards: string) => `<input type="hidden" id="totalMatchRecords" value="${total}">${cards}`;
  const ref = { name: "NHS Scotland", enabled: true, ats: "jobtrain", slug: "apply.jobs.scot.nhs.uk" } as CompanyRef;

  it("has no URL detection: sites are found by probe", async () => {
    expect(jobtrain.detect(new URL("https://apply.jobs.scot.nhs.uk/"))).toBeNull();
    const { http } = fakeHttp((url) => (url.endsWith("/robots.txt") ? text("", 404) : url.includes("good.example") ? text(frag(0, "")) : text("<html></html>")));
    expect(await isJobtrainSite("good.example.org", http)).toBe(true);
    expect(await isJobtrainSite("other.example.org", http)).toBe(false);
  });

  it("reads the cards by Skip until the total", async () => {
    const { http, calls } = fakeHttp((url) => {
      if (url.endsWith("/robots.txt")) return text("", 404);
      return text(url.endsWith("Skip=0") ? frag(3, card(1, "General Porter") + card(2, "Housekeeper")) : frag(3, card(3, "Nurse")));
    });
    const raw = await jobtrain.fetch(ref, ctx(http));
    expect(calls.slice(1)).toEqual(["https://apply.jobs.scot.nhs.uk/Home/_JobCard?Skip=0", "https://apply.jobs.scot.nhs.uk/Home/_JobCard?Skip=2"]);
    const j = jobtrain.normalize(raw[0]!, ref);
    expect(j).toMatchObject({
      id: "jobtrain:apply.jobs.scot.nhs.uk:1",
      title: "General Porter",
      location: "Western General Hospital",
      postedAt: "2026-10-19T00:00:00.000Z",
      employmentType: "full-time",
      url: "https://apply.jobs.scot.nhs.uk/Job/JobDetail?JobId=1",
    });
    expect(raw[0]!.employer).toBe("NHS Lothian");
    expect(raw).toHaveLength(3);
  });

  it("says when a host isn't a Jobtrain site", async () => {
    const { http } = fakeHttp((url) => (url.endsWith("/robots.txt") ? text("", 404) : text("<html></html>")));
    await expect(jobtrain.fetch(ref, ctx(http))).rejects.toThrow(/not a Jobtrain site/);
  });

  it("reads the advert from the job page", async () => {
    const html = `<h1>Porter</h1><div class="job-advert__media-rich" data-testid="div-job-discription"><h2>Job Advert</h2><div id="Media_Rich_Advert"><p>Move patients safely.</p></div></div><div class="d-flex" data-testid="div-job-other-details"><div>About NHS Lothian</div></div>`;
    const { http } = fakeHttp(() => text(html));
    const d = desc(await jobtrain.describe!({ id: "1", title: "Porter", location: "", url: "https://x/Job/JobDetail?JobId=1", employmentType: "", liveDate: "", employer: "" }, ref, ctx(http)));
    expect(d).toContain("Move patients safely.");
    expect(d).not.toContain("About NHS Lothian");
    expect(d).not.toContain("<");
  });
});

describe("varbi", () => {
  const feed = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>New jobs</title><link>https://www.varbi.com</link><item><title>Forskningsassistent</title><link>https://su.varbi.com/en/what:job/jobID:979357/</link><description>Arbetsuppgifter\nForska &amp; undervisa.</description><pubDate>Fri, 16 Oct 2026 00:00:00 +0200</pubDate><guid>https://su.varbi.com/en/what:job/jobID:979357/</guid></item></channel></rss>`;
  const ref = { name: "Stockholms universitet", enabled: true, ats: "varbi", slug: "su" } as CompanyRef;

  it("detects the tenant", () => {
    expect(varbi.detect(new URL("https://su.varbi.com/se/"))).toEqual({ ats: "varbi", slug: "su" });
    expect(varbi.detect(new URL("https://www.varbi.com/"))).toBeNull();
  });

  it("reads the RSS feed in one request; the place comes from the job page", async () => {
    const { http, calls } = fakeHttp((url) => (url.endsWith("/robots.txt") ? robots() : text(feed)));
    const raw = await varbi.fetch(ref, ctx(http));
    expect(calls.slice(1)).toEqual(["https://su.varbi.com/what:rssfeed/"]);
    const j = varbi.normalize(raw[0]!, ref);
    expect(j).toMatchObject({ id: "varbi:su:979357", title: "Forskningsassistent", location: "", postedAt: "2026-10-15T22:00:00.000Z", url: "https://su.varbi.com/en/what:job/jobID:979357/" });
    expect(j.description).toContain("Forska & undervisa.");
    expect(varbi.vagueLocation!(raw[0]!)).toBe(true);

    const page = `<table><tr class="quick-info-town"><th scope="row">Ort</th><td>Stockholm</td></tr><tr class="quick-info-county"><th>Län</th><td>Stockholms län</td></tr><tr class="quick-info-country"><th>Land</th><td>Sverige</td></tr></table>`;
    const d = await varbi.describe!(raw[0]!, ref, ctx(fakeHttp(() => text(page)).http));
    expect(d).toMatchObject({ location: "Stockholm, Sverige" });
  });

  it("calls a missing feed a closed board", async () => {
    const { http } = fakeHttp((url) => (url.endsWith("/robots.txt") ? robots() : text("", 404)));
    await expect(varbi.fetch(ref, ctx(http))).rejects.toThrow(/board not found/);
  });
});

describe("reachmee", () => {
  const cjs = `var iFrameUrl = 'https://web103.reachmee.com/ext/';\nvar validator = 'cb1621ed77b7f3ffe36371034a533994';\nvar iid = 'I021';\nvar customer = '1746';\nvar site = '6';\nvar langDef = 'SE';`;
  const main = `<table class='table table-hover jobsTableClass' id='jobsTable' ><caption>Lista</caption><thead><tr><th id='col-1'>Tjänst <i></i></th><th id='col-9'>Ort <i></i></th><th id='col-6'>Sista ansökningsdag <i></i></th></tr></thead><tbody><tr><td><a href='https://web103.reachmee.com/ext/I021/1746/job?site=6&lang=SE&validator=cb1621ed77b7f3ffe36371034a533994&job_id=108' class='btn btn-link'>Arbetsgivarverket söker en utredare</a></td><td>Stockholm</td><td><span class='show-mobile'>Sista ansökningsdag:</span> 2026-10-30</td></tr></tbody></table>`;
  const ref = { name: "Arbetsgivarverket", enabled: true, ats: "reachmee", slug: "I021-1746", site: "6" } as CompanyRef;

  it("detects the iframe and site-script URLs, never siteNNN hosts", () => {
    expect(reachmee.detect(new URL("https://web103.reachmee.com/ext/I021/1746/main?site=6&validator=abc&lang=SE"))).toEqual({ ats: "reachmee", slug: "I021-1746", site: "6" });
    expect(reachmee.detect(new URL("https://web103.reachmee.com/customerjs/I021-1746-6.js"))).toEqual({ ats: "reachmee", slug: "I021-1746", site: "6" });
    expect(reachmee.detect(new URL("https://web103.reachmee.com/ext/I021/1746/main"))).toBeNull();
    expect(reachmee.detect(new URL("https://site106.reachmee.com/I021/1746/main?site=6"))).toBeNull();
  });

  it("reads the validator from the site script, then the job table", async () => {
    const { http, calls } = fakeHttp((url) => (url.endsWith("/robots.txt") ? text("", 404) : url.includes("/customerjs/") ? text(cjs) : text(main)));
    const raw = await reachmee.fetch(ref, ctx(http));
    expect(calls.slice(1)).toEqual([
      "https://web103.reachmee.com/customerjs/I021-1746-6.js",
      "https://web103.reachmee.com/ext/I021/1746/main?site=6&validator=cb1621ed77b7f3ffe36371034a533994&lang=SE",
    ]);
    expect(raw.map((r) => reachmee.normalize(r, ref)).map((j) => [j.id, j.title, j.location, j.url])).toEqual([
      [
        "reachmee:i021-1746:108",
        "Arbetsgivarverket söker en utredare",
        "Stockholm",
        "https://web103.reachmee.com/ext/I021/1746/job?site=6&lang=SE&validator=cb1621ed77b7f3ffe36371034a533994&job_id=108",
      ],
    ]);
  });

  it("reads the advert from the job page", async () => {
    const html = `<main><h1 id="jobad-heading">Utredare</h1><p class="text-color-muted extid">Stockholm</p><div class="jobad-body"><p class="prefix-text"></p><p>Vi söker en utredare.</p><p class="suffix-text"></p></div><p class="text-secondary">Länk till den här sidan</p></main>`;
    const { http } = fakeHttp(() => text(html));
    const d = await reachmee.describe!({ id: "108", title: "Utredare", location: "", url: "https://web103.reachmee.com/ext/I021/1746/job?job_id=108" }, ref, ctx(http));
    expect(d).toMatchObject({ location: "Stockholm" });
    expect(desc(d)).toBe("Vi söker en utredare.");
  });
});
