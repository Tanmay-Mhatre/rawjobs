import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp } from "./helpers";

const text = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
const page = readFileSync(new URL("./fixtures/pages/hiringthing-careers.html", import.meta.url), "utf8");
const HOST = "1440-by-the-bay.oasisrecruit.com";

describe("hiringthing", () => {
  it("reads every job off a careers site's root page (a saved real page), with pay; descriptions from each job page", async () => {
    const { http, calls } = fakeHttp((url) =>
      url.includes("/job/") ? text('<script type="application/ld+json">{"@type":"JobPosting","title":"x","description":"<p>Care for <b>guests</b>.</p>"}</script>') : text(page),
    );
    const c = getConnector("hiringthing")!;
    const r = { name: "1440 by the Bay", enabled: true, ats: "hiringthing", slug: HOST } as CompanyRef;
    const raws = await c.fetch(r, { http, now: new Date() });
    const jobs = raws.map((x) => c.normalize(x, r));
    expect(calls).toEqual([`https://${HOST}/`]);
    expect(jobs.map((j) => [j.title, j.location])).toEqual([
      ["Caregiver", "Emeryville, CA"],
      ["Dishwasher", "Emeryville, CA"],
      ["Server", "Emeryville, CA"],
    ]);
    expect(jobs[0]).toMatchObject({ id: `hiringthing:${HOST}:1064604`, url: `https://${HOST}/job/1064604/caregiver`, salary: { min: 20, max: 23, currency: "USD", period: "hour" } });
    expect(await c.describe!(raws[0]!, r, { http, now: new Date() })).toBe("Care for guests.");
  });

  it("only reads hosts on HiringThing's and its resellers' domains", async () => {
    const { http } = fakeHttp(() => text(page));
    await expect(getConnector("hiringthing")!.fetch({ name: "x", enabled: true, ats: "hiringthing", slug: "careers.example.com" } as CompanyRef, { http, now: new Date() })).rejects.toThrow(
      /not a HiringThing/,
    );
  });

  it("is recognised on the vendor's and resellers' domains", () => {
    expect(detectCompany(`https://${HOST}/job/1064604/caregiver`)).toMatchObject({ ats: "hiringthing", slug: HOST, supported: true });
    expect(detectCompany("https://skijapan.hiringthing.com/")).toMatchObject({ slug: "skijapan.hiringthing.com" });
    expect(detectCompany("https://www.hiringthing.com/")).toBeNull();
  });
});
