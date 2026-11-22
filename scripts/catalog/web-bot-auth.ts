/**
 * Web Bot Auth helpers for the job feed's key (scripts/catalog/lib/web-bot-auth.ts).
 *
 *   pnpm feed:bot-auth keygen <file>   Write a new Ed25519 private key (PKCS#8 PEM) to <file>, outside the
 *                                      repo, and print its keyid and public key. The file is the secret.
 *   pnpm feed:bot-auth check <file>    Sign one request with that key to Cloudflare's test endpoint and
 *                                      say what it made of it; then read the site's key directory.
 *
 * Setup and what each answer means: docs/shared-directory.md#web-bot-auth
 */
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_AGENT, DIRECTORY_PATH, agentOrigin, loadBotKey, signRequest } from "./lib/web-bot-auth";

const TEST_URL = "https://crawltest.com/cdn-cgi/web-bot-auth";
const UA = "RawJobs-feed/0.2 (open-source job radar; one read per board every 6 hours; https://github.com/Tanmay-Mhatre/rawjobs)";

async function keygen(file: string) {
  if (existsSync(file)) throw new Error(`${file} already exists; pick a new file name`);
  const { privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  writeFileSync(file, pem, { mode: 0o600 });
  const key = await loadBotKey(pem);
  console.log(`Wrote the private key to ${file}. Keep it secret; never commit it.`);
  console.log(`keyid: ${key.keyid}`);
  console.log(`public key: ${JSON.stringify(key.jwk)}`);
}

async function check(file: string) {
  const key = await loadBotKey(readFileSync(file, "utf8"));
  const agent = agentOrigin(process.env.WEB_BOT_AUTH_AGENT?.trim() || DEFAULT_AGENT);
  console.log(`keyid ${key.keyid}, Signature-Agent "${agent}"`);
  const res = await fetch(TEST_URL, { headers: { "user-agent": UA, ...(await signRequest(key, TEST_URL, agent)) } });
  const meaning: Record<number, string> = {
    200: "signature verified with a registered key",
    401: "well-formed signature; the key isn't registered with Cloudflare (yet)",
    400: "Cloudflare could not read the signature: something is wrong",
  };
  console.log(`${TEST_URL}: ${res.status} (${meaning[res.status] ?? "unexpected answer"})`);
  const dir = await fetch(`${agent}${DIRECTORY_PATH}`, { headers: { "user-agent": UA } });
  const body = dir.ok ? await dir.text() : "";
  const listed = body.includes(key.jwk.x);
  console.log(
    `${agent}${DIRECTORY_PATH}: ${dir.status} ${dir.headers.get("content-type") ?? ""}` +
      (dir.ok ? (listed ? ", lists this key, signed" : ", does NOT list this key") : " (not served yet: add the Worker secret and deploy the site)"),
  );
  if (res.status === 400 || (dir.ok && !listed)) process.exitCode = 1;
}

const [cmd, file] = process.argv.slice(2);
if ((cmd !== "keygen" && cmd !== "check") || !file) {
  console.error("usage: pnpm feed:bot-auth keygen <file> | check <file>");
  process.exit(2);
}
await (cmd === "keygen" ? keygen(file) : check(file));
