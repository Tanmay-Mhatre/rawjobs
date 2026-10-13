import { afterEach, describe, expect, it, vi } from "vitest";
import { shareMove } from "../src/lib/shareMove";

afterEach(() => vi.unstubAllGlobals());

const answer = (status: number, body: unknown) => vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));

describe("shareMove", () => {
  it("posts the name and the two boards, nothing else", async () => {
    const fetch = answer(200, { queued: true });
    vi.stubGlobal("fetch", fetch);
    const from = { ats: "lever", slug: "acme", careers_url: "https://jobs.lever.co/acme" } as never;
    const to = { ats: "workday", slug: "acme", shard: "wd5", site: "Ext", region: "global", name: "x" } as never;
    expect(await shareMove("Acme", from, to)).toEqual({ queued: true });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("/api/directory/moves");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "Acme", from: { ats: "lever", slug: "acme" }, to: { ats: "workday", slug: "acme", shard: "wd5", site: "Ext" } });
  });

  it("says why it wasn't queued: sharing off, a body the server refused", async () => {
    vi.stubGlobal("fetch", answer(200, { queued: false, reason: "Sharing is off in your settings." }));
    expect(await shareMove("Acme", { ats: "lever", slug: "a" }, { ats: "lever", slug: "b" })).toEqual({ queued: false, reason: "Sharing is off in your settings." });
    vi.stubGlobal("fetch", answer(400, { ok: false, errors: "from and to are the same board" }));
    expect(await shareMove("Acme", { ats: "lever", slug: "a" }, { ats: "lever", slug: "a" })).toEqual({ queued: false, reason: "from and to are the same board" });
  });

  it("never throws, even with the server down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(shareMove("Acme", { ats: "lever", slug: "a" }, { ats: "lever", slug: "b" })).resolves.toEqual({ queued: false, reason: "Failed to fetch" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>", { status: 502 })),
    );
    await expect(shareMove("Acme", { ats: "lever", slug: "a" }, { ats: "lever", slug: "b" })).resolves.toEqual({ queued: false, reason: "HTTP 502" });
  });
});
