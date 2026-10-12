import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findConfigPath, isLegacyConfig, parseConfig } from "../src/config";
import { detectCompany } from "../src/connectors";
import { diagnoseNoMatches } from "../src/diagnose";
import type { Job } from "../src/schema";
import { checkCompanies, resetConfig, saveConfig, setupStatus } from "../src/setup";
import { configToYaml } from "../src/yaml-writer";
import { profile, fakeHttp, fixture, json } from "./helpers";

const example = parseConfig(readFileSync(new URL("../../../rawjobs.config.example.yaml", import.meta.url), "utf8"));

describe("configToYaml", () => {
  it("writes an empty company list that reads back as empty, not null", () => {
    const empty = { ...example, companies: [] };
    expect(configToYaml(empty)).toContain("companies: []");
    expect(parseConfig(configToYaml(empty)).companies).toEqual([]);
  });

  it("round-trips through parseConfig, with comments", () => {
    const yaml = configToYaml(example);
    expect(parseConfig(yaml)).toEqual(example);
    expect(yaml).toContain("# A job's title must contain one of these");
  });

  it("quotes awkward values and keeps optional company fields", () => {
    const cfg = parseConfig(`
profile:
  name: 'Quotes "and" colons: yes'
  titles: { include: ["c++ engineer", "head: product"] }
  locations: { include: ["zürich"] }
  keywords: { "open banking": 3, "e-commerce": 2 }
companies:
  - { name: "Bank #1", ats: workday, slug: "bank", shard: "wd3", site: "External", careers_url: "https://bank.wd3.myworkdayjobs.com/External" }
  - { name: "Off", ats: lever, slug: "off", region: eu, enabled: false }
`);
    expect(parseConfig(configToYaml(cfg))).toEqual(cfg);
  });

  it("writes dealbreakers when set, and commented examples when not", () => {
    expect(configToYaml(example)).toContain("# salary_floor: {");
    expect(parseConfig(configToYaml(example)).profile.avoid).toBeUndefined();
    const cfg = parseConfig(`
profile:
  titles: { include: ["platform engineer"] }
  locations: { include: ["berlin"] }
  salary_floor: { amount: 85000, currency: eur }
  work_authorization: [eu]
  avoid: [frontend, "credit risk"]
`);
    expect(cfg.profile.salary_floor).toEqual({ amount: 85000, currency: "EUR", period: "year" });
    expect(parseConfig(configToYaml(cfg))).toEqual(cfg);
  });
});

describe("detectCompany for every hiring system", () => {
  it.each([
    ["https://acme.wd3.myworkdayjobs.com/en-US/External", { ats: "workday", slug: "acme", shard: "wd3", site: "External", supported: true }],
    ["https://acme.wd5.myworkdayjobs.com/Careers/job/Dubai/PM_123", { ats: "workday", slug: "acme", shard: "wd5", site: "Careers" }],
    ["https://careers.smartrecruiters.com/AcmeCorp", { ats: "smartrecruiters", slug: "AcmeCorp" }],
    ["https://apply.workable.com/acme/", { ats: "workable", slug: "acme" }],
    ["https://acme.recruitee.com/", { ats: "recruitee", slug: "acme" }],
    ["https://acme.jobs.personio.de/", { ats: "personio", slug: "acme" }],
    ["https://acme.bamboohr.com/careers", { ats: "bamboohr", slug: "acme" }],
    ["https://acme.breezy.hr/", { ats: "breezy", slug: "acme" }],
    ["https://career5.successfactors.eu/career?company=AcmeBank&career_ns=job_listing", { ats: "successfactors", slug: "AcmeBank", shard: "career5.successfactors.eu" }],
    ["https://acme.teamtailor.com/jobs", { ats: "teamtailor", slug: "acme" }],
    ["https://www.comeet.com/jobs/acme/A1.B2C", { ats: "comeet", slug: "A1.B2C", site: "acme", name: "Acme" }],
    ["https://abcd.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions", { ats: "oracle", slug: "abcd", shard: "em2", site: "CX_1" }],
    ["https://careers-acme.icims.com/jobs/search", { ats: "icims", slug: "careers-acme", name: "Acme" }],
    ["https://acme.taleo.net/careersection/2/jobsearch.ftl", { ats: "taleo", slug: "acme", site: "2" }],
    ["https://jobs.jobvite.com/acme/jobs", { ats: "jobvite", slug: "acme" }],
    ["https://acme.pinpointhq.com/", { ats: "pinpoint", slug: "acme" }],
    ["https://ats.rippling.com/acme/jobs", { ats: "rippling", slug: "acme" }],
    ["https://acme.applytojob.com/apply", { ats: "jazzhr", slug: "acme" }],
    ["https://acme.zohorecruit.com/jobs/Careers-Page", { ats: "zoho", slug: "acme", site: "Careers-Page" }],
    ["https://acme.careers.hibob.com/", { ats: "hibob", slug: "acme" }],
    ["https://acme.freshteam.com/jobs", { ats: "freshteam", slug: "acme" }],
  ])("%s", (url, expected) => {
    expect(detectCompany(url)).toMatchObject(expected);
  });

  it("doesn't take a Taleo asset folder for a career section", () => {
    const d = detectCompany("https://aa010.taleo.net/careersection/2025PRD.4.0.15.3.0/css/ftl.css");
    expect(d).toMatchObject({ ats: "taleo", slug: "aa010" });
    expect(d!.site).toBeUndefined();
  });

  it("marks built connectors as supported", () => {
    expect(detectCompany("https://jobs.lever.co/acme")).toMatchObject({ supported: true });
  });

  it("doesn't mistake Lever's own image and asset links for boards", () => {
    expect(detectCompany("https://jobs.lever.co/img/lever-logo.png")).toBeNull();
    expect(detectCompany("https://jobs.lever.co/200")).toBeNull();
  });
});

describe("checkCompanies", () => {
  it("reports live / error / unknown with the full directory record", async () => {
    const { http, calls } = fakeHttp((url) => (url.includes("greenhouse") ? json(fixture("greenhouse.json")) : json({}, 404)));
    const res = await checkCompanies(["https://job-boards.greenhouse.io/acme/jobs/123", " jobs.lever.co/nope ", "https://acme.wd3.myworkdayjobs.com/en-US", "https://example.com/careers", ""], {
      http,
    });
    expect(res.map((r) => r.status)).toEqual(["live", "error", "error", "unknown"]);
    expect(res[0]).toMatchObject({
      key: "greenhouse:acme",
      name: "Acme",
      name_source: "slug", // this fixture has no company_name
      ats: "greenhouse",
      slug: "acme",
      careers_url: "https://job-boards.greenhouse.io/acme",
      open_jobs: 3,
      in_directory: false,
    });
    expect(res[0]!.sample_titles).toHaveLength(3);
    expect(res[0]!.top_locations!.length).toBeGreaterThan(0);
    expect(res[0]!.matches).toBeUndefined(); // no profile given
    expect(res[1]!.error).toMatch(/Not found/);
    expect(res[2]!.error).toMatch(/full Workday link/); // no site in that URL
    expect(calls).toHaveLength(2); // never fetches an incomplete Workday link or an unknown site
  });

  it("counts jobs matching the profile and marks companies already in the directory", async () => {
    const { http } = fakeHttp(() => json(fixture("greenhouse.json")));
    const [r] = await checkCompanies(["job-boards.greenhouse.io/acme"], { http, profile: profile(), directory: new Map([["greenhouse:acme", { name: "Acme Inc" }]]) });
    expect(r).toMatchObject({ in_directory: true, name: "Acme Inc", name_source: "directory" });
    expect(r!.matches).toBeGreaterThanOrEqual(0);
    expect(r!.match_examples!.length).toBe(Math.min(3, r!.matches!));
  });

  it("treats an empty Greenhouse/Lever/Ashby board as dormant, but an empty SmartRecruiters one as a likely wrong link", async () => {
    const { http } = fakeHttp((url) => (url.includes("smartrecruiters") ? json({ totalFound: 0, content: [] }) : json({ jobs: [] })));
    const [gh, sr] = await checkCompanies(["job-boards.greenhouse.io/quiet", "careers.smartrecruiters.com/Madeup"], { http });
    expect(gh).toMatchObject({ status: "dormant", open_jobs: 0, name: "Quiet", name_source: "slug" });
    expect(sr).toMatchObject({ status: "error" });
    expect(sr!.error).toMatch(/SmartRecruiters/);
  });
});

describe("saveConfig / setupStatus", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("only counts the .local file as personal, and writes a valid one", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-setup-"));
    writeFileSync(join(dir, "rawjobs.config.yaml"), configToYaml(example));
    expect(setupStatus(dir)).toMatchObject({ isPersonal: false, valid: false, hasData: false });

    const res = saveConfig(example, dir);
    expect(res.ok).toBe(true);
    const status = setupStatus(dir);
    expect(status).toMatchObject({ isPersonal: true, valid: true });
    expect(status.config).toEqual(example);
  });

  it("rejects an invalid config with readable issues, and reports a broken file", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-setup-"));
    const res = saveConfig({ ...example, profile: { ...example.profile, titles: { include: [], exclude: [] } } }, dir);
    expect(res).toMatchObject({ ok: false, issues: [{ path: "profile.titles.include", message: "add at least one title to titles.include" }] });
    expect(saveConfig({ ...example, companies: [] }, dir)).toMatchObject({ ok: true });

    writeFileSync(join(dir, "rawjobs.config.local.yaml"), "profile: { titles: { include: [] } }\n");
    const status = setupStatus(dir);
    expect(status).toMatchObject({ isPersonal: true, valid: false });
    expect(status.errors).toMatch(/titles\.include/);
    expect(status.raw).toBeTruthy();
  });

  it("keeps reading and saving a config under its pre-rename name until a rawjobs one exists", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-setup-"));
    const legacy = join(dir, "jobhunter.config.local.yaml");
    writeFileSync(legacy, configToYaml(example));
    expect(setupStatus(dir)).toMatchObject({ configPath: legacy, isPersonal: true, valid: true });
    expect(saveConfig(example, dir)).toMatchObject({ ok: true, path: legacy });
    expect(existsSync(join(dir, "rawjobs.config.local.yaml"))).toBe(false);

    writeFileSync(join(dir, "rawjobs.config.local.yaml"), configToYaml(example));
    expect(setupStatus(dir).configPath).toBe(join(dir, "rawjobs.config.local.yaml"));
  });

  it("resetConfig moves the config to a backup and leaves the resume alone", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-setup-"));
    expect(resetConfig(dir)).toEqual({ ok: true, backup: null });

    saveConfig(example, dir);
    mkdirSync(join(dir, "profile"));
    writeFileSync(join(dir, "profile", "resume.md"), "# Me");
    const backup = join(dir, "rawjobs.config.local.backup.yaml");
    expect(resetConfig(dir)).toEqual({ ok: true, backup });
    expect(setupStatus(dir)).toMatchObject({ isPersonal: false, hasResume: true });
    expect(parseConfig(readFileSync(backup, "utf8"))).toEqual(example);

    // A second reset replaces the older backup.
    saveConfig({ ...example, companies: [] }, dir);
    resetConfig(dir);
    expect(parseConfig(readFileSync(backup, "utf8")).companies).toEqual([]);
  });

  it("finds a config under the new names first, then the pre-rename ones", () => {
    dir = mkdtempSync(join(tmpdir(), "rawjobs-setup-"));
    writeFileSync(join(dir, "jobhunter.config.yaml"), "");
    expect(findConfigPath(dir)).toBe(join(dir, "jobhunter.config.yaml"));
    expect(isLegacyConfig(findConfigPath(dir))).toBe(true);
    writeFileSync(join(dir, "rawjobs.config.yaml"), "");
    expect(findConfigPath(dir)).toBe(join(dir, "rawjobs.config.yaml"));
    expect(isLegacyConfig(findConfigPath(dir))).toBe(false);
  });
});

describe("diagnoseNoMatches", () => {
  const base = { ats: "lever", company: "A", url: "u", workplace: "onsite", firstSeen: "x", lastSeen: "x", status: "open", score: 0 } as const;
  const j = (id: string, title: string, location: string, why: Partial<Job["why"]>): Job => ({
    ...base,
    id,
    title,
    location,
    why: { title: 0, location: 0, keywords: [], keywordPoints: 0, freshness: 2, ...why },
  });

  it("counts gate failures and lists near misses", () => {
    const jobs = [
      j("1", "Software Engineer", "Dubai", { gate: "title", location: 20 }),
      j("2", "Software Engineer", "Dubai", { gate: "title", location: 20 }),
      j("3", "Designer", "London", { gate: "title" }),
      j("4", "Product Manager", "London", { gate: "location", title: 20 }),
      j("5", "Senior Product Manager", "London", { gate: "location", title: 30 }),
      j("6", "Product Manager", "New York", { gate: "location", title: 20 }),
      { ...j("7", "Product Manager", "Dubai", { title: 20, location: 20 }), score: 50 },
      { ...j("8", "Old PM", "London", { gate: "location" }), status: "closed" as const },
    ];
    expect(diagnoseNoMatches(jobs)).toEqual({
      scanned: 7,
      matched: 1,
      titleMiss: 3,
      locationMiss: 3,
      nearMissLocations: [
        { location: "London", count: 2 },
        { location: "New York", count: 1 },
      ],
      nearMissTitles: ["Software Engineer"],
    });
  });
});
