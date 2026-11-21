import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import { firstPageFingerprint } from "../src/connectors/types";
import type { CompanyRef } from "../src/schema";
import { fakeHttp } from "./helpers";

const text = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
/** A join.com page: Next.js data in a script tag, as the site renders it. */
const nextPage = (pageData: unknown) =>
  text(
    `<html><head></head><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json" nonce="YjJiYzM4">${JSON.stringify({ props: { pageProps: { pageData } } })}</script></body></html>`,
  );
const job = (id: number, title: string) => ({
  id,
  idParam: `${id}-${title.toLowerCase().replace(/ /g, "-")}`,
  title,
  createdAt: "2026-10-01T08:00:00.000Z",
  workplaceType: id % 2 ? "HYBRID" : "REMOTE",
  city: { cityName: "Berlin", countryName: "Germany" },
  category: { name: "Engineering" },
});
/** Six jobs over two careers pages. */
const twoPages = (url: string) => {
  const page = Number(new URL(url).searchParams.get("page") ?? 1);
  return nextPage({
    company: { id: 30107, name: "Acme" },
    jobs: { items: page === 1 ? [1, 2, 3, 4, 5].map((i) => job(i, `Role ${i}`)) : [job(6, "Platform Engineer")], pagination: { page, pageCount: 2, pageSize: 5, perPage: 5, total: 6 } },
  });
};

async function run(route: (url: string) => Response) {
  const { http, calls } = fakeHttp(route);
  const c = getConnector("join")!;
  const r = { name: "Acme", enabled: true, ats: "join", slug: "acme" } as CompanyRef;
  const raws = await c.fetch(r, { http, now: new Date() });
  return { jobs: raws.map((x) => c.normalize(x, r)), raws, calls, c, r, http };
}

describe("join", () => {
  it("reads the jobs off the careers page, five a page", async () => {
    const { jobs, calls } = await run(twoPages);
    expect(calls).toEqual(["https://join.com/companies/acme", "https://join.com/companies/acme?page=2"]);
    expect(jobs).toHaveLength(6);
    expect(jobs[5]).toMatchObject({
      id: "join:acme:6",
      title: "Platform Engineer",
      location: "Berlin, Germany, Remote",
      country: "Germany",
      workplace: "remote",
      department: "Engineering",
      postedAt: "2026-10-01T08:00:00.000Z",
      url: "https://join.com/companies/acme/6-platform-engineer",
      description: "",
    });
  });

  it("reads a description off the job's page", async () => {
    const { raws, c, r } = await run(twoPages);
    const { http, calls } = fakeHttp(() => nextPage({ job: { id: 1, description: "<h2>About us</h2><p>We build <strong>heat pumps</strong>.</p>" } }));
    const d = await c.describe!(raws[0]!, r, { http, now: new Date() });
    expect(calls).toEqual(["https://join.com/companies/acme/1-role-1"]);
    expect(d).toContain("About us");
    expect(d).toContain("We build heat pumps.");
  });

  it("stops after the first page when it's as the last full read saw it", async () => {
    const seen: [string, number][] = [];
    const { http, calls } = fakeHttp(twoPages);
    const c = getConnector("join")!;
    const r = { name: "Acme", enabled: true, ats: "join", slug: "acme" } as CompanyRef;
    const firstPage = (f: string, n: number) => {
      seen.push([f, n]);
      return true;
    };
    const raws = await c.fetch(r, { http, now: new Date(), firstPage });
    expect(calls).toEqual(["https://join.com/companies/acme"]);
    expect(raws).toHaveLength(5);
    expect(seen).toEqual([[firstPageFingerprint(6, ["1", "2", "3", "4", "5"]), 6]]);
  });

  it("reads an empty board as no jobs", async () => {
    const { jobs } = await run(() => nextPage({ jobs: { items: [], pagination: { total: 0, page: 1, pageCount: 0, pageSize: 0, perPage: 0 } } }));
    expect(jobs).toEqual([]);
  });

  it("says so when the page has no job list", async () => {
    await expect(run(() => text("<html>404</html>"))).rejects.toThrow('JOIN company "acme" not found');
  });

  it("is recognised from a careers or job link", () => {
    expect(detectCompany("https://join.com/companies/1komma5grad")).toMatchObject({ ats: "join", slug: "1komma5grad", supported: true });
    expect(detectCompany("join.com/companies/Acme/123-pm")).toMatchObject({ ats: "join", slug: "acme" });
    expect(detectCompany("https://join.com/pricing")).toBeNull();
  });
});
