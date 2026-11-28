import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";

/**
 * Node's active release keys (gpg-only-active-keys/pubring.kbx in nodejs/release-keys), pinned by
 * commit and hash so a change to that repository can't swap the keys. When Node adds a releaser,
 * a release fails with "not signed"; then take the newest commit of that file and its sha256.
 */
export const NODE_KEYRING = {
  url: "https://raw.githubusercontent.com/nodejs/release-keys/481637f813e912c4aa3622d7964ab426c97b8e8d/gpg-only-active-keys/pubring.kbx",
  sha256: "140f2ad5260fd62773b6243ce8e1d3009645d558f121b8262c55e383dc285932",
};

export type SumsCheck = "ok" | "no-gpgv" | "not-signed" | "mismatch" | "bad-keyring";

/** The hash lines, without the line-end and trailing-space differences a clearsigned copy can have. */
const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .join("\n");

type Run = (args: string[], input: string, cwd: string) => { status: number | null; stdout: string; missing: boolean };

const gpgv: Run = (args, input, cwd) => {
  const r = spawnSync("gpgv", args, { input, cwd, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", missing: (r.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT" };
};

/**
 * Whether `sums` (SHASUMS256.txt) has the same lines as `asc` (SHASUMS256.txt.asc, clearsigned), signed
 * by one of the keys in `keyring` — the check from https://github.com/nodejs/node#verifying-binaries.
 * `keyringFile` is where `keyring` was written; gpgv reads it from there.
 */
export function checkNodeSums(o: { sums: string; asc: string; keyring: Buffer; keyringFile: string; run?: Run; keyringSha256?: string }): SumsCheck {
  if (createHash("sha256").update(o.keyring).digest("hex") !== (o.keyringSha256 ?? NODE_KEYRING.sha256)) return "bad-keyring";
  // Relative, from the keyring's folder: gpgv reads "C:\..." as a URL ("invalid key resource URL").
  const r = (o.run ?? gpgv)(["--keyring", `./${basename(o.keyringFile)}`, "--output", "-"], o.asc, dirname(o.keyringFile));
  if (r.missing) return "no-gpgv";
  if (r.status !== 0) return "not-signed";
  return lines(r.stdout) === lines(o.sums) ? "ok" : "mismatch";
}
