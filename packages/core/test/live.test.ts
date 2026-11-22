import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LIVE_FILE, liveInBackground, readLiveHead, startLiveLog } from "../src/live";

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
