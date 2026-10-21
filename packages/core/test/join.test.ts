import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import { firstPageFingerprint } from "../src/connectors/types";
import type { CompanyRef } from "../src/schema";
import { fakeHttp, json } from "./helpers";

const text = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
const job = (id: number, title: string) => ({
  id,
  idParam: `${id}-${title.toLowerCase().replace(/ /g, "-")}`,
  title,
  createdAt: "2026-10-01T08:00:00.000Z",
  workplaceType: id % 2 ? "HYBRID" : "REMOTE",
  city: { cityName: "Berlin", countryName: "Germany" },
  category: { name: "Engineering" },
});

async function run(ref: Partial<CompanyRef>, route: (url: string) => Response) {
  const { http, calls } = fakeHttp(route);
  const c = getConnector("join")!;
  const r = { name: "Acme", enabled: true, ats: "join", slug: "acme", ...ref } as CompanyRef;
  const raws = await c.fetch(r, { http, now: new Date() });
  return { jobs: raws.map((x) => c.normalize(x, r)), raws, calls, c, r, http };
}

describe("join", () => {
  it("reads the company id from the careers page, then pages the public API five at a time", async () => {
    const { jobs, calls } = await run({}, (url) => {
      if (url === "https://join.com/companies/acme") return text('<script id="__NEXT_DATA__">{"props":{"company":{"id":30107,"name":"Acme"}}}</script>');
      const page = Number(new URL(url).searchParams.get("page"));
      return json({ items: page === 1 ? [1, 2, 3, 4, 5].map((i) => job(i, `Role ${i}`)) : [job(6, "Platform Engineer")], pagination: { pageCount: 2, rowCount: 6 } });
    });
    expect(calls).toEqual([
      "https://join.com/companies/acme",
      "https://join.com/api/public/companies/30107/jobs?page=1&pageSize=5",
      "https://join.com/api/public/companies/30107/jobs?page=2&pageSize=5",
    ]);
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

  it("uses the id a list gave (shard) without loading the careers page, and reads descriptions from the job API", async () => {
    const { calls, raws, c, r, http } = await run({ shard: "54" }, (url) =>
      url.includes("/api/public/jobs/") ? json({ description: "## About us\n\nWe build **heat pumps**. [Apply](https://x)" }) : json({ items: [job(7, "PM")], pagination: { pageCount: 1 } }),
    );
    expect(calls).toEqual(["https://join.com/api/public/companies/54/jobs?page=1&pageSize=5"]);
    expect(await c.describe!(raws[0]!, r, { http, now: new Date() })).toBe("About us\n\nWe build heat pumps. Apply");
  });

  it("keeps the id it read off the careers page, so the next run asks the API straight away", async () => {
    const ids = new Map<string, string>();
    const route = (url: string) => (url === "https://join.com/companies/acme" ? text('{"company":{"id":30107}}') : json({ items: [job(1, "PM")], pagination: { pageCount: 1, rowCount: 1 } }));
    const c = getConnector("join")!;
    const r = { name: "Acme", enabled: true, ats: "join", slug: "acme" } as CompanyRef;
    const first = fakeHttp(route);
    await c.fetch(r, { http: first.http, now: new Date(), ids });
    expect(ids.get("join:acme")).toBe("30107");
    const second = fakeHttp(route);
    await c.fetch(r, { http: second.http, now: new Date(), ids });
    expect(second.calls).toEqual(["https://join.com/api/public/companies/30107/jobs?page=1&pageSize=5"]);
  });

  it("stops after the first page when it's as the last full read saw it", async () => {
    const seen: [string, number][] = [];
    const { http, calls } = fakeHttp((url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      return json({ items: page === 1 ? [1, 2, 3, 4, 5].map((i) => job(i, `Role ${i}`)) : [job(6, "PM")], pagination: { pageCount: 2, rowCount: 6 } });
    });
    const c = getConnector("join")!;
    const r = { name: "Acme", enabled: true, ats: "join", slug: "acme", shard: "54" } as CompanyRef;
    const firstPage = (f: string, n: number) => {
      seen.push([f, n]);
      return true;
    };
    const raws = await c.fetch(r, { http, now: new Date(), firstPage });
    expect(calls).toEqual(["https://join.com/api/public/companies/54/jobs?page=1&pageSize=5"]);
    expect(raws).toHaveLength(5);
    expect(seen).toEqual([[firstPageFingerprint(6, ["1", "2", "3", "4", "5"]), 6]]);
  });

  it("says so when the company doesn't exist", async () => {
    await expect(run({}, () => text("<html>404</html>"))).rejects.toThrow('JOIN company "acme" not found');
  });

  it("is recognised from a careers or job link", () => {
    expect(detectCompany("https://join.com/companies/1komma5grad")).toMatchObject({ ats: "join", slug: "1komma5grad", supported: true });
    expect(detectCompany("join.com/companies/Acme/123-pm")).toMatchObject({ ats: "join", slug: "acme" });
    expect(detectCompany("https://join.com/pricing")).toBeNull();
  });
});
