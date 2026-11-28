import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { thirdPartyNotices } from "./notices";

/** A fake install: node_modules/<name>/package.json (+ LICENSE unless `license` is null). */
function tree(pkgs: Record<string, { deps?: string[]; license?: string | null }>) {
  const root = mkdtempSync(join(tmpdir(), "rawjobs-notices-"));
  for (const [name, p] of Object.entries(pkgs)) {
    const dir = join(root, "node_modules", name);
    mkdirSync(join(dir, "dist"), { recursive: true });
    const dependencies = Object.fromEntries((p.deps ?? []).map((d) => [d, "*"]));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", license: "MIT", dependencies }));
    writeFileSync(join(dir, "dist", "index.js"), "");
    if (p.license !== null) writeFileSync(join(dir, "LICENSE"), p.license ?? `Copyright ${name}`);
  }
  return root;
}

describe("thirdPartyNotices", () => {
  it("lists the bundled packages and their runtime dependencies, with each license text", () => {
    const root = tree({ jszip: { deps: ["pako"] }, pako: {}, unused: {} });
    const { text, packages } = thirdPartyNotices([join(root, "node_modules/jszip/dist/index.js"), join(root, "src/own-code.ts")], [{ title: "Geist (OFL-1.1)", text: "SIL OPEN FONT LICENSE" }]);
    expect(packages).toEqual(["jszip@1.0.0", "pako@1.0.0"]);
    expect(text).toContain("jszip@1.0.0 (MIT)\n\nCopyright jszip");
    expect(text).toContain("Copyright pako");
    expect(text).not.toContain("unused");
    expect(text).toContain("Geist (OFL-1.1)\n\nSIL OPEN FONT LICENSE");
  });

  it("refuses a package without a license file, unless it has a fallback", () => {
    expect(() => thirdPartyNotices([join(tree({ nolicense: { license: null } }), "node_modules/nolicense/dist/index.js")])).toThrow(/nolicense@1.0.0 has no license file/);
    expect(thirdPartyNotices([join(tree({ isarray: { license: null } }), "node_modules/isarray/dist/index.js")]).text).toContain("Julian Gruber");
  });
});
