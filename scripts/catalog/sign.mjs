/**
 * Sign the shared data's manifests: writes <file>.sig (ed25519 over the file's exact bytes, base64)
 * next to each file. Apps accept the directory and the job feed only with a valid signature
 * (packages/core/src/data-signing.ts).
 *
 *   RAWJOBS_DATA_SIGNING_KEY="<PEM>" node scripts/catalog/sign.mjs dist/manifest.json [...]
 *
 * Plain Node with no imports outside node:, on purpose: nothing from node_modules runs while the key
 * is in memory. With RAWJOBS_DATA_PUBLIC_KEY set, each signature is also checked against it.
 */
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const pem = process.env.RAWJOBS_DATA_SIGNING_KEY;
if (!pem) {
  console.error("No signing key: set RAWJOBS_DATA_SIGNING_KEY (the repo secret of the same name).");
  process.exit(1);
}
const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: node scripts/catalog/sign.mjs <file> [...]");
  process.exit(1);
}
const key = createPrivateKey(pem);
const check = process.env.RAWJOBS_DATA_PUBLIC_KEY;
for (const file of files) {
  const body = readFileSync(file);
  const signature = sign(null, body, key);
  if (check && !verify(null, body, createPublicKey({ key: Buffer.from(check, "base64"), format: "der", type: "spki" }), signature)) {
    console.error(`${file}: the signature doesn't match RAWJOBS_DATA_PUBLIC_KEY; wrong signing key?`);
    process.exit(1);
  }
  writeFileSync(`${file}.sig`, `${signature.toString("base64")}\n`);
  console.log(`Signed ${file}`);
}
