import { describe, expect, it } from "vitest";
import { companyLabel, displayName } from "../src/display-name";

// Real names and slugs from data/catalog/directory.json (2026-10-07).
describe("displayName", () => {
  it("drops machine-cased web endings", () => {
    expect(displayName("Rillet.Com", "rillet")).toBe("Rillet");
    expect(displayName("Parity.Io", "parity")).toBe("Parity");
    expect(displayName("Paradigm.Xyz", "paradigm")).toBe("Paradigm");
    expect(displayName("Strike.Me", "strike")).toBe("Strike");
    expect(displayName("Symbiotic.Fi")).toBe("Symbiotic");
  });

  it("turns word-like endings into the brand's last word", () => {
    expect(displayName("Sui.Foundation", "sui")).toBe("Sui Foundation");
    expect(displayName("Nomic.Foundation")).toBe("Nomic Foundation");
    expect(displayName("Acme.Finance")).toBe("Acme Finance");
    expect(displayName("Acme.Labs")).toBe("Acme Labs");
    // Only the machine casing: brands that write it lower case, or as a web address, keep it.
    for (const n of ["yearn.finance", "Ramp.Network", "Safe.Global", "Q.Institute"]) expect(displayName(n)).toBe(n);
  });

  it("drops legal forms, keeping words that are often the brand's own", () => {
    expect(displayName("Gusto, Inc.")).toBe("Gusto");
    expect(displayName("Apera AI Inc")).toBe("Apera AI");
    expect(displayName("Meshy LLC")).toBe("Meshy");
    expect(displayName("Farallon Capital Management, L.L.C.")).toBe("Farallon Capital Management");
    expect(displayName("HiveMQ GmbH")).toBe("HiveMQ");
    expect(displayName("Prophet Tech Pty Ltd")).toBe("Prophet Tech");
    expect(displayName("SingFuels Pte Ltd")).toBe("SingFuels");
    expect(displayName("Razorpay Software Private Limited")).toBe("Razorpay Software");
    expect(displayName("T-Systems ICT India Pvt. Ltd.")).toBe("T-Systems ICT India");
    expect(displayName("MariaDB plc")).toBe("MariaDB");
    expect(displayName("Wingtra AG")).toBe("Wingtra");
    expect(displayName("Techland S.A.")).toBe("Techland");
    expect(displayName("Korton Software B.V.")).toBe("Korton Software");
    expect(displayName("ZoomInfo Technologies LLC")).toBe("ZoomInfo");
    expect(displayName("Weee! Inc")).toBe("Weee!");
    // Brand words and lower-case look-alikes stay, and so does a name that is only its form.
    for (const n of ["Betsson Group", "Palantir Technologies", "Brain Corp", "Levi Strauss & Co", "Appian Corporation", "Sensei Ag", "Inc", "Ltd"]) expect(displayName(n)).toBe(n);
  });

  it("prefers the board slug when the domain has a prefix", () => {
    expect(displayName("Getrecharge.Com", "recharge")).toBe("Recharge");
    // Without the slug it can't tell, so it only drops the ending.
    expect(displayName("Getrecharge.Com")).toBe("Getrecharge");
  });

  it("keeps brands that are web addresses", () => {
    for (const n of ["Crypto.com", "Apollo.io", "Character.AI", "Calm.com", "You.com", "incident.io", "Trigger.dev", "FAR.AI", "fastino.ai"]) expect(displayName(n)).toBe(n);
    // Word-like endings and short bases stay too.
    for (const n of ["Talon.One", "Rocket.Chat", "A.Team", "Li.Fi", "Ramp.Network"]) expect(displayName(n)).toBe(n);
  });

  it("turns written-out slugs into words", () => {
    expect(displayName("Trust-Wallet", "trust-wallet")).toBe("Trust Wallet");
    expect(displayName("Grape-Health", "grape-health")).toBe("Grape Health");
    expect(displayName("crossjoin-solutions")).toBe("Crossjoin Solutions");
  });

  it("keeps hyphenated brands", () => {
    for (const n of ["d-Matrix", "Q-CTRL", "M-KOPA", "Re-Leased", "At-Bay", "Rite-Hite", "Myers-Holum", "think-cell", "k-ID"]) expect(displayName(n)).toBe(n);
  });

  it("splits glued names the slug spells out", () => {
    expect(displayName("Matterlabs", "matter-labs")).toBe("Matter Labs");
    expect(displayName("Ethereumfoundation", "ethereum-foundation")).toBe("Ethereum Foundation");
    expect(displayName("Glimpse", "glimp-se")).toBe("Glimpse");
    expect(displayName("Matterlabs")).toBe("Matterlabs");
  });

  it("uses the override list", () => {
    expect(displayName("Imc.Com", "imc")).toBe("IMC");
    expect(displayName("Magiceden", "magiceden")).toBe("Magic Eden");
    expect(displayName("Trmlabs", "trm-labs")).toBe("TRM Labs");
    expect(displayName("Redgate", "red-gate")).toBe("Redgate");
    expect(displayName("Oplabs", "oplabs")).toBe("OP Labs");
    expect(displayName("Coinmarketcap", "coinmarketcap")).toBe("CoinMarketCap");
    expect(displayName("SeiLabs", "seilabs")).toBe("Sei Labs");
    expect(displayName("Bvnk", "bvnk")).toBe("BVNK");
  });

  it("leaves ordinary names alone and trims", () => {
    for (const n of ["Stripe", "OpenAI", "Bank of America", "Constructor", "toString", "Pathward, N.A."]) expect(displayName(n)).toBe(n);
    expect(displayName("  Filson ")).toBe("Filson");
    expect(displayName("")).toBe("");
  });
});

describe("companyLabel", () => {
  it("falls back to the slug", () => {
    expect(companyLabel({ name: "Getrecharge.Com", slug: "recharge" })).toBe("Recharge");
    expect(companyLabel({ name: "", slug: "trust-wallet" })).toBe("Trust Wallet");
  });
});
