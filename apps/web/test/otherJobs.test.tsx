// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useData, useOtherJobs, type Job } from "../src/lib/data";
import { makeJob } from "./helpers";

const job = (id: string, title: string) => makeJob({ id, title, why: { title: 0, location: 20, keywords: [], keywordPoints: 0, gate: "title" } });
const file = (jobs: Job[]) => ({ version: 2, generatedAt: "2026-10-12T00:00:00Z", jobs });

/** The run's files, as the local server serves them; `other` is what jobs-other.json holds now. */
let other: Job[] = [];
function serve() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = url.includes("jobs-other.json") ? file(other) : url.includes("jobs.json") ? file([]) : url.includes("meta.json") ? { version: 1, runs: [] } : null;
      return body ? new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }) : new Response("", { status: 404 });
    }),
  );
}

let reloadData: () => Promise<void> = async () => {};
function Probe() {
  const { state, reload } = useData();
  reloadData = reload;
  const jobs = useOtherJobs(state.kind === "ready");
  return <p>{jobs ? jobs.map((j) => j.title).join(", ") || "none" : "loading"}</p>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useOtherJobs", () => {
  it("shows the new scan's jobs after a reload, not the previous scan's", async () => {
    serve();
    other = [job("lever:acme:1", "Old role")];
    render(<Probe />);
    expect(await screen.findByText("Old role")).toBeTruthy();

    other = [job("lever:acme:2", "New role")];
    await act(() => reloadData());
    expect(await screen.findByText("New role")).toBeTruthy();
  });
});
