import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeHomePrivate, PRIVATE_MARKER } from "../src/private-home";

const posix = process.platform !== "win32";
const mode = (p: string) => statSync(p).mode & 0o777;

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));
const folder = () => {
  root = mkdtempSync(join(tmpdir(), "rawjobs-private-"));
  const home = join(root, "home");
  mkdirSync(home);
  return home;
};

describe("making the RawJobs folder private", () => {
  it("leaves Windows alone", () => {
    const home = folder();
    expect(makeHomePrivate(home, "win32")).toBe(false);
    expect(existsSync(join(home, PRIVATE_MARKER))).toBe(false);
  });

  it.skipIf(!posix)("makes the folder 0700 on macOS and Linux", () => {
    const home = folder();
    chmodSync(home, 0o755);
    expect(makeHomePrivate(home)).toBe(true);
    expect(mode(home)).toBe(0o700);
    expect(existsSync(join(home, PRIVATE_MARKER))).toBe(true);
  });

  it.skipIf(!posix)("does it once: a later chmod of your own stays", () => {
    const home = folder();
    makeHomePrivate(home);
    chmodSync(home, 0o750);
    expect(makeHomePrivate(home)).toBe(false);
    expect(mode(home)).toBe(0o750);
  });

  it.skipIf(!posix)("leaves a linked folder alone", () => {
    const home = folder();
    chmodSync(home, 0o755);
    const link = join(root, "link");
    symlinkSync(home, link);
    expect(makeHomePrivate(link)).toBe(false);
    expect(mode(home)).toBe(0o755);
    expect(existsSync(join(home, PRIVATE_MARKER))).toBe(false);
  });
});
