import { describe, expect, it } from "vitest";
import { runLine } from "../src/components/ScheduledScans";
import type { ScheduledRun } from "../src/lib/automation";

const failed = (error?: string): ScheduledRun => ({ startedAt: "2026-10-20T10:00:00Z", scope: "mine", ok: false, error });

describe("runLine", () => {
  it("explains a file held open by another program", () => {
    const line = runLine(failed("EPERM: operation not permitted, rename 'C:\\data\\meta.json.21748.tmp' -> 'C:\\data\\meta.json'"));
    expect(line).toMatch(/^Didn't finish\. Another program, often antivirus/);
    expect(line).not.toMatch(/EPERM/);
  });

  it("explains a full disk and a lost connection", () => {
    expect(runLine(failed("ENOSPC: no space left on device, write"))).toMatch(/disk is full/);
    expect(runLine(failed("getaddrinfo ENOTFOUND boards.greenhouse.io"))).toMatch(/No internet connection/);
  });

  it("calls a run that found another scan going skipped, not failed", () => {
    expect(runLine(failed("Another scan was already running."))).toBe("Skipped. Another scan was already running.");
  });

  it("keeps the general line for anything else", () => {
    expect(runLine(failed("Something odd"))).toBe("Didn't finish. It runs again at the next scheduled time.");
    expect(runLine(failed())).toBe("Didn't finish. It runs again at the next scheduled time.");
  });

  it("summarises a finished run", () => {
    expect(runLine({ ...failed(), ok: true, matches: 629, newMatches: 0, notified: "nothing-new" })).toBe("629 matches, 0 new · nothing new to send");
  });
});
