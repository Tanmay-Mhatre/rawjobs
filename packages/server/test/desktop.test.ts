import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTOSTART, readServerState, writeServerState } from "../src/desktop";

const root = join(import.meta.dirname, "../../..");

describe("an installed copy's server", () => {
  it("records where it runs, for the shortcut", () => {
    const home = mkdtempSync(join(tmpdir(), "rj-state-"));
    expect(readServerState(home)).toBeNull();
    writeServerState(4318, home);
    expect(readServerState(home)).toMatchObject({ port: 4318, pid: process.pid });
  });

  it("is registered by the installers under the names uninstall removes", () => {
    const ps1 = readFileSync(join(root, "packaging/install.ps1"), "utf8");
    const sh = readFileSync(join(root, "packaging/install.sh"), "utf8");
    expect(ps1).toContain(`$TaskName = '${AUTOSTART.windowsTask}'`);
    expect(sh).toContain(`LABEL='${AUTOSTART.macLabel}'`);
    expect(sh).toContain(`UNIT='${AUTOSTART.linuxUnit}'`);
  });
});
