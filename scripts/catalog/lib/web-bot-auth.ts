/**
 * Web Bot Auth: the job feed says who it is with a signature, not just a User-Agent, so Cloudflare
 * (and any site that checks) can tell the real RawJobs feed from someone borrowing its name.
 * https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/
 *
 * - Requests (signRequest): an HTTP Message Signature (RFC 9421, Ed25519) over `@authority` and
 *   `signature-agent`, tagged `web-bot-auth`, with `created`, `expires`, `keyid` and a nonce.
 *   `Signature-Agent` is a quoted string (Cloudflare's docs: the dictionary form fails there).
 * - The key directory (signDirectory): the public key as a JWK set, served at
 *   /.well-known/http-message-signatures-directory and itself signed over `"@authority";req`, tagged
 *   `http-message-signatures-directory`. The site's Worker (apps/site/worker.ts) serves it.
 * - keyid is the key's JWK SHA-256 thumbprint (RFC 7638), base64url.
 *
 * Plain WebCrypto, so the same code runs in Node (the feed) and in a Cloudflare Worker (the directory).
 * Only the feed's CI job and the site's Worker hold the private key (WEB_BOT_AUTH_KEY, a PKCS#8 PEM);
 * the desktop app never loads this file.
 */

import type { webcrypto } from "node:crypto";

export const DIRECTORY_PATH = "/.well-known/http-message-signatures-directory";
export const DIRECTORY_CONTENT_TYPE = "application/http-message-signatures-directory+json";
/** How long a signature stays valid. Cloudflare: "a minute is often sufficient"; this leaves room for clock skew. */
export const SIGNATURE_TTL_S = 300;

export type PublicJwk = { kty: "OKP"; crv: "Ed25519"; x: string };
export type BotKey = { privateKey: webcrypto.CryptoKey; jwk: PublicJwk; keyid: string };

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

function base64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
const base64url = (bytes: Uint8Array) => base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Reads a PKCS#8 PEM Ed25519 private key (what `openssl genpkey -algorithm ed25519` writes). */
export async function loadBotKey(pem: string): Promise<BotKey> {
  const b64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  if (!b64 || /-----/.test(b64)) throw new Error("WEB_BOT_AUTH_KEY must be an Ed25519 private key in PKCS#8 PEM (-----BEGIN PRIVATE KEY-----)");
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  // Extractable only to read the public half (x) out of it; the private half (d) is never kept or shown.
  const extractable = await subtle.importKey("pkcs8", der, { name: "Ed25519" }, true, ["sign"]);
  const full = (await subtle.exportKey("jwk", extractable)) as webcrypto.JsonWebKey;
  if (full.kty !== "OKP" || full.crv !== "Ed25519" || !full.x) throw new Error("WEB_BOT_AUTH_KEY is not an Ed25519 key");
  const privateKey = await subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, ["sign"]);
  const jwk: PublicJwk = { kty: "OKP", crv: "Ed25519", x: full.x };
  return { privateKey, jwk, keyid: await thumbprint(jwk) };
}

/** RFC 7638 thumbprint: SHA-256 of the required members in lexical order, no spaces, base64url. */
export async function thumbprint(jwk: PublicJwk): Promise<string> {
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`;
  return base64url(new Uint8Array(await subtle.digest("SHA-256", enc.encode(canonical))));
}

function nonce(): string {
  return base64(globalThis.crypto.getRandomValues(new Uint8Array(64)));
}

async function signBase(key: BotKey, base: string): Promise<string> {
  return base64(new Uint8Array(await subtle.sign({ name: "Ed25519" }, key.privateKey, enc.encode(base))));
}

/** The origin a Signature-Agent names: the site that serves the key directory. */
export function agentOrigin(site: string): string {
  const u = new URL(site);
  if (u.protocol !== "https:") throw new Error(`the Signature-Agent must be https (got ${site})`);
  return u.origin;
}

/**
 * The headers that sign one request to `url`. Sign each attempt afresh: the signature names the host
 * (`@authority`) and expires after SIGNATURE_TTL_S.
 */
export async function signRequest(key: BotKey, url: string, agent: string, now = Date.now()): Promise<Record<string, string>> {
  const authority = new URL(url).host.toLowerCase();
  const signatureAgent = `"${agentOrigin(agent)}"`;
  const created = Math.floor(now / 1000);
  const params = `("@authority" "signature-agent");created=${created};keyid="${key.keyid}";alg="ed25519"` + `;expires=${created + SIGNATURE_TTL_S};nonce="${nonce()}";tag="web-bot-auth"`;
  const base = `"@authority": ${authority}\n"signature-agent": ${signatureAgent}\n"@signature-params": ${params}`;
  return {
    "signature-agent": signatureAgent,
    "signature-input": `sig1=${params}`,
    signature: `sig1=:${await signBase(key, base)}:`,
  };
}

/** The key directory's body and headers, signed for the host it is served from (`authority`). */
export async function signDirectory(key: BotKey, authority: string, now = Date.now()): Promise<{ body: string; headers: Record<string, string> }> {
  const created = Math.floor(now / 1000);
  const params = `("@authority";req);alg="ed25519";keyid="${key.keyid}";nonce="${nonce()}"` + `;tag="http-message-signatures-directory";created=${created};expires=${created + SIGNATURE_TTL_S}`;
  const base = `"@authority";req: ${authority.toLowerCase()}\n"@signature-params": ${params}`;
  return {
    body: JSON.stringify({ keys: [{ ...key.jwk, kid: key.keyid }] }),
    headers: {
      "content-type": DIRECTORY_CONTENT_TYPE,
      "cache-control": `public, max-age=${SIGNATURE_TTL_S}`,
      "signature-input": `sig1=${params}`,
      signature: `sig1=:${await signBase(key, base)}:`,
    },
  };
}

/**
 * The feed's request signer, or undefined (requests go out unsigned, as before). Signs only in GitHub
 * Actions with WEB_BOT_AUTH_KEY set; WEB_BOT_AUTH_AGENT names the site serving the key directory.
 */
export async function feedSigner(env: Record<string, string | undefined> = process.env): Promise<((url: string) => Promise<Record<string, string>>) | undefined> {
  const pem = env.WEB_BOT_AUTH_KEY?.trim();
  if (!pem || env.GITHUB_ACTIONS !== "true") return undefined;
  const key = await loadBotKey(pem);
  const agent = agentOrigin(env.WEB_BOT_AUTH_AGENT?.trim() || DEFAULT_AGENT);
  return (url) => signRequest(key, url, agent);
}

/** The site's default address (apps/site/README.md: SITE_URL). */
export const DEFAULT_AGENT = "https://www.rawjobs.workers.dev";
