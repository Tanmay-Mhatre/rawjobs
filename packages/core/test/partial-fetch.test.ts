import { describe, expect, it } from "vitest";
import { getConnector } from "../src/connectors";
import type { AtsType, CompanyRef } from "../src/schema";
import { fakeHttp, json } from "./helpers";

const text = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });

/** Fetch a board and report whether the connector said its list was cut short. */
async function fetchFlag(ats: AtsType, ref: Partial<CompanyRef>, route: (url: string, init?: RequestInit) => Response) {
  const { http } = fakeHttp(route);
  let partial = false;
  const raws = await getConnector(ats)!.fetch({ name: "Acme", enabled: true, ats, slug: "acme", ...ref } as CompanyRef, {
    http,
    now: new Date("2026-10-13T00:00:00Z"),
    partial: () => {
      partial = true;
    },
  });
  return { count: raws.length, partial };
}

const body = (init?: RequestInit) => JSON.parse(String(init?.body ?? "{}")) as Record<string, number>;
const wdPage = (offset: number, total: number) =>
  json({
    total: offset === 0 ? total : 0,
    jobPostings: Array.from({ length: Math.max(0, Math.min(20, total - offset)) }, (_, i) => ({ title: `Job ${offset + i}`, externalPath: `/job/x/R${offset + i}`, postedOn: "Posted Today" })),
  });

describe("capped lists say they were cut short", () => {
  it("workday: 2,500 postings, read to the 2,000 cap -> partial; 300 -> complete", async () => {
    const big = await fetchFlag("workday", { slug: "bank", shard: "wd3", site: "External" }, (_u, init) => wdPage(body(init).offset ?? 0, 2500));
    expect(big).toEqual({ count: 2000, partial: true });
    const small = await fetchFlag("workday", { slug: "bank", shard: "wd3", site: "External" }, (_u, init) => wdPage(body(init).offset ?? 0, 300));
    expect(small).toEqual({ count: 300, partial: false });
  });

  it("phenom: the API stops well short of the total it reports -> partial", async () => {
    const job = (n: number) => ({ jobSeqNo: `S${n}`, title: `Job ${n}`, locale: "en_US" });
    const r = await fetchFlag("phenom", { slug: "careers.acme.com" }, (_u, init) => {
      const from = body(init).from ?? 0;
      // 9,900 jobs reported; the widget stops handing out pages after 1,800.
      return json({ refineSearch: { totalHits: 9900, data: { jobs: from < 1800 ? Array.from({ length: 100 }, (_, i) => job(from + i)) : [] } } });
    });
    expect(r).toEqual({ count: 1800, partial: true });
  });

  it("jobvite: still a next page after the last page we read -> partial", async () => {
    let n = 0;
    const r = await fetchFlag("jobvite", {}, () => {
      n++;
      return text(
        `<table class="jv-job-list"><tr><td class="jv-job-list-name"><a href="/acme/job/o${n}">Job ${n}</a></td><td class="jv-job-list-location">Remote</td></tr></table><a class="jv-pagination-next" href="?p=${n}">Next</a>`,
      );
    });
    expect(r.partial).toBe(true);
  });

  it("smartrecruiters: a list read to its end is complete", async () => {
    const r = await fetchFlag("smartrecruiters", {}, () => json({ totalFound: 3, content: [1, 2, 3].map((i) => ({ id: String(i), name: `Job ${i}` })) }));
    expect(r).toEqual({ count: 3, partial: false });
  });
});
