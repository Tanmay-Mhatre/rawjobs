import { describe, expect, it } from "vitest";
import { ownCareersLink, ownedBy, ownerLabels, ownSiteLinks, planTenants, workdayTenantOf } from "./own-sites";

describe("own careers sites of Workday companies", () => {
  it("reads the tenant from a Workday board key", () => {
    expect(workdayTenantOf("workday:Adobe|wd5|external_experienced")).toEqual({ id: "adobe|wd5", tenant: "adobe" });
    expect(workdayTenantOf("phenom:careers.adobe.com")).toBeUndefined();
  });

  it("accepts boards carrying the company's name, on its own hosts or a hiring system's", () => {
    const labels = ownerLabels({ tenant: "disney", websites: [{ website: "https://www.disney.com/", name: "Disney", from: "resolved" }] });
    expect(labels).toEqual(["disney"]);
    expect(ownedBy({ slug: "join.disneycareers.com" }, labels)).toBe(true);
    expect(ownedBy({ slug: "careers-disney" }, labels)).toBe(true);
    expect(ownedBy({ slug: "careers.marvel.com" }, labels)).toBe(false);
    expect(ownedBy({ slug: "indeed" }, labels)).toBe(false);
    // Short names match too much by accident: left out.
    expect(ownerLabels({ tenant: "ngc", websites: [] })).toEqual([]);
  });

  it("doesn't take a subsidiary's name for the parent's (Splunk's site for Cisco's tenant)", () => {
    const labels = ownerLabels({
      tenant: "cisco",
      websites: [
        { website: "https://www.splunk.com/", name: "Splunk", from: "resolved" },
        { website: "https://www.cisco.com/", name: "Cisco", from: "resolved" },
      ],
    });
    expect(labels).toEqual(["cisco"]);
    expect(ownedBy({ slug: "careers.splunk.com" }, labels)).toBe(false);
    // A website the tenant's name contains is the company's own ("my7elevenhr" and 7-eleven.com).
    expect(ownerLabels({ tenant: "my7elevenhr", websites: [{ website: "https://www.7-eleven.com/", name: "7-Eleven", from: "resolved" }] })).toEqual(["my7elevenhr", "7eleven"]);
    // A tenant too short to judge: its websites' names count.
    expect(ownerLabels({ tenant: "ghr", websites: [{ website: "https://www.globalhealth.com/", name: "GH", from: "resolved" }] })).toEqual(["globalhealth"]);
  });

  it("follows careers links on the company's domains only", () => {
    expect(ownCareersLink("https://careers.adobe.com/us/en", ["adobe"])).toBe(true);
    expect(ownCareersLink("https://www.adobe.com/about-adobe/careers.html", ["adobe"])).toBe(true);
    expect(ownCareersLink("https://www.adobe.com/products", ["adobe"])).toBe(false);
    expect(ownCareersLink("https://adobe.wd5.myworkdayjobs.com/jobs", ["adobe"])).toBe(false);
    expect(ownCareersLink("mailto:jobs@adobe.com", ["adobe"])).toBe(false);
  });

  it("plans tenants biggest first, websites named like the tenant first", () => {
    const checks = new Map([
      ["workday:adobe|wd5|external", { status: "live", jobs: 500 }],
      ["workday:adobe|wd5|campus", { status: "live", jobs: 20 }],
      ["workday:tiny|wd1|jobs", { status: "live", jobs: 3 }],
      ["workday:gone|wd1|jobs", { status: "dead", jobs: 0 }],
      ["workday:netflix|wd1|netflix", { status: "live", jobs: 400 }],
      ["greenhouse:acme", { status: "live", jobs: 9 }],
    ]);
    const resolved = [
      { name: "Marketo", website: "https://www.marketo.com/", board: { key: "workday:adobe|wd5|external" } },
      { name: "Adobe", website: "https://www.adobe.com/", board: { key: "workday:adobe|wd5|campus" } },
    ];
    const plan = planTenants(checks, resolved, [{ name: "Netflix", website: "https://www.netflix.com/" }]);
    expect(plan.map((t) => t.id)).toEqual(["adobe|wd5", "netflix|wd1", "tiny|wd1"]);
    expect(plan[0]!.boards).toEqual(["workday:adobe|wd5|external", "workday:adobe|wd5|campus"]);
    expect(plan[0]!.websites.map((w) => w.website)).toEqual(["https://www.adobe.com/", "https://www.marketo.com/"]);
    expect(plan[1]!.websites).toEqual([{ website: "https://www.netflix.com/", name: "Netflix", from: "wikidata" }]);
    // No website known and too short a name to guess one.
    expect(plan[2]!.websites).toEqual([]);
  });

  it("joins the Workday boards to the live site, which leads", () => {
    const sites = [
      { key: "phenom:careers.adobe.com", replaces: ["workday:adobe|wd5|external", "workday:adobe|wd5|campus"] },
      { key: "radancy:jobs.gone.com", replaces: ["workday:gone|wd1|jobs"] },
    ];
    const links = ownSiteLinks(sites, new Set(["phenom:careers.adobe.com"]), new Map());
    expect([...links]).toEqual([
      ["phenom:careers.adobe.com", "phenom:careers.adobe.com"],
      ["workday:adobe|wd5|external", "phenom:careers.adobe.com"],
      ["workday:adobe|wd5|campus", "phenom:careers.adobe.com"],
    ]);
    // A site already joined to another board keeps that board as the lead.
    const joined = ownSiteLinks(sites.slice(0, 1), new Set(["phenom:careers.adobe.com"]), new Map([["phenom:careers.adobe.com", "greenhouse:adobe"]]));
    expect(joined.get("workday:adobe|wd5|external")).toBe("greenhouse:adobe");
  });
});
