import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../src/http";
import { json } from "./helpers";

afterEach(() => vi.restoreAllMocks());

/** A clock that sleep() moves forward, so per-host slots behave as in real time. */
function fakeClock() {
  let t = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => t);
  return (ms: number) => void (t += ms);
}

function client(responses: (Response | Error)[], extra: { sleeps?: number[]; breakAfter?: number } = {}) {
  const seen: { url: string; ua: string | undefined }[] = [];
  const tick = fakeClock();
  const http = new HttpClient({
    userAgent: "test-agent",
    hostDelayMs: 0,
    backoffMs: 100,
    breakAfter: extra.breakAfter,
    sleep: async (ms) => {
      extra.sleeps?.push(ms);
      tick(ms);
    },
    fetchImpl: (async (url: string, init?: RequestInit) => {
      seen.push({ url, ua: (init?.headers as Record<string, string> | undefined)?.["user-agent"] });
      const next = responses.shift();
      if (!next) throw new Error("no more responses");
      if (next instanceof Error) throw next;
      return next;
    }) as typeof fetch,
  });
  return { http, seen };
}

describe("HttpClient", () => {
  it("sends an identifying User-Agent", async () => {
    const { http, seen } = client([json({ ok: 1 })]);
    await expect(http.getJson("https://a.example/x")).resolves.toEqual({ ok: 1 });
    expect(seen[0]!.ua).toBe("test-agent");
  });

  it("names the page when it answers with something that isn't JSON", async () => {
    const { http } = client([new Response("<html><body>Maintenance</body></html>", { headers: { "content-type": "text/html" } })]);
    await expect(http.getJson("https://a.example/board")).rejects.toThrow("not JSON (text/html): <html><body>Maintenance</body></html> (https://a.example/board)");
  });

  it("retries 429 and 5xx with backoff, honouring Retry-After", async () => {
    const sleeps: number[] = [];
    const { http, seen } = client([new Response("", { status: 429, headers: { "retry-after": "3" } }), new Response("", { status: 503 }), json([1])], { sleeps });
    await expect(http.getJson("https://a.example/x")).resolves.toEqual([1]);
    expect(seen).toHaveLength(3);
    // Retry-After 3s, then 200ms backoff; the 429 also slowed the host to 500ms between requests.
    expect(sleeps).toEqual([3000, 200, 300]);
  });

  it("revalidates with the saved ETag and reuses the saved body on 304", async () => {
    const saved = new Map<string, { etag: string; body: string }>();
    const cache = { get: (u: string) => saved.get(u), set: (u: string, etag: string, body: string) => void saved.set(u, { etag, body }) };
    const sent: (string | undefined)[] = [];
    const replies = [new Response(JSON.stringify({ jobs: [1] }), { headers: { etag: 'W/"v1"' } }), new Response(null, { status: 304 })];
    const http = new HttpClient({
      hostDelayMs: 0,
      cache,
      fetchImpl: (async (_u: string, init?: RequestInit) => {
        sent.push((init?.headers as Record<string, string> | undefined)?.["if-none-match"]);
        return replies.shift()!;
      }) as typeof fetch,
    });
    await expect(http.getJson("https://a.example/x")).resolves.toEqual({ jobs: [1] });
    await expect(http.getJson("https://a.example/x")).resolves.toEqual({ jobs: [1] });
    expect(sent).toEqual([undefined, 'W/"v1"']);
    expect(http.stats.notModified).toBe(1);
  });

  it("skips a host after it fails several times in a row, but not after a 404", async () => {
    const down = () => new Response("", { status: 503 });
    const { http, seen } = client([new Response("", { status: 404 }), down(), down()], { breakAfter: 2 });
    const noRetry = new HttpClient({
      hostDelayMs: 0,
      retries: 0,
      breakAfter: 2,
      sleep: async () => {},
      fetchImpl: (async () => {
        seen.push({ url: "", ua: "" });
        return down();
      }) as unknown as typeof fetch,
    });
    await expect(http.getJson("https://a.example/404")).rejects.toMatchObject({ status: 404 });
    await expect(noRetry.getJson("https://h.example/1")).rejects.toMatchObject({ status: 503 });
    await expect(noRetry.getJson("https://h.example/2")).rejects.toMatchObject({ status: 503 });
    const before = seen.length;
    await expect(noRetry.getJson("https://h.example/3")).rejects.toThrow(/failed 2 times in a row/);
    expect(seen.length).toBe(before);
    expect(noRetry.stats.brokenHosts).toEqual(["h.example"]);
  });

  it("retries network errors, then gives up with the last error", async () => {
    const { http, seen } = client([new Error("ECONNRESET"), new Error("ECONNRESET"), new Error("ECONNRESET"), new Error("ECONNRESET")]);
    await expect(http.getJson("https://a.example/x")).rejects.toThrow(/ECONNRESET/);
    expect(seen).toHaveLength(4);
  });

  it("retries a body that stalls past the timeout, counts it towards the host and says it timed out", async () => {
    /** Headers arrived, then the body read hit the request's timeout. */
    const stalled = () => {
      const res = new Response("{}", { status: 200 });
      Object.defineProperty(res, "text", { value: () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")) });
      return res;
    };
    const { http, seen } = client([stalled(), json({ ok: 1 })]);
    await expect(http.getJson("https://a.example/x")).resolves.toEqual({ ok: 1 });
    expect(seen).toHaveLength(2);

    const { http: down } = client([stalled(), stalled(), stalled(), stalled(), stalled(), stalled(), stalled(), stalled()], { breakAfter: 2 });
    await expect(down.getText("https://h.example/1")).rejects.toThrow(/^timed out after 30s \(https:\/\/h\.example\/1\)$/);
    await expect(down.getText("https://h.example/2")).rejects.toThrow(/timed out after/);
    await expect(down.getText("https://h.example/3")).rejects.toThrow(/failed 2 times in a row/);
    expect(down.stats.brokenHosts).toEqual(["h.example"]);
  });

  it("does not retry other 4xx", async () => {
    const { http, seen } = client([new Response("", { status: 404 })]);
    await expect(http.getJson("https://a.example/x")).rejects.toMatchObject({ status: 404 });
    expect(seen).toHaveLength(1);
  });

  it("spaces requests to the same host", async () => {
    const sleeps: number[] = [];
    const http = new HttpClient({
      hostDelayMs: 1000,
      sleep: async (ms) => void sleeps.push(ms),
      fetchImpl: (async () => json({})) as unknown as typeof fetch,
    });
    await Promise.all([http.getJson("https://a.example/1"), http.getJson("https://a.example/2"), http.getJson("https://b.example/1")]);
    // First call to each host goes straight away; the second a.example call waits ~1s.
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(900);
  });
});
