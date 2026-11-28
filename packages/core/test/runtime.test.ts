import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { APP_VERSION, BUNDLED, CODE_ROOT, cliCommand, schedulerCommand, WEB_DIR } from "../src/runtime";
import { scanCommand } from "../src/schedule";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("runtime (from the sources)", () => {
  it("finds the checkout, its built dashboard and its version", () => {
    expect(BUNDLED).toBe(false);
    expect(CODE_ROOT).toBe(resolve(import.meta.dirname, "../../.."));
    expect(WEB_DIR).toBe(join(CODE_ROOT, "apps/web/dist"));
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("starts the CLI through tsx", () => {
    const c = cliCommand();
    expect(c.command).toBe(process.execPath);
    expect(c.args).toEqual([join(CODE_ROOT, "node_modules/tsx/dist/cli.mjs"), join(CODE_ROOT, "packages/cli/src/index.ts")]);
  });

  it("schedules scans through the launcher of an installed copy, so updates don't need them registered again", () => {
    delete process.env.RAWJOBS_LAUNCHER;
    expect(schedulerCommand()).toEqual(cliCommand());
    const launcher = join("/Users/me/RawJobs", "bin/rawjobs");
    process.env.RAWJOBS_LAUNCHER = launcher;
    expect(schedulerCommand()).toEqual({ command: resolve(launcher), args: [] });
    const cmd = scanCommand({ repoRoot: CODE_ROOT, dataDir: "/Users/me/RawJobs/data", launch: schedulerCommand() }, "mine");
    expect(cmd.slice(0, 4)).toEqual([resolve(launcher), "scan", "--scope", "mine"]);
  });
});

describe("this copy's version", () => {
  it("is package.json's, and the User-Agent sends the same one", async () => {
    const { readFileSync } = await import("node:fs");
    const { APP_VERSION } = await import("../src/runtime");
    const { defaultUserAgent } = await import("../src/http");
    const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
    expect(defaultUserAgent().startsWith(`RawJobs/${APP_VERSION} `)).toBe(true);
  });
});
