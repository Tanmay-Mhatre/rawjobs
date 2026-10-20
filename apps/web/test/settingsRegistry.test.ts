import { describe, expect, it } from "vitest";
import { parseSettingsHash, SETTINGS_PAGES, SETTINGS_SECTIONS, settingsHash } from "../src/components/settings/registry";

describe("Settings pages and links", () => {
  it("reads the page and card from a link", () => {
    expect(parseSettingsHash("#settings/scans?section=schedule")).toEqual({ page: "scans", section: "schedule" });
    expect(parseSettingsHash("#settings/appearance")).toEqual({ page: "appearance", section: null });
    expect(parseSettingsHash("#settings")).toEqual({ page: null, section: null });
  });

  it("sends links from before Settings had pages to the page the card is on now", () => {
    expect(parseSettingsHash("#settings?section=schedule")).toEqual({ page: "scans", section: "schedule" });
    expect(parseSettingsHash("#settings?section=alerts")).toEqual({ page: "notifications", section: "alerts" });
    expect(parseSettingsHash("#settings?section=keywords")).toEqual({ page: "profile", section: "keywords" });
    expect(parseSettingsHash("#settings?section=release-notes")).toEqual({ page: "whats-new", section: "release-notes" });
    expect(parseSettingsHash("#settings?section=shortcut")).toEqual({ page: "updates", section: "shortcut" });
    // Old group links.
    expect(parseSettingsHash("#settings?section=about").page).toBe("updates");
    expect(parseSettingsHash("#settings?section=my-companies").page).toBe("companies");
    expect(parseSettingsHash("#settings?section=data").page).toBe("data");
  });

  it("builds links to a page or a card", () => {
    expect(settingsHash("schedule")).toBe("settings/scans?section=schedule");
    expect(settingsHash("whats-new")).toBe("settings/whats-new");
    expect(settingsHash("companies")).toBe("settings/companies?section=companies");
    expect(settingsHash("network")).toBe("settings/data?section=network");
  });

  it("puts every card on a real page, once", () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SETTINGS_SECTIONS) expect(SETTINGS_PAGES.some((p) => p.id === s.page)).toBe(true);
  });
});
