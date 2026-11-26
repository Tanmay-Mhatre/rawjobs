import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pageScripts } from "./pages";

/**
 * The Content-Security-Policy of the dashboard's pages: scripts only from this server, plus the few
 * inline ones we wrote, each allowed by its SHA-256. A script injected into a page (a future XSS)
 * doesn't run. Sent as Report-Only for now: the browser runs everything as before and reports what
 * the policy would have blocked to /api/csp-report (logged in logs/server.log).
 *
 * Which inline scripts are allowed:
 * - the dashboard's index.html: the ones in that file as it was built (read once per start: an
 *   update starts a new server);
 * - the server's own pages (offline, 404…): their constants (pages.ts `pageScripts`);
 * - anything else served as HTML (a file in the data folder): none.
 */
export const CSP_HEADER = "content-security-policy-report-only";
export const CSP_REPORT_PATH = "/api/csp-report";

const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

/** 'sha256-…' for each inline script (no src) in this HTML. */
export function scriptHashes(html: string): string[] {
  return [...html.matchAll(INLINE_SCRIPT)].map((m) => `'sha256-${createHash("sha256").update(m[1]!, "utf8").digest("base64")}'`);
}

export function policy(hashes: string[]): string {
  return [
    "default-src 'self'",
    `script-src 'self'${hashes.length ? ` ${[...new Set(hashes)].join(" ")}` : ""}`,
    // The server's pages use style attributes and a <style> block; styles can't run code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // The port-hop check: a dashboard left open looks for RawJobs on the other ports of this computer.
    "connect-src 'self' http://127.0.0.1:* http://localhost:*",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `report-uri ${CSP_REPORT_PATH}`,
  ].join("; ");
}

const webPolicies = new Map<string, string>();

/** The policy for the built dashboard in `webDir`: its index.html's inline scripts, hashed once. */
export function webPolicy(webDir: string): string {
  let p = webPolicies.get(webDir);
  if (p === undefined) {
    let html = "";
    try {
      html = readFileSync(join(webDir, "index.html"), "utf8");
    } catch {
      // No dashboard (yet): nothing inline is allowed.
    }
    p = policy(scriptHashes(html));
    webPolicies.set(webDir, p);
  }
  return p;
}

let pagesPolicy: string | undefined;
/** The policy for the server's own pages (pages.ts). */
export function serverPagesPolicy(): string {
  pagesPolicy ??= policy(pageScripts().flatMap(scriptHashes));
  return pagesPolicy;
}

/**
 * One log line for a CSP violation report (the `report-uri` format, {"csp-report": {…}}), or null
 * when the body isn't one. Only what helps fix the policy; one line, at most 300 characters.
 */
export function cspReportLine(body: string): string | null {
  let r: Record<string, unknown> | undefined;
  try {
    r = (JSON.parse(body) as { "csp-report"?: Record<string, unknown> })["csp-report"];
  } catch {
    return null;
  }
  if (!r || typeof r !== "object") return null;
  const text = (k: string) => (typeof r[k] === "string" || typeof r[k] === "number" ? String(r[k]) : "");
  const page = (() => {
    try {
      return new URL(text("document-uri")).pathname;
    } catch {
      return "";
    }
  })();
  const where = text("source-file") ? ` at ${text("source-file")}:${text("line-number")}` : "";
  const line = `CSP (report-only) would block ${text("blocked-uri") || "?"} by ${text("effective-directive") || text("violated-directive") || "?"} on ${page || "?"}${where}`;
  return line.replace(/[\r\n]+/g, " ").slice(0, 300);
}

/** The policy for any other HTML (the data folder): no inline script at all. */
export const plainPolicy = (): string => policy([]);
