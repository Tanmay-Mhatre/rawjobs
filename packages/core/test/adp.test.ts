import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp, json } from "./helpers";

const CID = "00886df5-bd47-4bca-bbd8-7329e9c28b84";
const API = "https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions";
const req = (n: number, extra: Record<string, unknown> = {}) => ({
  itemID: `9201232464532_${n}`,
  requisitionTitle: `Security Officer ${n} `,
  postDate: "2026-10-08T16:52:00.000-04:00",
  requisitionLocations: [{ address: { cityName: "San Antonio", countrySubdivisionLevel1: { codeValue: "TX" } }, nameCode: { shortName: " San Antonio, TX, US" } }],
  organizationalUnits: [{ nameCode: { shortName: "Operations" } }],
  ...extra,
});

describe("adp", () => {
  it("pages the career center's public requisitions 50 at a time and reads each description", async () => {
    const { http, calls } = fakeHttp((url) => {
      if (url.includes("/job-requisitions/")) return json({ requisitionDescription: "<p>Keep the <b>zoo</b> safe.</p>" });
      const skip = Number(new URL(url).searchParams.get("$skip"));
      return json({
        jobRequisitions:
          skip === 0 ? Array.from({ length: 50 }, (_, i) => req(i + 1)) : [req(51, { requisitionLocations: [{ address: { cityName: "Remote" }, nameCode: { shortName: " Remote, CA" } }] })],
        meta: { totalNumber: 51 },
      });
    });
    const c = getConnector("adp")!;
    const r = { name: "San Antonio Zoo", enabled: true, ats: "adp", slug: CID, site: "19000101_000001" } as CompanyRef;
    const raws = await c.fetch(r, { http, now: new Date() });
    const jobs = raws.map((x) => c.normalize(x, r));
    expect(calls).toEqual([
      `${API}?cid=${CID}&ccId=19000101_000001&lang=en_US&locale=en_US&%24top=50&%24skip=0`,
      `${API}?cid=${CID}&ccId=19000101_000001&lang=en_US&locale=en_US&%24top=50&%24skip=50`,
    ]);
    expect(jobs).toHaveLength(51);
    expect(jobs[0]).toMatchObject({
      id: `adp:${CID}:9201232464532_1`,
      title: "Security Officer 1",
      location: "San Antonio, TX",
      department: "Operations",
      postedAt: "2026-10-08T20:52:00.000Z",
      url: `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=${CID}&ccId=19000101_000001&jobId=9201232464532_1&lang=en_US`,
    });
    expect(jobs[50]).toMatchObject({ location: "Remote", workplace: "remote" });
    expect(await c.describe!(raws[0]!, r, { http, now: new Date() })).toBe("Keep the zoo safe.");
  });

  it("needs both ids from the careers URL", async () => {
    const { http } = fakeHttp(() => json({}));
    await expect(getConnector("adp")!.fetch({ name: "x", enabled: true, ats: "adp", slug: CID } as CompanyRef, { http, now: new Date() })).rejects.toThrow(/need the "cid" and "ccId"/);
  });

  it("is recognised from a recruitment link", () => {
    expect(detectCompany(`https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=${CID.toUpperCase()}&ccId=19000101_000001&lang=en_US`)).toMatchObject({
      ats: "adp",
      slug: CID,
      site: "19000101_000001",
      supported: true,
    });
    expect(detectCompany("https://workforcenow.adp.com/theme/index.html")).toBeNull();
  });
});
