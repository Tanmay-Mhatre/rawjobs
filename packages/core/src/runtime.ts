import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Set to true by the bundle build (scripts/bundle/build.ts); absent when running the TypeScript sources. */
declare const __RAWJOBS_BUNDLE__: boolean | undefined;

/**
 * Where this copy of RawJobs runs from. Two layouts:
 * - a repo checkout: the TypeScript sources, run through tsx;
 * - the bundle (an installed copy): one cli.mjs with web/ and package.json next to it.
 */
export const BUNDLED = typeof __RAWJOBS_BUNDLE__ !== "undefined" && __RAWJOBS_BUNDLE__ === true;

/** The folder with RawJobs' code: the bundle's folder, or the checkout's root. */
export const CODE_ROOT = BUNDLED ? dirname(fileURLToPath(import.meta.url)) : resolve(fileURLToPath(new URL("../../..", import.meta.url)));

/** The built dashboard. */
export const WEB_DIR = BUNDLED ? join(CODE_ROOT, "web") : join(CODE_ROOT, "apps/web/dist");

/** This copy's version (package.json next to the code). */
export const APP_VERSION: string = (() => {
  try {
    return (JSON.parse(readFileSync(join(CODE_ROOT, "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

export type Command = { command: string; args: string[] };

/** Start the CLI of this very copy from another process (the server's scans and setup calls). */
export function cliCommand(): Command {
  return BUNDLED
    ? { command: process.execPath, args: [join(CODE_ROOT, "cli.mjs")] }
    : { command: process.execPath, args: [join(CODE_ROOT, "node_modules/tsx/dist/cli.mjs"), join(CODE_ROOT, "packages/cli/src/index.ts")] };
}

/**
 * Start the CLI from the computer's scheduler. An installed copy goes through its launcher
 * (RAWJOBS_LAUNCHER, set by bin/rawjobs), which always runs the current version and its Node, so
 * scheduled scans keep working across updates without registering them again.
 */
export function schedulerCommand(): Command {
  const launcher = process.env.RAWJOBS_LAUNCHER;
  return launcher ? { command: resolve(launcher), args: [] } : cliCommand();
}
