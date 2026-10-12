/**
 * Sign files: writes <file>.sig (ed25519 over the file's exact bytes, base64) next to each one.
 * Apps accept the directory and the job feed (packages/core/src/data-signing.ts), and installs and
 * updates accept a release (packages/core/src/release.ts), only with a valid signature.
 *
 *   RAWJOBS_DATA_SIGNING_KEY="<PEM>" node scripts/catalog/sign.mjs dist/manifest.json [...]
 *   RAWJOBS_SIGNING_KEY="<PEM>" node scripts/catalog/sign.mjs --key-env RAWJOBS_SIGNING_KEY --public-key <base64> latest.json
 *
 * --key-env names the variable holding the private key (default RAWJOBS_DATA_SIGNING_KEY).
 * --public-key (default: RAWJOBS_DATA_PUBLIC_KEY) checks each signature against the key apps carry.
 * Plain Node with no imports outside node:, on purpose: nothing from node_modules runs while the key
 * is in memory.
 */
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values, positionals: files } = parseArgs({
  allowPositionals: true,
  options: { "key-env": { type: "string", default: "RAWJOBS_DATA_SIGNING_KEY" }, "public-key": { type: "string" } },
});
const keyEnv = values["key-env"];
const pem = process.env[keyEnv];
if (!pem) {
  console.error(`No signing key: set ${keyEnv} (the repo secret of the same name).`);
  process.exit(1);
}
if (!files.length) {
  console.error("Usage: node scripts/catalog/sign.mjs [--key-env NAME] [--public-key <base64>] <file> [...]");
  process.exit(1);
}
const key = createPrivateKey(pem);
const check = values["public-key"] || process.env.RAWJOBS_DATA_PUBLIC_KEY;
for (const file of files) {
  const body = readFileSync(file);
  const signature = sign(null, body, key);
  if (check && !verify(null, body, createPublicKey({ key: Buffer.from(check, "base64"), format: "der", type: "spki" }), signature)) {
    console.error(`${file}: the signature doesn't match the expected public key; wrong signing key?`);
    process.exit(1);
  }
  writeFileSync(`${file}.sig`, `${signature.toString("base64")}\n`);
  console.log(`Signed ${file}`);
}
