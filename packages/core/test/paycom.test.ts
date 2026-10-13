import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp, json } from "./helpers";

const text = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
const KEY = "0021d8c7d53423ec352e3ef1df7cbec7";
const API = "https://portal-applicant-tracking.us-cent.paycomonline.net/api/ats";
const portal = `<script>window.__config = {"sessionJWT":"eyJ.anon.token","apiHost":"portal-applicant-tracking.us-cent.paycomonline.net"};</script>`;
const preview = (jobId: number, jobTitle: string, locations: string, remoteType = "") => ({ jobId, jobTitle, positionType: "Full Time", remoteType, locations, description: "Teaser…" });

async function run(route: (url: string, init?: RequestInit) => Response) {
  const { http, calls } = fakeHttp(route);
  const c = getConnector("paycom")!;
  const r = { name: "Wiese Group", enabled: true, ats: "paycom", slug: KEY } as CompanyRef;
  const raws = await c.fetch(r, { http, now: new Date() });
  return { jobs: raws.map((x) => c.normalize(x, r)), raws, calls, c, r, http };
}

describe("paycom", () => {
  it("takes the portal's anonymous session, then pages the postings search 50 at a time", async () => {
    const seen: { url: string; auth?: string; skip?: number }[] = [];
    const { jobs, raws, c, r, http } = await run((url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (url.includes("/web.php/portal/")) return text(portal);
      if (url.endsWith("/job-posting-previews/search")) {
        const skip = (JSON.parse(String(init?.body)) as { skip: number }).skip;
        seen.push({ url, auth: headers.authorization, skip });
        const list =
          skip === 0
            ? Array.from({ length: 50 }, (_, i) => preview(i + 1, `Role ${i + 1}`, "HQ - Baltimore, MD 21230"))
            : [preview(51, "Rental Coordinator", "Main - Baltimore, MD 21230; Annex - Remote", "Remote")];
        return json({ jobPostingPreviews: list, jobPostingPreviewsCount: 51 });
      }
      seen.push({ url, auth: headers.authorization });
      return json({ jobPosting: { description: "<p>Rent <b>forklifts</b>.</p>", qualifications: "<ul><li>CDL</li></ul>", startDate: "2026-10-05T00:00:00Z" } });
    });
    expect(seen.map((s) => [s.skip, s.auth])).toEqual([
      [0, "eyJ.anon.token"],
      [50, "eyJ.anon.token"],
    ]);
    expect(jobs).toHaveLength(51);
    expect(jobs[50]).toMatchObject({
      id: `paycom:${KEY}:51`,
      title: "Rental Coordinator",
      location: "Baltimore, MD 21230; Remote",
      workplace: "remote",
      url: `https://www.paycomonline.net/v4/ats/web.php/portal/${KEY}/jobs/51`,
      description: "",
    });
    expect(await c.describe!(raws[50]!, r, { http, now: new Date() })).toEqual({ description: "Rent forklifts.\n\n• CDL", postedAt: "2026-10-05T00:00:00.000Z" });
    expect(seen.at(-1)).toEqual({ url: `${API}/job-postings/51`, auth: "eyJ.anon.token" });
  });

  it("says so when the portal doesn't exist", async () => {
    await expect(run(() => text("<html>Not found</html>"))).rejects.toThrow(/not found/);
  });

  it("is recognised from a careers or job link", () => {
    expect(detectCompany(`https://www.paycomonline.net/v4/ats/web.php/portal/${KEY.toUpperCase()}/career-page`)).toMatchObject({ ats: "paycom", slug: KEY, supported: true });
    expect(detectCompany(`https://www.paycomonline.net/v4/ats/web.php/portal/${KEY}/jobs/177460`)).toMatchObject({ slug: KEY });
    expect(detectCompany("https://www.paycom.com/careers/")).toBeNull();
  });
});
