// @vitest-environment happy-dom
import { activityMonths, type ActivityView, type HiringSummary } from "@rawjobs/core/activity";
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { HiringActivity, hiringFootnote, hiringLine } from "../src/components/HiringActivity";
import { JobDetail } from "../src/components/JobDetail";
import { JobCard } from "../src/components/radar/JobCard";
import { MoreToggles } from "../src/components/radar/MoreFilters";
import { DEFAULT_FILTERS } from "../src/lib/filters";
import type { Job, Profile } from "../src/lib/data";
import { makeJob } from "./helpers";

afterEach(cleanup);

const months = (counts: (number | null)[]) => activityMonths("2026-10-13", 12).map((month, i) => ({ month, count: counts[i] ?? null }));
const summary = (o: Partial<HiringSummary> = {}): HiringSummary => ({
  last30: 14,
  basis: "new",
  since: "2026-07-01",
  baselineReady: true,
  usual: 4.6,
  pace: 14 / 4.6,
  surge: true,
  months: months([null, null, null, null, null, null, null, null, 2, 3, 2, 14]),
  source: "feed",
  ...o,
});

describe("Hiring at … text", () => {
  it("says the last 30 days, and the pace once it can be compared and is well above usual", () => {
    expect(hiringLine(summary())).toBe("14 new roles in the last 30 days, about 3× their usual pace.");
    expect(hiringLine(summary({ last30: 1, pace: 1.2 }))).toBe("1 new role in the last 30 days.");
    expect(hiringLine(summary({ pace: 1.6 }))).toBe("14 new roles in the last 30 days, about 1.5× their usual pace.");
    expect(hiringLine(summary({ baselineReady: false, usual: undefined, pace: undefined }))).toBe("14 new roles in the last 30 days.");
    // "Usually none" has no pace to give.
    expect(hiringLine(summary({ usual: 0, pace: Infinity }))).toBe("14 new roles in the last 30 days.");
  });

  it("counts posted roles until 30 days are recorded, and says nothing without a count", () => {
    expect(hiringLine(summary({ basis: "posted", last30: 6, baselineReady: false }))).toBe("6 posted in the last 30 days.");
    expect(hiringLine(summary({ last30: undefined }))).toBeNull();
  });

  it("says when records started until comparisons show, then where the numbers come from", () => {
    expect(hiringFootnote(summary({ baselineReady: false, since: "2026-10-11" }))).toBe("Records started October 2026. Comparisons show after 6 weeks.");
    expect(hiringFootnote(summary())).toBe("New roles seen in RawJobs' daily read of their careers page.");
    expect(hiringFootnote(summary({ source: "local" }))).toBe("New roles seen in your scans of their careers page.");
  });

  it("draws 12 bars with this month in ink, months without records as a dashed line, and reads them out", () => {
    const { container } = render(<HiringActivity company="Northwind Pay" summary={summary()} />);
    expect(screen.getByRole("heading", { name: "Hiring at Northwind Pay" })).toBeTruthy();
    const bars = screen.getByRole("img");
    expect(bars.children).toHaveLength(12);
    expect(bars.lastElementChild!.className).toContain("bg-ink");
    expect(bars.firstElementChild!.className).toContain("border-dashed");
    expect(bars.getAttribute("aria-label")).toBe(
      "New roles per month: November 2025 no records, December 2025 no records, January 2026 no records, February 2026 no records, March 2026 no records, April 2026 no records, May 2026 no records, June 2026 no records, July 2026 2, August 2026 3, September 2026 2, October 2026 14 (this month).",
    );
    expect(container.textContent).toContain("about 3× their usual pace");
  });
});

describe("in the drawer and the feed", () => {
  const view: ActivityView = {
    version: 1,
    ready: true,
    feed: { date: "2026-10-13", since: "2026-07-01", first_month: "2025-10" },
    companies: { "greenhouse:acme": { src: "feed", m: [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 2, 14], n: 14, p: 20 } },
  };
  beforeAll(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.endsWith("activity.json") ? new Response(JSON.stringify(view), { headers: { "content-type": "application/json" } }) : new Response("", { status: 404 }))),
    );
  });
  afterAll(() => vi.unstubAllGlobals());

  const profile = {
    name: "Me",
    titles: { include: [], exclude: [] },
    seniority_boost: [],
    locations: { include: [], remote_ok: [], remote_exclude: [], workplace: [] },
    industries: [],
    past_employers: [],
    keywords: {},
    min_score: 65,
  } as unknown as Profile;
  const surge = { n: 14, usual: 4.6 };
  const job = (o: Partial<Job> = {}) => makeJob({ company: "Acme", companyKey: "greenhouse:acme", ...o });

  it("shows the block for a company with records, and the tag with its numbers", async () => {
    const { container } = render(<JobDetail job={job({ surge })} profile={profile} onUpdate={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Hiring at Acme" })).toBeTruthy();
    expect(container.textContent).toContain("14 new roles in the last 30 days, about");
    const fact = [...container.querySelectorAll(".rj-fact")].find((f) => f.textContent?.startsWith("Company hiring"))!;
    expect(fact.textContent).toContain("14 roles in 30 days");
  });

  it("hides the block for a company without records", async () => {
    render(<JobDetail job={job({ companyKey: "lever:nobody" })} profile={profile} onUpdate={() => {}} />);
    await screen.findByRole("heading", { name: "Details" });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("heading", { name: /^Hiring at/ })).toBeNull();
  });

  it("tags a feed row only when its company has a surge", () => {
    const lead = job({ surge });
    const row = (j: Job) => (
      <ul>
        <JobCard group={{ key: j.group, lead: j, jobs: [j] }} min={65} isNew={false} selected={false} onSelect={() => {}} onStatus={() => {}} />
      </ul>
    );
    render(row(lead));
    expect(screen.getByText("Hiring surge").title).toBe("Acme opened 14 roles in the last 30 days; usually about 5.");
    cleanup();
    render(row(job()));
    expect(screen.queryByText("Hiring surge")).toBeNull();
  });
});

describe("the surge filter", () => {
  const toggles = (o: { hiringReady?: boolean; surgeOnly?: boolean }) =>
    render(<MoreToggles filters={{ ...DEFAULT_FILTERS, surgeOnly: !!o.surgeOnly }} setFilters={() => {}} olderCount={0} maxAgeDays={0} hiringReady={o.hiringReady} />);

  it("stays hidden until some company can be compared", () => {
    toggles({});
    expect(screen.queryByLabelText("Only companies with a hiring surge")).toBeNull();
    cleanup();
    toggles({ hiringReady: true });
    expect(screen.getByLabelText("Only companies with a hiring surge")).toBeTruthy();
  });

  it("shows while it's on, so it can be turned off", () => {
    toggles({ surgeOnly: true });
    expect((screen.getByLabelText("Only companies with a hiring surge") as HTMLInputElement).checked).toBe(true);
  });
});
