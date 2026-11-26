import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeOnlyInEntry } from "./web-check";

function dist(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "rawjobs-webcheck-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), `<script>theme()</script><script type="module" crossorigin src="./assets/index-a.js"></script>`);
  for (const [name, code] of Object.entries(files)) writeFileSync(join(dir, "assets", name), code);
  return dir;
}

describe("nodeOnlyInEntry", () => {
  it("passes browser code, and Node code that only a lazy import() loads", () => {
    expect(nodeOnlyInEntry(dist({ "index-a.js": `import{x}from"./chunk-b.js";import("./lazy-c.js")`, "chunk-b.js": "export const x=1", "lazy-c.js": "process.versions.node" }))).toBeNull();
  });

  it("finds Node-only code in the entry or in a chunk it imports at start", () => {
    expect(nodeOnlyInEntry(dist({ "index-a.js": "var[a]=process.versions.node.split('.')" }))).toMatch(/index-a\.js has process\.versions/);
    expect(nodeOnlyInEntry(dist({ "index-a.js": `import"./chunk-b.js"`, "chunk-b.js": "/* undici */" }))).toMatch(/chunk-b\.js has undici/);
  });
});
