import { describe, expect, it } from "vitest";
import { waitLabel, waitLine } from "../src/components/UpdateWait";
import { scanProgressOf, type ScanState } from "../src/lib/scan";

const scan = (s: Partial<ScanState>): ScanState => ({ phase: "running", companies: [], total: 0, done: 0, resumed: 0, results: {}, live: [], ...s });

describe("an update waiting for a scan", () => {
  it("says how far along the scan is and about how long is left, whoever started it", () => {
    const p = scanProgressOf(scan({ origin: "scheduled", total: 200, done: 84, seconds: 600 }));
    expect(p).toMatchObject({ origin: "scheduled", percent: 42, background: false });
    expect(waitLabel(p)).toBe("Updates after the scan · 42%");
    expect(waitLine(p)).toMatch(/^The scheduled scan has about \d+ min left\. RawJobs updates as soon as it ends\.$/);
    expect(waitLine({ origin: "page", percent: null, secondsLeft: 0, background: false })).toBe("The scan is running. RawJobs updates as soon as it ends.");
  });

  it("follows the background check too, and nothing once the scan is over", () => {
    const bg = { total: 1000, done: 250, resumed: 0, found: 0, failed: 0 };
    expect(scanProgressOf(scan({ phase: "background", bg }))).toMatchObject({ percent: 25, background: true });
    expect(scanProgressOf(scan({ phase: "done" }))).toBeNull();
    expect(waitLabel(null)).toBe("Updates after the scan");
    expect(waitLine(null)).toBe("A scan is running: RawJobs updates as soon as it's done.");
  });
});
