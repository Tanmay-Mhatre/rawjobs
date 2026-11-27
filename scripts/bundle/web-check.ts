import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/** Signs of Node-only code: the browser has no `process`, and undici is Node's HTTP library. */
const NODE_ONLY = [/\bprocess\.versions\b/, /\bundici\b/];
const STATIC_IMPORT = /\b(?:import|from)\s*["'](\.{1,2}\/[^"']+\.m?js)["']/g;

/**
 * What the built dashboard runs at start: the module scripts in index.html and every chunk they import
 * statically (lazy `import()` chunks only load when used). Returns their paths, entry first.
 */
function entryChunks(dist: string): string[] {
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const queue = [...html.matchAll(/<script[^>]*\bsrc=["']\.?\/?([^"']+\.m?js)["']/g)].map((m) => join(dist, m[1]!));
  const seen = new Set<string>();
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, "utf8").matchAll(STATIC_IMPORT)) queue.push(join(dirname(file), m[1]!));
  }
  return [...seen];
}

/** The first chunk the dashboard runs at start that has Node-only code, and what gave it away; null when it's all browser code. */
export function nodeOnlyInEntry(dist: string): string | null {
  for (const file of entryChunks(dist)) {
    const code = readFileSync(file, "utf8");
    const hit = NODE_ONLY.find((re) => re.test(code));
    if (hit) return `${file.slice(dist.length + 1)} has ${hit.source.replace(/\\b|\\/g, "")}`;
  }
  return null;
}

/** How many bytes of JavaScript the dashboard loads before it shows anything (raw, not gzip: it's served from this computer, so parsing is the cost). */
export function entryBytes(dist: string): number {
  return entryChunks(dist).reduce((sum, file) => sum + statSync(file).size, 0);
}
