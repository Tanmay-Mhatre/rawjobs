import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Set the version in every package.json, so a checkout says which release it's on (Settings → About,
 * /api/health, the User-Agent). Run it in a pull request right after pushing a release tag:
 *
 *   pnpm release:bump 0.7.19
 *
 * The bundle doesn't need it: the release build writes the tag's version into its own package.json.
 */

export const PACKAGE_FILES = ["package.json", "apps/web/package.json", "packages/cli/package.json", "packages/core/package.json", "packages/server/package.json"];

/** The package.json text with its top-level "version" set to `version`, the rest byte for byte. */
export function withVersion(text: string, version: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Not a version: ${version} (expected X.Y.Z)`);
  if (!/^ {2}"version": "[^"]*"/m.test(text)) throw new Error('No top-level "version" field');
  return text.replace(/^( {2}"version": )"[^"]*"/m, `$1"${version}"`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const version = process.argv[2]?.replace(/^v/, "") ?? "";
  const root = resolve(import.meta.dirname, "../..");
  for (const file of PACKAGE_FILES) {
    const path = join(root, file);
    writeFileSync(path, withVersion(readFileSync(path, "utf8"), version));
  }
  console.log(`Set ${PACKAGE_FILES.length} package.json files to ${version}.`);
}
