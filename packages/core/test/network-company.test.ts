import { describe, expect, it } from "vitest";
import { companyNameKey, companyNameWords } from "../src/dashboard";
import { buildNetworkIndex, matchingKeys, networkKey } from "../src/network/company";

describe("companyNameWords", () => {
  it("uses the same pipeline as companyNameKey", () => {
    for (const n of ["The Kraken Digital Asset Exchange, Inc.", "Procter & Gamble Co.", "Acme GmbH", "Open AI", "The Company"]) expect(companyNameWords(n).join("")).toBe(companyNameKey(n));
    expect(companyNameWords("The Kraken Digital Asset Exchange, Inc.")).toEqual(["kraken", "digital", "asset", "exchange"]);
  });
});

describe("networkKey", () => {
  it("normalizes legal forms and spacing", () => {
    expect(networkKey("Acme, Inc.")).toBe("acme");
    expect(networkKey("ACME GmbH")).toBe(networkKey("Acme"));
  });

  it("maps aliases to one employer", () => {
    for (const n of ["Facebook", "Meta Platforms", "Meta Platforms, Inc.", "Instagram", "WhatsApp", "Meta"]) expect(networkKey(n)).toBe("meta");
    for (const n of ["Alphabet", "Google Cloud", "Google"]) expect(networkKey(n)).toBe("google");
    for (const n of ["Twitter", "X Corp.", "X"]) expect(networkKey(n)).toBe("x");
    for (const n of ["Square", "Cash App", "Block"]) expect(networkKey(n)).toBe("block");
    for (const n of ["AWS", "Amazon Web Services", "Amazon.com", "Amazon"]) expect(networkKey(n)).toBe("amazon");
  });

  it("is null for the stoplist and empties", () => {
    for (const n of [
      "Self-Employed",
      "self employed",
      "Freelance",
      "Stealth",
      "Stealth Startup",
      "Stealth Mode Startup",
      "Confidential",
      "N/A",
      "None",
      "Retired",
      "Open to Work",
      "Student",
      "",
      "  ",
      "--",
      undefined,
    ])
      expect(networkKey(n)).toBeNull();
  });

  it("doesn't look up prototype names as aliases", () => {
    expect(networkKey("Constructor")).toBe("constructor");
  });
});

describe("matchingKeys", () => {
  const people = [
    ["1", "Kraken"],
    ["2", "Kraken Digital Asset Exchange"],
    ["3", "Apple"],
    ["4", "Apple Leisure Group"],
    ["5", "Ramp"],
    ["6", "Ramp Network"],
    ["7", "Facebook"],
    ["8", "Metabase"],
    ["9", "Stripe Partners"],
    ["10", "Self-Employed"],
    ["11", "Krakenfly"],
    ["12", "Datadog, Inc."],
    ["13", "Shell Recharge"],
    ["14", "Target Corporation"],
    ["15", "Monzo Bank"],
    ["16", "Monzo Bank Ltd"],
  ].map(([id, company]) => ({ id: id!, company }));
  const index = buildNetworkIndex(people);

  // Must match: [job company, keys].
  it.each([
    ["Kraken", ["kraken", "krakendigitalassetexchange"], "exact"],
    ["Kraken Digital Asset Exchange", ["krakendigitalassetexchange"], "exact"],
    ["Apple Inc.", ["apple"], "exact"],
    ["Meta", ["meta"], "exact"],
    ["Instagram", ["meta"], "alias"],
    ["Datadog", ["datadog"], "exact"],
    ["Monzo", ["monzobank"], "prefix"],
    ["Target", ["target"], "exact"],
  ])("matches %s", (job, keys, how) => {
    expect(matchingKeys(job, index)).toEqual({ keys, how });
  });

  // Must not match: [job company, a key it must never reach].
  it.each([
    ["Apple", "appleleisuregroup"],
    ["Ramp", "rampnetwork"],
    ["Meta", "metabase"],
    ["Stripe", "stripepartners"],
    ["Kraken", "krakenfly"],
    ["Shell", "shellrecharge"],
  ])("doesn't match %s to %s", (job, key) => {
    expect(matchingKeys(job, index).keys).not.toContain(key);
  });

  it("never matches the stoplist", () => {
    expect(matchingKeys("Self-Employed", index)).toEqual({ keys: [], how: "none" });
    expect(index.byKey.has("selfemployed")).toBe(false);
  });

  it("is none for an unknown company", () => {
    expect(matchingKeys("Initech", index)).toEqual({ keys: [], how: "none" });
  });

  it("indexes connection ids under one key", () => {
    expect(index.byKey.get("monzobank")).toEqual(["15", "16"]);
    expect(index.byKey.get("meta")).toEqual(["7"]);
  });

  it("caps prefix matches at 3", () => {
    const idx = buildNetworkIndex(["Globex One", "Globex Two", "Globex Three", "Globex Four"].map((company, i) => ({ id: String(i), company })));
    expect(matchingKeys("Globex", idx)).toMatchObject({ how: "prefix" });
    expect(matchingKeys("Globex", idx).keys).toHaveLength(3);
  });
});
