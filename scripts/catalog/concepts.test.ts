import { describe, expect, it } from "vitest";
import { backedByTitles, gate, offered, rejectAlias } from "./concepts";

const known = new Set(["payments", "cards", "security", "acquiring"]);

describe("weekly word list gates", () => {
  it("rejects tasks, general words, broader words, other topics and never-match pairs", () => {
    expect(rejectAlias("machine learning", "utilise machine learning", known)).toBe("a task, not a name");
    expect(rejectAlias("payments", "management", known)).toBe("too general");
    expect(rejectAlias("card issuing", "cards", known)).toBe("broader than the topic");
    expect(rejectAlias("payments", "acquiring", known)).toBe("another topic");
    expect(rejectAlias("java", "JavaScript", known)).toBe("on the never-match list");
    expect(rejectAlias("payments", "pp", known)).toBe("short and not an acronym");
    expect(rejectAlias("payments", "payment service provider", known)).toBeUndefined();
  });

  it("only offers labels from concepts that name the topic", () => {
    expect(
      offered("fraud", [
        ["fraud", "fraud examination"],
        ["card game", "cards"],
      ]),
    ).toEqual(["fraud", "fraud examination"]);
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
