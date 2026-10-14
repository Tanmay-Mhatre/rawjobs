// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/setup", async (orig) => ({
  ...(await orig<typeof import("../src/lib/setup")>()),
  checkCompanies: vi.fn(async (urls: string[]) =>
    urls.map((input) => ({ input, status: "live", ats: "ashby", slug: "globex-inc", careers_url: "https://jobs.ashbyhq.com/globex-inc", name: "Globex", name_source: "ats", open_jobs: 14 })),
  ),
}));
import { MyCompanies } from "../src/components/Companies";
import type { CompanyHealth, DataMeta } from "../src/lib/data";
import { barsOf, barsSummary, filterCounts, pageOf, problemOf, quietOf, type Seen } from "../src/lib/myCompanies";
import type { CompanyRow } from "../src/lib/setup";

afterEach(cleanup);

const DAY = 86_400_000;
const row = (name: string, slug: string, patch: Partial<CompanyRow> = {}): CompanyRow => ({ id: slug, input: `greenhouse: ${slug}`, state: "saved", name, ats: "greenhouse", slug, ...patch });
const rows = [row("Acme", "acme"), row("Globex", "globex")];
const keys = (list: CompanyRow[]) => new Set(list.map((r) => `greenhouse:${r.slug}`));
const renderList = (attention?: number) => render(<MyCompanies rows={rows} savedKeys={keys(rows)} onRemove={() => {}} onRemoveMany={() => {}} attention={attention} />);

const health = (slug: string, patch: Partial<CompanyHealth> = {}): CompanyHealth => ({ company: slug, ats: "greenhouse", slug, ok: true, jobsFound: 10, matches: 0, durationMs: 100, ...patch });
/** Scans newest first, one a day: `each(slug, i)` is a company's health in scan i (undefined: not in it). */
function meta(n: number, slugs: string[], each: (slug: string, i: number) => Partial<CompanyHealth> | undefined = () => ({})): DataMeta {
  const runs = Array.from({ length: n }, (_, i) => {
    const at = new Date(Date.now() - (i + 1) * DAY).toISOString();
    const hs = slugs.flatMap((s) => {
      const p = each(s, i);
      return p ? [health(s, p)] : [];
    });
    return { startedAt: at, finishedAt: at, partial: false, jobsFound: 0, matches: 0, newMatches: 0, closed: 0, health: hs };
  });
  return { version: 1, generatedAt: new Date().toISOString(), runs } as unknown as DataMeta;
}
const seen = (...hs: Partial<CompanyHealth>[]): Seen[] => hs.map((p, i) => ({ h: health("x", p), at: new Date(Date.UTC(2026, 9, 10 - i)).toISOString() }));

describe("status mapping", () => {
  it("says nothing for a company whose last scan worked", () => {
    expect(problemOf(seen({}, { ok: false, error: "HTTP (500)" }), { anyScans: true })).toBeNull();
  });

  it("takes the start of a long failure from the board's record, past the saved scans", () => {
    const now = Date.UTC(2026, 9, 11);
    const all = seen({ ok: false, error: "timeout" }, { ok: false, error: "timeout" });
    const older = new Date(Date.UTC(2026, 8, 1)).toISOString();
    expect(problemOf(all, { anyScans: true, failingSince: older, now })).toEqual({ kind: "notAnswering", since: older, scans: 2, chronic: true });
    // A saved scan that worked ends the streak, whatever the record says.
    expect(problemOf([...all, ...seen({})], { anyScans: true, failingSince: older, now })).toEqual({ kind: "notAnswering", since: all[1]!.at, scans: 2 });
    expect(problemOf(all, { anyScans: true, failingSince: new Date(Date.UTC(2026, 9, 1)).toISOString(), now })).not.toHaveProperty("chronic");
  });

  it("says 'for over a month' when a company of yours has failed that long", () => {
    const list = [row("Initech", "initech")];
    const m = { ...meta(2, ["initech"], () => ({ ok: false, error: "timeout" })), boardHealth: { "greenhouse:initech": { since: new Date(Date.now() - 40 * DAY).toISOString() } } };
    const { container } = render(<MyCompanies rows={list} savedKeys={keys(list)} meta={m} onScan={() => {}} onRemove={() => {}} onRemoveMany={() => {}} />);
    const table = within(container.querySelector("table")!);
    expect(table.getByText("Not answering")).toBeTruthy();
    expect(table.getByText(/^for over a month \(since /)).toBeTruthy();
  });

  it("calls a 404 'not found', since the first failing scan in a row", () => {
    expect(problemOf(seen({ ok: false, error: "Not found (404)" }, { ok: false, error: "Not found (404)" }, {}), { anyScans: true, now: Date.UTC(2026, 9, 11) })).toEqual({
      kind: "notFound",
      since: new Date(Date.UTC(2026, 9, 9)).toISOString(),
    });
  });

  it("calls other failures 'not answering', counting the scans in a row", () => {
    expect(problemOf(seen({ ok: false, error: "timeout" }, {}), { anyScans: true })).toMatchObject({ kind: "notAnswering", scans: 1 });
  });

  it("knows hiring systems it can't read yet, and companies no scan has included", () => {
    expect(problemOf(seen({ ok: false, unsupported: true }), { anyScans: true })).toEqual({ kind: "cantRead" });
    expect(problemOf([], { unreadable: true, anyScans: true })).toEqual({ kind: "cantRead" });
    expect(problemOf([], { anyScans: true })).toEqual({ kind: "notChecked", afterLastScan: true });
    expect(problemOf([], { anyScans: false })).toEqual({ kind: "notChecked", afterLastScan: false });
  });

  it("counts quiet scans until one has something for you or fails", () => {
    expect(quietOf(seen({}, {}, { matches: 2 }, {})).scans).toBe(2);
    expect(quietOf(seen({ ok: false }, {})).scans).toBe(0);
  });
});

describe("filter counts and pages", () => {
  it("counts each filter", () => {
    expect(
      filterCounts([
        { problem: null, quiet: false },
        { problem: null, quiet: true },
        { problem: { kind: "notFound", since: "" }, quiet: false },
        { problem: { kind: "notAnswering", since: "", scans: 1 }, quiet: false },
        { problem: { kind: "notChecked", afterLastScan: true }, quiet: false },
        { problem: { kind: "cantRead" }, quiet: false },
      ]),
    ).toEqual({ all: 6, attention: 2, quiet: 1, new: 1 });
  });

  it("pages 25 at a time and clamps the page", () => {
    const list = Array.from({ length: 60 }, (_, i) => i);
    expect(pageOf(list, 1)).toMatchObject({ page: 1, pages: 3 });
    expect(pageOf(list, 3).items).toEqual([50, 51, 52, 53, 54, 55, 56, 57, 58, 59]);
    expect(pageOf(list, 9).page).toBe(3);
    expect(pageOf([], 1)).toEqual({ items: [], page: 1, pages: 1 });
  });

  it("draws the last 5 scans oldest first, with health only", () => {
    const runs = meta(7, ["a"], (_, i) => (i === 0 ? { ok: false } : i === 2 ? undefined : { matches: 3 })).runs;
    const bars = barsOf(runs, (h) => h[0]);
    expect(bars.map((b) => b.state)).toEqual(["worked", "worked", "none", "worked", "failed"]);
    expect(barsSummary(bars)).toBe("Last 5 scans: 3 worked, 1 failed, 1 not checked");
  });
});

describe("MyCompanies sort", () => {
  const sortValue = () => (screen.getByRole("combobox", { name: "Sort" }) as HTMLSelectElement).value;

  it("starts with Needs attention first, on All", () => {
    renderList();
    expect(sortValue()).toBe("attention");
    expect(screen.getByRole("button", { name: /^All/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows Needs attention when a failing link was followed, each time", () => {
    const { rerender } = renderList();
    rerender(<MyCompanies rows={rows} savedKeys={keys(rows)} onRemove={() => {}} onRemoveMany={() => {}} attention={1} />);
    expect(screen.getByRole("button", { name: /^Needs attention/ }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("MyCompanies summary", () => {
  it("says how many companies there are and that each is checked on every scan", () => {
    renderList();
    expect(screen.getByText(/companies, checked on every scan\./).textContent).toBe("2 companies, checked on every scan.");
  });

  it("shows what the scan covers instead of a list when there are none", () => {
    render(<MyCompanies rows={[]} savedKeys={new Set()} onRemove={() => {}} onRemoveMany={() => {}} empty="Right now: 0 companies, so your Radar stays empty." />);
    expect(screen.getByText("Right now: 0 companies, so your Radar stays empty.")).toBeTruthy();
    expect(screen.queryByText(/checked on every scan/)).toBeNull();
  });

  it("opens the last scan and hidden companies in place at the top", () => {
    const onShowAgain = vi.fn();
    const m = meta(2, ["acme", "globex"], (s, i) => (s === "acme" && i === 0 ? { ok: false, error: "timeout" } : {}));
    render(
      <MyCompanies rows={rows} savedKeys={keys(rows)} meta={m} hidden={[{ key: "greenhouse:zoominfo", name: "ZoomInfo" }]} onShowAgain={onShowAgain} onRemove={() => {}} onRemoveMany={() => {}} />,
    );
    const last = screen.getByRole("button", { name: /Last scan 1d ago · 1 failed/ });
    expect(last.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(last);
    expect(screen.getByRole("heading", { name: "Recent scans" })).toBeTruthy();
    expect(screen.getAllByText(/2 companies checked/).length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "1 hidden" }));
    expect(screen.queryByRole("heading", { name: "Recent scans" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show ZoomInfo again" }));
    expect(onShowAgain).toHaveBeenCalledWith({ key: "greenhouse:zoominfo", name: "ZoomInfo" });
  });
});

describe("MyCompanies rows", () => {
  it("has no job columns: For you and Open jobs live on the Radar", () => {
    renderList();
    expect(screen.queryByRole("columnheader", { name: "For you" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Open jobs" })).toBeNull();
    expect(screen.queryByText(/Hiring system/)).toBeNull();
  });

  it("links each name to its jobs on the Radar, under the names its jobs carry", () => {
    render(<MyCompanies rows={rows} savedKeys={new Set()} jobNames={new Map([["greenhouse:globex", ["Globex Corp"]]])} onRemove={() => {}} onRemoveMany={() => {}} />);
    const links = (name: string) => screen.getAllByRole("link", { name: `${name}: see its jobs on your Radar` }).map((a) => a.getAttribute("href"));
    expect(links("Acme")[0]).toBe("#radar?companies=Acme");
    expect(links("Globex")[0]).toBe("#radar?companies=Globex+Corp");
    expect(screen.getAllByTitle("See Acme on your Radar").length).toBeGreaterThan(0);
  });

  it("offers a page the last scan found: Review opens it filled in and checked, and only Use this link switches", async () => {
    const list = [row("Globex", "globex"), row("Acme", "acme"), row("Initech", "initech")];
    const m = meta(1, ["globex", "acme", "initech"], (s) => (s === "globex" ? { ok: false, error: "Not found (404)" } : s === "initech" ? { ok: false, error: "timeout" } : {}));
    const to = { name: "Globex", ats: "ashby" as const, slug: "globex-inc", careers_url: "https://jobs.ashbyhq.com/globex-inc", enabled: true };
    m.runs[0]!.moves = [
      { name: "Globex", from: { name: "Globex", ats: "greenhouse", slug: "globex", enabled: true }, to },
      // Already one of yours: not offered.
      { name: "Acme", from: { name: "Acme", ats: "greenhouse", slug: "acme", enabled: true }, to: { name: "Acme", ats: "greenhouse", slug: "globex", enabled: true } },
      // Checked by RawJobs for everyone: offered even though the old page only timed out, and can't be turned down.
      {
        name: "Initech",
        from: { name: "Initech", ats: "greenhouse", slug: "initech", enabled: true },
        to: { name: "Initech", ats: "lever", slug: "initech", careers_url: "https://jobs.lever.co/initech", enabled: true },
        checked_at: "2026-10-01T00:00:00Z",
      },
    ];
    const onUpdateLink = vi.fn();
    const onDismissMove = vi.fn();
    const { container } = render(<MyCompanies rows={list} savedKeys={keys(list)} meta={m} onUpdateLink={onUpdateLink} onDismissMove={onDismissMove} onRemove={() => {}} onRemoveMany={() => {}} />);
    const table = within(container.querySelector("table")!);
    const rowOf = (name: string) => within(table.getByRole("link", { name: `${name}: see its jobs on your Radar` }).closest("tr")!);
    expect(rowOf("Globex").getByText("May have moved to Ashby")).toBeTruthy();
    expect(rowOf("Acme").queryByRole("button", { name: /Review/ })).toBeNull();
    expect(rowOf("Initech").getByText("Moved to Lever, checked by RawJobs")).toBeTruthy();
    expect(rowOf("Initech").queryByRole("button", { name: /^Not / })).toBeNull();

    fireEvent.click(rowOf("Globex").getByRole("button", { name: "Not Globex's new careers page" }));
    expect(onDismissMove).toHaveBeenCalledWith(expect.objectContaining({ name: "Globex" }));

    fireEvent.click(rowOf("Globex").getByRole("button", { name: "Review Globex's possible new careers page" }));
    expect((table.getByLabelText("New careers link for Globex") as HTMLInputElement).value).toBe("https://jobs.ashbyhq.com/globex-inc");
    expect(table.getByText(/Check it's really Globex/)).toBeTruthy();
    expect(await table.findByText(/Ashby · 14 open jobs/)).toBeTruthy();
    expect(onUpdateLink).not.toHaveBeenCalled();
    fireEvent.click(table.getByRole("button", { name: "Use this link" }));
    expect(onUpdateLink).toHaveBeenCalledWith("greenhouse:globex", expect.objectContaining({ ats: "ashby", slug: "globex-inc" }), {});
  });

  it("doesn't offer a page you turned down", () => {
    const list = [row("Globex", "globex")];
    const m = meta(1, ["globex"], () => ({ ok: false, error: "Not found (404)" }));
    m.runs[0]!.moves = [{ name: "Globex", from: { name: "Globex", ats: "greenhouse", slug: "globex", enabled: true }, to: { name: "Globex", ats: "ashby", slug: "globex-inc", enabled: true } }];
    const { container } = render(
      <MyCompanies rows={list} savedKeys={keys(list)} meta={m} onUpdateLink={() => {}} dismissedMoves={new Set(["greenhouse:globex>ashby:globex-inc"])} onRemove={() => {}} onRemoveMany={() => {}} />,
    );
    expect(within(container.querySelector("table")!).queryByRole("button", { name: /^Review/ })).toBeNull();
  });

  it("updates a link in place: check it, see old and new, and only Use this link changes anything", async () => {
    const list = [row("Globex", "globex"), row("Acme", "acme")];
    const m = meta(2, ["globex", "acme"], (s) => (s === "globex" ? { ok: false, error: "Not found (404)" } : {}));
    const onUpdateLink = vi.fn();
    const { container } = render(<MyCompanies rows={list} savedKeys={keys(list)} meta={m} onUpdateLink={onUpdateLink} onRemove={() => {}} onRemoveMany={() => {}} attention={1} />);
    const table = within(container.querySelector("table")!);
    const open = table.getByRole("button", { name: "Update Globex's careers link" });
    expect(open.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(open);
    expect(open.getAttribute("aria-expanded")).toBe("true");
    const input = table.getByLabelText("New careers link for Globex");
    expect(document.activeElement).toBe(input);

    // Escape closes without a change, and focus goes back to the button.
    fireEvent.keyDown(input, { key: "Escape" });
    expect(table.queryByLabelText("New careers link for Globex")).toBeNull();
    expect(document.activeElement).toBe(open);

    fireEvent.click(open);
    fireEvent.change(table.getByLabelText("New careers link for Globex"), { target: { value: "https://jobs.ashbyhq.com/globex-inc" } });
    fireEvent.click(table.getByRole("button", { name: "Check link" }));
    expect(await table.findByText("Not found")).toBeTruthy();
    expect(table.getByRole("link", { name: /jobs\.ashbyhq\.com\/globex-inc/ }).getAttribute("href")).toBe("https://jobs.ashbyhq.com/globex-inc");
    expect(table.getByText(/Ashby · 14 open jobs/)).toBeTruthy();
    expect(onUpdateLink).not.toHaveBeenCalled();

    fireEvent.click(table.getByRole("button", { name: "Use this link" }));
    expect(onUpdateLink).toHaveBeenCalledWith("greenhouse:globex", expect.objectContaining({ ats: "ashby", slug: "globex-inc", name: "Globex" }), {});
    expect(table.queryByLabelText("New careers link for Globex")).toBeNull();
  });

  it("offers Update link on a company that isn't answering, from the first failed scan", () => {
    const list = [row("Initech", "initech"), row("Hooli", "hooli")];
    const m = meta(3, ["initech", "hooli"], (s, i) => (s === "initech" && i < 2 ? { ok: false, error: "timeout" } : s === "hooli" && i === 0 ? { ok: false, error: "timeout" } : {}));
    const { container } = render(<MyCompanies rows={list} savedKeys={keys(list)} meta={m} onUpdateLink={() => {}} onRemove={() => {}} onRemoveMany={() => {}} />);
    const table = within(container.querySelector("table")!);
    expect(table.getByRole("button", { name: "Update Initech's careers link" })).toBeTruthy();
    expect(table.getByRole("button", { name: "Update Hooli's careers link" })).toBeTruthy();
  });

  it("says the old page isn't answering (not that it's gone) when updating such a company", async () => {
    const list = [row("Hooli", "hooli")];
    const m = meta(1, ["hooli"], () => ({ ok: false, error: "timeout" }));
    const { container } = render(<MyCompanies rows={list} savedKeys={keys(list)} meta={m} onUpdateLink={() => {}} onRemove={() => {}} onRemoveMany={() => {}} />);
    const table = within(container.querySelector("table")!);
    fireEvent.click(table.getByRole("button", { name: "Update Hooli's careers link" }));
    fireEvent.change(table.getByLabelText("New careers link for Hooli"), { target: { value: "https://jobs.ashbyhq.com/globex-inc" } });
    fireEvent.click(table.getByRole("button", { name: "Check link" }));
    await table.findByRole("button", { name: "Use this link" });
    expect(table.getAllByText("Not answering")).toHaveLength(2);
    expect(table.queryByText("Not found")).toBeNull();
  });

  it("puts words only on problems, each with its fix", () => {
    const list = [row("Acme", "acme"), row("Globex", "globex"), row("Initech", "initech"), row("Umbrella", "umbrella")];
    const m = meta(3, ["acme", "globex", "initech"], (s, i) => (s === "globex" ? { ok: false, error: "Not found (404)" } : s === "initech" && i === 0 ? { ok: false, error: "timeout" } : {}));
    const onScan = vi.fn();
    const onPasteLink = vi.fn();
    const { container } = render(<MyCompanies rows={list} savedKeys={keys(list)} meta={m} onScan={onScan} onPasteLink={onPasteLink} onRemove={() => {}} onRemoveMany={() => {}} />);
    const table = within(container.querySelector("table")!);
    const rowOf = (name: string) => within(table.getByRole("link", { name: `${name}: see its jobs on your Radar` }).closest("tr")!);
    expect(rowOf("Acme").getAllByRole("cell")[2]!.textContent).toBe("");
    expect(rowOf("Globex").getByText("Careers page not found")).toBeTruthy();
    fireEvent.click(rowOf("Globex").getByRole("button", { name: "Paste new link" }));
    expect(onPasteLink).toHaveBeenCalled();
    expect(rowOf("Initech").getByText("Not answering")).toBeTruthy();
    expect(rowOf("Initech").getByText("on the last scan")).toBeTruthy();
    fireEvent.click(rowOf("Initech").getByRole("button", { name: "Check again" }));
    expect(onScan).toHaveBeenCalled();
    expect(rowOf("Umbrella").getByText("Not checked yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Needs attention/ }).textContent).toBe("Needs attention2");
    expect(screen.getByRole("button", { name: /^Not checked yet/ }).textContent).toBe("Not checked yet1");
    // No role counts in the bars' tooltips.
    for (const el of container.querySelectorAll("[title]")) expect(el.getAttribute("title")).not.toMatch(/for you|jobs,/);
  });

  it("shows 25 per page", () => {
    const many = Array.from({ length: 30 }, (_, i) => row(`Co ${String(i).padStart(2, "0")}`, `co${i}`));
    const { container } = render(<MyCompanies rows={many} savedKeys={keys(many)} onRemove={() => {}} onRemoveMany={() => {}} />);
    expect(container.querySelectorAll("tbody tr").length).toBe(25);
    expect(screen.getByText("Showing 1–25 of 30")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(container.querySelectorAll("tbody tr").length).toBe(5);
  });

  it("filters by the page's search", () => {
    const { container } = render(<MyCompanies rows={rows} savedKeys={keys(rows)} query="glo" onRemove={() => {}} onRemoveMany={() => {}} />);
    expect(container.querySelectorAll("tbody tr").length).toBe(1);
  });
});

describe("quiet banner", () => {
  // 10 scans with nothing for you, over more than 7 days.
  const m = meta(10, ["acme", "globex"], (s) => (s === "acme" ? {} : { matches: 1 }));

  it("tells the truth, offers Review first, and Remove with Undo", () => {
    const onRemoveMany = vi.fn();
    const onRestore = vi.fn();
    const { container } = render(<MyCompanies rows={rows} savedKeys={keys(rows)} meta={m} onRemove={() => {}} onRemoveMany={onRemoveMany} onRestore={onRestore} />);
    expect(screen.getByText(/1 company has had nothing for you in its last 10 scans\. Removing it keeps scans quick\./)).toBeTruthy();
    expect(container.textContent).not.toMatch(/from the directory/);
    const review = screen.getByRole("button", { name: "Review 1" });
    const remove = screen.getByRole("button", { name: "Remove 1 quiet company" });
    expect(review.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(remove.className).not.toMatch(/danger/);
    fireEvent.click(review);
    expect(container.querySelectorAll("tbody tr").length).toBe(1);
    fireEvent.click(remove);
    expect(onRemoveMany).toHaveBeenCalledWith(["greenhouse:acme"]);
    expect(screen.getByRole("status").textContent).toMatch(/Removed 1 quiet company/);
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    expect(onRestore).toHaveBeenCalledWith([rows[0]]);
  });
});
