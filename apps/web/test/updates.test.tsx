// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerNotices } from "../src/components/Updates";
import type { UpdateStatus } from "../src/lib/update";

const base: UpdateStatus = {
  installed: true,
  current: "0.3.0",
  settings: { mode: "auto", channel: "stable" },
  available: null,
  tooOld: false,
  state: "idle",
  lastUpdate: null,
};

/** The local API: /api/health answers (or not), /api/update says `status`. */
function api(status: UpdateStatus, healthy = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/health")) {
        if (!healthy) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ ok: true, version: status.current }));
      }
      return new Response(JSON.stringify(status));
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ServerNotices", () => {
  it("says which version it updated to, with what's new", async () => {
    api({ ...base, lastUpdate: { from: "0.2.0", to: "0.3.0", ok: true, at: "", notes: "Faster scans." } });
    render(<ServerNotices />);
    expect(await screen.findByText("Updated to RawJobs 0.3.0.")).toBeTruthy();
    expect(screen.getByText("Faster scans.")).toBeTruthy();
  });

  it("says when an update went back, and that nothing of yours changed", async () => {
    api({ ...base, current: "0.2.0", lastUpdate: { from: "0.2.0", to: "0.3.0", ok: false, at: "" } });
    render(<ServerNotices />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/update to 0\.3\.0 didn't work, so you're still on 0\.2\.0\..*Nothing of yours changed/);
  });

  it("asks before a new major version, and shows the install line when this one is too old", async () => {
    api({ ...base, available: { version: "1.0.0", notes: "", critical: false, date: "", major: true } });
    const { unmount } = render(<ServerNotices />);
    expect(await screen.findByRole("button", { name: /Update now/ })).toBeTruthy();
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
