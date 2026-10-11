import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

/** The file under one of the roots that this URL names, or null (never anything outside the roots). */
export function findFile(roots: string[], urlPath: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(urlPath.split("?")[0]!);
  } catch {
    return null;
  }
  if (path.includes("\0")) return null;
  if (path === "/" || path === "") path = "/index.html";
  for (const root of roots) {
    const base = resolve(root);
    const file = resolve(base, `.${path}`);
    if (file !== base && !file.startsWith(base + sep)) continue;
    try {
      if (statSync(file).isFile()) return file;
    } catch {
      // not in this root
    }
  }
  return null;
}

/**
 * Serve the built dashboard, then the run output folder, at the site root (as the dev server
 * does: /jobs.json, /meta.json…). Returns false when nothing matched.
 */
export function serveStatic(roots: string[], req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const file = findFile(roots, req.url ?? "/");
  if (!file) return false;
  const html = file.endsWith(".html");
  res.setHeader("content-type", TYPES[extname(file).toLowerCase()] ?? "application/octet-stream");
  // Built assets have hashed names and can be kept; the page and the data change between scans.
  res.setHeader("cache-control", /[\\/]assets[\\/]/.test(file) && !html ? "public, max-age=31536000, immutable" : "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  if (html) res.setHeader("x-frame-options", "DENY");
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(file)
    .on("error", () => {
      res.statusCode = 500;
      res.end();
    })
    .pipe(res);
  return true;
}
