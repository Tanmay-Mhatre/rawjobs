import { describe, expect, it } from "vitest";
import { fromJobBoard, groupKey } from "../src/dashboard";
import { JOB_BOARDS } from "../src/schema";

const same = (a: [string, string], b: [string, string]) => expect(groupKey(...a), `${a} / ${b}`).toBe(groupKey(...b));
const apart = (a: [string, string], b: [string, string]) => expect(groupKey(...a), `${a} / ${b}`).not.toBe(groupKey(...b));

describe("groupKey", () => {
  it("reads one company through its legal forms, case, accents and a leading 'the'", () => {
    const title = "Product Manager";
    for (const name of ["Acme Inc.", "ACME", "Acme, Inc", "ACME GmbH", "Acme Pty Ltd", "Acme S.A.", "The Acme Company", "Acme Corp.", "acme llc"]) same([name, title], ["Acme", title]);
    same(["Procter & Gamble Co.", title], ["Procter and Gamble", title]);
    same(["Nestlé SA", title], ["Nestle", title]);
    same(["Open AI", title], ["OpenAI", title]);
  });

  it("writes out short forms in titles, as whole words only", () => {
    same(["Acme", "Sr. Software Engineer"], ["Acme", "Senior Software Engineer"]);
    same(["Acme", "Jr Data Analyst"], ["Acme", "Junior Data Analyst"]);
    same(["Acme", "Product Mgr"], ["Acme", "Product Manager"]);
    same(["Acme", "Software Eng"], ["Acme", "Software Engineer"]);
    same(["Acme", "Research & Development Lead"], ["Acme", "Research and Development Lead"]);
    same(["Acme", "Senior  Software Engineer, Payments"], ["Acme", "senior software engineer payments"]);
    // The place still comes off, with the short form written out.
    same(["Acme", "Sr. Software Engineer - Remote"], ["Acme", "Senior Software Engineer (London, United Kingdom)"]);
    apart(["Acme", "Engineering Manager"], ["Acme", "Engineer Manager"]);
  });

  it("keeps different companies and roles apart", () => {
    apart(["Meta", "Software Engineer"], ["Metal", "Software Engineer"]);
    apart(["Bain", "Analyst"], ["Bain Group", "Analyst"]);
    apart(["Acme", "Software Engineer II"], ["Acme", "Software Engineer III"]);
    apart(["Acme", "Senior C++ Engineer"], ["Acme", "Senior C# Engineer"]);
    apart(["Acme", "Senior .NET Engineer"], ["Acme", "Senior Engineer"]);
    apart(["Acme", "Senior Software Engineer"], ["Acme", "Staff Software Engineer"]);
  });

  it("leaves out pieces that name a place, and only those", () => {
    same(["Bybit", "Product Manager - Manchester, United Kingdom"], ["Bybit", "Product Manager – Dubai"]);
    same(["Bybit", "Product Manager (Remote)"], ["Bybit", "Product Manager | Abu Dhabi"]);
    apart(["Bybit", "Senior Product Manager – Trading & Onchain"], ["Bybit", "Senior Product Manager – Payments"]);
    apart(["Bybit", "Senior Growth Product Manager - User Activation"], ["Bybit", "Senior Growth Product Manager"]);
  });

  it("never reduces a name to nothing", () => {
    apart(["The Company", "Analyst"], ["Company", "Analyst"]);
    apart(["AS", "Analyst"], ["AB", "Analyst"]);
    expect(groupKey("Inc", "Analyst")).toBe("inc|analyst");
  });
});

describe("fromJobBoard", () => {
  it("knows every job board, and nothing else", () => {
    for (const ats of JOB_BOARDS) expect(fromJobBoard({ ats }), ats).toBe(true);
    expect(fromJobBoard({ ats: "greenhouse" })).toBe(false);
  });
});
