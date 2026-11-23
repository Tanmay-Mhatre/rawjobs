import { describe, expect, it } from "vitest";
import { networkReachable } from "../src/online";

const urls = ["https://a.example/", "https://b.example/"];

describe("networkReachable", () => {
  it("is true when any probe gets an answer, even an error status", async () => {
    const get = (async (url: string) => {
      if (url.includes("a.example")) throw new TypeError("fetch failed");
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    expect(await networkReachable({ fetchImpl: get, urls })).toBe(true);
  });

  it("is false when nothing answers", async () => {
    const get = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await networkReachable({ fetchImpl: get, urls })).toBe(false);
  });

  it("gives up after its timeout when probes hang", async () => {
    const hang = ((_u: string, init?: RequestInit) => new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    expect(await networkReachable({ fetchImpl: hang, urls, timeoutMs: 30 })).toBe(false);
  });
});
