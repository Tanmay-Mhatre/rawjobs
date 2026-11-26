import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The dev server doesn't tree-shake: a Node-only module anywhere in the web app's import graph
// (node:dns via @rawjobs/core's http.ts once happened) blanks the page, even though `pnpm build`
// still works. Walk every runtime import from the app's entry points and refuse Node-only ones.

const root = resolve(__dirname, "../../..");
const web = join(root, "apps/web");
const core = join(root, "packages/core");
const coreExports = JSON.parse(readFileSync(join(core, "package.json"), "utf8")).exports as Record<string, string>;
const NODE_ONLY = new Set([...builtinModules, "undici"]);

/** Runtime imports only: `import type` / `export type` and comments are left out. */
function specifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  for (const m of code.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm)) {
    if (!m[1]) out.push(m[2]!);
  }
  for (const m of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]!);
  return out;
}

function resolveFile(base: string): string | undefined {
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(c) && /\.tsx?$/.test(c)) return c;
  }
  return undefined;
}

/** Every Node-only import reachable from the entries, as "file -> module" with the chain that reached it. */
function nodeOnlyImports(entries: string[]): string[] {
  const found: string[] = [];
  const via = new Map<string, string | undefined>(entries.map((e) => [e, undefined]));
  const queue = [...entries];
  while (queue.length) {
    const file = queue.shift()!;
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      let next: string | undefined;
      if (spec.startsWith(".")) next = resolveFile(resolve(dirname(file), spec));
      else if (spec === "@rawjobs/core" || spec.startsWith("@rawjobs/core/")) {
        const target = coreExports[`.${spec.slice("@rawjobs/core".length)}`];
        next = target ? join(core, target) : undefined;
      } else if (spec.startsWith("node:") || NODE_ONLY.has(spec.split("/")[0]!)) {
        const chain: string[] = [];
        for (let f: string | undefined = file; f; f = via.get(f)) chain.unshift(relative(root, f).replaceAll("\\", "/"));
        found.push(`${spec} <- ${chain.join(" -> ")}`);
      }
      if (next && !via.has(next)) {
        via.set(next, file);
        queue.push(next);
      }
    }
  }
  return found;
}

describe("web app import graph", () => {
  it("never reaches a Node-only module", () => {
    const entries = ["src/main.tsx", "src/gallery.tsx"].map((p) => join(web, p)).filter((p) => existsSync(p));
    expect(entries.length).toBeGreaterThan(0);
    expect(nodeOnlyImports(entries)).toEqual([]);
  });

  it("catches a Node-only import behind a core subpath", () => {
    expect(nodeOnlyImports([join(core, "src/http.ts")]).some((f) => f.startsWith("node:dns"))).toBe(true);
  });
});
