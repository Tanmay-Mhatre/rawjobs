import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkNodeSums } from "./node-sums";

const sums = "abc  node-v24.0.0-linux-x64.tar.xz\n";
const keyring = Buffer.from("stand-in keyring");
const keyringSha256 = createHash("sha256").update(keyring).digest("hex");
/** A fake gpgv: its exit status and what it prints (the signed text). */
const gpgv =
  (status: number | null, stdout: string, missing = false) =>
  () => ({ status, stdout, missing });
const base = { sums, asc: "-----BEGIN PGP SIGNED MESSAGE-----", keyring, keyringFile: "pubring.kbx", keyringSha256 };

describe("checkNodeSums", () => {
  it("passes sums that gpgv verifies and that match the signed text", () => {
    expect(checkNodeSums({ ...base, run: gpgv(0, sums) })).toBe("ok");
    // gpgv on Linux can hand back the signed text with other line ends or without the last newline.
    expect(checkNodeSums({ ...base, run: gpgv(0, `${sums.trimEnd().replace("\n", "\r\n")}  `) })).toBe("ok");
  });

  it("names each failure", () => {
    expect(checkNodeSums({ ...base, run: gpgv(0, `${sums}evil  node-v24.0.0-win-x64.zip\n`) })).toBe("mismatch");
    expect(checkNodeSums({ ...base, run: gpgv(1, "") })).toBe("not-signed");
    expect(checkNodeSums({ ...base, run: gpgv(null, "", true) })).toBe("no-gpgv");
  });

  it("refuses a keyring that isn't the pinned one, before running gpgv", () => {
    expect(checkNodeSums({ ...base, keyringSha256: undefined, run: gpgv(0, sums) })).toBe("bad-keyring");
  });
});
