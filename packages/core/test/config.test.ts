import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../src/config";

const minimal = `
profile:
  titles: { include: ["product manager"] }
  locations: { include: ["dubai"] }
companies:
  - { name: "Acme", ats: greenhouse, slug: "acme" }
`;

describe("parseConfig", () => {
  it("parses the example config shipped in the repo", () => {
    const text = readFileSync(fileURLToPath(new URL("../../../rawjobs.config.example.yaml", import.meta.url)), "utf8");
    const cfg = parseConfig(text);
    expect(cfg.companies.length).toBeGreaterThan(0);
    expect(cfg.profile.min_score).toBe(70);
  });

  it("fills defaults", () => {
    const cfg = parseConfig(minimal);
    expect(cfg.profile).toMatchObject({ name: "My profile", seniority_boost: [], keywords: {}, min_score: 70 });
    expect(cfg.profile.locations).toEqual({ include: ["dubai"], remote_ok: [], remote_exclude: [], workplace: [] });
    expect(cfg.alerts).toEqual({ telegram: false, email: false, only_new: true });
    expect(cfg.companies[0]!.enabled).toBe(true);
  });

  it("explains bad values with their path", () => {
    const bad = minimal.replace("ats: greenhouse", "ats: notarealats") + "\n  - { name: X, ats: workday, slug: x }\n";
    expect(() => parseConfig(bad)).toThrow(ConfigError);
    try {
      parseConfig(bad);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/companies\[0\]\.ats/);
      expect(msg).toMatch(/workday companies need "shard"/);
    }
  });

  it("rejects keyword weights outside 1..5 and duplicate companies", () => {
    const withBadWeight = minimal.replace("profile:", "profile:\n  keywords: { crypto: 9 }");
    expect(() => parseConfig(withBadWeight)).toThrow(/keywords\.crypto/);
    const dup = minimal + `  - { name: "Acme again", ats: greenhouse, slug: "ACME" }\n`;
    expect(() => parseConfig(dup)).toThrow(/duplicate company greenhouse:acme/);
  });

  it("reports YAML syntax errors", () => {
    expect(() => parseConfig("profile: [unclosed")).toThrow(/not valid YAML/);
  });
});

describe("jobs beyond your companies", () => {
  const base = `
profile:
  titles: { include: ["product manager"] }
  locations: { include: ["dubai"] }
`;
  it("defaults to nothing hidden, and still reads a config with the old discovery setting", () => {
    expect(parseConfig(base)).toMatchObject({ companies_muted: [], companies_replaced: [] });
    expect(parseConfig(`${base}discovery: { check_per_scan: 0 }\n`)).not.toHaveProperty("discovery");
  });

  it("survives a save from the dashboard (YAML round trip)", async () => {
    const { configToYaml } = await import("../src/yaml-writer");
    const config = parseConfig(`${base}companies_muted: ["Lever:Foo"]\ncompanies_replaced: ["Taleo:Old"]\n`);
    expect(parseConfig(configToYaml(config))).toMatchObject({ companies_muted: ["lever:foo"], companies_replaced: ["taleo:old"] });
  });
});
