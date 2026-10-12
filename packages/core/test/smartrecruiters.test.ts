import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config";
import { detectCompany } from "../src/connectors";
import { smartrecruiters, type SmartRecruitersPosting } from "../src/connectors/smartrecruiters";
import { runRadar } from "../src/run";
import type { Job } from "../src/schema";
import { checkCompanies } from "../src/setup";
import { company, fakeHttp, json } from "./helpers";

const now = new Date("2026-10-03T12:00:00Z");

const posting = (id: string, name: string, location: SmartRecruitersPosting["location"]): SmartRecruitersPosting => ({
  id,
  name,
  releasedDate: "2026-10-02T09:00:00.000Z",
  company: { identifier: "AcmeGroup", name: "Acme Group" },
  location,
  department: {},
  function: { label: "Product Management" },
});

const PM_DUBAI = posting("101", "Senior Product Manager, Payments", { city: "Dubai", country: "ae", remote: false, hybrid: true });
const ENG_BERLIN = posting("102", "Backend Engineer", { city: "Berlin", country: "de", remote: false, hybrid: false });
const PM_REMOTE = posting("103", "Product Manager", { country: "ae", remote: true });

const detail = (text: string) => ({
  jobAd: { sections: { jobDescription: { title: "Job Description", text: `<p>${text}</p>` }, qualifications: { text: "<ul><li>KYC experience</li></ul>" } } },
});

/** Two pages (limit 100): the first has 100 copies of a posting, the second the rest. */
function routes(url: string) {
  if (url.includes("/postings/")) return json(detail(url.endsWith("/101") ? "Own crypto payments rails." : "General product role."));
  if (url.includes("/companies/AcmeGroup/postings")) {
    const offset = Number(new URL(url).searchParams.get("offset"));
    const first = Array.from({ length: 100 }, (_, i) => posting(`x${i}`, "Warehouse Associate", { city: "Riyadh", country: "sa" }));
    return json(offset === 0 ? { totalFound: 103, content: first } : { totalFound: 103, content: [PM_DUBAI, ENG_BERLIN, PM_REMOTE] });
  }
  return json({ totalFound: 0, content: [] });
}

describe("smartrecruiters connector", () => {
  it("pages through all postings", async () => {
    const { http, calls } = fakeHttp(routes);
    const raws = await smartrecruiters.fetch(company("smartrecruiters", { slug: "AcmeGroup" }), { http, now });
    expect(raws).toHaveLength(103);
    expect(calls).toEqual([
      "https://api.smartrecruiters.com/v1/companies/AcmeGroup/postings?limit=100&offset=0",
      "https://api.smartrecruiters.com/v1/companies/AcmeGroup/postings?limit=100&offset=100",
    ]);
  });

  it("normalises location names, workplace and the public job link", () => {
    const ref = company("smartrecruiters", { slug: "AcmeGroup" });
    expect(smartrecruiters.normalize(PM_DUBAI, ref)).toMatchObject({
      id: "smartrecruiters:acmegroup:101",
      title: "Senior Product Manager, Payments",
      location: "Dubai, United Arab Emirates",
      country: "United Arab Emirates",
      workplace: "hybrid",
      department: "Product Management",
      postedAt: "2026-10-02T09:00:00.000Z",
      url: "https://jobs.smartrecruiters.com/AcmeGroup/101",
      description: "",
    });
    expect(smartrecruiters.normalize(ENG_BERLIN, ref)).toMatchObject({ location: "Berlin, Germany", workplace: "onsite" });
    expect(smartrecruiters.normalize(PM_REMOTE, ref)).toMatchObject({ location: "United Arab Emirates, Remote", workplace: "remote" });
  });

  it("describe() turns the job ad sections into text", async () => {
    const { http } = fakeHttp(routes);
    const text = await smartrecruiters.describe!(PM_DUBAI, company("smartrecruiters", { slug: "AcmeGroup" }), { http, now });
    expect(text).toBe("Own crypto payments rails.\n\n• KYC experience");
  });

  it("detects careers, jobs and API links", () => {
    for (const url of ["https://careers.smartrecruiters.com/AcmeGroup", "https://jobs.smartrecruiters.com/AcmeGroup/101-pm", "https://api.smartrecruiters.com/v1/companies/AcmeGroup/postings"]) {
      expect(detectCompany(url)).toMatchObject({ ats: "smartrecruiters", slug: "AcmeGroup", supported: true });
    }
  });
});

describe("runRadar with a list that has no descriptions", () => {
  const config = parseConfig(`
profile:
  titles: { include: ["product manager"] }
  locations: { include: ["dubai", "united arab emirates"] }
  keywords: { crypto: 5, kyc: 2 }
companies:
  - { name: "Acme Group", ats: smartrecruiters, slug: "AcmeGroup" }
`);

  it("fetches descriptions only for jobs that pass the gates, and scores their keywords", async () => {
    const { http, calls } = fakeHttp(routes);
    const result = await runRadar(config, { http, now });
    const detailCalls = calls.filter((u) => u.includes("/postings/"));
    expect(detailCalls.sort()).toEqual(["https://api.smartrecruiters.com/v1/companies/AcmeGroup/postings/101", "https://api.smartrecruiters.com/v1/companies/AcmeGroup/postings/103"]);
    const pm = result.jobs.find((j) => j.id.endsWith(":101"))!;
    expect(pm.why.keywords).toEqual(["crypto", "kyc"]);
    expect(result.health[0]).toMatchObject({ ok: true, jobsFound: 103, matches: 2 });
  });

  it("reuses stored descriptions instead of fetching them again", async () => {
    const { http, calls } = fakeHttp(routes);
    const previous = [
      { id: "smartrecruiters:acmegroup:101", description: "Stored: crypto", firstSeen: "2026-09-01T00:00:00.000Z" },
      { id: "smartrecruiters:acmegroup:103", description: "Stored: other", firstSeen: "2026-09-01T00:00:00.000Z" },
    ] as Job[];
    await runRadar(config, { http, now, previous });
    expect(calls.filter((u) => u.includes("/postings/"))).toEqual([]);
  });
});

describe("checkCompanies validity", () => {
  it("treats an empty board as invalid, since unknown names still answer 200", async () => {
    const { http } = fakeHttp(routes);
    const [r] = await checkCompanies(["https://careers.smartrecruiters.com/NotARealCompany"], { http });
    expect(r).toMatchObject({ status: "error", ats: "smartrecruiters", slug: "NotARealCompany" });
    expect(r!.error).toMatch(/No open jobs/);
  });
});
