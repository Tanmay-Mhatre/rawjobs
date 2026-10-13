import { describe, expect, it } from "vitest";
import { getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { checkCompanies } from "../src/setup";
import { fakeHttp, json } from "./helpers";

const job = (n: number, extra: Record<string, unknown> = {}) => ({
  jobSeqNo: `ADOBUSR${n}EXTERNALENUS`,
  title: `Role ${n}`,
  cityState: "San Jose, California",
  city: "San Jose",
  country: "United States of America",
  locale: "en_US",
  postedDate: "2026-09-18T00:00:00.000+0000",
  category: "Engineering",
  ...extra,
});

async function run(route: (url: string, init?: RequestInit) => Response) {
  const { http, calls } = fakeHttp(route);
  const c = getConnector("phenom")!;
  const r = { name: "Adobe", enabled: true, ats: "phenom", slug: "careers.adobe.com" } as CompanyRef;
  const raws = await c.fetch(r, { http, now: new Date() });
  return { jobs: raws.map((x) => c.normalize(x, r)), raws, calls, c, r, http };
}

const body = (init?: RequestInit) => JSON.parse(String(init?.body)) as { ddoKey: string; from?: number; jobSeqNo?: string };

describe("phenom", () => {
  it("pages the site's refineSearch widget 100 at a time and reads descriptions from jobDetail", async () => {
    const froms: number[] = [];
    const { jobs, raws, c, r, http } = await run((_url, init) => {
      const b = body(init);
      if (b.ddoKey === "jobDetail") return json({ jobDetail: { data: { job: { description: `<p>About <b>${b.jobSeqNo}</b></p>` } } } });
      froms.push(b.from ?? -1);
      const list =
        b.from === 0
          ? Array.from({ length: 100 }, (_, i) => job(i + 1))
          : [job(101, { cityState: "9362 - Instrumentation Svcs - Charlotte, North Carolina", locale: "en_GLOBAL", remote: true, country: "United States of America" })];
      return json({ refineSearch: { totalHits: 101, data: { jobs: list } } });
    });
    expect(froms).toEqual([0, 100]);
    expect(jobs).toHaveLength(101);
    expect(jobs[0]).toMatchObject({
      id: "phenom:careers.adobe.com:ADOBUSR1EXTERNALENUS",
      title: "Role 1",
      location: "San Jose, California, United States",
      country: "United States",
      department: "Engineering",
      postedAt: "2026-09-18T00:00:00.000Z",
      url: "https://careers.adobe.com/us/en/job/ADOBUSR1EXTERNALENUS",
    });
    expect(jobs[100]).toMatchObject({ location: "Charlotte, North Carolina, United States, Remote", workplace: "remote", url: "https://careers.adobe.com/global/en/job/ADOBUSR101EXTERNALENUS" });
    expect(await c.describe!(raws[0]!, r, { http, now: new Date() })).toBe("About ADOBUSR1EXTERNALENUS");
  });

  it("refuses a site whose widgets don't answer with a job list", async () => {
    await expect(run(() => json({ status: "ok" }))).rejects.toThrow(/not a Phenom careers site/);
  });

  it("is added by link when the site answers Phenom's widgets call", async () => {
    const { http } = fakeHttp((url, init) =>
      url === "https://careers.adobe.com/widgets" && body(init).ddoKey === "refineSearch" ? json({ refineSearch: { data: { jobs: [job(1)] } } }) : json({}, 404),
    );
    const [r] = await checkCompanies(["https://careers.adobe.com/us/en/search-results"], { http });
    expect(r).toMatchObject({ status: "live", ats: "phenom", slug: "careers.adobe.com", key: "phenom:careers.adobe.com", careers_url: "https://careers.adobe.com", open_jobs: 1 });
  });
});
