// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AboutRawJobs, ServerNotices } from "../src/components/Updates";
import { UpdatePill } from "../src/components/WhatsNew";
import { __resetHealthForTests } from "../src/lib/health";
import type { UpdateStatus } from "../src/lib/update";

const base: UpdateStatus = {
  installed: true,
  current: "0.3.0",
  settings: { mode: "ask", channel: "stable" },
  available: null,
  tooOld: false,
  state: "idle",
  lastUpdate: null,
};

const CHANGELOG = {
  current: "0.3.0",
  upcoming: null,
  entries: [
    { version: "0.3.0", date: "2026-10-19", notes: "", changes: [{ type: "new", text: "Deadlines on saved jobs" }], critical: false },
    { version: "0.2.1", date: "2026-10-15", notes: "", changes: [{ type: "fixed", text: "Alerts after a restart" }], critical: false },
    { version: "0.2.0", date: "2026-10-10", notes: "", changes: [{ type: "improved", text: "Older, already seen" }], critical: false },
  ],
};

/** The local API: /api/health answers (or not), /api/update says `status` (and Update now `applied`), the changelog CHANGELOG. */
function api(status: UpdateStatus, healthy = true, applied: UpdateStatus = status) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/update/apply")) return new Response(JSON.stringify(applied));
      if (url.startsWith("/api/health")) {
        if (!healthy) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ ok: true, version: status.current }));
      }
      if (url.startsWith("/api/update/changelog")) return new Response(JSON.stringify(CHANGELOG));
      return new Response(JSON.stringify(status));
    }),
  );
}

afterEach(() => {
  cleanup();
  __resetHealthForTests();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("ServerNotices", () => {
  it("shows what's new once after an update: every version since the one you had, grouped, tagged", async () => {
    api({ ...base, lastUpdate: { from: "0.2.0", to: "0.3.0", ok: true, at: "", notes: "" } });
    render(<ServerNotices />);
    expect(await screen.findByRole("heading", { name: "What's new since 0.2.0" })).toBeTruthy();
    expect(screen.getByText("2 versions")).toBeTruthy();
    expect((await screen.findAllByText("Deadlines on saved jobs")).length).toBeGreaterThan(0);
    // The version in between that was skipped, but not the one you already had.
    expect(screen.getAllByText("Alerts after a restart").length).toBeGreaterThan(0);
    expect(screen.queryByText("Older, already seen")).toBeNull();
    expect(screen.getAllByText("New").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fixed").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Got it" })).toBeTruthy();
  });

  it("says when an update went back, and that nothing of yours changed", async () => {
    api({ ...base, current: "0.2.0", lastUpdate: { from: "0.2.0", to: "0.3.0", ok: false, at: "" } });
    render(<ServerNotices />);
    expect(await screen.findByRole("heading", { name: "The update to 0.3.0 didn't start" })).toBeTruthy();
    expect(screen.getByText(/Went back to 0\.2\.0/)).toBeTruthy();
    expect(screen.getByText("Nothing changed. Your data is as it was.")).toBeTruthy();
    expect(screen.getByText(/won't offer 0\.3\.0 by itself again/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Try 0.3.0 again" }).getAttribute("href")).toMatch(/^#settings\/updates/);
  });

  it("says Update tries it again when the computer never started the new version", async () => {
    api({ ...base, current: "0.2.0", lastUpdate: { from: "0.2.0", to: "0.3.0", ok: false, at: "", skipped: false } });
    render(<ServerNotices />);
    expect(await screen.findByText("Your computer didn't start 0.3.0. Update tries it again.")).toBeTruthy();
    expect(screen.queryByText(/won't offer/)).toBeNull();
  });

  it("offers to try a version that went back again, in Settings → About", async () => {
    const skipped = { ...base, current: "0.2.0", lastCheck: new Date().toISOString(), skipped: { version: "0.3.0", date: "2026-10-13" } };
    const calls: string[] = [];
    api(skipped, true);
    const f = globalThis.fetch as ReturnType<typeof vi.fn>;
    f.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return new Response(JSON.stringify(url === "/api/update/retry" ? { ...skipped, state: "updating", skipped: null } : skipped));
    });
    render(<AboutRawJobs />);
    expect(await screen.findByText(/didn't start here last time, so you're still on 0\.2\.0/)).toBeTruthy();
    expect(screen.queryByText("You have the newest version.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Try 0\.3\.0 again/ }));
    await vi.waitFor(() => expect(calls).toContain("POST /api/update/retry"));
  });

  it("says Updating to the new version while RawJobs restarts after you clicked Update", async () => {
    sessionStorage.setItem("rawjobs.updatingTo", JSON.stringify({ from: "0.3.0", to: "0.3.1", at: Date.now() }));
    api(base, false);
    render(<ServerNotices />);
    expect(await screen.findByRole("heading", { name: "Updating to 0.3.1" })).toBeTruthy();
    expect(screen.getByText("Back in a few seconds. The page reloads by itself.")).toBeTruthy();
  });

  it("shows a new version as the Update pill, and asks for the install line when this one is too old", async () => {
    api({ ...base, available: { version: "1.0.0", notes: "", critical: false, date: "", major: true, ready: true } });
    const { unmount } = render(<UpdatePill />);
    expect((await screen.findByRole("button")).textContent).toMatch(/Update to 1\.0\.0/);
    unmount();
    api({ ...base, tooOld: true });
    render(<ServerNotices />);
    expect(await screen.findByRole("heading", { name: "Reinstall RawJobs to keep using it" })).toBeTruthy();
    expect(screen.getByText(/too old to update by itself/)).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Install line" }) as HTMLInputElement).value).toMatch(/install\.(sh|ps1)/);
  });

  const required = {
    ...base,
    available: {
      version: "0.6.0",
      notes: "",
      changes: [
        { type: "fixed" as const, text: "Alerts after a restart" },
        { type: "new" as const, text: "Update button" },
        { type: "improved" as const, text: "Faster scans" },
        { type: "new" as const, text: "Release notes" },
      ],
      critical: true,
      date: "",
      major: false,
      ready: true,
    },
  };

  it("asks for a required update at a glance: versions, three points, New changes first, one button", async () => {
    api(required);
    render(<ServerNotices />);
    expect(await screen.findByRole("heading", { name: "Update to RawJobs 0.6.0" })).toBeTruthy();
    expect(screen.getByText("This update is required to keep using RawJobs.")).toBeTruthy();
    expect(screen.getByText("Takes a few seconds")).toBeTruthy();
    expect(screen.getByText("Your data stays, backed up first")).toBeTruthy();
    expect(screen.getByText("Updates after a running scan")).toBeTruthy();
    // The top three, New first; the fourth behind "See all".
    const shown = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(shown.indexOf("NewUpdate button")).toBeLessThan(shown.indexOf("ImprovedFaster scans"));
    expect(screen.getByText("See all 4 changes")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Update now/ })).toBeTruthy();
    // Background check errors don't turn it into "didn't finish" before you clicked.
    cleanup();
    api({ ...required, error: "Couldn't reach GitHub to get the update." });
    render(<ServerNotices />);
    expect(await screen.findByRole("heading", { name: "Update to RawJobs 0.6.0" })).toBeTruthy();
  });

  it("doesn't block you once you said yes during a scan: no window, the pill waits", async () => {
    api({ ...required, state: "waiting" });
    render(
      <>
        <ServerNotices />
        <UpdatePill />
      </>,
    );
    expect((await screen.findByRole("button", { name: /Update after scan/ })).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("heading", { name: /Update to RawJobs/ })).toBeNull();
  });

  it("answers a click that couldn't get the update right under the pill, with Try again", async () => {
    const ready = { ...base, available: { version: "0.3.1", notes: "", changes: [{ type: "fixed" as const, text: "Alerts" }], critical: false, date: "", major: false, ready: true } };
    api(ready, true, { ...ready, error: "Couldn't reach GitHub to get the update. Check your internet connection, then try again." });
    render(<UpdatePill />);
    fireEvent.click(await screen.findByRole("button", { name: /Update to 0\.3\.1/ }));
    expect(await screen.findByText("Couldn't update to 0.3.1")).toBeTruthy();
    expect(screen.getByText("Nothing changed. You're still on 0.3.0.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Couldn't update to 0.3.1")).toBeNull();
  });

  it("previews what's in the update on focus, without needing a click", async () => {
    api({ ...base, available: { version: "0.3.1", notes: "", changes: [{ type: "new" as const, text: "Deadlines" }], critical: false, date: "", major: false, ready: true } });
    render(<UpdatePill />);
    fireEvent.focus(await screen.findByRole("button", { name: /Update to 0\.3\.1/ }));
    expect((await screen.findByRole("tooltip")).textContent).toMatch(/RawJobs 0\.3\.1 is ready.*Deadlines.*Click to update/);
  });

  it("says it's reconnecting while the server is away", async () => {
    api(base, false);
    render(<ServerNotices />);
    expect(await screen.findByText("Reconnecting to RawJobs…")).toBeTruthy();
  });
});
