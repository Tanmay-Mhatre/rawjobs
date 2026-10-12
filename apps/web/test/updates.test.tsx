// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerNotices } from "../src/components/Updates";
import { UpdatePill } from "../src/components/WhatsNew";
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

/** The local API: /api/health answers (or not), /api/update says `status`, the changelog CHANGELOG. */
function api(status: UpdateStatus, healthy = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
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
  vi.unstubAllGlobals();
});

describe("ServerNotices", () => {
  it("shows what's new once after an update: every version since the one you had, tagged", async () => {
    api({ ...base, lastUpdate: { from: "0.2.0", to: "0.3.0", ok: true, at: "", notes: "" } });
    render(<ServerNotices />);
    expect(await screen.findByText("What's new in RawJobs")).toBeTruthy();
    expect(await screen.findByText("Deadlines on saved jobs")).toBeTruthy();
    // The version in between that was skipped, but not the one you already had.
    expect(screen.getByText("Alerts after a restart")).toBeTruthy();
    expect(screen.queryByText("Older, already seen")).toBeNull();
    expect(screen.getAllByText("New").length).toBeGreaterThan(0);
    expect(screen.getByText("Fixed")).toBeTruthy();
  });

  it("says when an update went back, and that nothing of yours changed", async () => {
    api({ ...base, current: "0.2.0", lastUpdate: { from: "0.2.0", to: "0.3.0", ok: false, at: "" } });
    render(<ServerNotices />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/update to 0\.3\.0 didn't work, so you're still on 0\.2\.0\..*Nothing of yours changed/);
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

  it("says it's reconnecting while the server is away", async () => {
    api(base, false);
    render(<ServerNotices />);
    expect(await screen.findByText("Reconnecting to RawJobs…")).toBeTruthy();
  });
});
