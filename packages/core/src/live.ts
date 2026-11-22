import { appendFileSync, closeSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunEvent, ScanOrigin, ScanScope } from "./protocol";

/**
 * A scan's progress, written as it goes so anyone can follow it. Nobody reads the output of a scan
 * the dashboard didn't start (a scheduled one, or `rawjobs scan` in a terminal), so the server reads
 * this file instead and the page shows the scan like one it started.
 *
 * Line 1 is the head ({ origin, scope, pid, startedAt }). After it comes one RunEvent per line, the
 * same lines the dashboard's own scans send. The next scan starts the file over.
 */
export const LIVE_FILE = "scan-live.ndjson";

export type LiveHead = { origin: ScanOrigin; scope: ScanScope; pid: number; startedAt: string };

/** Start the file for this scan; the function it returns adds one event. Never throws: progress is a nice-to-have. */
export function startLiveLog(dataDir: string, head: { origin: ScanOrigin; scope: ScanScope }): (event: RunEvent) => void {
  const path = join(dataDir, LIVE_FILE);
  try {
    writeFileSync(path, `${JSON.stringify({ ...head, pid: process.pid, startedAt: new Date().toISOString() } satisfies LiveHead)}\n`);
  } catch {
    return () => {};
  }
  return (event) => {
    try {
      appendFileSync(path, `${JSON.stringify(event)}\n`);
    } catch {
      // A full disk or a locked file: the scan carries on, the page just sees less.
    }
  };
}

/** The head of the last scan's file, or undefined when there's none. */
export function readLiveHead(dataDir: string): LiveHead | undefined {
  try {
    const fd = openSync(join(dataDir, LIVE_FILE), "r");
    try {
      const buf = Buffer.alloc(1024);
      const n = readSync(fd, buf, 0, buf.length, 0);
      const head = JSON.parse(buf.subarray(0, n).toString("utf8").split("\n")[0]!) as Partial<LiveHead>;
      return typeof head.pid === "number" && typeof head.origin === "string" && typeof head.scope === "string" ? (head as LiveHead) : undefined;
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

/** Whether the scan in the file has reached its background check (it then gives way to Scan now). */
export function liveInBackground(dataDir: string): boolean {
  try {
    return readFileSync(join(dataDir, LIVE_FILE), "utf8").includes('{"type":"background"}');
  } catch {
    return false;
  }
}
