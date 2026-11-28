import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

/** A third-party package that ships inside the bundle. */
interface Shipped {
  name: string;
  version: string;
  license: string;
  dir: string;
}

/** License text for the few packages that ship without a license file (the text is in their README). */
const FALLBACK: Record<string, string> = {
  isarray: "MIT License\n\nCopyright (c) 2013 Julian Gruber <julian@juliangruber.com>",
};

const LICENSE_FILE = /^(licen[cs]e|copying|notice)/i;

function readJson(file: string): { name?: string; version?: string; license?: string; dependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(file, "utf8"));
}

function shipped(dir: string): Shipped {
  const p = readJson(join(dir, "package.json"));
  return { name: p.name!, version: p.version ?? "", license: p.license ?? "", dir };
}

/** The package a bundled file belongs to: the nearest folder above it with a named package.json. Null for our own code. */
function packageOf(file: string): Shipped | null {
  const abs = resolve(file.replace(/^\0/, "").split("?")[0]!);
  if (!abs.includes(`${sep}node_modules${sep}`)) return null;
  for (let dir = dirname(abs); dir !== dirname(dir); dir = dirname(dir)) {
    if (existsSync(join(dir, "package.json")) && readJson(join(dir, "package.json")).name) return shipped(dir);
  }
  return null;
}

/** Where Node finds `dep` from inside `fromDir`: the nearest node_modules/<dep> above it. */
function resolveFrom(fromDir: string, dep: string): string | null {
  for (let dir = fromDir; dir !== dirname(dir); dir = dirname(dir)) {
    if (existsSync(join(dir, "node_modules", dep, "package.json"))) return join(dir, "node_modules", dep);
  }
  return null;
}

/**
 * THIRD_PARTY_NOTICES.txt for the bundle: the license of every package the bundlers put in (from the
 * files they read), plus those packages' own runtime dependencies, because prebuilt files hide them
 * (jszip's dist inlines pako, lie, readable-stream…). `extras` are notices for files that aren't
 * packages (the fonts). Throws when a package has no license file and no FALLBACK entry, so a new
 * dependency can't ship without its notice.
 */
export function thirdPartyNotices(files: string[], extras: { title: string; text: string }[] = []): { text: string; packages: string[] } {
  const found = new Map<string, Shipped>();
  const add = (p: Shipped) => {
    const key = `${p.name}@${p.version}`;
    if (found.has(key)) return false;
    found.set(key, p);
    return true;
  };
  for (const f of files) {
    const p = packageOf(f);
    if (p) add(p);
  }
  const queue = [...found.values()];
  while (queue.length) {
    const p = queue.pop()!;
    for (const dep of Object.keys(readJson(join(p.dir, "package.json")).dependencies ?? {})) {
      const dir = resolveFrom(p.dir, dep);
      if (!dir) continue;
      const d = shipped(dir);
      if (add(d)) queue.push(d);
    }
  }

  const rule = "-".repeat(72);
  const parts = ["RawJobs includes the third-party software below, each under its own license.\n"];
  const keys = [...found.keys()].sort();
  for (const key of keys) {
    const p = found.get(key)!;
    const file = readdirSync(p.dir).find((n) => LICENSE_FILE.test(n));
    const text = file ? readFileSync(join(p.dir, file), "utf8").trim() : FALLBACK[p.name];
    if (!text) throw new Error(`${key} has no license file: add its license text to FALLBACK in scripts/bundle/notices.ts.`);
    parts.push(`${rule}\n${key}${p.license ? ` (${p.license})` : ""}\n\n${text}\n`);
  }
  for (const e of extras) parts.push(`${rule}\n${e.title}\n\n${e.text.trim()}\n`);
  return { text: parts.join("\n"), packages: keys };
}
