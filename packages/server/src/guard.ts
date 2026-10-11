import type { IncomingMessage } from "node:http";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** "127.0.0.1:4317" → "127.0.0.1"; "[::1]:4317" → "[::1]". */
function hostname(host: string): string {
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]!;
}

/**
 * Only this computer's own pages may use the API.
 * - Host must be a loopback name: a website that points its own domain at 127.0.0.1
 *   (DNS rebinding) arrives with its own Host and is turned away.
 * - Anything that changes something (not GET/HEAD) must come with an Origin equal to our own
 *   address. Browsers send Origin on every POST and DELETE, so a page on another site can't
 *   reset your setup or schedule scans. Tools like curl send no Origin and are turned away too.
 * Returns why a request is refused, or null when it's allowed.
 */
export function refuse(req: IncomingMessage): string | null {
  const host = (req.headers.host ?? "").toLowerCase();
  if (!LOOPBACK.has(hostname(host))) return "This server only answers on this computer (127.0.0.1).";
  if (req.method === "GET" || req.method === "HEAD") return null;
  const origin = req.headers.origin;
  if (!origin) return "Missing Origin.";
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return "Bad Origin.";
  }
  return originHost === host ? null : "Requests from other sites aren't allowed.";
}
