import { afterEach, describe, expect, it, vi } from "vitest";
import { getJson, isHealth, isRunEvent, trackingRead } from "../src/lib/api";

afterEach(() => vi.unstubAllGlobals());

const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("getJson", () => {
  it("returns the answer with ok: true, asking the route's own path and method", async () => {
    const fetch = answer(200, { ok: true, version: "1.2.3" });
    vi.stubGlobal("fetch", fetch);
    const r = await getJson("GET /api/health", { cache: "no-store" });
    expect(r).toEqual({ ok: true, status: 200, data: { ok: true, version: "1.2.3" } });
    // A GET leaves the method out, as fetch(url) does.
    expect(fetch).toHaveBeenCalledWith("/api/health", { cache: "no-store" });
  });

  it("sends a route's method, and `path` in place of its own", async () => {
    const fetch = answer(200, { ok: true });
    vi.stubGlobal("fetch", fetch);
    await getJson("POST /api/alerts/telegram/:action", { path: "/api/alerts/telegram/test", body: "{}" });
    expect(fetch).toHaveBeenCalledWith("/api/alerts/telegram/test", { body: "{}", method: "POST" });
  });

  it("returns {ok:false,status} on 500, with what the server said", async () => {
    vi.stubGlobal("fetch", answer(500, { ok: false, errors: "rawjobs failed" }));
    const r = await getJson("GET /api/setup");
    expect(r).toEqual({ ok: false, status: 500, error: "rawjobs failed", body: { ok: false, errors: "rawjobs failed" } });
  });

  it("returns {ok:false,status} on 500 that isn't JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Internal error", { status: 500 })),
    );
    expect(await getJson("GET /api/setup")).toEqual({ ok: false, status: 500, error: "HTTP 500", body: null });
  });

  it("returns {ok:false,status:0} on network error, never throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await getJson("GET /api/tracking")).toEqual({ ok: false, status: 0, error: "Failed to fetch", body: null });
  });

  it("keeps a route's error answer in `body` (the 409 with the file's copy)", async () => {
    const conflict = { ok: false, rev: 4, epoch: "e", tracking: { app: "rawjobs" }, conflicts: [] };
    vi.stubGlobal("fetch", answer(409, conflict));
    const r = await getJson("PATCH /api/tracking", { body: "{}" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.body).toEqual(conflict);
  });

  it("says when it ran out of time (timeoutMs)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, fail) => init.signal!.addEventListener("abort", () => fail(init.signal!.reason)))),
    );
    const r = await getJson("GET /api/schedule", { timeoutMs: 20 });
    expect(r).toMatchObject({ ok: false, status: 0, error: expect.stringMatching(/^Timed out after/) });
  });
});

describe("answers from another version", () => {
  it("health guard rejects an old-shape body", () => {
    expect(isHealth({ ok: true, version: "0.7.16", scanning: false, background: false, scanOrigin: null, dataVersion: null, trackingRev: 3, update: null })).toBe(true);
    // Fields the page reads with a different type, or not an object at all.
    expect(isHealth({ ok: "yes", version: 7 })).toBe(false);
    expect(isHealth({ ok: true, update: "0.8.0" })).toBe(false);
    expect(isHealth({ ok: true, scanOrigin: "someone" })).toBe(false);
    expect(isHealth("ok")).toBe(false);
    expect(isHealth(null)).toBe(false);
  });

  it("reads tracking from any server, and refuses what isn't tracking", () => {
    expect(trackingRead({ tracking: { state: {} }, rev: 2, epoch: "e" })).toEqual({ tracking: { state: {} }, base: { epoch: "e", rev: 2 } });
    // An older server: no revision, so the page saves whole parts.
    expect(trackingRead({ tracking: null })).toEqual({ tracking: null, base: null });
    expect(trackingRead({ tracking: "nope" })).toBeNull();
    expect(trackingRead([])).toBeNull();
  });

  it("takes only scan events that have a type", () => {
    expect(isRunEvent({ type: "progress", done: 3 })).toBe(true);
    expect(isRunEvent({ done: 3 })).toBe(false);
    expect(isRunEvent("done")).toBe(false);
  });
});
