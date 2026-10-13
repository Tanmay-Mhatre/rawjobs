import { describe, expect, it } from "vitest";
import { detectCompany, getConnector } from "../src/connectors";
import type { CompanyRef } from "../src/schema";
import { fakeHttp, json } from "./helpers";

const csrf = () => {
  const res = json({ csrfToken: "tok123" });
  res.headers.append("set-cookie", "__Host-next-auth.csrf-token=tok123%7Chash; Path=/; HttpOnly; Secure; SameSite=Lax");
  res.headers.append("set-cookie", "__Secure-next-auth.callback-url=https%3A%2F%2Fjobs.dayforcehcm.com; Path=/; HttpOnly; Secure");
  return res;
};
const posting = (n: number, extra: Record<string, unknown> = {}) => ({
  jobPostingId: n,
  jobTitle: `Role ${n}`,
  jobDescription: "Help members plan trips.",
  postingStartTimestampUTC: "2026-10-13T10:00:00+00:00",
  hasVirtualLocation: false,
  postingLocations: [{ cityName: "Bellevue", stateCode: "WA", isoCountryCode: "US" }],
  ...extra,
});

describe("dayforce", () => {
  it("takes the anonymous CSRF pair, then pages the site's search 25 at a time, descriptions included", async () => {
    const seen: { start: number; cookie?: string; token?: string }[] = [];
    const { http, calls } = fakeHttp((url, init) => {
      if (url.endsWith("/api/auth/csrf")) return csrf();
      const h = init?.headers as Record<string, string>;
      const b = JSON.parse(String(init?.body)) as { paginationStart: number; clientNamespace: string; jobBoardCode: string; cultureCode: string };
      seen.push({ start: b.paginationStart, cookie: h.cookie, token: h["x-csrf-token"] });
      expect([b.clientNamespace, b.jobBoardCode, b.cultureCode]).toEqual(["aaawa", "candidateportal", "en-US"]);
      const list =
        b.paginationStart === 0
          ? Array.from({ length: 25 }, (_, i) => posting(i + 1))
          : [posting(26, { hasVirtualLocation: true, postingLocations: [{ cityName: "Toronto", stateCode: "ON", isoCountryCode: "CA" }] })];
      return json({ jobPostings: list, maxCount: 26 });
    });
    const c = getConnector("dayforce")!;
    const r = { name: "AAA Washington", enabled: true, ats: "dayforce", slug: "aaawa", site: "candidateportal" } as CompanyRef;
    const jobs = (await c.fetch(r, { http, now: new Date() })).map((x) => c.normalize(x, r));
    expect(calls[1]).toBe("https://jobs.dayforcehcm.com/api/geo/aaawa/jobposting/search");
    expect(seen).toEqual([
      { start: 0, cookie: "__Host-next-auth.csrf-token=tok123%7Chash; __Secure-next-auth.callback-url=https%3A%2F%2Fjobs.dayforcehcm.com", token: "tok123" },
      { start: 25, cookie: "__Host-next-auth.csrf-token=tok123%7Chash; __Secure-next-auth.callback-url=https%3A%2F%2Fjobs.dayforcehcm.com", token: "tok123" },
    ]);
    expect(jobs).toHaveLength(26);
    expect(jobs[0]).toMatchObject({
      id: "dayforce:aaawa:1",
      location: "Bellevue, WA",
      country: "United States",
      postedAt: "2026-10-13T10:00:00.000Z",
      url: "https://jobs.dayforcehcm.com/en-US/aaawa/candidateportal/jobs/1",
      description: "Help members plan trips.",
    });
    expect(jobs[25]).toMatchObject({ location: "Toronto, ON, Canada, Remote", workplace: "remote", country: "Canada" });
  });

  it("needs the board code from the careers URL", async () => {
    const { http } = fakeHttp(() => csrf());
    await expect(getConnector("dayforce")!.fetch({ name: "x", enabled: true, ats: "dayforce", slug: "aaawa" } as CompanyRef, { http, now: new Date() })).rejects.toThrow(/need the tenant and "site"/);
  });

  it("is recognised from a careers or job link, keeping a culture other than en-US", () => {
    expect(detectCompany("https://jobs.dayforcehcm.com/en-US/aaawa/CANDIDATEPORTAL")).toMatchObject({ ats: "dayforce", slug: "aaawa", site: "candidateportal", supported: true });
    expect(detectCompany("https://jobs.dayforcehcm.com/fr-CA/gm/candidateportal/jobs/12")).toMatchObject({ slug: "gm", site: "candidateportal", shard: "fr-CA" });
    expect(detectCompany("https://jobs.dayforcehcm.com/")).toBeNull();
  });
});
