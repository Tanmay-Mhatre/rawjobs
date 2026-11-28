import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/main";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "rawjobs-cli-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** A rawjobs command run in this process (main.ts, as index.ts runs it), with what it printed. */
const rawjobs = (...args: string[]) => rawjobsIn(dir, ...args);

async function rawjobsIn(home: string, ...args: string[]) {
  vi.stubEnv("RAWJOBS_HOME", home);
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
  vi.stubEnv("TELEGRAM_CHAT_ID", "");
  const out: string[] = [];
  const err: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  const error = vi.spyOn(console, "error").mockImplementation((...a) => void err.push(a.map(String).join(" ")));
  try {
    const code = await runCli(args);
    return { code, out: out.join("\n"), err: err.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

describe("the rawjobs process", () => {
  // One real start, the way the server and the scheduler run it (tsx on the TypeScript source): the
  // entry point, its exit code and its output. Everything else runs in-process, below.
  it("prints help and exits 0", () => {
    const r = spawnSync(process.execPath, [join(root, "node_modules/tsx/dist/cli.mjs"), join(root, "packages/cli/src/index.ts"), "--help"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, RAWJOBS_HOME: dir },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/RawJobs: self-hosted job radar/);
  });
});

describe("the rawjobs command", () => {
  it("prints help for help and no command", async () => {
    expect(await rawjobs()).toMatchObject({ code: 0, out: expect.stringMatching(/^RawJobs: self-hosted job radar/) });
    expect((await rawjobs("help")).code).toBe(0);
  });

  it("validates a good config (exit 0) and explains a broken one (exit 2)", async () => {
    const ok = await rawjobs("validate", "--config", join(root, "rawjobs.config.example.yaml"));
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/is valid/);

    const bad = join(dir, "bad.yaml");
    writeFileSync(bad, "profile:\n  min_score: lots\ncompanies: nope\n");
    const r = await rawjobs("validate", "--config", bad);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/min_score|companies/);
  });

  it("says so for an unknown command or option (exit 2)", async () => {
    const unknown = await rawjobs("frobnicate");
    expect(unknown.code).toBe(2);
    expect(unknown.err).toMatch(/Unknown command "frobnicate"/);
    expect((await rawjobs("validate", "--no-such-option")).code).toBe(2);
  });

  it("lists today's Pipeline tasks, and sends nothing without Telegram", async () => {
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    mkdirSync(join(dir, "profile"), { recursive: true });
    const entry = { status: "applied", followUp: day, updatedAt: d.toISOString(), snapshot: { title: "Head of <Product>", company: "Acme", url: "", location: "", score: 80 } };
    writeFileSync(join(dir, "profile", "tracking.json"), JSON.stringify({ app: "rawjobs", version: 1, updatedAt: "", state: { a: entry } }));
    const list = await rawjobs("today", "--data", join(dir, "data"));
    expect(list.code).toBe(0);
    expect(list.out).toContain("⏰ Follow up: Head of <Product> · Acme");
    const notify = await rawjobs("today", "--notify", "--data", join(dir, "data"));
    expect(notify.out).toMatch(/Telegram isn't set up yet/);
    expect(JSON.parse((await rawjobs("today", "status", "--data", join(dir, "data"))).out)).toMatchObject({ ok: true, installed: false, telegram: false, last: null });
  });

  it("answers the dashboard's status questions on a fresh folder", async () => {
    const fresh = mkdtempSync(join(tmpdir(), "rawjobs-cli-fresh-"));
    try {
      const inFresh = async (...args: string[]) => {
        const r = await rawjobsIn(fresh, ...args);
        expect(r.code, r.err).toBe(0);
        return r.out;
      };
      expect(JSON.parse(await inFresh("setup", "status"))).toMatchObject({ isPersonal: false, valid: false, hasData: false, hasResume: false });
      expect(JSON.parse(await inFresh("alerts", "telegram", "status"))).toMatchObject({ ok: true, connected: false, enabled: false });
      expect(await inFresh("directory", "status", "--data", join(fresh, "data"))).toMatch(/No company directory yet/);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  it("recognises careers links", async () => {
    const r = await rawjobs("detect", "https://jobs.lever.co/acme");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/ats: lever, slug: "acme"/);
  });
});
