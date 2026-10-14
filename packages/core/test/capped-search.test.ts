import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config";
import { getConnector } from "../src/connectors";
import { runRadar, searchTerms } from "../src/run";
import { fakeHttp, json, profile } from "./helpers";

const now = new Date("2026-10-14T00:00:00Z");
const body = (init?: RequestInit) => JSON.parse(String(init?.body ?? "{}")) as { offset?: number; searchText?: string };
const posting = (n: number, title = `Job ${n}`) => ({ title, externalPath: `/job/x/Title_R${n}`, postedOn: "Posted Today", locationsText: "Dubai" });
/** A Workday tenant listing `total` postings; a search answers with `found` instead. */
const workdayBoard = (total: number, found: (term: string) => ReturnType<typeof posting>[]) => (_url: string, init?: RequestInit) => {
  const { offset = 0, searchText = "" } = body(init);
  if (searchText) {
    const hits = found(searchText);
    return json({ total: offset === 0 ? hits.length : 0, jobPostings: hits.slice(offset, offset + 20) });
  }
  return json({ total: offset === 0 ? total : 0, jobPostings: Array.from({ length: Math.max(0, Math.min(20, total - offset)) }, (_, i) => posting(offset + i)) });
};

describe("searchTerms", () => {
  it("searches your titles without level words, broadest and most specific first, never a lone generic word", () => {
    const p = profile({
      titles: { include: ["Senior Product Manager", "product manager", "Technical Product Manager", "PM", "manager", "Head of Product", "designer", "Product Designer"], exclude: [] },
    });
    expect(searchTerms(p)).toEqual(["product manager", "head of product", "designer"]);
  });

  it("keeps at most five, and none when the titles are all generic or short forms", () => {
    const many = profile({ titles: { include: ["data scientist", "data engineer", "ml engineer", "product analyst", "growth manager", "brand manager"], exclude: [] } });
    expect(searchTerms(many)).toEqual(["data scientist", "data engineer", "ml engineer", "product analyst", "growth manager"]);
    expect(searchTerms(profile({ titles: { include: ["Manager", "PM", "Senior Engineer"], exclude: [] } }))).toEqual([]);
  });
});

describe("connector search requests", () => {
  const ref = { name: "Bank", enabled: true, ats: "workday" as const, slug: "bank", shard: "wd3", site: "External" };

  it("workday: posts the term as searchText and reads at most 200 results", async () => {
    const bodies: ReturnType<typeof body>[] = [];
    const { http, calls } = fakeHttp((url, init) => {
      bodies.push(body(init));
      return workdayBoard(0, () => Array.from({ length: 900 }, (_, i) => posting(i, "Product Manager")))(url, init);
    });
    const found = await getConnector("workday")!.search!(ref, "product manager", { http, now });
    expect(found).toHaveLength(200);
    expect(calls.every((u) => u === "https://bank.wd3.myworkdayjobs.com/wday/cxs/bank/External/jobs")).toBe(true);
    expect(bodies[0]).toEqual({ appliedFacets: {}, limit: 20, offset: 0, searchText: "product manager" });
    expect(bodies.map((b) => b.offset)).toEqual([0, 20, 40, 60, 80, 100, 120, 140, 160, 180]);
  });

  it("smartrecruiters and oracle: the term goes in the API's own search parameter", async () => {
    const sr = fakeHttp(() => json({ totalFound: 1, content: [{ id: "1", name: "Product Manager" }] }));
    await getConnector("smartrecruiters")!.search!({ ...ref, ats: "smartrecruiters", slug: "Acme" }, "product manager", { http: sr.http, now });
    // Quoted: unquoted, SmartRecruiters matches any of the words.
    expect(sr.calls).toEqual(["https://api.smartrecruiters.com/v1/companies/Acme/postings?limit=100&offset=0&q=%22product%20manager%22"]);

    const or = fakeHttp(() => json({ items: [{ TotalJobsCount: 0, requisitionList: [] }] }));
    await getConnector("oracle")!.search!({ ...ref, ats: "oracle", slug: "acme", shard: "ocs", site: undefined }, 'product "manager", ops', { http: or.http, now });
    // The finder's own separators and quotes can't appear inside the keyword.
    const finder = new URL(or.calls[0]!).searchParams.get("finder");
    expect(finder).toBe('findReqs;siteNumber=CX_1,keyword="product manager ops",limit=200,offset=0,sortBy=POSTING_DATES_DESC');
  });

  it("ukg, icims and dayforce: QueryString, searchKeyword and searchText", async () => {
    const uk = fakeHttp((_u, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ opportunitySearch: { Top: 50, Skip: 0, QueryString: "line cook" } });
      return json({ totalCount: 0, opportunities: [] });
    });
    await getConnector("ukg")!.search!({ ...ref, ats: "ukg", slug: "acm1000acme", shard: "recruiting2.ultipro.com", site: "2b13054b-60bb-410d-9136-e52c1c7d9720" }, "line cook", {
      http: uk.http,
      now,
    });
    expect(uk.calls).toHaveLength(1);

    const ic = fakeHttp(() => new Response("<html>iCIMS</html>", { status: 200, headers: { "content-type": "text/html" } }));
    await getConnector("icims")!.search!({ ...ref, ats: "icims", slug: "careers-acme" }, "physical therapist", { http: ic.http, now });
    expect(ic.calls).toEqual(["https://careers-acme.icims.com/jobs/search?ss=1&searchKeyword=physical%20therapist&in_iframe=1&pr=0"]);

    const bodies: unknown[] = [];
    const df = fakeHttp((url, init) => {
      if (url.endsWith("/api/auth/csrf")) return new Response(JSON.stringify({ csrfToken: "t" }), { status: 200, headers: { "content-type": "application/json", "set-cookie": "c=1; Path=/" } });
      bodies.push(JSON.parse(String(init?.body)));
      return json({ maxCount: 0, jobPostings: [] });
    });
    await getConnector("dayforce")!.search!({ ...ref, ats: "dayforce", slug: "acme", site: "candidateportal" }, "nurse", { http: df.http, now });
    expect(bodies).toEqual([{ clientNamespace: "acme", jobBoardCode: "candidateportal", cultureCode: "en-US", paginationStart: 0, searchText: "nurse" }]);
  });
});

describe("runRadar on a capped board", () => {
  const config = parseConfig(`
profile:
  titles: { include: ["Senior Product Manager", "head of product", "manager"] }
  locations: { include: ["dubai"] }
companies:
  - { name: "Bank Co", ats: workday, slug: "bank", shard: "wd3", site: "External" }
`);

  it("searches your titles past the cap, adds only jobs it hadn't seen, and stays partial", async () => {
    const searched: string[] = [];
    const { http } = fakeHttp(
      workdayBoard(2500, (term) => {
        searched.push(term);
        // One job past the 2,000 cap, and one the list already had.
        return term === "product manager" ? [posting(2400, "Senior Product Manager"), posting(5, "Product Manager")] : [];
      }),
    );
    const result = await runRadar(config, { http, now });
    const h = result.health[0]!;
    expect(h).toMatchObject({ ok: true, partial: true, searchFound: 1, jobsFound: 2001, matches: 1 });
    expect([...new Set(searched)]).toEqual(["product manager", "head of product"]);
    const found = result.jobs.find((j) => j.id === "workday:bank|external:R2400");
    expect(found).toMatchObject({ title: "Senior Product Manager", status: "open" });
    expect(found!.why.gate).toBeUndefined();
    expect(result.jobs.filter((j) => j.id === "workday:bank|external:R5")).toHaveLength(1);
  });

  it("doesn't search a list read to its end, nor once the scan is stopped", async () => {
    const searched: string[] = [];
    const record = (t: string) => {
      searched.push(t);
      return [];
    };
    const small = fakeHttp(workdayBoard(300, record));
    const full = (await runRadar(config, { http: small.http, now })).health[0]!;
    expect(full.partial).toBeUndefined();
    expect(full.searchFound).toBeUndefined();
    expect(searched).toEqual([]);

    // Stopped after the first search: the rest are skipped, the company still finishes.
    const big = fakeHttp(workdayBoard(2500, record));
    const h = (await runRadar(config, { http: big.http, now, stopped: () => searched.length > 0 })).health[0]!;
    expect(h).toMatchObject({ ok: true, partial: true, searchFound: 0 });
    expect(searched).toEqual(["product manager"]);
  });

  it("a failing search loses only its own results", async () => {
    const { http } = fakeHttp((url, init) => (body(init).searchText ? json({ error: "busy" }, 500) : workdayBoard(2500, () => [])(url, init)));
    const h = (await runRadar(config, { http, now })).health[0]!;
    expect(h).toMatchObject({ ok: true, partial: true, searchFound: 0, jobsFound: 2000 });
  });
});
