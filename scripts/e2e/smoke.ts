import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { seedHome } from "./seed-home";

/**
 * End-to-end smoke test: the real local server (from the sources, on the built dashboard) on a
 * seeded RawJobs folder, driven in Edge. It covers what unit tests can't: the page, the server and
 * the files on disk together.
 *
 *   pnpm build && pnpm e2e:smoke [--headed]
 *
 * Ports 4399 and 4400, never the installed app's 4317/4318. No network: every online source points
 * at a closed local port. Exits 1 when a case fails.
 */

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const headed = process.argv.includes("--headed");
const CLOSED = "http://127.0.0.1:9/";

type Server = { url: string; home: string; stop: () => Promise<void> };

async function startServer(port: number, empty: boolean): Promise<Server> {
  const home = mkdtempSync(join(tmpdir(), "rawjobs-e2e-"));
  seedHome(home, { empty });
  const env = { ...process.env, RAWJOBS_HOME: home, RAWJOBS_DIRECTORY_URL: CLOSED, RAWJOBS_JOBS_URL: CLOSED, RAWJOBS_CONTRIBUTE_URL: CLOSED, RAWJOBS_CONCEPTS_URL: CLOSED };
  const child: ChildProcess = spawn(process.execPath, [require.resolve("tsx/cli"), "packages/server/src/main.ts", "--port", String(port)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout?.on("data", (d) => (log += d));
  child.stderr?.on("data", (d) => (log += d));
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`The server stopped while starting:\n${log}`);
    try {
      if ((await fetch(`${url}/api/health`)).ok) {
        const exited = new Promise<void>((r) => child.once("exit", () => r()));
        const stop = () => {
          child.kill();
          return exited;
        };
        return { url, home, stop };
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error(`The server didn't answer on ${url} within 30 s:\n${log}`);
}

async function openPage(browser: Browser, url: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15_000);
  // The GitHub star prompt can open over any page; it isn't what these cases test.
  await page.addLocatorHandler(page.getByRole("button", { name: "Remind me later" }), (b) => b.click());
  await page.goto(url);
  return page;
}

/** The first visible element with this text (lists keep hidden copies for screen readers and menus). */
const visibleText = (page: Page, text: string) => page.getByText(text).locator("visible=true").first();

const expectVisible = (page: Page, role: Parameters<Page["getByRole"]>[0], name: string | RegExp) => page.getByRole(role, { name }).first().waitFor({ state: "visible" });

type Case = { name: string; run: (ctx: { browser: Browser; seeded: Server; fresh: Server }) => Promise<void> };

const CASES: Case[] = [
  {
    name: "first run: an empty folder opens the setup",
    run: async ({ browser, fresh }) => {
      const page = await openPage(browser, `${fresh.url}/`);
      await expectVisible(page, "heading", "Let's set up your job radar");
    },
  },
  {
    name: "Radar lists the seeded jobs and opens a job's details",
    run: async ({ browser, seeded }) => {
      const page = await openPage(browser, `${seeded.url}/#radar`);
      await page.getByRole("button", { name: "Senior Product Manager, Payments Platform" }).first().click();
      await expectVisible(page, "heading", "Senior Product Manager, Payments Platform");
    },
  },
  {
    name: "a saved job shows in Pipeline, survives a reload and is on disk",
    run: async ({ browser, seeded }) => {
      const page = await openPage(browser, `${seeded.url}/#radar`);
      const row = page
        .getByRole("listitem")
        .filter({ has: page.getByRole("button", { name: "Head of Product, Open Banking" }) })
        .first();
      await row.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByRole("button", { name: "Pipeline", exact: true }).click();
      await visibleText(page, "Head of Product, Open Banking").waitFor();
      await page.reload();
      await visibleText(page, "Head of Product, Open Banking").waitFor();
      const tracking = readFileSync(join(seeded.home, "profile/tracking.json"), "utf8");
      const entry = (JSON.parse(tracking) as { state?: Record<string, { status?: string }> }).state?.["lever:tidewave:4105"];
      if (entry?.status !== "saved") throw new Error(`profile/tracking.json doesn't have the job as saved: ${JSON.stringify(entry)}`);
    },
  },
  {
    name: "Companies lists the seeded companies",
    run: async ({ browser, seeded }) => {
      const page = await openPage(browser, `${seeded.url}/#companies`);
      await visibleText(page, "Northwind Payments").waitFor();
    },
  },
  {
    name: "Settings → Updates shows this copy's version",
    run: async ({ browser, seeded }) => {
      const version = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
      const page = await openPage(browser, `${seeded.url}/#settings/updates`);
      await visibleText(page, `RawJobs ${version}`).waitFor();
    },
  },
];

const deadline = setTimeout(() => {
  console.error("e2e: gave up after 3 minutes");
  process.exit(1);
}, 180_000);

const servers: Server[] = [];
let browser: Browser | undefined;
let failures = 0;
try {
  const [seeded, fresh] = await Promise.all([startServer(4399, false), startServer(4400, true)]);
  servers.push(seeded, fresh);
  browser = await chromium.launch({ channel: "msedge", headless: !headed });
  for (const c of CASES) {
    const started = Date.now();
    try {
      await c.run({ browser, seeded, fresh });
      console.log(`ok   ${c.name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    } catch (err) {
      failures++;
      console.log(`FAIL ${c.name}\n     ${(err as Error).message.split("\n")[0]}`);
    }
  }
} finally {
  await browser?.close();
  for (const s of servers) {
    await s.stop();
    try {
      rmSync(s.home, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      // Windows can hold a file for a moment after the server exits; it's a temp folder.
    }
  }
  clearTimeout(deadline);
}
console.log(failures ? `e2e: ${failures} of ${CASES.length} failed` : `e2e: all ${CASES.length} passed`);
process.exit(failures ? 1 : 0);
