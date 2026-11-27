// @vitest-environment happy-dom
// A running scan's events reach the page through GET /api/run, whoever started it. They move the scan's
// progress, not App or the Radar.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { memo, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataMeta, Job, Profile } from "../src/lib/data";
import { resetScanStore } from "../src/lib/scanStore";
import { makeJob } from "./helpers";

const n = vi.hoisted(() => ({ radar: 0 }));
vi.mock("../src/components/radar/RadarPage", async (orig) => {
  const m = await orig<typeof import("../src/components/radar/RadarPage")>();
  const inner = m.RadarPage as unknown as { type: (p: object) => ReactNode };
  // The real page, counted, keeping memo's prop check.
  const Counted = memo((p: object) => {
    n.radar++;
    return inner.type(p);
  });
  return { ...m, RadarPage: Counted };
});

const profile = {
  name: "Me",
  titles: { include: ["product manager"], exclude: [] },
  seniority_boost: [],
  locations: { include: [], remote_ok: [], remote_exclude: [], workplace: [] },
  industries: [],
  past_employers: [],
  keywords: {},
  min_score: 65,
} as unknown as Profile;
const jobs: Job[] = Array.from({ length: 20 }, (_, i) => makeJob({ id: `greenhouse:acme:${i}`, title: `Product Manager ${i}` }));
const ready = { kind: "ready" as const, jobs, meta: { version: 1, generatedAt: "2026-11-26T00:00:00Z", profile, companies: [], runs: [] } as unknown as DataMeta };
vi.mock("../src/lib/data", async (orig) => {
  const m = await orig<typeof import("../src/lib/data")>();
  const reload = async () => ready.meta;
  return { ...m, useData: () => ({ state: ready, reload }) };
});

/** GET /api/run: a running scan, started by `origin`; `send` writes its next events. */
function serveRun(origin?: "scheduled" | "terminal") {
  let push: (line: string) => void = () => {};
  let end = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      push = (line) => c.enqueue(enc.encode(line));
      end = () => c.close();
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url !== "/api/run") return new Response("", { status: 503 });
      const headers: Record<string, string> = { "x-rawjobs-scope": "mine" };
      if (origin) headers["x-rawjobs-origin"] = origin;
      return new Response(body, { status: 200, headers });
    }),
  );
  return { send: (...events: object[]) => push(events.map((e) => `${JSON.stringify(e)}\n`).join("")), end: () => end() };
}

beforeEach(() => {
  n.radar = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  resetScanStore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Lets the stream's lines be read and the store tell its readers (once a frame, or within 100 ms). */
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 150))));

describe.each([
  ["a scan this page started (picked up after a reload)", undefined],
  ["a scheduled scan", "scheduled" as const],
])("%s", (_name, origin) => {
  it("50 progress events cause 0 RadarPage renders", async () => {
    const run = serveRun(origin);
    const { App } = await import("../src/App");
    render(<App />);
    await waitFor(() => expect(n.radar).toBeGreaterThan(0));
    run.send({ type: "start", stage: "quick", companies: ["Acme"], total: 100 });
    await settle();
    const before = n.radar;
    for (let i = 1; i <= 50; i++) run.send({ type: "progress", done: i, last: `Co${i}` });
    await settle();
    expect(n.radar - before).toBe(0);
    run.end();
  });

  it("a jobs event renders the Radar once, with the new job in the list", async () => {
    const run = serveRun(origin);
    const { App } = await import("../src/App");
    render(<App />);
    await waitFor(() => expect(n.radar).toBeGreaterThan(0));
    run.send({ type: "start", stage: "quick", companies: ["Acme"], total: 100 });
    await settle();
    const before = n.radar;
    run.send({ type: "jobs", jobs: [makeJob({ id: "greenhouse:beta:1", company: "Beta", title: "Head of Product" })] });
    await settle();
    expect(n.radar - before).toBe(1);
    expect(screen.getAllByRole("button", { name: "Head of Product" }).length).toBeGreaterThan(0);
    run.end();
  });
});
