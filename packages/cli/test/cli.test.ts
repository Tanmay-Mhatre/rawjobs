import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "rawjobs-cli-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The real CLI, the way the server and the scheduler start it (tsx on the TypeScript source). */
function rawjobs(...args: string[]) {
  const r = spawnSync(process.execPath, [join(root, "node_modules/tsx/dist/cli.mjs"), join(root, "packages/cli/src/index.ts"), ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, RAWJOBS_HOME: dir },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe("the rawjobs command", () => {
  it("prints help and exits 0", () => {
    const r = rawjobs("--help");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/RawJobs: self-hosted job radar/);
  });

  it("validates a good config (exit 0) and explains a broken one (exit 2)", () => {
    const ok = rawjobs("validate", "--config", join(root, "rawjobs.config.example.yaml"));
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/is valid/);

    const bad = join(dir, "bad.yaml");
    writeFileSync(bad, "profile:\n  min_score: lots\ncompanies: nope\n");
    const r = rawjobs("validate", "--config", bad);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/min_score|companies/);
  });

  it("says so for an unknown command or option (exit 2)", () => {
    const unknown = rawjobs("frobnicate");
    expect(unknown.code).toBe(2);
    expect(unknown.err).toMatch(/Unknown command "frobnicate"/);
    expect(rawjobs("validate", "--no-such-option").code).toBe(2);
  });

  it("recognises careers links", () => {
    const r = rawjobs("detect", "https://jobs.lever.co/acme");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/ats: lever, slug: "acme"/);
  });
});
