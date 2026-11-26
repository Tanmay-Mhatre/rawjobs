import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config";
import { OUTBOX_FILE, queueTelegram, sendTelegramQueued } from "../src/notify";
import { scan } from "../src/scan";
import { readMeta, runCommitted } from "../src/store";
import { fakeHttp, fixture, json } from "./helpers";

const now = new Date("2026-10-03T12:00:00Z");
const secrets = { token: "123456:abc", chatId: "42" };
const config = () =>
  parseConfig(`
profile:
  titles: { include: ["product manager", "head of product"] }
  locations: { include: ["dubai"], remote_ok: ["emea"] }
companies:
  - { name: "GH Co", ats: greenhouse, slug: "ghco" }
`);

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "rj-alert-ahead-"));
  mkdirSync(join(dir, "catalog"));
  writeFileSync(join(dir, "catalog", "directory.json"), JSON.stringify({ companies: [] }));
  return dir;
}
const routes = (url: string) => (url.includes("greenhouse") ? json(fixture("greenhouse.json")) : json({ error: "not found" }, 404));

/** A Telegram that accepts everything and records the texts. */
function telegram() {
  const sent: string[] = [];
  const get = (async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)).text);
    return new Response(JSON.stringify({ ok: true, result: {} }));
  }) as unknown as typeof fetch;
  return { get, sent };
}
/** What the CLI's notify step does after a scan: send the outbox, committed runs only. */
const flush = (dir: string, fetchImpl: typeof fetch) => sendTelegramQueued(dir, undefined, secrets, { fetchImpl, committed: (run) => runCommitted(dir, run) });
const outbox = (dir: string) => (JSON.parse(readFileSync(join(dir, OUTBOX_FILE), "utf8")) as { messages: { text: string; run?: string }[] }).messages;

describe("alerts written ahead of the save", () => {
  it("alert queued before saveRun survives a crash after saveRun and is sent next scan", async () => {
    const dir = setup();
    const crash = () => {
      throw new Error("killed");
    };
    await expect(scan(config(), { dataDir: dir, http: fakeHttp(routes).http, now, alert: () => "3 new jobs", afterSave: crash })).rejects.toThrow("killed");
    const [waiting] = outbox(dir);
    expect(waiting?.text).toBe("3 new jobs");
    expect(readMeta(dir)?.runs.map((r) => r.finishedAt)).toContain(waiting?.run);

    // The next scan has nothing new of its own; its notify step sends the waiting alert, once.
    const next = await scan(config(), { dataDir: dir, http: fakeHttp(routes).http, now, alert: () => undefined });
    expect(next.alertQueued).toBe(false);
    const t = telegram();
    expect(await flush(dir, t.get)).toBe("sent");
    expect(await flush(dir, t.get)).toBe("nothing");
    expect(t.sent).toEqual(["3 new jobs"]);
  });

  it("alert of a run whose save never committed is dropped", async () => {
    const dir = setup();
    // Written ahead by a scan killed before its save: a later scan saved since.
    queueTelegram(dir, "lost run", "2026-10-03T11:00:00.000Z");
    const r = await scan(config(), { dataDir: dir, http: fakeHttp(routes).http, now, alert: () => "this run" });
    expect(r.alertQueued).toBe(true);
    const t = telegram();
    expect(await flush(dir, t.get)).toBe("sent");
    expect(t.sent).toEqual(["this run"]);
    expect(existsSync(join(dir, OUTBOX_FILE))).toBe(false);
  });

  it("keeps an alert while its scan may still be saving", async () => {
    const dir = setup();
    queueTelegram(dir, "saving", "2099-01-01T00:00:00.000Z");
    const t = telegram();
    expect(await flush(dir, t.get)).toBe("nothing");
    expect(t.sent).toEqual([]);
    expect(outbox(dir).map((m) => m.text)).toEqual(["saving"]);
  });

  it("dry run queues nothing", async () => {
    const dir = setup();
    let asked = false;
    await scan(config(), {
      dataDir: dir,
      http: fakeHttp(routes).http,
      now,
      dryRun: true,
      alert: () => {
        asked = true;
        return "should not be kept";
      },
    });
    expect(asked).toBe(false);
    expect(existsSync(join(dir, OUTBOX_FILE))).toBe(false);
  });

  it("existing outbox messages without run still send", async () => {
    const dir = setup();
    writeFileSync(join(dir, OUTBOX_FILE), JSON.stringify({ messages: [{ text: "from an older version", at: new Date().toISOString() }] }));
    const t = telegram();
    expect(await flush(dir, t.get)).toBe("sent");
    expect(t.sent).toEqual(["from an older version"]);
  });
});

describe("runCommitted", () => {
  it("true once saved, false when a later run saved instead, pending otherwise", () => {
    const dir = setup();
    writeFileSync(join(dir, "meta.json"), JSON.stringify({ version: 1, runs: [{ startedAt: "2026-10-03T10:00:00Z", finishedAt: "2026-10-03T10:05:00Z" }] }));
    expect(runCommitted(dir, "2026-10-03T10:05:00Z")).toBe(true);
    expect(runCommitted(dir, "2026-10-03T09:00:00Z")).toBe(false);
    expect(runCommitted(dir, "2026-10-03T11:00:00Z")).toBe("pending");
  });
});
