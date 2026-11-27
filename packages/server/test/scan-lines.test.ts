import { describe, expect, it } from "vitest";
import { scanLines } from "../src/scan-lines";

const line = (e: Record<string, unknown>) => JSON.stringify(e);

describe("a running scan's kept lines", () => {
  it("keeps a bounded replay after 5,000 lines, with every step and company, in order", () => {
    const lines = scanLines();
    lines.push(line({ type: "sync" }));
    lines.push(line({ type: "synced", updated: false, message: "up to date" }));
    lines.push(line({ type: "start", companies: ["A"], total: 5000, stage: "quick" }));
    lines.push(line({ type: "company", done: 1, company: "A", ok: true, matches: 2 }));
    lines.push(line({ type: "jobs", jobs: [{ id: "a1" }] }));
    for (let i = 2; i <= 5000; i++) lines.push(line({ type: "progress", done: i }));
    lines.push(line({ type: "done", stage: "quick" }));

    const replay = lines.replay();
    expect(replay.length).toBeLessThanOrEqual(6 + 1000);
    expect(lines.size()).toBe(replay.length);
    const events = replay.map((l) => JSON.parse(l) as { type: string; done?: number });
    expect(events.slice(0, 5).map((e) => e.type)).toEqual(["sync", "synced", "start", "company", "jobs"]);
    expect(events.at(-1)!.type).toBe("done");
    // The last progress lines, in order, up to the newest count.
    const progress = events.filter((e) => e.type === "progress").map((e) => e.done);
    expect(progress).toHaveLength(1000);
    expect(progress[0]).toBe(4001);
    expect(progress.at(-1)).toBe(5000);
    expect(progress).toEqual([...progress].sort((a, b) => a! - b!));
  });

  it("puts progress lines back between the lines around them", () => {
    const lines = scanLines(2);
    const sent = [
      line({ type: "start", companies: [], stage: "quick" }),
      line({ type: "progress", done: 1 }),
      line({ type: "progress", done: 2 }),
      line({ type: "done", stage: "quick" }),
      line({ type: "background" }),
      line({ type: "start", companies: [], stage: "background" }),
      line({ type: "progress", done: 3 }),
      line({ type: "progress", done: 4 }),
      line({ type: "error", message: "stopped" }),
    ];
    for (const l of sent) lines.push(l);
    // Only the last two progress lines are kept; everything else stays where it was.
    expect(lines.replay()).toEqual(sent.filter((l) => !l.includes('"done":1') && !l.includes('"done":2')));
  });
});
