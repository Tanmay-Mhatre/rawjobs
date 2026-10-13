import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config";
import { connectors } from "../src/connectors";
import { jsonAfter, relativePosted } from "../src/connectors/parse";
import { runRadar } from "../src/run";
import type { AtsType, CompanyRef } from "../src/schema";
import { company, fakeHttp, json } from "./helpers";

const now = new Date("2026-10-09T12:00:00Z");
const text = (body: string, type = "text/html") => new Response(body, { status: 200, headers: { "content-type": type } });

/** Fetch + normalize one company through its connector, with every request answered by `route`. */
async function run(ats: AtsType, ref: Partial<CompanyRef>, route: (url: string, init?: RequestInit) => Response) {
  const { http, calls } = fakeHttp(route);
  const c = connectors[ats]!;
  const r = company(ats, ref);
  const raws = await c.fetch(r, { http, now });
  return { raws, jobs: raws.map((x) => c.normalize(x, r)), calls, http, c, ref: r };
}

describe("workday connector", () => {
  const posting = (n: number, locationsText = "Dubai") => ({ title: `Product Manager ${n}`, externalPath: `/job/Dubai/PM_${n}`, locationsText, postedOn: "Posted 3 Days Ago", remoteType: "Hybrid" });

  it("pages 20 at a time using the first page's total, and turns 'Posted 3 Days Ago' into a date", async () => {
    const { jobs, calls } = await run("workday", { slug: "bank", shard: "wd3", site: "External" }, (_url, init) => {
      const { offset } = JSON.parse(String(init!.body)) as { offset: number };
      // Workday reports the total on the first page only.
      return json({ total: offset === 0 ? 25 : 0, jobPostings: Array.from({ length: offset === 0 ? 20 : 5 }, (_, i) => posting(offset + i)) });
    });
    expect(calls).toEqual(["https://bank.wd3.myworkdayjobs.com/wday/cxs/bank/External/jobs", "https://bank.wd3.myworkdayjobs.com/wday/cxs/bank/External/jobs"]);
    expect(jobs).toHaveLength(25);
    expect(jobs[0]).toMatchObject({
      id: "workday:bank|external:0",
      title: "Product Manager 0",
      location: "Dubai",
      workplace: "hybrid",
      url: "https://bank.wd3.myworkdayjobs.com/External/job/Dubai/PM_0",
      postedAt: new Date(now.getTime() - 3 * 86_400_000).toISOString(),
    });
  });

  it("looks up the real places of a '2 Locations' job before the location gate", async () => {
    const config = parseConfig(`
profile:
  titles: { include: ["product manager"] }
  locations: { include: ["dubai"] }
companies:
  - { name: "Bank", ats: workday, slug: "bank", shard: "wd3", site: "External" }
`);
    const { http, calls } = fakeHttp((url) => {
      if (url.endsWith("/jobs")) return json({ total: 2, jobPostings: [posting(1, "2 Locations"), { ...posting(2, "2 Locations"), title: "Accountant" }] });
      return json({ jobPostingInfo: { location: "London", additionalLocations: ["Dubai"], jobDescription: "<p>Payments</p>", country: { descriptor: "United Kingdom" } } });
    });
    const result = await runRadar(config, { http, now });
    const pm = result.jobs.find((j) => j.title === "Product Manager 1")!;
    expect(pm).toMatchObject({ location: "London; Dubai", description: "Payments" });
    expect(pm.why.gate).toBeUndefined();
    // The accountant fails the title gate, so its page is never fetched.
    expect(calls.filter((u) => u.includes("/job/"))).toEqual(["https://bank.wd3.myworkdayjobs.com/wday/cxs/bank/External/job/Dubai/PM_1"]);
  });
});

describe("JSON feed connectors", () => {
  it("workable: one widget request, locations and remote", async () => {
    const { jobs, calls } = await run("workable", { slug: "acme" }, () =>
      json({
        jobs: [
          {
            title: "PM",
            shortcode: "AB12",
            telecommuting: true,
            department: "Product",
            url: "https://apply.workable.com/j/AB12",
            published_on: "2026-10-01",
            locations: [{ city: "Dubai", country: "United Arab Emirates" }],
            description: "<p>Hi</p>",
          },
        ],
      }),
    );
    expect(calls).toEqual(["https://apply.workable.com/api/v1/widget/accounts/acme?details=true"]);
    expect(jobs[0]).toMatchObject({ id: "workable:acme:AB12", location: "Dubai, United Arab Emirates, Remote", workplace: "remote", department: "Product", description: "Hi" });
  });

  it("recruitee: salary, workplace and description with requirements", async () => {
    const { jobs, calls } = await run("recruitee", { slug: "acme" }, () =>
      json({
        offers: [
          {
            id: 7,
            title: "PM",
            careers_url: "https://acme.recruitee.com/o/pm",
            hybrid: true,
            locations: [{ city: "Berlin", country: "Germany" }],
            published_at: "2026-10-01 10:00:00 UTC",
            description: "<p>A</p>",
            requirements: "<p>B</p>",
            salary: { min: "50000", max: "70000", currency: "EUR", period: "year" },
          },
        ],
      }),
    );
    expect(calls).toEqual(["https://acme.recruitee.com/api/offers/"]);
    expect(jobs[0]).toMatchObject({
      location: "Berlin, Germany",
      workplace: "hybrid",
      postedAt: "2026-10-01T10:00:00.000Z",
      description: "A\n\nB",
      salary: { min: 50000, max: 70000, currency: "EUR", period: "year" },
    });
  });

  it("bamboohr: list, then the detail page for description and date", async () => {
    const { raws, jobs, http, c, ref } = await run("bamboohr", { slug: "acme" }, (url) =>
      url.endsWith("/list")
        ? json({ result: [{ id: "330", jobOpeningName: "PM", departmentLabel: "Product", location: { city: "Limassol", state: null }, atsLocation: { country: "Cyprus" }, locationType: "2" }] })
        : json({ result: { jobOpening: { description: "<p>Role</p>", datePosted: "2026-05-19" } } }),
    );
    expect(jobs[0]).toMatchObject({ location: "Limassol, Cyprus", workplace: "hybrid", url: "https://acme.bamboohr.com/careers/330" });
    expect(await c.describe!(raws[0], ref, { http, now })).toMatchObject({ description: "Role", postedAt: "2026-05-19T00:00:00.000Z" });
  });

  it("bamboohr and freshteam say plainly when a company's board is gone, instead of a JSON error", async () => {
    // BambooHR sends a gone account to its home page and a switched-off careers page to the login.
    const redirected = (to: string) => Object.defineProperty(text("<!DOCTYPE html><title>BambooHR</title>"), "url", { value: to });
    await expect(run("bamboohr", { slug: "acme" }, () => redirected("https://www.bamboohr.com/"))).rejects.toThrow('BambooHR board not found: "acme" no longer exists');
    await expect(run("bamboohr", { slug: "acme" }, () => redirected("https://acme.bamboohr.com/login.php"))).rejects.toThrow("has its careers page switched off");
    await expect(run("bamboohr", { slug: "acme" }, () => new Response("", { status: 401 }))).rejects.toThrow("has its careers page switched off");
    // Any other page is still an ordinary error (retried), not a closed board.
    await expect(run("bamboohr", { slug: "acme" }, () => redirected("https://acme.bamboohr.com/careers/list"))).rejects.toThrow("unexpected BambooHR response");
    await expect(run("freshteam", { slug: "acme" }, () => text("<h3>We couldn't find</h3> May be this is still fresh!"))).rejects.toThrow('Freshteam board not found: "acme" no longer exists');
    await expect(run("freshteam", { slug: "acme" }, () => text("Your account is blocked. Please reach out to our support team"))).rejects.toThrow("is blocked by Freshteam");
    await expect(run("freshteam", { slug: "acme" }, () => text("<html>maintenance</html>"))).rejects.toThrow("unexpected Freshteam response");
  });

  it("breezy: list, then the JobPosting on the job page", async () => {
    const { raws, jobs, http, c, ref } = await run("breezy", { slug: "acme" }, (url) =>
      url.endsWith("/json")
        ? json([
            {
              id: "e1",
              name: "PM",
              url: "https://acme.breezy.hr/p/e1-pm",
              published_date: "2026-08-20T16:26:00Z",
              location: { country: { name: "United States" }, is_remote: true, name: "United States" },
            },
          ])
        : text(`<script type="application/ld+json">{"@type":"JobPosting","description":"<p>Build things</p>"}</script>`),
    );
    expect(jobs[0]).toMatchObject({ location: "United States, Remote", workplace: "remote" });
    expect(await c.describe!(raws[0], ref, { http, now })).toBe("Build things");
  });

  it("pinpoint, rippling, hibob, freshteam", async () => {
    const pin = await run("pinpoint", { slug: "acme" }, () =>
      json({
        data: [
          {
            id: "1",
            title: "PM",
            url: "https://acme.pinpointhq.com/en/postings/x",
            workplace_type: "remote",
            location: { city: "Cairo", name: "Egypt" },
            job: { department: { name: "Ops" } },
            description: "<p>D</p>",
          },
        ],
      }),
    );
    expect(pin.jobs[0]).toMatchObject({ location: "Cairo, Egypt, Remote", workplace: "remote", department: "Ops", description: "D" });

    const rip = await run("rippling", { slug: "acme" }, (url) =>
      json(
        url.includes("page=0")
          ? {
              items: [{ id: "u1", name: "PM", url: "https://ats.rippling.com/acme/jobs/u1", locations: [{ name: "New York, NY", country: "United States", workplaceType: "ON_SITE" }] }],
              totalPages: 2,
            }
          : { items: [{ id: "u2", name: "PM 2", url: "x", locations: [] }], totalPages: 2 },
      ),
    );
    expect(rip.calls).toEqual(["https://ats.rippling.com/api/v2/board/acme/jobs?page=0&pageSize=50", "https://ats.rippling.com/api/v2/board/acme/jobs?page=1&pageSize=50"]);
    expect(rip.jobs[0]).toMatchObject({ location: "New York, NY", workplace: "onsite", country: "United States" });

    const bob = await run("hibob", { slug: "acme" }, (_url, init) => {
      expect((init!.headers as Record<string, string>).companyidentifier).toBe("acme");
      return json({ jobAdDetails: [{ id: "g1", title: "PM", site: "Gibraltar", country: "Gibraltar", workspaceTypeId: "on_site", description: "<b>D</b>" }] });
    });
    expect(bob.jobs[0]).toMatchObject({ location: "Gibraltar", workplace: "onsite", url: "https://acme.careers.hibob.com/jobs/g1" });

    const fresh = await run("freshteam", { slug: "acme" }, () =>
      json({
        jobs: [{ id: 3, title: "PM", url: "https://acme.freshteam.com/jobs/x/pm", branch_id: 9, job_role_id: 1, remote: false }],
        branches: [{ id: 9, city: "Espoo", state: "Uusimaa", country_code: "FI" }],
        job_roles: [{ id: 1, name: "All Departments" }],
      }),
    );
    expect(fresh.jobs[0]).toMatchObject({ location: "Espoo, Uusimaa, Finland", country: "Finland", department: undefined });
  });

  it("oracle: requisitions from the candidate-experience API, paged by its total", async () => {
    const { jobs, calls } = await run("oracle", { slug: "abcd", shard: "em2", site: "CX_1" }, () =>
      json({
        items: [
          {
            TotalJobsCount: 1,
            requisitionList: [
              { Id: "332", Title: "Legal Counsel", PostedDate: "2026-09-24", PrimaryLocation: "Abu Dhabi, United Arab Emirates", PrimaryLocationCountry: "AE", WorkplaceTypeCode: "ORA_HYBRID" },
            ],
          },
        ],
      }),
    );
    expect(calls[0]).toContain("https://abcd.fa.em2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?");
    expect(decodeURIComponent(calls[0]!)).toContain("siteNumber=CX_1,limit=200,offset=0");
    expect(jobs[0]).toMatchObject({ country: "United Arab Emirates", workplace: "hybrid", url: "https://abcd.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/332" });
  });
});

describe("feed connectors (XML and embedded data)", () => {
  it("personio: positions with every office and the description sections", async () => {
    const xml = `<?xml version="1.0"?><workzag-jobs><position><id>12</id><office>Berlin</office><additionalOffices><office>Hybrid</office><office>Munich</office></additionalOffices><department>Product</department><name>Product Manager</name><jobDescriptions><jobDescription><name>Your role</name><value><![CDATA[<p>Own payments</p>]]></value></jobDescription></jobDescriptions><createdAt>2026-09-01T10:00:00+00:00</createdAt></position></workzag-jobs>`;
    const { jobs, calls } = await run("personio", { slug: "acme" }, () => text(xml, "text/xml"));
    expect(calls).toEqual(["https://acme.jobs.personio.com/xml"]);
    expect(jobs[0]).toMatchObject({
      id: "personio:acme:12",
      title: "Product Manager",
      location: "Berlin; Hybrid; Munich",
      workplace: "hybrid",
      department: "Product",
      description: "Your role\nOwn payments",
    });
  });

  it("successfactors: a career site (RMK) is read from its search pages, descriptions from the job page", async () => {
    const row = (id: number, title: string, place: string) =>
      `<tr class="data-row"><td class="colTitle"><span class="jobTitle hidden-phone"><a href="/job/${place}-${title.replace(/ /g, "-")}/${id}/" class="jobTitle-link">${title}</a></span><span class="jobDate visible-phone">Oct 13, 2026
</span></td><td class="colDepartment"><span class="jobDepartment">Engineering &amp; Science</span></td><td class="colLocation"><span class="jobLocation">
${place}, NL</span></td></tr>`;
    const page = (rows: string) => `<div class="searchResultsShell"><span class="paginationLabel">Results <b>1 – 25</b> of <b>27</b></span><table id="searchresults">${rows}</table></div>`;
    const first = Array.from({ length: 25 }, (_, i) => row(100 + i, `Role ${i}`, "Delft")).join("");
    const { jobs, calls, raws, c, ref, http } = await run("successfactors", { slug: "jobs.acme.com" }, (url) => {
      if (url.includes("startrow=0")) return text(page(first));
      if (url.includes("startrow=25")) return text(page(row(200, "Installatie monteur", "Heerhugowaard") + row(201, "Planner", "Delft").replace('href="/job/', 'href="/AEI/job/')));
      return text('<div class="job"><span itemprop="description" class="jobdescription"><p>Fix <span>heat</span> pumps</p></span></div><span>after</span>');
    });
    expect(calls).toEqual(["https://jobs.acme.com/search/?q=&startrow=0", "https://jobs.acme.com/search/?q=&startrow=25"]);
    expect(jobs).toHaveLength(27);
    expect(jobs[26]!.url).toBe("https://jobs.acme.com/AEI/job/Delft-Planner/201/"); // a brand-prefixed path
    expect(jobs[25]).toMatchObject({
      id: "successfactors:jobs.acme.com:200",
      title: "Installatie monteur",
      location: "Heerhugowaard, NL",
      department: "Engineering & Science",
      postedAt: "2026-10-13T00:00:00.000Z",
      url: "https://jobs.acme.com/job/Heerhugowaard-Installatie-monteur/200/",
    });
    expect(await c.describe!(raws[25]!, ref, { http, now: new Date() })).toBe("Fix heat pumps");
  });

  it("successfactors: a career site on a newer template is refused, not read as empty", async () => {
    await expect(run("successfactors", { slug: "jobs.acme.com" }, () => text("<html><div id='app'></div></html>"))).rejects.toThrow(/template isn't readable yet/);
  });

  it("teamtailor: a site on the company's own domain is read there, and must be Teamtailor's feed", async () => {
    const ttFeed = `<rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel><title>Acme </title><item><title>PM</title><link>https://careers.acme.com/jobs/1-pm</link><guid>g-1</guid></item></channel></rss>`;
    const { jobs, calls } = await run("teamtailor", { slug: "careers.acme.com" }, () => text(ttFeed, "application/rss+xml"));
    expect(calls[0]).toBe("https://careers.acme.com/jobs.rss");
    expect(jobs[0]).toMatchObject({ title: "PM", url: "https://careers.acme.com/jobs/1-pm" });
    await expect(run("teamtailor", { slug: "careers.acme.com" }, () => text('<rss version="2.0"><channel></channel></rss>', "application/rss+xml"))).rejects.toThrow(/not a Teamtailor careers site/);
    await expect(run("teamtailor", { slug: "evil.com/x" }, () => text(ttFeed))).rejects.toThrow(/not a careers site host/);
  });

  it("teamtailor: RSS items with locations, department and remote status", async () => {
    const rss = `<rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel><item><title>PM</title><description>&lt;p&gt;Role&lt;/p&gt;</description><pubDate>Fri, 24 Jul 2026 09:05:16 +0200</pubDate><link>https://acme.teamtailor.com/jobs/1-pm</link><remoteStatus>fully</remoteStatus><guid>g-1</guid><tt:locations><tt:location><tt:name>HQ</tt:name><tt:city>Stockholm</tt:city><tt:country>Sweden</tt:country></tt:location></tt:locations><tt:department>Product</tt:department></item></channel></rss>`;
    const { jobs } = await run("teamtailor", { slug: "acme" }, () => text(rss, "application/rss+xml"));
    expect(jobs[0]).toMatchObject({ location: "Stockholm, Sweden, Remote", workplace: "remote", department: "Product", postedAt: "2026-07-24T07:05:16.000Z", description: "Role" });
  });

  it("successfactors: the XML listing, with the company's own location filters", async () => {
    const xml = `<?xml version="1.0"?><Job-Listing><Job><JobTitle><![CDATA[Affiliates Lead]]></JobTitle><Job-Description><![CDATA[<p>Grow partners</p>]]></Job-Description><ReqId>3979</ReqId><filter1><label>Country</label><value>Jordan</value></filter1><filter2><label>Location</label><value>Amman</value></filter2></Job></Job-Listing>`;
    const { jobs, calls } = await run("successfactors", { slug: "Acme", careers_url: "https://career2.successfactors.eu/portalcareer?company=Acme" }, () => text(xml, "application/octet-stream"));
    expect(calls).toEqual(["https://career2.successfactors.eu/career?company=Acme&career_ns=job_listing_summary&resultType=XML"]);
    expect(jobs[0]).toMatchObject({ title: "Affiliates Lead", location: "Amman, Jordan", country: "Jordan", description: "Grow partners" });
  });

  it("comeet: the positions the hosted page embeds, falling back to the company name for its address", async () => {
    const page = `<script>var COMPANY_POSITIONS_DATA = [{"uid":"5A.D65","name":"PM; Payments","department":"Product","location":{"name":"Tel Aviv","country":"IL","city":"Tel Aviv"},"workplace_type":"Hybrid","url_active_page":"https://acme.com/p/5a","custom_fields":{"details":[{"name":"Description","value":"<p>Own it</p>"}]}}];</script>`;
    const { jobs, calls } = await run("comeet", { slug: "41.009", name: "Acme Inc" }, () => text(page));
    expect(calls).toEqual(["https://www.comeet.com/jobs/acme-inc/41.009"]);
    expect(jobs[0]).toMatchObject({ title: "PM; Payments", location: "Tel Aviv, Israel", workplace: "hybrid", url: "https://acme.com/p/5a", description: "Description\nOwn it" });
  });

  it("zoho: the job list in the page's hidden input", async () => {
    const data = JSON.stringify([{ id: "56", Posting_Title: "Senior Accountant", City: "Surat", Country: "India", Job_Description: "GST & TDS", Date_Opened: "2026-10-02", Publish: true }])
      .replace(/"/g, "&#34;")
      .replace(/&(?!#34;)/g, "&amp;");
    const { jobs } = await run("zoho", { slug: "acme" }, () => text(`<input type="hidden" value="${data}" id="jobs">`));
    expect(jobs[0]).toMatchObject({ title: "Senior Accountant", location: "Surat, India", description: "GST & TDS", url: "https://acme.zohorecruit.com/jobs/Careers/56/Senior-Accountant" });
  });

  it("zoho: a board on another data centre is read from that domain", async () => {
    const data = JSON.stringify([{ id: "7", Posting_Title: "Analyst", Publish: true }]).replace(/"/g, "&#34;");
    const { jobs, calls } = await run("zoho", { slug: "acme", shard: "in" }, () => text(`<input type="hidden" value="${data}" id="jobs">`));
    expect(calls[0]).toBe("https://acme.zohorecruit.in/jobs/Careers");
    expect(jobs[0]?.url).toBe("https://acme.zohorecruit.in/jobs/Careers/7/Analyst");
  });

  it("zoho: an unknown data centre falls back to .com", async () => {
    const { calls } = await run("zoho", { slug: "acme", shard: "evil.example" }, () => text(`<input type="hidden" value="[]" id="jobs">`));
    expect(calls[0]).toBe("https://acme.zohorecruit.com/jobs/Careers");
  });
});

describe("page connectors", () => {
  it("taleo: reads the portal number, then pages the section's search", async () => {
    const { jobs, calls } = await run("taleo", { slug: "aa010", site: "ext" }, (url) => {
      if (url.includes("jobsearch.ftl")) return text(`<a href="x?portal=8116760768">`);
      return json({
        requisitionList: [{ jobId: "1", contestNo: "26A", column: ["Planning Engineer", '["Dubai","Abu Dhabi"]', "Oct 7, 2026"], locationsColumns: [1] }],
        pagingData: { pageSize: 25, totalCount: 1 },
      });
    });
    expect(calls).toEqual(["https://aa010.taleo.net/careersection/ext/jobsearch.ftl?lang=en", "https://aa010.taleo.net/careersection/rest/jobboard/searchjobs?lang=en&portal=8116760768"]);
    expect(jobs[0]).toMatchObject({ id: "taleo:aa010|ext:26A", title: "Planning Engineer", location: "Dubai; Abu Dhabi", postedAt: "2026-10-07T00:00:00.000Z" });
  });

  it("icims: job cards across pages", async () => {
    const card = (id: number, title: string) =>
      `<li class="iCIMS_JobCardItem"><span class="sr-only field-label">Job Location</span><span>US-NJ-Newark</span><a href="https://careers-acme.icims.com/jobs/${id}/x/job?in_iframe=1" title="${id} - ${title}"><h3>${title}</h3></a><dt>Posted Date</dt><dd><span title="10/8/2026 12:57 PM">1 day ago</span></dd></li>`;
    const { jobs, calls } = await run("icims", { slug: "careers-acme" }, (url) =>
      text(`<div>iCIMS</div>Page ${url.endsWith("pr=0") ? 1 : 2} of 2${url.endsWith("pr=0") ? card(1, "Store Supervisor") : card(2, "Parts Specialist")}`),
    );
    expect(calls).toHaveLength(2);
    expect(jobs.map((j) => j.title)).toEqual(["Store Supervisor", "Parts Specialist"]);
    expect(jobs[0]).toMatchObject({ location: "US-NJ-Newark", url: "https://careers-acme.icims.com/jobs/1/x/job" });
  });

  it("jobvite: search pages until there is no next link", async () => {
    const row = (id: string, title: string) => `<tr><td class="jv-job-list-name"><a href="/acme/job/${id}">${title}</a></td><td class="jv-job-list-location">Chicago, Illinois</td></tr>`;
    const { jobs, calls } = await run("jobvite", { slug: "acme" }, (url) =>
      text(url.endsWith("p=0") ? `${row("o1", "Analyst")}<a href="/acme/search/?p=1" class="jv-pagination-next">` : row("o2", "Data Scientist")),
    );
    expect(calls).toEqual(["https://jobs.jobvite.com/acme/search?p=0", "https://jobs.jobvite.com/acme/search?p=1"]);
    expect(jobs.map((j) => [j.title, j.location])).toEqual([
      ["Analyst", "Chicago, Illinois"],
      ["Data Scientist", "Chicago, Illinois"],
    ]);
  });

  it("jazzhr: the careers page list", async () => {
    const page = `resumator<li class="list-group-item"><h3><a href="https://acme.applytojob.com/apply/Eny4/BI-Analyst">BI Analyst</a></h3><ul><li><i class='fa fa-map-marker'></i>New York, NY</li><li><i class='fa fa-sitemap'></i>Data</li></ul></li>`;
    const { jobs } = await run("jazzhr", { slug: "acme" }, () => text(page));
    expect(jobs[0]).toMatchObject({ id: "jazzhr:acme:Eny4", title: "BI Analyst", location: "New York, NY", department: "Data" });
  });
});

describe("parse helpers", () => {
  it("jsonAfter reads a value with brackets and quotes inside strings", () => {
    expect(jsonAfter(`x = [{"a":"] } [","b":[1,2]}]; y = 2`, "x =")).toEqual([{ a: "] } [", b: [1, 2] }]);
    expect(jsonAfter("nothing here", "x =")).toBeUndefined();
  });

  it("relativePosted handles today, days, 30+ and unknown text", () => {
    expect(relativePosted("Posted Today", now)).toBe(now.toISOString());
    expect(relativePosted("Posted 30+ Days Ago", now)).toBe(new Date(now.getTime() - 30 * 86_400_000).toISOString());
    expect(relativePosted("Posted recently", now)).toBeUndefined();
  });
});
