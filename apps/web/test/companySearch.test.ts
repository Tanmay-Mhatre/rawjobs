import { describe, expect, it } from "vitest";
import { companyIndex, companyMatches, nameRank } from "../src/lib/companySearch";

const c = (name: string, slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "")) => ({ name, slug });
const all = [c("Stripe"), c("Stripe Climate", "stripeclimate"), c("Pinstripe"), c("OpenAI"), c("Bank of America", "bofa"), c("Revolut"), c("Ramp"), c("Rampart Security", "rampart")];
const index = companyIndex(all);
const names = (q: string) => [...companyMatches(index, q)].sort((a, b) => a[1] - b[1]).map(([co, rank]) => `${co.name}:${rank}`);

describe("companyMatches", () => {
  it("ranks the exact name, then starts-with, then a word, then contains", () => {
    expect(names("stripe")).toEqual(["Stripe:0", "Stripe Climate:1", "Pinstripe:3"]);
    expect(names("america")).toEqual(["Bank of America:2"]);
    expect(names("ramp")).toEqual(["Ramp:0", "Rampart Security:1"]);
  });

  it("ignores spaces and dots, and never matches inside a careers address", () => {
    expect(names("open ai")).toContain("OpenAI:0");
    expect(names("bofa")).toEqual([]);
  });

  it("finds Revolution Medicines for “revolut”, never Emporia Energy through its careers address", () => {
    const idx = companyIndex([
      c("Revolution Medicines", "revolutionmedicines"),
      c("Carrevolutis.com", "Carrevolutiscom"),
      c("Emporia Energy", "emporiarevolutionizinghomeenergy"),
      c("Getrecharge.Com", "recharge"),
    ]);
    const hits = [...companyMatches(idx, "revolut")].sort((a, b) => a[1] - b[1]).map(([co, rank]) => `${co.name}:${rank}`);
    expect(hits).toEqual(["Revolution Medicines:1", "Carrevolutis.com:3"]);
    expect([...companyMatches(idx, "recharge")].map(([co, rank]) => `${co.name}:${rank}`)).toEqual(["Getrecharge.Com:0"]);
  });

  it("forgives a typo, ranked after real matches", () => {
    expect(names("strpe")).toContain("Stripe:4");
    expect(names("revolt")).toEqual(["Revolut:4"]);
    expect(names("xyzzy")).toEqual([]);
  });

  it("finds a company by its raw name and by the clean name we show", () => {
    const idx = companyIndex([c("Getrecharge.Com", "recharge"), c("Trust-Wallet", "trust-wallet"), c("Crypto.com", "crypto")]);
    const hits = (q: string) => [...companyMatches(idx, q)].sort((a, b) => a[1] - b[1]).map(([co, rank]) => `${co.name}:${rank}`);
    expect(hits("recharge")).toEqual(["Getrecharge.Com:0"]);
    expect(hits("getrecharge")).toEqual(["Getrecharge.Com:1"]);
    expect(hits("trust wallet")).toEqual(["Trust-Wallet:0"]);
    expect(hits("wallet")).toEqual(["Trust-Wallet:2"]);
    expect(hits("crypto.com")).toEqual(["Crypto.com:0"]);
  });

  it("ranks one name without typo forgiveness (nameRank, for your own list)", () => {
    expect(nameRank("kraken", "Kraken")).toBe(0);
    expect(nameRank("krak", "Kraken")).toBe(1);
    expect(nameRank("wallet", "Trust-Wallet", "Trust Wallet")).toBe(2);
    expect(nameRank("rake", "Kraken")).toBe(3);
    expect(nameRank("krakn", "Kraken")).toBe(-1);
    expect(nameRank(" ", "Kraken")).toBe(-1);
  });

  it("matches nothing for an empty search", () => {
    expect(companyMatches(index, "  ").size).toBe(0);
  });
});
