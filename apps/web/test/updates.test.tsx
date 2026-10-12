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
    expect(await screen.findByText(/too old to update by itself/)).toBeTruthy();
    expect(screen.getByText(/install\.(sh|ps1)/)).toBeTruthy();
  });

  it("says it's reconnecting while the server is away", async () => {
    api(base, false);
    render(<ServerNotices />);
    expect(await screen.findByText("Reconnecting to RawJobs…")).toBeTruthy();
  });
});
