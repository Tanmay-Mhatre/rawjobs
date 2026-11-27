// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stand-ins for the lazy pages: the test is about loading them, not what they show.
const pages = vi.hoisted(() => ({ settingsFails: false }));
vi.mock("../src/components/Pipeline", () => ({ Pipeline: () => <h2>Pipeline page</h2> }));
vi.mock("../src/components/CompaniesTab", () => ({ CompaniesTab: () => <h2>Companies page</h2> }));
vi.mock("../src/components/Settings", () => ({
  get Settings() {
    // A chunk that didn't load (an update replaced it, or the server stopped) rejects the import.
    if (pages.settingsFails) throw new Error("Failed to fetch dynamically imported module");
    return () => <h2>Settings page</h2>;
  },
}));

beforeEach(() => {
  // Nothing answers: the pages still open, with the "Couldn't load your jobs" card above them.
  vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.resetModules();
  pages.settingsFails = false;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  location.hash = "";
});

async function openApp(hash: string) {
  location.hash = hash;
  const { App } = await import("../src/App");
  render(<App />);
}

describe("lazy pages", () => {
  it.each([
    ["#pipeline", "Pipeline page"],
    ["#companies", "Companies page"],
    ["#settings", "Settings page"],
  ])("%s renders once its chunk loads", async (hash, heading) => {
    await openApp(hash);
    expect(await screen.findByRole("heading", { name: heading }, { timeout: 5000 })).toBeTruthy();
    // The header stays the app's own.
    expect(screen.getAllByRole("navigation", { name: "Sections" }).length).toBeGreaterThan(0);
  });

  it("a page whose chunk fails to load shows the page error card, and the header stays", async () => {
    pages.settingsFails = true;
    await openApp("#settings");
    expect(await screen.findByText("Something went wrong on this page", undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.getAllByRole("navigation", { name: "Sections" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Settings page" })).toBeNull();
  });
});
