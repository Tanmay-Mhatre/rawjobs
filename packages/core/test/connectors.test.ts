import { describe, expect, it } from "vitest";
import { detectCompany } from "../src/connectors";
import { ashby } from "../src/connectors/ashby";
import { greenhouse } from "../src/connectors/greenhouse";
import { lever } from "../src/connectors/lever";
import { company, fakeHttp, fixture, json } from "./helpers";

const now = new Date("2026-10-03T12:00:00Z");

describe("greenhouse", () => {
  it("fetches the light board list and normalises jobs (content when the list has it)", async () => {
    const { http, calls } = fakeHttp(() => json(fixture("greenhouse.json")));
    const ref = company("greenhouse");
    const raws = await greenhouse.fetch(ref, { http, now });
    expect(calls).toEqual(["https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=false"]);
    expect(raws).toHaveLength(3);

    const [first, second, third] = raws.map((r) => greenhouse.normalize(r, ref));
    expect(first).toEqual({
      id: "greenhouse:acme:1001",
      ats: "greenhouse",
      company: "Acme",
      title: "Senior Product Manager, Crypto Payments",
      location: "Dubai, United Arab Emirates",
      workplace: "unknown",
      department: "Product",
      postedAt: "2026-10-01T09:00:00-04:00",
      url: "https://acme.example/careers?gh_jid=1001",
      description: "About the role\nOwn our stablecoin payments rails & KYC flows.\n\n• Fintech experience",
    });
    // Office "US" is appended so remote_exclude can catch US-only remote roles.
    expect(second!.location).toBe("SF, NYC, Remote (US)");
    expect(second!.workplace).toBe("remote");
    expect(third!.postedAt).toBeUndefined();
  });

  it("uses the one board API for EU-hosted boards too", async () => {
    const { http, calls } = fakeHttp(() => json({ jobs: [] }));
    await greenhouse.fetch(company("greenhouse", { region: "eu" }), { http, now });
    expect(calls[0]).toBe("https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=false");
  });

  it("describes one job from its own endpoint", async () => {
    const { http, calls } = fakeHttp(() => json({ id: 1001, title: "PM", content: "&lt;p&gt;Own payments&lt;/p&gt;" }));
    const d = await greenhouse.describe!({ id: 1001, title: "PM", absolute_url: "" }, company("greenhouse"), { http, now });
    expect(calls).toEqual(["https://boards-api.greenhouse.io/v1/boards/acme/jobs/1001"]);
    expect(d).toBe("Own payments");
  });

  it("throws on an unexpected shape", async () => {
    const { http } = fakeHttp(() => json({ error: "nope" }));
    await expect(greenhouse.fetch(company("greenhouse"), { http, now })).rejects.toThrow(/no jobs array/);
  });

  it("fails fast on 404 (bad slug) without retrying", async () => {
    const { http, calls } = fakeHttp(() => json({ status: 404 }, 404));
    await expect(greenhouse.fetch(company("greenhouse"), { http, now })).rejects.toThrow(/HTTP 404/);
    expect(calls).toHaveLength(1);
  });
});

describe("lever", () => {
  it("normalises postings including lists, salary and workplace", async () => {
    const { http, calls } = fakeHttp(() => json(fixture("lever.json")));
    const ref = company("lever");
    const raws = await lever.fetch(ref, { http, now });
    expect(calls).toEqual(["https://api.lever.co/v0/postings/acme?mode=json"]);
    const [head, eng] = raws.map((r) => lever.normalize(r, ref));
    expect(head).toMatchObject({
      id: "lever:acme:6ed76ce8-0000-4b60-b120-403538bd66cd",
      title: "Head of Product, Exchange",
      location: "Abu Dhabi; Dubai",
      country: "AE",
      workplace: "hybrid",
      department: "Product",
      salary: { min: 40000, max: 55000, currency: "AED", period: "month" },
      postedAt: "2026-10-02T00:13:20.000Z",
      url: "https://jobs.lever.co/acme/6ed76ce8-0000-4b60-b120-403538bd66cd",
    });
    expect(head!.description).toContain("Ship tokenization features");
    expect(eng).toMatchObject({ location: "Remote - EMEA", workplace: "remote", salary: undefined });
  });

  it("uses the EU host and reports Lever's error body", async () => {
    const { http, calls } = fakeHttp(() => json({ ok: false, error: "Document not found" }));
    await expect(lever.fetch(company("lever", { region: "eu" }), { http, now })).rejects.toThrow(/Document not found/);
    expect(calls[0]).toBe("https://api.eu.lever.co/v0/postings/acme?mode=json");
  });
});

describe("ashby", () => {
  it("drops unlisted jobs and normalises compensation", async () => {
    const { http, calls } = fakeHttp(() => json(fixture("ashby.json")));
    const ref = company("ashby");
    const raws = await ashby.fetch(ref, { http, now });
    expect(calls).toEqual(["https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true"]);
    expect(raws).toHaveLength(1);
    expect(ashby.normalize(raws[0]!, ref)).toEqual({
      id: "ashby:acme:34413f8d-0000-4bbc-8ade-eb309a0e2245",
      ats: "ashby",
      company: "Acme",
      title: "Group Product Manager, AI",
      location: "London; Remote (EMEA)",
      country: "United Kingdom",
      workplace: "remote",
      department: "Product",
      salary: { min: 120000, max: 150000, currency: "GBP", period: "year" },
      postedAt: "2026-09-30T12:00:00.000+00:00",
      url: "https://jobs.ashbyhq.com/acme/34413f8d-0000-4bbc-8ade-eb309a0e2245",
      employmentType: "full-time",
      description: "Build AI agents for payments operations.",
    });
  });
});

describe("detectCompany", () => {
  it.each([
    ["https://boards.greenhouse.io/acme", { ats: "greenhouse", slug: "acme" }],
    ["https://job-boards.greenhouse.io/acme/jobs/123", { ats: "greenhouse", slug: "acme" }],
    ["https://job-boards.eu.greenhouse.io/acme", { ats: "greenhouse", slug: "acme", region: "eu" }],
    ["https://boards.greenhouse.io/embed/job_board?for=acme", { ats: "greenhouse", slug: "acme" }],
    ["jobs.lever.co/acme-labs/abc-123", { ats: "lever", slug: "acme-labs", name: "Acme Labs" }],
    ["https://jobs.eu.lever.co/acme", { ats: "lever", slug: "acme", region: "eu" }],
    ["https://jobs.ashbyhq.com/Acme%20Inc", { ats: "ashby", slug: "Acme Inc" }],
    ["https://api.lever.co/v0/postings/acme?mode=json", { ats: "lever", slug: "acme" }],
    ["https://api.eu.lever.co/v0/postings/acme", { ats: "lever", slug: "acme", region: "eu" }],
    ["https://api.ashbyhq.com/posting-api/job-board/acme", { ats: "ashby", slug: "acme" }],
    ["https://bank.wd3.myworkdayjobs.com/wday/cxs/bank/External/jobs", { ats: "workday", slug: "bank", shard: "wd3", site: "External" }],
    ["https://bank.wd3.myworkdayjobs.com/en-US/External/job/123", { ats: "workday", slug: "bank", shard: "wd3", site: "External" }],
  ])("%s", (url, expected) => {
    expect(detectCompany(url)).toMatchObject(expected);
  });

  it("returns null for unknown or bare hosts", () => {
    expect(detectCompany("https://careers.example.com/jobs")).toBeNull();
    expect(detectCompany("https://jobs.lever.co/")).toBeNull();
    expect(detectCompany("https://jobs.ashbyhq.com/api/non-user-graphql")).toBeNull();
    expect(detectCompany("https://api.lever.co/v1/other")).toBeNull();
    expect(detectCompany("not a url at all")).toBeNull();
  });
});
