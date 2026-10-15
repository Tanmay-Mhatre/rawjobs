/**
 * A careful GET for pages we don't control (a company's careers page, an RDAP server), used as
 * evidence for moved careers pages. Stricter than HttpClient on purpose:
 *   - https on port 443 only; every hop's host is resolved first and refused if any address is
 *     private, loopback, link-local, CGNAT, multicast or otherwise not public (no SSRF from a URL
 *     in the directory);
 *   - redirects are followed by hand, at most 5 hops, and every hop is returned (the caller decides
 *     which hops count);
 *   - the body is cut at 2 MB; no cookies are sent or kept;
 *   - robots.txt is read per origin and is strict: a 4xx allows everything (no robots.txt), a 5xx,
 *     a timeout or no answer disallows everything (RFC 9309, 2.3.1.4).
 * Nothing here throws for a network problem: the result says what happened.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { parseRobots, type RobotsRules, robotsAllowsPath } from "@rawjobs/core";

export type Hop = { url: string; status: number; location?: string };
export type SafeResult =
  | { kind: "ok"; status: number; url: string; hops: Hop[]; body: string; truncated: boolean }
  | { kind: "error"; reason: "blocked-url" | "private-address" | "robots" | "too-many-hops" | "http" | "network"; detail: string; status?: number; hops: Hop[] };

export type SafeFetchOptions = {
  userAgent: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxHops?: number;
  /** false for API endpoints such as RDAP (not crawled pages). */
  robots?: boolean;
  /** Every address a host resolves to (tests pass a fake). */
  lookup?: (host: string) => Promise<string[]>;
  fetchImpl?: typeof fetch;
};

export const MAX_BYTES = 2_000_000;
export const MAX_HOPS = 5;

/** Not a public unicast address: private, loopback, link-local, CGNAT, documentation, multicast, reserved. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return x === "::" || x === "::1" || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x) || x.startsWith("2001:db8") || x.startsWith("64:ff9b");
  }
  return true;
}

const defaultLookup = async (host: string) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** A URL we may fetch at all: https, port 443, a host name (not an IP literal), no credentials. */
export function allowedUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || (u.port && u.port !== "443") || u.username || u.password) return null;
  if (isIP(u.hostname.replace(/^\[|\]$/g, ""))) return null;
  if (!u.hostname.includes(".")) return null;
  return u;
}

/** One fetcher with its own robots.txt cache (one per run). */
export function safeFetcher(opts: SafeFetchOptions) {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const maxHops = opts.maxHops ?? MAX_HOPS;
  const lookup = opts.lookup ?? defaultLookup;
  const doFetch = opts.fetchImpl ?? fetch;
  const robotsCache = new Map<string, Promise<RobotsRules | "deny">>();

  const publicHost = async (host: string): Promise<boolean> => {
    try {
      const addrs = await lookup(host);
      return addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a));
    } catch {
      return false;
    }
  };

  /** One request, no redirects followed, body read up to the cap. */
  const once = async (url: URL): Promise<{ status: number; location?: string; body: string; truncated: boolean }> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await doFetch(url, {
        redirect: "manual",
        credentials: "omit",
        signal: ctl.signal,
        headers: { "user-agent": opts.userAgent, accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5" },
      });
      const location = res.headers.get("location") ?? undefined;
      let body = "";
      let truncated = false;
      if (res.body && !(res.status >= 300 && res.status < 400)) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let bytes = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) {
            body += decoder.decode(value.subarray(0, value.byteLength - (bytes - maxBytes)));
            truncated = true;
            await reader.cancel().catch(() => {});
            break;
          }
          body += decoder.decode(value, { stream: true });
        }
      } else await res.body?.cancel().catch(() => {});
      return { status: res.status, ...(location ? { location } : {}), body, truncated };
    } finally {
      clearTimeout(timer);
    }
  };

  const robotsFor = (origin: URL): Promise<RobotsRules | "deny"> => {
    const key = origin.origin;
    let p = robotsCache.get(key);
    if (!p) {
      p = (async () => {
        try {
          if (!(await publicHost(origin.hostname))) return "deny";
          const r = await once(new URL("/robots.txt", origin));
          if (r.status >= 200 && r.status < 300) return parseRobots(r.body);
          if (r.status >= 400 && r.status < 500) return { allow: [], disallow: [] };
          return "deny"; // 3xx (not followed for robots.txt), 5xx
        } catch {
          return "deny"; // timeout, no answer
        }
      })();
      robotsCache.set(key, p);
    }
    return p;
  };

  /**
   * `stayOn`: stop at the first redirect that leaves this host, without fetching it. The result is
   * "ok" with that URL as `url`, an empty body, and the off-host URL as the last hop (status 0).
   */
  return async function get(raw: string, o: { stayOn?: string } = {}): Promise<SafeResult> {
    const hops: Hop[] = [];
    let url = allowedUrl(raw);
    if (!url) return { kind: "error", reason: "blocked-url", detail: raw.slice(0, 200), hops };
    for (let hop = 0; ; hop++) {
      if (o.stayOn && url.hostname !== o.stayOn && hop > 0) {
        hops.push({ url: url.href, status: 0 });
        return { kind: "ok", status: 0, url: url.href, hops, body: "", truncated: false };
      }
      if (hop > maxHops) return { kind: "error", reason: "too-many-hops", detail: url.href, hops };
      if (!(await publicHost(url.hostname))) return { kind: "error", reason: "private-address", detail: url.hostname, hops };
      if (opts.robots !== false) {
        const rules = await robotsFor(url);
        if (rules === "deny" || !robotsAllowsPath(rules, url.pathname + url.search)) return { kind: "error", reason: "robots", detail: url.href, hops };
      }
      let r: Awaited<ReturnType<typeof once>>;
      try {
        r = await once(url);
      } catch (err) {
        return { kind: "error", reason: "network", detail: (err as Error).message.slice(0, 200), hops };
      }
      hops.push({ url: url.href, status: r.status, ...(r.location ? { location: r.location } : {}) });
      if (r.status >= 300 && r.status < 400 && r.location) {
        const next = allowedUrl(new URL(r.location, url).href);
        if (!next) return { kind: "error", reason: "blocked-url", detail: r.location.slice(0, 200), hops };
        url = next;
        continue;
      }
      if (r.status < 200 || r.status >= 300) return { kind: "error", reason: "http", detail: url.href, status: r.status, hops };
      return { kind: "ok", status: r.status, url: url.href, hops, body: r.body, truncated: r.truncated };
    }
  };
}

export type SafeGet = ReturnType<typeof safeFetcher>;
