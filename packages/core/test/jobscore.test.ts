import { beforeEach, describe, expect, it } from "vitest";
import { careersUrl, detectCompany, getConnector } from "../src/connectors";
import { clearRobotsCache } from "../src/robots";
import type { CompanyRef } from "../src/schema";
import { fakeHttp, json } from "./helpers";

const robots = () => new Response("User-agent: *\nDisallow: /apply_flow/\n", { status: 200 });
const job = {
  id: "aBteyEBjnbqAbZKOH6JRzy",
  title: "Content Marketing Editor ",
  department: "Content Engineering",
  location: "Redmond, WA",
  city: "Redmond",
  state: "WA",
  country: "US",
  remote: "No | Must be able to work onsite all of the time",
  opened_date: "2026-02-11T21:35:56.081Z",
  detail_url: "https://careers.jobscore.com/careers/maqsoftware/jobs/content-marketing-editor-aBteyEBjnbqAbZKOH6JRzy?ref=rss&sid=68",
  description: "<p>About <b>MAQ</b></p>",
  public_salary_minimum: 5500000,
  public_salary_maximum: 7500000,
  public_compensation_interval: "per year",
  currency_code: "USD",
};
const ref = { name: "MAQ Software", enabled: true, ats: "jobscore", slug: "maqsoftware" } as CompanyRef;

describe("jobscore", () => {
  beforeEach(() => clearRobotsCache());

  it("reads every job (place, remote policy, salary in cents, description) from one feed", async () => {
    const { http, calls } = fakeHttp((url) => (url.endsWith("/robots.txt") ? robots() : json({ company_name: "MAQ Software", jobs: [job, { ...job, id: "x2", remote: "Yes | Fully remote" }] })));
    const c = getConnector("jobscore")!;
    const jobs = (await c.fetch(ref, { http, now: new Date() })).map((x) => c.normalize(x, ref));
    expect(calls).toEqual(["https://careers.jobscore.com/robots.txt", "https://careers.jobscore.com/jobs/maqsoftware/feed.json"]);
    expect(jobs[0]).toMatchObject({
      id: "jobscore:maqsoftware:aBteyEBjnbqAbZKOH6JRzy",
      title: "Content Marketing Editor",
      location: "Redmond, WA, United States",
      country: "United States",
      workplace: "onsite",
      department: "Content Engineering",
      salary: { min: 55000, max: 75000, currency: "USD", period: "year" },
      postedAt: "2026-02-11T21:35:56.081Z",
      url: "https://careers.jobscore.com/careers/maqsoftware/jobs/content-marketing-editor-aBteyEBjnbqAbZKOH6JRzy",
      description: "About MAQ",
    });
    expect(jobs[1]!.workplace).toBe("remote");
  });

  it("reports a missing board as closed", async () => {
    const { http } = fakeHttp((url) => (url.endsWith("/robots.txt") ? robots() : new Response("", { status: 404 })));
    await expect(getConnector("jobscore")!.fetch(ref, { http, now: new Date() })).rejects.toThrow(/board not found/);
  });

  it("is recognised from a careers, job or widget link", () => {
    expect(detectCompany("https://careers.jobscore.com/careers/maqsoftware/jobs/x-aB12")).toMatchObject({ ats: "jobscore", slug: "maqsoftware", supported: true });
    expect(detectCompany("https://widgets.jobscore.com/jobs/MAQSoftware/widget")).toMatchObject({ ats: "jobscore", slug: "maqsoftware" });
    expect(careersUrl({ ats: "jobscore", slug: "maqsoftware" })).toBe("https://careers.jobscore.com/careers/maqsoftware");
    expect(detectCompany("https://www.jobscore.com/pricing")).toBeNull();
  });
});
