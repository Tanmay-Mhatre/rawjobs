import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp, json } from "./helpers";

const text = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
const GUID = "bdcbc22d-c568-4b9f-bc84-421f9522fd47";
const BOARD = `https://recruiting.ultipro.com/STS1000SCO/JobBoard/${GUID}`;
const opp = (n: number, extra: Record<string, unknown> = {}) => ({
  Id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
  Title: `Role ${n}`,
  PostedDate: "2026-10-09T18:39:31.743Z",
  JobCategoryName: "Retail",
  JobLocationType: 1,
  Locations: [{ LocalizedName: "Erskine Banking Center", Address: { City: "South Bend", State: { Code: "IN", Name: "Indiana" }, Country: { Code: "USA", Name: "United States" } } }],
  ...extra,
});

async function run(route: (url: string, init?: RequestInit) => Response, ref: Partial<CompanyRef> = {}) {
  const { http, calls } = fakeHttp(route);
  const c = getConnector("ukg")!;
  const r = { name: "1st Source Bank", enabled: true, ats: "ukg", slug: "STS1000SCO", shard: "recruiting.ultipro.com", site: GUID, ...ref } as CompanyRef;
  const raws = await c.fetch(r, { http, now: new Date() });
  return { jobs: raws.map((x) => c.normalize(x, r)), raws, calls, c, r, http };
}

describe("ukg", () => {
  it("pages the board's public search 50 at a time, and reads descriptions from each posting's page", async () => {
    const skips: number[] = [];
    const { jobs, raws, calls, c, r, http } = await run((url, init) => {
      if (url.includes("OpportunityDetail")) return text(`<script>new CandidateOpportunityDetail({"Id":"x","Description":"<p>Help <b>clients</b>.</p>","Title":"Teller"});</script>`);
      const skip = (JSON.parse(String(init?.body)) as { opportunitySearch: { Skip: number } }).opportunitySearch.Skip;
      skips.push(skip);
      return json({
        opportunities:
          skip === 0
            ? Array.from({ length: 50 }, (_, i) => opp(i + 1))
            : [
                opp(51, { Title: "Data Manager", JobLocationType: 2 }),
                opp(52, { JobLocationType: null, Locations: [{ LocalizedName: "Toronto Office", Address: { City: "Toronto", State: { Code: "ON" }, Country: { Code: "CAN", Name: "Canada" } } }] }),
              ],
        totalCount: 52,
      });
    });
    expect(calls[0]).toBe(`${BOARD}/JobBoardView/LoadSearchResults`);
    expect(skips).toEqual([0, 50]);
    expect(jobs).toHaveLength(52);
    expect(jobs[0]).toMatchObject({
      id: "ukg:sts1000sco:00000000-0000-0000-0000-000000000001",
      location: "South Bend, IN",
      country: "United States",
      workplace: "onsite",
      department: "Retail",
      postedAt: "2026-10-09T18:39:31.743Z",
      url: `${BOARD}/OpportunityDetail?opportunityId=00000000-0000-0000-0000-000000000001`,
    });
    expect(jobs[50]).toMatchObject({ title: "Data Manager", location: "South Bend, IN, Remote", workplace: "remote" });
    expect(jobs[51]).toMatchObject({ location: "Toronto, ON, Canada", country: "Canada" });
    expect(await c.describe!(raws[0]!, r, { http, now: new Date() })).toBe("Help clients.");
  });

  it("needs the host and board from the careers link", async () => {
    await expect(run(() => json({}), { shard: undefined })).rejects.toThrow(/need "shard"/);
    await expect(run(() => json({}), { shard: "evil.example.com" })).rejects.toThrow(/need "shard"/);
  });

  it("is recognised from a board or posting link on either host style", () => {
    expect(detectCompany(`${BOARD}/?q=&o=postedDateDesc`)).toMatchObject({ ats: "ukg", slug: "STS1000SCO", shard: "recruiting.ultipro.com", site: GUID, supported: true });
    expect(detectCompany(`https://accessiblespace.rec.pro.ukg.net/acc1507asei/JobBoard/1F3E7F92-2B60-4B8D-A893-C948A630E8A8/OpportunityDetail?opportunityId=1`)).toMatchObject({
      slug: "acc1507asei",
      shard: "accessiblespace.rec.pro.ukg.net",
      site: "1f3e7f92-2b60-4b8d-a893-c948a630e8a8",
    });
    expect(detectCompany("https://recruiting.ultipro.com/STS1000SCO/")).toBeNull();
  });
});
