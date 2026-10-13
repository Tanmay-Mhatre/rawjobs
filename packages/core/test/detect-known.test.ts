import { describe, expect, it } from "vitest";
import { detectKnownAts } from "../src/connectors/detect-known";

const detect = (u: string) => detectKnownAts(new URL(u));

describe("detectKnownAts", () => {
  it.each([
    ["https://acme.wd5.myworkdayjobs.com/External", { ats: "workday", slug: "acme", shard: "wd5", site: "External" }],
    ["https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/Careers/jobs", { ats: "workday", slug: "acme", shard: "wd1", site: "Careers" }],
    ["https://wd1.myworkdaysite.com/en-US/recruiting/acme/External/job/123", { ats: "workday", slug: "acme", shard: "wd1", site: "External" }],
    ["https://wd3.myworkdaysite.com/wday/cxs/Acme/Careers/jobs", { ats: "workday", slug: "acme", shard: "wd3", site: "Careers" }],
    ["https://apply.workable.com/acme/", { ats: "workable", slug: "acme" }],
    ["https://acme.workable.com/", { ats: "workable", slug: "acme" }],
    ["https://acme.recruitee.com/", { ats: "recruitee", slug: "acme" }],
    ["https://acme.jobs.personio.de/", { ats: "personio", slug: "acme" }],
    ["https://acme.bamboohr.com/careers", { ats: "bamboohr", slug: "acme" }],
    ["https://acme.breezy.hr/", { ats: "breezy", slug: "acme" }],
    ["https://career4.successfactors.com/career?company=acmecorp", { ats: "successfactors", slug: "acmecorp", shard: "career4.successfactors.com" }],
    ["https://assaabloy.jobs2web.com/search/?q=", { ats: "successfactors", slug: "assaabloy.jobs2web.com" }],
    ["https://careersacme.jobs.hr.cloud.sap/job/x/1/", { ats: "successfactors", slug: "careersacme.jobs.hr.cloud.sap" }],
    ["https://career15.sapsf.cn/career?company=acme09", { ats: "successfactors", slug: "acme09", shard: "career15.sapsf.cn" }],
    ["https://acme.teamtailor.com/jobs", { ats: "teamtailor", slug: "acme" }],
    ["https://www.comeet.com/jobs/acme/12.345", { ats: "comeet", slug: "12.345", site: "acme" }],
    ["https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs", { ats: "oracle", slug: "acme", shard: "us2", site: "CX_1" }],
    ["https://careers-acme.icims.com/jobs", { ats: "icims", slug: "careers-acme" }],
    ["https://jobs.jobvite.com/acme/jobs", { ats: "jobvite", slug: "acme" }],
    ["https://acme.pinpointhq.com/", { ats: "pinpoint", slug: "acme" }],
    ["https://ats.rippling.com/acme/jobs", { ats: "rippling", slug: "acme" }],
    ["https://acme.applytojob.com/apply", { ats: "jazzhr", slug: "acme" }],
    ["https://acme.zohorecruit.com/jobs/Careers", { ats: "zoho", slug: "acme", site: "Careers" }],
    ["https://acme.zohorecruit.in/jobs/Careers", { ats: "zoho", slug: "acme", shard: "in", site: "Careers" }],
    ["https://acme.zohorecruit.com.au/", { ats: "zoho", slug: "acme", shard: "com.au" }],
    ["https://acme.zohorecruit.sa/jobs/Jobs", { ats: "zoho", slug: "acme", shard: "sa", site: "Jobs" }],
  ])("reads %s", (url, expected) => {
    expect(detect(url)).toMatchObject(expected);
  });

  it.each([
    "https://www.workable.com/",
    "https://apply.workable.com/api/v1/x",
    "https://www.bamboohr.com/",
    "https://app.breezy.hr/",
    "https://www.teamtailor.com/",
    "https://cdn.icims.com/x",
    "https://career4.successfactors.com/career",
    "https://wd1.myworkdaysite.com/en-US/recruiting/",
    "https://acme.example.com/careers",
  ])("leaves %s alone", (url) => {
    expect(detect(url)).toBeNull();
  });
});
