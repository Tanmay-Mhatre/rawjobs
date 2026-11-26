/**
 * Scans fetch URLs that other people chose: a job's link on a public board, a board host built from a
 * directory slug. None of them may reach this computer, its network or a cloud metadata address.
 * publicOnlyAgent checks the address each new connection actually goes to (every redirect hop
 * included, and after DNS, so a name that later re-resolves to 127.0.0.1 is caught too). IP literals
 * never go through DNS, so HttpClient checks those itself (privateHost).
 * RAWJOBS_ALLOW_PRIVATE=1 turns the guard off, for self-hosters whose job board runs on their own network.
 */
import { type LookupAddress, lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import type { Dispatcher } from "undici";
import { envSetting } from "./env";

/** A fetch was refused because its host is (or resolves to) a private address. Permanent: never retried. */
export class PrivateAddressError extends Error {
  override name = "PrivateAddressError";
  readonly code = "EPRIVATE";
}

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
    // The URL parser writes a mapped IPv4 address in hex: [::ffff:127.0.0.1] becomes ::ffff:7f00:1.
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(x);
    if (hex) {
      const [hi, lo] = [Number.parseInt(hex[1]!, 16), Number.parseInt(hex[2]!, 16)];
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return x === "::" || x === "::1" || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x) || x.startsWith("2001:db8") || x.startsWith("64:ff9b");
  }
  return true;
}

/** True when RAWJOBS_ALLOW_PRIVATE=1: private addresses may be fetched (a job board on your own network). */
export const allowPrivate = (): boolean => envSetting("ALLOW_PRIVATE") === "1";

/** Why a URL's host is refused before connecting (a private IP literal, or localhost), or null. */
export function privateHost(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return `${host} is this computer; not fetched.`;
  if (isIP(host) && isPrivateAddress(host)) return `${host} is a private address; not fetched.`;
  return null;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
type Resolve = (host: string, opts: { all: true }, cb: (err: NodeJS.ErrnoException | null, addrs: LookupAddress[]) => void) => void;

/** A connect-time `lookup` that refuses a host when any of its addresses isn't public. `resolve` and `blocked` are for tests. */
export function publicOnlyLookup(resolve: Resolve = dnsLookup as unknown as Resolve, blocked: (ip: string) => boolean = isPrivateAddress) {
  return (host: string, opts: { all?: boolean }, cb: LookupCallback): void => {
    resolve(host, { ...opts, all: true }, (err, addrs) => {
      if (err) return cb(err, []);
      if (addrs.some((a) => blocked(a.address))) return cb(new PrivateAddressError(`${host} points to a private address; not fetched.`), []);
      if (opts.all) cb(null, addrs);
      else cb(null, addrs[0]!.address, addrs[0]!.family);
    });
  };
}

let agent: Promise<Dispatcher> | undefined;
/**
 * An undici dispatcher for fetch() whose connections only ever go to public addresses. Loaded on
 * first use, never at import: undici is Node-only (it reads `process` when it loads), and the
 * dashboard's bundle imports @rawjobs/core too. An import at the top broke the page (v0.7.13).
 */
export function publicOnlyAgent(): Promise<Dispatcher> {
  agent ??= import("undici").then(({ Agent }) => new Agent({ connect: { lookup: publicOnlyLookup() } }));
  return agent;
}

/** When fetch() failed because publicOnlyAgent refused the address: the refusal's message (fetch wraps it in a cause). */
export function privateAddressReason(err: unknown): string | undefined {
  for (let e = err as { code?: unknown; cause?: unknown; message?: string } | undefined, i = 0; e && i < 5; e = e.cause as typeof e, i++)
    if (e.code === "EPRIVATE") return e.message ?? "a private address; not fetched.";
  return undefined;
}
