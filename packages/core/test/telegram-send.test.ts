import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sendTelegram, sendTelegramQueued } from "../src/notify";

const secrets = { token: "123456:abc", chatId: "42" };
const ok = () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
const err = (status: number, extra: object = {}) => new Response(JSON.stringify({ ok: false, description: `error ${status}`, ...extra }), { status });

/** A Telegram that answers from a list, then OK; records each message's text. */
function telegram(answers: (() => Response)[]) {
  const sent: string[] = [];
  const get = (async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)).text);
    const next = answers.shift();
    return next ? next() : ok();
  }) as unknown as typeof fetch;
  return { get, sent };
}

describe("sending a Telegram message", () => {
  it("tries again when Telegram is down or busy, waiting as long as it asks", async () => {
    const waits: number[] = [];
    const t = telegram([() => err(502), () => err(429, { parameters: { retry_after: 7 } })]);
    await sendTelegram("hi", secrets, t.get, async (ms) => void waits.push(ms));
    expect(t.sent).toHaveLength(3);
    expect(waits).toEqual([2_000, 7_000]);
  });

  it("tries again when there's no answer at all", async () => {
    let calls = 0;
    const get = (async () => {
      if (++calls === 1) throw new TypeError("fetch failed");
      return ok();
    }) as unknown as typeof fetch;
    await sendTelegram("hi", secrets, get, async () => {});
    expect(calls).toBe(2);
  });

  it("doesn't try again when trying can't help (a bad token)", async () => {
    const t = telegram([() => err(401)]);
    await expect(sendTelegram("hi", secrets, t.get, async () => {})).rejects.toThrow(/didn't accept that bot token/);
    expect(t.sent).toHaveLength(1);
  });

  it("gives up after three tries", async () => {
    const t = telegram([() => err(500), () => err(500), () => err(500), () => err(500)]);
    await expect(sendTelegram("hi", secrets, t.get, async () => {})).rejects.toThrow(/error 500/);
    expect(t.sent).toHaveLength(3);
  });
});

describe("the alert outbox", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "rawjobs-tg-"));
  const fail = () => err(503);

  it("keeps an alert that couldn't be sent, and sends it first next time", async () => {
    const d = dir();
    const down = telegram([fail, fail, fail]);
    expect(await sendTelegramQueued(d, "scan 1", secrets, { fetchImpl: down.get, sleep: async () => {} })).toMatch(/^failed: .*kept to send/);
    expect(existsSync(join(d, "telegram-outbox.json"))).toBe(true);
    const up = telegram([]);
    expect(await sendTelegramQueued(d, "scan 2", secrets, { fetchImpl: up.get })).toBe("sent");
    expect(up.sent).toEqual(["scan 1", "scan 2"]);
    expect(existsSync(join(d, "telegram-outbox.json"))).toBe(false);
  });

  it("sends what's waiting even when this scan has nothing new", async () => {
    const d = dir();
    await sendTelegramQueued(d, "scan 1", secrets, { fetchImpl: telegram([fail, fail, fail]).get, sleep: async () => {} });
    const up = telegram([]);
    expect(await sendTelegramQueued(d, undefined, secrets, { fetchImpl: up.get })).toBe("sent");
    expect(up.sent).toEqual(["scan 1"]);
    expect(await sendTelegramQueued(d, undefined, secrets, { fetchImpl: up.get })).toBe("nothing");
  });

  it("keeps only what's still unsent, and drops alerts older than a day", async () => {
    const d = dir();
    const now = Date.parse("2026-11-23T10:00:00Z");
    await sendTelegramQueued(d, "old", secrets, { fetchImpl: telegram([fail, fail, fail]).get, sleep: async () => {}, now });
    const later = now + 25 * 3_600_000;
    const t = telegram([fail, fail, fail]);
    await sendTelegramQueued(d, "new", secrets, { fetchImpl: t.get, sleep: async () => {}, now: later });
    expect(t.sent.every((s) => s === "new")).toBe(true);
    expect(JSON.parse(readFileSync(join(d, "telegram-outbox.json"), "utf8")).messages.map((m: { text: string }) => m.text)).toEqual(["new"]);
  });
});
