import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpClient, StoppedError } from "../src/http";
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

  it("says who refused a 403: CDN and firewall headers and the start of the body", async () => {
    const refused = new Response("<html><body>Request blocked.</body></html>", {
      status: 403,
      headers: { server: "CloudFront", "x-cache": "Error from cloudfront", "x-amzn-waf-action": "block", "content-type": "text/html" },
    });
    const { http } = client([refused]);
    const err = await http.getJson("https://a.example/x").catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 403, message: "HTTP 403 (https://a.example/x)" });
    expect((err as { detail: string }).detail).toBe("server: CloudFront; x-amzn-waf-action: block; x-cache: Error from cloudfront; body: <html><body>Request blocked.</body></html>");
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

  describe("a host that keeps failing", () => {
    /** No retries; `down` hosts answer 503 (or nothing, with `offline`), the rest 200. */
    function hosts(down: (url: string) => boolean, opts: { offline?: boolean } = {}) {
      const sleeps: number[] = [];
      const seen: string[] = [];
      const tick = fakeClock();
      const http = new HttpClient({
        hostDelayMs: 0,
        retries: 0,
        breakAfter: 2,
        sleep: async (ms) => {
          sleeps.push(ms);
          tick(ms);
        },
        fetchImpl: (async (url: string) => {
          seen.push(url);
          if (!down(url)) return json({ ok: 1 });
          if (opts.offline) throw new TypeError("fetch failed");
          return new Response("", { status: 503 });
        }) as unknown as typeof fetch,
      });
      return { http, sleeps, seen };
    }

    it("doesn't rest after a 404", async () => {
      const { http } = client([new Response("", { status: 404 }), new Response("", { status: 404 }), json({ ok: 1 })], { breakAfter: 2 });
      await expect(http.getJson("https://a.example/1")).rejects.toMatchObject({ status: 404 });
      await expect(http.getJson("https://a.example/2")).rejects.toMatchObject({ status: 404 });
      await expect(http.getJson("https://a.example/3")).resolves.toEqual({ ok: 1 });
      expect(http.stats.restedHosts).toEqual([]);
    });

    it("rests, then tries it again: an answer ends the rest", async () => {
      let up = false;
      const { http, sleeps, seen } = hosts(() => !up);
      await expect(http.getJson("https://h.example/1")).rejects.toMatchObject({ status: 503 });
      await expect(http.getJson("https://h.example/2")).rejects.toMatchObject({ status: 503 });
      up = true;
      await expect(http.getJson("https://h.example/3")).resolves.toEqual({ ok: 1 });
      expect(sleeps).toEqual([30_000]);
      await expect(http.getJson("https://h.example/4")).resolves.toEqual({ ok: 1 });
      expect(sleeps).toEqual([30_000]);
      expect(seen).toHaveLength(4);
      expect(http.stats.restedHosts).toEqual(["h.example"]);
      expect(http.stats.brokenHosts).toEqual([]);
    });

    it("rests longer each time it fails while other hosts answer, then is skipped for the run", async () => {
      const { http, sleeps, seen } = hosts((url) => url.includes("h.example"));
      await expect(http.getJson("https://h.example/1")).rejects.toMatchObject({ status: 503 });
      await expect(http.getJson("https://h.example/2")).rejects.toMatchObject({ status: 503 });
      for (let i = 0; i < 5; i++) {
        await http.getJson("https://ok.example/x");
        await expect(http.getJson(`https://h.example/try${i}`)).rejects.toMatchObject({ status: 503 });
      }
      expect(sleeps).toEqual([30_000, 60_000, 120_000, 300_000, 600_000]);
      const before = seen.length;
      await expect(http.getJson("https://h.example/last")).rejects.toThrow(/^skipped: h\.example kept failing/);
      expect(seen.length).toBe(before);
      expect(http.stats.brokenHosts).toEqual(["h.example"]);
    });

    it("waits, without giving up, while nothing answers at all (offline), for up to an hour", async () => {
      const { http, sleeps } = hosts(() => true, { offline: true });
      await expect(http.getJson("https://h.example/1")).rejects.toThrow(/fetch failed/);
      await expect(http.getJson("https://h.example/2")).rejects.toThrow(/fetch failed/);
      for (let i = 0; i < 10; i++) await expect(http.getJson(`https://h.example/try${i}`)).rejects.toThrow(/fetch failed/);
      expect(sleeps.every((ms) => ms === 30_000)).toBe(true);
      expect(http.stats.brokenHosts).toEqual([]);
      for (let i = 0; i < 110; i++) await http.getJson(`https://h.example/more${i}`).catch(() => {});
      await expect(http.getJson("https://h.example/late")).rejects.toThrow(/kept failing/);
      expect(sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(3_600_000);
    });

    it("lets one request try it after a rest while the others wait for its answer", async () => {
      let up = false;
      const { http, seen, sleeps } = hosts(() => !up);
      await expect(http.getJson("https://h.example/1")).rejects.toMatchObject({ status: 503 });
      await expect(http.getJson("https://h.example/2")).rejects.toMatchObject({ status: 503 });
      const tries = [http.getJson("https://h.example/a").catch(() => "failed"), http.getJson("https://h.example/b").catch(() => "failed")];
      expect(await Promise.all(tries)).toEqual(["failed", "failed"]);
      // One tried it and failed; the other waited for that, then for the next, longer rest, and tried again.
      expect(seen).toHaveLength(4);
      expect(sleeps).toEqual([30_000, 60_000]);
      up = true;
      await expect(http.getJson("https://h.example/c")).resolves.toEqual({ ok: 1 });
    });
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
    expect(down.stats.restedHosts).toEqual(["h.example"]);
    expect(down.stats.timeouts).toBeGreaterThanOrEqual(6);
  });

  it("gives up on a host that sends no headers after the connect timeout, not the whole timeout", async () => {
    const hang = ((_u: string, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;
    const http = new HttpClient({ hostDelayMs: 0, retries: 0, connectTimeoutMs: 20, readTimeoutMs: 5_000, fetchImpl: hang });
    const started = Date.now();
    await expect(http.getText("https://slow.example/x")).rejects.toThrow(/^timed out after 0.02s/);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(http.stats.timeouts).toBe(1);
  });

  it("reads a saved body only on a 304, and fetches in full when it's gone", async () => {
    const sent: (string | undefined)[] = [];
    let loads = 0;
    /** etag -> body; a body of undefined is a saved file that has gone missing. */
    const saved = new Map<string, string | undefined>([["https://a.example/x", JSON.stringify({ jobs: [1] })]]);
    const cache = {
      get: (u: string) => (saved.has(u) ? { etag: 'W/"v1"' } : undefined),
      set: () => {},
      load: async (u: string) => {
        loads++;
        const b = saved.get(u);
        if (b === undefined) saved.delete(u);
        return b;
      },
    };
    const replies = [new Response(null, { status: 304 }), new Response(null, { status: 304 }), json({ jobs: [2] })];
    const http = new HttpClient({
      hostDelayMs: 0,
      cache,
      fetchImpl: (async (_u: string, init?: RequestInit) => {
        sent.push((init?.headers as Record<string, string> | undefined)?.["if-none-match"]);
        return replies.shift()!;
      }) as typeof fetch,
    });
    await expect(http.getJson("https://a.example/x")).resolves.toEqual({ jobs: [1] });
    // The body went missing: the 304 can't be used, so it asks again without the ETag.
    saved.set("https://a.example/x", undefined);
    await expect(http.getJson("https://a.example/x")).resolves.toEqual({ jobs: [2] });
    expect(loads).toBe(2);
    expect(sent).toEqual(['W/"v1"', 'W/"v1"', undefined]);
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

  describe("stopped", () => {
    /** A host that never answers until the request is aborted. */
    const hang = (async (_url: string, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;

    it("cuts a request in flight short within a moment, without counting it against the host", async () => {
      let stop = false;
      const http = new HttpClient({ hostDelayMs: 0, timeoutMs: 60_000, breakAfter: 1, fetchImpl: hang, stopped: () => stop });
      setTimeout(() => (stop = true), 50);
      const started = Date.now();
      await expect(http.getJson("https://a.example/x")).rejects.toBeInstanceOf(StoppedError);
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(http.stats.failures).toBe(0);
      expect(http.stats.brokenHosts).toEqual([]);
    });

    it("doesn't retry, or send anything, once stopped", async () => {
      let stop = false;
      let sent = 0;
      const http = new HttpClient({
        hostDelayMs: 0,
        backoffMs: 10_000,
        sleep: async () => void (stop = true), // stopped during the backoff
        fetchImpl: (async () => {
          sent++;
          return json({}, 503);
        }) as typeof fetch,
        stopped: () => stop,
      });
      await expect(http.getJson("https://a.example/x")).rejects.toBeInstanceOf(StoppedError);
      await expect(http.getJson("https://a.example/y")).rejects.toBeInstanceOf(StoppedError);
      expect(sent).toBe(1);
    });
  });
});
