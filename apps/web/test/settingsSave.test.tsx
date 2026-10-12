// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDraft, type Draft } from "../src/lib/setup";

const saveConfig = vi.fn(async (_config: unknown) => ({ ok: true as const }));
vi.mock("../src/lib/setup", async (orig) => ({ ...(await orig<typeof import("../src/lib/setup")>()), saveConfig: (c: unknown) => saveConfig(c) }));
// The cards that talk to the local server on their own aren't what this is about.
vi.mock("../src/components/ScheduledScans", () => ({ ScheduledScans: () => null }));
vi.mock("../src/components/TelegramAlerts", () => ({ TelegramAlerts: () => null }));
vi.mock("../src/components/Updates", () => ({ AboutRawJobs: () => null, UpdatesSettings: () => null, UpdateTelegramSetting: () => null }));
vi.mock("../src/components/WhatsNew", () => ({ ReleaseNotes: () => null }));
vi.mock("../src/lib/update", () => ({ useUpdateStatus: () => ({ status: null, setStatus: () => {} }) }));
vi.mock("../src/lib/data", async (orig) => ({ ...(await orig<typeof import("../src/lib/data")>()), canRunLocally: true, useDirectorySize: () => 51000 }));

const { Settings } = await import("../src/components/Settings");

const saved: Draft = { ...emptyDraft(), include: ["product manager"], remote: true, minScore: 70 };

function renderSettings(over: Partial<ComponentProps<typeof Settings>> = {}) {
  const props: ComponentProps<typeof Settings> = {
    draft: saved,
    update: vi.fn(),
    revert: vi.fn(),
    dirty: false,
    saved,
    setupSaved: true,
    onSaved: vi.fn(async () => {}),
    onScan: vi.fn(),
    scanning: false,
    user: {},
    prefs: { views: [], hiddenCompanies: [], hideRules: [] } as unknown as ComponentProps<typeof Settings>["prefs"],
    onImport: vi.fn(),
    suggest: undefined as unknown as ComponentProps<typeof Settings>["suggest"],
    resumeText: "",
    saveResume: vi.fn(),
    removeResume: vi.fn(),
    toCompanies: vi.fn(),
    ...over,
  };
  return { props, ...render(<Settings {...props} />) };
}

const go = (hash: string) =>
  act(() => {
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });

beforeEach(() => {
  saveConfig.mockClear();
  location.hash = "";
});
afterEach(cleanup);

describe("Settings saving", () => {
  it("a switch on Data & privacy saves at once, without the unsaved Profile edits", async () => {
    const draft = { ...saved, include: ["product manager", "designer"] };
    const { props } = renderSettings({ draft, dirty: true });
    await go("#settings/data");
    await userEvent.click(screen.getByRole("checkbox", { name: /share companies i add/i }));
    await waitFor(() => expect(saveConfig).toHaveBeenCalledOnce());
    const config = saveConfig.mock.calls[0]![0] as { profile: { titles: { include: string[] } }; directory: { share_additions: boolean } };
    expect(config.directory.share_additions).toBe(false);
    expect(config.profile.titles.include).toEqual(["product manager"]);
    expect(props.update).toHaveBeenCalledWith({ directory: { ...saved.directory, share_additions: false } });
    expect(await screen.findByText("Saved")).toBeTruthy();
  });

  it("shows the Save bar on Profile, and only a pointer back to it elsewhere", async () => {
    renderSettings({ draft: { ...saved, include: ["designer"] }, dirty: true });
    await go("#settings/profile");
    expect(screen.getByRole("button", { name: /save & scan/i })).toBeTruthy();
    await go("#settings/appearance");
    expect(screen.queryByRole("button", { name: /save & scan/i })).toBeNull();
    expect(screen.getByText("You have unsaved changes on Profile.")).toBeTruthy();
  });

  it("points to Matching when only the threshold changed", async () => {
    renderSettings({ draft: { ...saved, minScore: 55 }, dirty: true });
    await go("#settings/scans");
    expect(screen.getByText("You have unsaved changes on Matching.")).toBeTruthy();
  });

  it("before setup is saved, switches wait for Save like everything else", async () => {
    const { props } = renderSettings({ setupSaved: false });
    await go("#settings/data");
    await userEvent.click(screen.getByRole("checkbox", { name: /share companies i add/i }));
    expect(props.update).toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
  });
});

describe("Settings › Notifications", () => {
  it("“only jobs I haven't been sent” saves at once, on top of the saved alerts", async () => {
    const { props } = renderSettings({ draft: { ...saved, include: ["designer"] }, dirty: true });
    await go("#settings/notifications");
    await userEvent.click(screen.getByRole("checkbox", { name: /only jobs i haven't been sent before/i }));
    await waitFor(() => expect(saveConfig).toHaveBeenCalledOnce());
    const config = saveConfig.mock.calls[0]![0] as { profile: { titles: { include: string[] } }; alerts: { only_new: boolean } };
    expect(config.alerts.only_new).toBe(false);
    expect(config.profile.titles.include).toEqual(["product manager"]);
    expect(props.update).toHaveBeenCalledWith({ alerts: { ...saved.alerts, only_new: false } });
  });
});
