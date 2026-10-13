import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp, json } from "./helpers";

const text = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
const pos = (n: number) => ({
  id: 1000 + n,
  name: `Role ${n}`,
  locations: ["Bruchsal,Baden-Württemberg,Germany"],
  department: "Supply Chain",
  workLocationOption: n % 2 ? "onsite" : "hybrid",
  postedTs: 1788417097,
  positionUrl: `/careers/job/${1000 + n}`,
});

async function run(route: (url: string) => Response, ref: Partial<CompanyRef> = {}) {
  const { http, calls } = fakeHttp(route);
  const c = getConnector("eightfold")!;
  const r = { name: "John Deere", enabled: true, ats: "eightfold", slug: "johndeere.eightfold.ai", shard: "johndeere.com", ...ref } as CompanyRef;
  const raws = await c.fetch(r, { http, now: new Date() });
  return { jobs: raws.map((x) => c.normalize(x, r)), raws, calls, c, r, http };
}

describe("eightfold", () => {
  it("pages the pcsx search ten at a time and reads each description from position_details", async () => {
    const { jobs, raws, calls, c, r, http } = await run((url) => {
      if (url.includes("position_details")) return json({ data: { jobDescription: "<p>Drive <b>forklifts</b>.</p>" } });
      const start = Number(new URL(url).searchParams.get("start"));
      return json({ data: { count: 12, positions: start === 0 ? Array.from({ length: 10 }, (_, i) => pos(i + 1)) : [pos(11), pos(12)] } });
    });
    expect(calls).toEqual(["https://johndeere.eightfold.ai/api/pcsx/search?domain=johndeere.com&start=0", "https://johndeere.eightfold.ai/api/pcsx/search?domain=johndeere.com&start=10"]);
    expect(jobs).toHaveLength(12);
    expect(jobs[1]).toMatchObject({
      id: "eightfold:johndeere.eightfold.ai:1002",
      title: "Role 2",
      location: "Bruchsal, Baden-Württemberg, Germany",
      country: "Germany",
      workplace: "hybrid",
      department: "Supply Chain",
      postedAt: "2026-09-03T06:31:37.000Z",
      url: "https://johndeere.eightfold.ai/careers/job/1002",
    });
    expect(await c.describe!(raws[0]!, r, { http, now: new Date() })).toBe("Drive forklifts.");
  });

  it("falls back to the v2 API when pcsx isn't enabled for the tenant, descriptions included", async () => {
    const { jobs, raws, calls, c, r } = await run(
      (url) =>
        url.includes("/api/pcsx/")
          ? json({ message: "PCSX is not enabled for this user." }, 403)
          : json({
              count: 1,
              positions: [
                {
                  id: 7,
                  name: "QA Lead",
                  locations: ["Weimar,Thuringia,Germany"],
                  work_location_option: "onsite",
                  t_create: 1790726400,
                  canonicalPositionUrl: "https://talent.bayer.com/careers/job/7",
                  job_description: "<p>Own quality.</p>",
                },
              ],
            }),
      { slug: "bayer.eightfold.ai", shard: "bayer.com" },
    );
    expect(calls).toEqual(["https://bayer.eightfold.ai/api/pcsx/search?domain=bayer.com&start=0", "https://bayer.eightfold.ai/api/apply/v2/jobs?domain=bayer.com&start=0"]);
    expect(jobs[0]).toMatchObject({ title: "QA Lead", workplace: "onsite", url: "https://talent.bayer.com/careers/job/7" });
    // v2 already had it: no extra request.
    const { http, calls: more } = fakeHttp(() => json({}));
    expect(await c.describe!(raws[0]!, r, { http, now: new Date() })).toBe("Own quality.");
    expect(more).toEqual([]);
  });

  it("asks the v2 single-job call when the list left the description out", async () => {
    const { raws, c, r } = await run(
      (url) =>
        url.includes("/api/pcsx/")
          ? json({ message: "PCSX is not enabled for this user." }, 403)
          : json({ count: 1, positions: [{ id: 9, name: "Comms Lead", locations: ["Tokyo,Japan"], job_description: "" }] }),
      { slug: "explore.jobs.netflix.net", shard: "netflix.com" },
    );
    const { http, calls } = fakeHttp(() => json({ job_description: "<p>Tell stories.</p>" }));
    expect(await c.describe!(raws[0]!, r, { http, now: new Date() })).toBe("Tell stories.");
    expect(calls).toEqual(["https://explore.jobs.netflix.net/api/apply/v2/jobs/9?domain=netflix.com"]);
  });

  it("reads the tenant domain off the careers page when a list didn't give it", async () => {
    const { calls } = await run(
      (url) =>
        url.endsWith("/careers")
          ? text('<div style="display:none;" data-nosnippet>{&#34;domain&#34;: &#34;netflix.com&#34;, &#34;user&#34;: null}</div>')
          : json({ data: { count: 0, positions: [] } }),
      {
        slug: "explore.jobs.netflix.net",
        shard: undefined,
      },
    );
    expect(calls).toEqual(["https://explore.jobs.netflix.net/careers", "https://explore.jobs.netflix.net/api/pcsx/search?domain=netflix.com&start=0"]);
    await expect(run(() => text("<html>404</html>"), { shard: undefined })).rejects.toThrow(/not found/);
  });

  it("is recognised from an eightfold.ai careers link", () => {
    expect(detectCompany("https://johndeere.eightfold.ai/careers?domain=johndeere.com")).toMatchObject({ ats: "eightfold", slug: "johndeere.eightfold.ai", shard: "johndeere.com", supported: true });
    expect(detectCompany("https://bayer.eightfold.ai/careers/job/7")).toMatchObject({ slug: "bayer.eightfold.ai" });
    expect(detectCompany("https://eightfold.ai/")).toBeNull();
  });
});
