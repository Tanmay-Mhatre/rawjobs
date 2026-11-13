import { describe, expect, it } from "vitest";
import { backedByTitles, gate, get, offered, rejectAlias } from "./concepts";

const known = new Set(["payments", "cards", "security", "acquiring"]);

describe("weekly word list gates", () => {
  it("rejects tasks, general words, broader words, other topics and never-match pairs", () => {
    expect(rejectAlias("machine learning", "utilise machine learning", known)).toBe("a task, not a name");
    expect(rejectAlias("payments", "management", known)).toBe("too general");
    expect(rejectAlias("card issuing", "cards", known)).toBe("broader than the topic");
    expect(rejectAlias("payments", "acquiring", known)).toBe("another topic");
    expect(rejectAlias("java", "JavaScript", known)).toBe("on the never-match list");
    expect(rejectAlias("payments", "pp", known)).toBe("short and not an acronym");
    expect(rejectAlias("payments", "PSP", known)).toBe("already counts");
    expect(rejectAlias("payments", "PayFac", known)).toBeUndefined();
  });

  it("only offers labels from concepts whose main label is the topic", () => {
    expect(
      offered("fraud", [
        ["fraud", "fraud examination"],
        ["card game", "cards"],
      ]),
    ).toEqual(["fraud", "fraud examination"]);
    // Another concept that only lists the topic among its names is another sense.
    expect(offered("banking", [["economics", "banking", "financial economics"]])).toEqual([]);
  });

  it("keeps a word only when real job titles back it", () => {
    const fintech = Array.from({ length: 5 }, (_, i) => `Payments Product Manager ${i} | PayFac Partnerships Lead`);
    const other = Array.from({ length: 95 }, (_, i) => `Software Engineer ${i} | Cardinals Fan Club Organiser`);
    const companies = [...fintech, ...other];
    expect(backedByTitles("payments", "PayFac", companies)).toBe(true);
    // Used at many companies that never mention payments.
    expect(backedByTitles("payments", "Cardinals", companies)).toBe(false);
    // Not used anywhere.
    expect(backedByTitles("payments", "BIN sponsor", companies)).toBe(false);
    expect(gate({ payments: ["PayFac", "Cardinals", "management"] }, companies)).toEqual({ payments: ["PayFac"] });
  });
});

describe("get", () => {
  const answers = (...steps: (number | Error)[]) => {
    let calls = 0;
    const fetchImpl = (async () => {
      const step = steps[Math.min(calls++, steps.length - 1)]!;
      if (step instanceof Error) throw step;
      return new Response("{}", { status: step });
    }) as typeof fetch;
    return { fetchImpl, calls: () => calls };
  };

  it("tries again after a timeout, a dropped connection or a 5xx", async () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const a = answers(timeout, 502, 200);
    expect((await get("https://x/y", { fetchImpl: a.fetchImpl, waitMs: 0 })).status).toBe(200);
    expect(a.calls()).toBe(3);
  });

  it("tries again after a 429", async () => {
    const a = answers(429, 200);
    expect((await get("https://x/y", { fetchImpl: a.fetchImpl, waitMs: 0 })).status).toBe(200);
  });

  it("gives up after its tries", async () => {
    const a = answers(new TypeError("fetch failed"));
    await expect(get("https://x/y", { fetchImpl: a.fetchImpl, waitMs: 0, tries: 3 })).rejects.toThrow("fetch failed");
    expect(a.calls()).toBe(3);
  });

  it("doesn't retry a 404", async () => {
    const a = answers(404, 200);
    await expect(get("https://x/y", { fetchImpl: a.fetchImpl, waitMs: 0 })).rejects.toThrow("404 https://x/y");
    expect(a.calls()).toBe(1);
  });
});
