import { describe, expect, it } from "vitest";
import { searchSettings } from "../src/components/settings/search";

const ids = (q: string, opts?: Parameters<typeof searchSettings>[1]) => searchSettings(q, opts).map((h) => h.section.id);

describe("Settings search", () => {
  it("finds a card by its title, first", () => {
    expect(ids("theme")[0]).toBe("theme");
    expect(ids("sched")[0]).toBe("schedule");
  });

  it("finds a card by what people call it", () => {
    expect(ids("dark mode")).toEqual(["theme"]);
    expect(ids("salary")).toEqual(["dealbreakers"]);
    expect(ids("phone")).toEqual(["alerts"]);
    expect(ids("backup")).toEqual(["tracking"]);
    expect(ids("beta")).toEqual(["update"]);
  });

  it("finds every card on a page by the page's name", () => {
    expect(ids("matching")).toEqual(["threshold", "max-age", "rules"]);
  });

  it("says why when the title doesn't match", () => {
    expect(searchSettings("salary")[0]!.why).toBe("Matches “salary”");
    expect(searchSettings("theme")[0]!.why).toBeUndefined();
  });

  it("finds your own saved values", () => {
    const values = (id: string) => (id === "locations" ? ["Berlin", "Remote"] : []);
    const [hit] = searchSettings("berlin", { values });
    expect(hit!.section.id).toBe("locations");
    expect(hit!.why).toBe("Your setting: Berlin");
  });

  it("needs every word to match, ignores case and accents", () => {
    expect(ids("dark banana")).toEqual([]);
    expect(ids("THÈME")[0]).toBe("theme");
    expect(ids("   ")).toEqual([]);
  });

  it("keeps cards this copy can't use, with the reason", () => {
    const [hit] = searchSettings("telegram", { unavailable: (id) => (id === "alerts" ? "Only when RawJobs runs on your computer" : undefined) });
    expect(hit!.section.id).toBe("alerts");
    expect(hit!.unavailable).toBe("Only when RawJobs runs on your computer");
    expect(hit!.path).toBe("Automation › Notifications");
  });
});
