import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { parseReleaseNotes, releaseItems } from "../src/release-notes";
import { beaconVersion, fetchBeacon } from "../src/update";

describe("release notes", () => {
  it("turn New / Improved / Fixed lines into tagged changes and keep the rest as written", () => {
    const n = parseReleaseNotes(
      "RawJobs 0.6.1\n\nSaved jobs get deadlines.\n\nNew: Deadlines on saved jobs\n- Improved: Faster scans\nfixed:  Alerts after a restart\nAdded: Dark icons\nUpdate: mandatory",
    );
    expect(n.changes).toEqual([
      { type: "new", text: "Deadlines on saved jobs" },
      { type: "improved", text: "Faster scans" },
      { type: "fixed", text: "Alerts after a restart" },
      { type: "new", text: "Dark icons" },
    ]);
    expect(n.critical).toBe(true);
    expect(n.notes).not.toMatch(/Update:/);
    expect(n.notes).toMatch(/Saved jobs get deadlines\./);
  });

  it("show a release from before tags as its own lines, without the title line", () => {
    expect(releaseItems("RawJobs 0.5.3\n- The shortcut popup reads better\n- Fixes the Settings link")).toEqual([
      { type: null, text: "The shortcut popup reads better" },
      { type: null, text: "Fixes the Settings link" },
    ]);
    expect(releaseItems("ignored", [{ type: "fixed", text: "X" }])).toEqual([{ type: "fixed", text: "X" }]);
  });
});

describe("the update beacon", () => {
  const servers: Server[] = [];
  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
    delete process.env.RAWJOBS_BEACON_URL;
  });

  it("is read once, then answers 'same' while its ETag holds", async () => {
    const s = createServer((req, res) => {
      if (req.headers["if-none-match"] === '"v1"') {
        res.statusCode = 304;
        return res.end();
      }
      res.setHeader("etag", '"v1"');
      res.end(JSON.stringify({ stable: { version: "0.6.1" }, beta: { version: "0.7.0-beta.1" } }));
    });
    servers.push(s);
    const port = await new Promise<number>((done) => s.listen(0, "127.0.0.1", () => done((s.address() as AddressInfo).port)));
    process.env.RAWJOBS_BEACON_URL = `http://127.0.0.1:${port}/v1/latest.json`;
    const first = await fetchBeacon();
    expect(first).toMatchObject({ same: false, etag: '"v1"', beacon: { stable: { version: "0.6.1" } } });
    expect(await fetchBeacon('"v1"')).toEqual({ same: true });
  });

  it("names the newest version for each channel", () => {
    const b = { stable: "0.6.1", beta: "0.7.0-beta.1" };
    expect(beaconVersion(b, "stable")).toBe("0.6.1");
    expect(beaconVersion(b, "beta")).toBe("0.7.0-beta.1");
    expect(beaconVersion({ stable: "0.7.0", beta: "0.7.0-beta.1" }, "beta")).toBe("0.7.0");
    expect(beaconVersion(undefined, "stable")).toBeNull();
  });
});
