import { describe, expect, it } from "vitest";
import { HttpClient } from "../src/http";
import { limiter } from "../src/limit";
import { runRadar } from "../src/run";
import { parseConfig } from "../src/config";
import type { CompanyRef } from "../src/schema";
import { estimateSeconds } from "../src/scope";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("limiter", () => {
  it("runs at most max tasks at once, in the order they came", async () => {
    const slot = limiter(2);
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        slot(async () => {
          order.push(n);
          peak = Math.max(peak, ++running);
          await tick(5);
          running--;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  it("frees the slot when a task fails", async () => {
    const slot = limiter(1);
    await expect(slot(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(slot(async () => "next")).resolves.toBe("next");
  });

  it("without a max, runs every task at once", async () => {
    const slot = limiter(undefined);
    let running = 0;
    let peak = 0;
    const task = async () => {
      peak = Math.max(peak, ++running);
      await tick(5);
      running--;
    };
    await Promise.all(Array.from({ length: 6 }, () => slot(task)));
    expect(peak).toBe(6);
  });
});

describe("runRadar's companies in flight", () => {
  const config = parseConfig(`
profile:
  titles: { include: ["product manager"] }
  locations: { include: ["dubai"] }
`);
  const checks: CompanyRef[] = (["greenhouse", "lever", "ashby"] as const).flatMap((ats) => Array.from({ length: 12 }, (_, i) => ({ name: `${ats}${i}`, ats, slug: `${ats}${i}`, enabled: true })));
  /** Peak requests in flight: each company has one at a time, so it's at least its companies in flight. */
  const peakOf = async (maxCompaniesInFlight?: number) => {
    let running = 0;
    let peak = 0;
    const http = new HttpClient({
      hostDelayMs: 0,
      retries: 0,
      sleep: async () => {},
      fetchImpl: (async () => {
        peak = Math.max(peak, ++running);
        await tick(10);
        running--;
        return new Response("{}", { status: 404 });
      }) as unknown as typeof fetch,
    });
    const r = await runRadar(config, { http, checks, maxCompaniesInFlight });
    expect(r.health).toHaveLength(checks.length);
    return peak;
  };

  it("stays at the cap across every lane (the background check), and isn't capped otherwise (Scan now)", async () => {
    expect(await peakOf(5)).toBeLessThanOrEqual(5);
    expect(await peakOf()).toBeGreaterThan(5);
  });
});

describe("estimateSeconds with a cap", () => {
  it("is no less than the companies' fetch time over the companies in flight", () => {
    const companies = Array.from({ length: 40 }, (_, i) => ({ ats: i % 2 ? ("lever" as const) : ("ashby" as const) }));
    const speeds = { lever: 1, ashby: 1 };
    // Uncapped: two lanes of 20 companies at 1 s each.
    expect(estimateSeconds(companies, speeds)).toBe(20);
    // Capped at 2: 40 companies of 4 s each (1 s a company over a lane's 4 in flight), 2 at a time.
    expect(estimateSeconds(companies, speeds, 2)).toBe(80);
    // A cap above the lanes' own workers changes nothing.
    expect(estimateSeconds(companies, speeds, 24)).toBe(20);
  });
});
