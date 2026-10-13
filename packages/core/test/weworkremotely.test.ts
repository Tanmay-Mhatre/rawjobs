import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp } from "./helpers";

const feed = readFileSync(new URL("./fixtures/wwr-feed.xml", import.meta.url), "utf8");
const rss = (body: string) => new Response(body, { status: 200, headers: { "content-type": "application/rss+xml" } });

describe("weworkremotely", () => {
  it("reads a category feed (a saved real feed): company and title split, region as remote place", async () => {
    const { http, calls } = fakeHttp(() => rss(feed));
    const c = getConnector("weworkremotely")!;
    const r = { name: "We Work Remotely", enabled: true, ats: "weworkremotely", slug: "remote-programming-jobs" } as CompanyRef;
    const jobs = (await c.fetch(r, { http, now: new Date() })).map((x) => c.normalize(x, r));
    expect(calls).toEqual(["https://weworkremotely.com/categories/remote-programming-jobs.rss"]);
    expect(jobs[0]).toMatchObject({
      id: "weworkremotely:remote-programming-jobs:bondex-fullstack-web3-engineer-solidity-rust-typescript",
      company: "bondex",
      title: "Fullstack Web3 Engineer (Solidity / Rust / Typescript)",
      location: "Remote (Americas)",
      workplace: "remote",
      department: "Front-End Programming",
      url: "https://weworkremotely.com/remote-jobs/bondex-fullstack-web3-engineer-solidity-rust-typescript",
      description: "Build protocols.",
    });
    expect(jobs[1]).toMatchObject({ company: "Discord", location: "Remote" });
    expect(c.label).toBe("We Work Remotely");
  });

  it('reads the all-jobs feed for "all"', async () => {
    const { http, calls } = fakeHttp(() => rss(feed));
    await getConnector("weworkremotely")!.fetch({ name: "x", enabled: true, ats: "weworkremotely", slug: "all" } as CompanyRef, { http, now: new Date() });
    expect(calls).toEqual(["https://weworkremotely.com/remote-jobs.rss"]);
  });

  it("is added from a category or home link", () => {
    expect(detectCompany("https://weworkremotely.com/categories/remote-design-jobs")).toMatchObject({ ats: "weworkremotely", slug: "remote-design-jobs", supported: true });
    expect(detectCompany("https://weworkremotely.com/")).toMatchObject({ slug: "all" });
  });
});
