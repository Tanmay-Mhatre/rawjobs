import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTOSTART, readServerState, writeServerState } from "../src/desktop";
import { iconIcns, iconIco, iconPng, markPixels } from "../src/icon";

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

describe("the shortcut icon", () => {
  it("draws the mark: the orange bar on the dark square", () => {
    const px = markPixels(64);
    const at = (x: number, y: number) => [...px.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)];
    expect(at(2, 2)).toEqual([0x15, 0x14, 0x12, 255]);
    expect(at(32, 32)).toEqual([0xff, 0x5a, 0x1f, 255]);
  });

  it("is a PNG, an ICO and an ICNS of the right sizes", () => {
    const png = iconPng(48);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(48);
    const ico = iconIco([16, 256]);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);
    expect(ico[6]).toBe(16);
    expect(ico[22]).toBe(0); // 256 is written as 0
    const icns = iconIcns();
    expect(icns.subarray(0, 4).toString("ascii")).toBe("icns");
    expect(icns.readUInt32BE(4)).toBe(icns.length);
  });
});
