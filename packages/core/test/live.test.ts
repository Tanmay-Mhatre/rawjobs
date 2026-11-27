import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LIVE_FILE, LIVE_STAGE_FILE, liveInBackground, readLiveHead, startLiveLog } from "../src/live";

describe("the live progress file", () => {
  it("starts over with who's scanning, then adds one event per line", () => {
    const dir = mkdtempSync(join(tmpdir(), "rawjobs-live-"));
    writeFileSync(join(dir, LIVE_FILE), "an older scan's lines\n");
    const send = startLiveLog(dir, { origin: "scheduled", scope: "mine" });
    send({ type: "sync" });
    send({ type: "progress", done: 3 });
    const lines = readFileSync(join(dir, LIVE_FILE), "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(readLiveHead(dir)).toMatchObject({ origin: "scheduled", scope: "mine", pid: process.pid });
    expect(liveInBackground(dir)).toBe(false);
    send({ type: "background" });
    expect(liveInBackground(dir)).toBe(true);
  });

  it("says the stage from its small stage file, which a new scan starts over", () => {
    const dir = mkdtempSync(join(tmpdir(), "rawjobs-live-"));
    writeFileSync(join(dir, LIVE_STAGE_FILE), "background");
    const send = startLiveLog(dir, { origin: "terminal", scope: "mine" });
    expect(readFileSync(join(dir, LIVE_STAGE_FILE), "utf8")).toBe("scan");
    expect(liveInBackground(dir)).toBe(false);
    send({ type: "background" });
    expect(readFileSync(join(dir, LIVE_STAGE_FILE), "utf8")).toBe("background");
    // The stage file is what's read: the live file isn't looked through.
    writeFileSync(join(dir, LIVE_FILE), "lines without the background event\n");
    expect(liveInBackground(dir)).toBe(true);
    writeFileSync(join(dir, LIVE_STAGE_FILE), "scan");
    writeFileSync(join(dir, LIVE_FILE), `${JSON.stringify({ type: "background" })}\n`);
    expect(liveInBackground(dir)).toBe(false);
  });

  it("looks through the live file when there's no stage file (an older CLI wrote it)", () => {
    const dir = mkdtempSync(join(tmpdir(), "rawjobs-live-"));
    const send = startLiveLog(dir, { origin: "scheduled", scope: "mine" });
    send({ type: "background" });
    rmSync(join(dir, LIVE_STAGE_FILE));
    expect(existsSync(join(dir, LIVE_STAGE_FILE))).toBe(false);
    expect(liveInBackground(dir)).toBe(true);
    writeFileSync(join(dir, LIVE_FILE), `${JSON.stringify({ type: "start", companies: [] })}\n`);
    expect(liveInBackground(dir)).toBe(false);
  });

  it("has no head when there's no file or it isn't one", () => {
    const dir = mkdtempSync(join(tmpdir(), "rawjobs-live-"));
    expect(readLiveHead(dir)).toBeUndefined();
    writeFileSync(join(dir, LIVE_FILE), "not json\n");
    expect(readLiveHead(dir)).toBeUndefined();
    expect(liveInBackground(dir)).toBe(false);
  });

  it("never throws when the folder can't be written: the scan carries on", () => {
    const send = startLiveLog(join(tmpdir(), "rawjobs-no-such-folder", "deeper"), { origin: "terminal", scope: "all" });
    expect(() => send({ type: "sync" })).not.toThrow();
  });
});
