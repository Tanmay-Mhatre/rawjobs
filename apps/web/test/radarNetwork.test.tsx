// @vitest-environment happy-dom
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SortOptions, SORTS, sortsFor } from "../src/components/radar/FilterSheet";
import { JobCard } from "../src/components/radar/JobCard";
import { MoreToggles } from "../src/components/radar/MoreFilters";
import type { Job } from "../src/lib/data";
import { activeChips, applyFilters, type Ctx, DEFAULT_FILTERS, type Filters, fromQuery, sortJobs, toQuery } from "../src/lib/filters";
import { knownCounter, networkChanged, resetNetworkStore, useNetworkSummary } from "../src/lib/network";
import type { Entry } from "../src/lib/userState";
import { makeJob } from "./helpers";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const job = (o: Partial<Job>): Job => makeJob({ firstSeen: daysAgo(1), postedAt: daysAgo(1), group: `${o.company}|${o.id}`, ...o });
const counts = { acme: 3, globex: 1 };
const f = (o: Partial<Filters> = {}): Filters => ({ ...DEFAULT_FILTERS, ...o });

beforeEach(() => resetNetworkStore());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("knownCounter", () => {
  it("counts by company key, and keys each company name once", () => {
    const reads: string[] = [];
    const watched = new Proxy(counts, {
      getOwnPropertyDescriptor(t, k) {
        reads.push(String(k));
        return Reflect.getOwnPropertyDescriptor(t, k);
      },
    });
    const knownAt = knownCounter(watched);
    const jobs = [job({ id: "1", company: "Acme" }), job({ id: "2", company: "Acme" }), job({ id: "3", company: "Globex Inc." }), job({ id: "4", company: "Initech" })];
    expect([...jobs, ...jobs].map(knownAt)).toEqual([3, 3, 1, 0, 3, 3, 1, 0]);
    expect(reads).toEqual(["acme", "globex", "initech"]);
    // Nothing inherited counts as a company.
    expect(knownCounter({})(job({ id: "5", company: "Constructor" }))).toBe(0);
  });
});

describe("Know someone there filter", () => {
  const knownAt = knownCounter(counts);
  const ctx: Ctx = { user: {}, min: 70, industriesOf: () => [], hiddenCompanies: new Set(), now: NOW, knownAt };
  const jobs = [job({ id: "a", company: "Acme" }), job({ id: "b", company: "Initech" }), job({ id: "c", company: "Globex" })];

  it("keeps only companies where you know someone, with a chip and a link that keep it", () => {
    expect(applyFilters(jobs, f({ knownOnly: true }), ctx).map((j) => j.id)).toEqual(["a", "c"]);
    expect(applyFilters(jobs, f({ knownOnly: true }), { ...ctx, knownAt: undefined })).toEqual([]);
    expect(applyFilters(jobs, f(), ctx)).toHaveLength(3);
    expect(activeChips(f({ knownOnly: true }), ctx)).toEqual([{ key: "known", label: "Know someone there", remove: { knownOnly: false } }]);
    expect(fromQuery(toQuery(f({ knownOnly: true }), "people"))).toMatchObject({ filters: { knownOnly: true }, sort: "people" });
  });

  const toggles = (o: { networkReady?: boolean; knownOnly?: boolean; knownCount?: number }) =>
    render(<MoreToggles filters={f({ knownOnly: !!o.knownOnly })} setFilters={() => {}} olderCount={0} maxAgeDays={0} networkReady={o.networkReady} knownCount={o.knownCount} />);

  it("shows with its count once connections are imported, and while it's on", () => {
    toggles({});
    expect(screen.queryByLabelText(/Know someone there/)).toBeNull();
    cleanup();
    toggles({ networkReady: true, knownCount: 2 });
    expect(screen.getByLabelText("Know someone there (2)")).toBeTruthy();
    cleanup();
    toggles({ knownOnly: true });
    expect((screen.getByLabelText("Know someone there") as HTMLInputElement).checked).toBe(true);
  });
});

describe("People you know sort", () => {
  const jobs = [
    job({ id: "low", company: "Globex", score: 90 }),
    job({ id: "none", company: "Initech", score: 99 }),
    job({ id: "acme-old", company: "Acme", score: 70, postedAt: daysAgo(9), firstSeen: daysAgo(9) }),
    job({ id: "acme-strong", company: "Acme", score: 80 }),
    job({ id: "acme-new", company: "Acme", score: 70 }),
  ];

  it("orders by people you know, then score, then newest, and never changes the score", () => {
    const sorted = sortJobs(jobs, "people", { now: NOW, known: knownCounter(counts) });
    expect(sorted.map((j) => j.id)).toEqual(["acme-strong", "acme-new", "acme-old", "low", "none"]);
    expect(sorted.map((j) => j.score)).toEqual([80, 70, 70, 90, 99]);
    // Without a network it is a plain score order.
    expect(sortJobs(jobs, "people").map((j) => j.id)).toEqual(["none", "low", "acme-strong", "acme-new", "acme-old"]);
  });

  it("is offered only once connections are imported, or while it's picked", () => {
    expect(sortsFor(false).map((s) => s.value)).not.toContain("people");
    expect(sortsFor(true)).toBe(SORTS);
    expect(sortsFor(false, "people")).toBe(SORTS);
    render(<SortOptions sort="best" onChange={() => {}} />);
    expect(screen.queryByText("People you know")).toBeNull();
    cleanup();
    render(<SortOptions sort="best" onChange={() => {}} networkReady />);
    expect(screen.getByText("People you know")).toBeTruthy();
  });
});

describe("Radar row", () => {
  const lead = job({ id: "greenhouse:acme:1", company: "Acme", title: "Senior Product Manager", location: "Dubai", workplace: "onsite", surge: { n: 14, usual: 4.6 } });
  const entry: Entry = { status: "saved", updatedAt: "2026-10-10T09:00:00.000Z", snapshot: { title: lead.title, company: lead.company, url: lead.url, location: lead.location, score: lead.score } };
  const row = (known?: number) =>
    render(
      <ul>
        <JobCard group={{ key: "g", lead, jobs: [lead] }} entry={entry} known={known} min={0} isNew={false} selected={false} onSelect={() => {}} onStatus={() => {}} />
      </ul>,
    );

  it("says how many people you know after your status, before the job's fact", () => {
    const { container } = row(3);
    const meta = container.querySelector(".rj-row__meta")!;
    expect(meta.textContent).toMatch(/Saved·3 you know·Hiring surge$/);
    expect(screen.getByText("3 you know").closest("[title]")!.getAttribute("title")).toBe("3 people you know work at Acme");
    expect(meta.querySelector("svg.rj-icon")).toBeTruthy();
  });

  it("says nothing when you know nobody there", () => {
    row(0);
    expect(screen.queryByText(/you know/)).toBeNull();
    cleanup();
    row(1);
    expect(screen.getByText("1 you know").closest("[title]")!.getAttribute("title")).toBe("1 person you know works at Acme");
  });
});

describe("useNetworkSummary", () => {
  const stub = (body: unknown) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  };

  it("stays empty until connections are imported", async () => {
    const fetch = stub({ importedAt: null, counts: {} });
    const { result } = renderHook(() => useNetworkSummary());
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/network/summary", { cache: "no-store" }));
    expect(result.current).toBeUndefined();
  });

  it("answers the counts, and asks again after an import", async () => {
    const fetch = stub({ importedAt: "2026-10-20T09:00:00.000Z", counts });
    const { result } = renderHook(() => useNetworkSummary());
    await waitFor(() => expect(result.current?.counts).toEqual(counts));
    networkChanged();
    await waitFor(() => expect(fetch.mock.calls.filter(([u]) => u === "/api/network/summary")).toHaveLength(2));
  });
});
