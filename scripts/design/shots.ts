/**
 * Deterministic screenshots (and an optional axe accessibility pass) of every dashboard screen,
 * with invented demo data only. Used for before/after design reviews and README images.
 *
 *   pnpm design:shots [--out <dir>] [--themes light,dark,light-hc,dark-hc] [--viewports 1280,375]
 *                     [--only radar,drawer,...] [--axe] [--list]
 *
 * How it stays safe and stable:
 * - Vite is started here with its own config (no localApi plugin, so no CLI, no real data/ folder):
 *   the public dir is a temp folder holding demo jobs.json / meta.json / … from ./demo-data.ts.
 * - Every /api/* call is answered by Playwright with demo JSON; any request off this server is blocked.
 * - The page clock is frozen at demo-data's NOW, animations are off, locale and time zone are fixed.
 * - Each capture gets a fresh browser context, so nothing carries over between screens.
 *
 * Uses the system Edge (playwright-core, channel "msedge"); no Playwright browser download.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright-core";
import * as demo from "./demo-data";

const repoRoot = resolve(import.meta.dirname, "../..");
const webDir = resolve(repoRoot, "apps/web");
const require = createRequire(import.meta.url);

// ---------- options ----------

const THEMES = {
  light: { theme: "light", contrast: "system", colorScheme: "light" },
  dark: { theme: "dark", contrast: "system", colorScheme: "dark" },
  "light-hc": { theme: "light", contrast: "more", colorScheme: "light" },
  "dark-hc": { theme: "dark", contrast: "more", colorScheme: "dark" },
} as const;
type ThemeId = keyof typeof THEMES;

const { values: args } = parseArgs({
  options: {
    out: { type: "string" },
    themes: { type: "string", default: "light,dark" },
    viewports: { type: "string", default: "1280,375" },
    only: { type: "string" },
    axe: { type: "boolean", default: false },
    list: { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
  },
});

/** Laptop screens are short: 760px tall is the case the Radar must fit (Apply in view, no page scroll). */
const HEIGHTS: Record<number, number> = { 1280: 760, 1100: 760, 390: 844, 375: 812 };
const themes = args.themes
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean) as ThemeId[];
for (const t of themes) if (!(t in THEMES)) fail(`Unknown theme "${t}". Use: ${Object.keys(THEMES).join(", ")}`);
const widths = args.viewports
  .split(",")
  .map((w) => Number(w.trim()))
  .filter((w) => w > 0);
if (!widths.length) fail("No viewports.");

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

// ---------- screens ----------

/** demo: set up, with scans · empty: set up, no scan yet · fresh: no config yet (first run). */
type Scenario = "demo" | "empty" | "fresh";

type Screen = {
  id: string;
  what: string;
  scenario: Scenario;
  /** A page other than the app (e.g. "design.html", the component gallery). */
  path?: string;
  hash: string;
  /** localStorage on top of the scenario's (values are JSON-encoded, like the app's own save()). */
  storage?: Record<string, unknown>;
  /** Only at these widths (default: every --viewports width). */
  widths?: number[];
  /** Text that must be on the page before the shot. */
  ready?: string;
  act?: (page: Page) => Promise<void>;
  /** Modal screens: the viewport only (a full-page shot would show the page running on below the fixed dialog). */
  viewportOnly?: boolean;
  /** What GET /api/health answers, given the ms since the page first asked; without it, health isn't answered. */
  health?: (ms: number) => Record<string, unknown>;
};

const strong = demo.STRONG_JOB.title;
const DRAFT_KEY = "rawjobs.setupDraft.v1";
const WELCOME_KEY = "rawjobs.welcomeSeen";

const clickView = (name: RegExp) => async (page: Page) => {
  await page.getByRole("tab", { name }).first().click();
};

const SCREENS: Screen[] = [
  { id: "radar", what: "Radar, All view (default)", scenario: "demo", hash: "#radar", ready: strong },
  {
    id: "radar-keys",
    what: "Radar after J/K presses: after every press the current row (aria-current) is the focused one (Feed: J/K move focus)",
    scenario: "demo",
    hash: "#radar",
    ready: strong,
    widths: [1280],
    act: async (page) => {
      await page.locator("li.rj-row [data-job-link]").nth(1).click();
      for (const [i, key] of ["j", "j", "j", "k", "j", "j", "k", "k"].entries()) {
        await page.keyboard.press(key);
        // A string, so this file needs no DOM types (tsconfig.scripts.json).
        const ok = await page.evaluate<boolean>(`(() => { const c = document.querySelector('li.rj-row[aria-current="true"] [data-job-link]'); return !!c && document.activeElement === c; })()`);
        if (!ok) throw new Error(`after press ${i + 1} (${key.toUpperCase()}) the focused element isn't the current row's title`);
      }
    },
  },
  { id: "radar-new", what: "Radar, New view (views bar)", scenario: "demo", hash: "#radar", ready: strong, act: clickView(/^New\b/) },
  { id: "radar-strong", what: "Radar, Strong matches view (views bar)", scenario: "demo", hash: "#radar", ready: strong, act: clickView(/^Strong\b/) },
  {
    id: "radar-fit",
    what: "Radar on a laptop (760px tall): the page doesn't scroll, the feed starts high, Apply is in view",
    scenario: "demo",
    hash: "#radar",
    ready: strong,
    widths: [1280, 1100],
    act: async (page) => {
      const m = await page.evaluate<{ scroll: number; feedTop: number; applyBottom: number; height: number }>(`(() => {
        const apply = [...document.querySelectorAll("a, button")].find((e) => /^(Apply on|Open careers page)/.test(e.textContent.trim()) && e.offsetParent);
        return {
          scroll: document.scrollingElement.scrollHeight - innerHeight,
          feedTop: Math.round(document.querySelector('section[aria-label="Jobs for you"]').getBoundingClientRect().top),
          applyBottom: apply ? Math.round(apply.getBoundingClientRect().bottom) : 99999,
          height: innerHeight,
        };
      })()`);
      const problems = [
        m.scroll > 1 && `the page scrolls by ${m.scroll}px`,
        m.feedTop > 300 && `the feed starts at ${m.feedTop}px (over 300)`,
        m.applyBottom > m.height && `Apply ends at ${m.applyBottom}px, below the ${m.height}px window`,
      ].filter(Boolean);
      if (problems.length) throw new Error(problems.join("; "));
    },
  },
  {
    id: "radar-drawer-other",
    viewportOnly: true,
    what: "Phone job drawer for a company that isn't yours: no footer button cuts its label (Add company)",
    scenario: "demo",
    hash: "#radar",
    widths: [375],
    ready: strong,
    act: async (page) => {
      await page
        .locator("li.rj-row")
        .filter({ hasNot: page.locator(".rj-star") })
        .first()
        .locator("[data-job-link]")
        .click();
      await page.getByRole("dialog").waitFor();
      const cut = await page.evaluate<string[]>(
        `[...document.querySelectorAll("dialog .rj-drawer__foot a, dialog .rj-drawer__foot button")].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim() + " (" + b.scrollWidth + "px in " + b.clientWidth + "px)")`,
      );
      if (cut.length) throw new Error(`footer labels cut off: ${cut.join(", ")}`);
    },
  },
  {
    id: "radar-drawer",
    viewportOnly: true,
    what: "Radar on a phone: tap the strongest job, the drawer opens (wide screens show it inline)",
    scenario: "demo",
    hash: "#radar",
    widths: [375, 390],
    ready: strong,
    act: async (page) => {
      await page.getByRole("button", { name: strong, exact: true }).first().click();
      await page.getByRole("dialog").waitFor();
    },
  },
  {
    id: "radar-not-interested-short",
    viewportOnly: true,
    what: "Radar right after X on the first row: one line with Why? and Undo",
    scenario: "demo",
    hash: "#radar",
    ready: strong,
    act: async (page) => {
      await page.locator("li.rj-row").first().getByRole("button", { name: "Not interested" }).click();
      await page.getByRole("button", { name: "Why?" }).waitFor();
    },
  },
  {
    id: "radar-not-interested",
    viewportOnly: true,
    what: "Radar after X on the first row, Why? and Too senior: the reasons toast offers the matching rule",
    scenario: "demo",
    hash: "#radar",
    ready: strong,
    act: async (page) => {
      await page.locator("li.rj-row").first().getByRole("button", { name: "Not interested" }).click();
      await page.getByRole("button", { name: "Why?" }).click();
      await page.getByRole("button", { name: "Too senior" }).click();
      await page.getByText(/^Hide all /).waitFor();
    },
  },
  {
    id: "radar-drawer-not-interested",
    viewportOnly: true,
    what: "Phone job drawer after Not interested and Location: the reasons sit right under Your status",
    scenario: "demo",
    hash: "#radar",
    widths: [375],
    ready: strong,
    act: async (page) => {
      await page.getByRole("button", { name: strong, exact: true }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Not interested" }).click();
      await dialog.getByRole("button", { name: "Location" }).click();
      await dialog.getByRole("button", { name: "Location" }).scrollIntoViewIfNeeded();
    },
  },
  {
    id: "drawer",
    viewportOnly: true,
    what: "Job drawer on the strongest job (opened from the Pipeline)",
    scenario: "demo",
    hash: "#pipeline",
    ready: strong,
    act: async (page) => {
      await page.getByRole("button", { name: strong, exact: true }).first().click();
      await page.getByRole("dialog").waitFor();
      // The description loads when the job opens.
      await page.getByText("About the team").first().waitFor();
    },
  },
  { id: "pipeline", what: "Pipeline", scenario: "demo", hash: "#pipeline", ready: strong },
  { id: "companies-mine", what: "Companies, My companies tab", scenario: "demo", hash: "#companies", storage: { "rawjobs.companiesTab": "mine" }, ready: "Larkspur Labs" },
  {
    id: "companies-suggestions",
    what: "Companies, Suggestions tab",
    scenario: "demo",
    hash: "#companies",
    storage: { "rawjobs.companiesTab": "suggestions" },
    ready: "Copperkettle Pay",
  },
  { id: "companies-browse", what: "Companies, Browse all tab", scenario: "demo", hash: "#companies", storage: { "rawjobs.companiesTab": "browse" }, ready: "Halcyon Clearing" },
  { id: "settings", what: "Settings (full page)", scenario: "demo", hash: "#settings", ready: "demo_radar_bot" },
  {
    id: "shortcuts",
    viewportOnly: true,
    what: "Keyboard shortcuts help (press ?)",
    scenario: "demo",
    hash: "#radar",
    ready: strong,
    act: async (page) => {
      await page.keyboard.press("?");
      await page.getByRole("dialog").waitFor();
    },
  },
  { id: "components", what: "Component gallery (design.html, dev only)", scenario: "demo", path: "design.html", hash: "", ready: "Score breakdown" },
  {
    id: "radar-scheduled-scan",
    viewportOnly: true,
    what: "Radar while a scheduled scan runs: the Scan button says so",
    scenario: "demo",
    hash: "#radar",
    widths: [1280],
    health: () => ({ ok: true, background: true, dataVersion: demo.META.generatedAt }),
    ready: "Scheduled scan running…",
  },
  {
    id: "radar-scheduled-done",
    viewportOnly: true,
    what: "Radar right after a scheduled scan: its new jobs are on screen and a toast says how many",
    scenario: "demo",
    hash: "#radar",
    widths: [1280],
    // Running when the page opens (several checks ask then), done by the scan watcher's next look.
    health: (ms) => (ms < 3000 ? { ok: true, background: true, dataVersion: demo.META.generatedAt } : { ok: true, background: false, dataVersion: "a newer scan" }),
    ready: "Scheduled scan done",
  },
  { id: "radar-empty", what: "Radar before the first scan (set up, no jobs.json)", scenario: "empty", hash: "#radar" },
  { id: "radar-not-set-up", what: "Radar with no config yet (Welcome already seen)", scenario: "fresh", hash: "#radar", storage: { [WELCOME_KEY]: true } },
  { id: "setup-0-welcome", what: "Setup wizard: Welcome (first visit)", scenario: "fresh", hash: "#setup" },
  ...(["resume", "roles", "locations", "topics", "review"] as const).map(
    (name, i): Screen => ({
      id: `setup-${i + 1}-${name}`,
      what: `Setup wizard step ${i + 1}: ${name} (demo answers filled in)`,
      scenario: "fresh",
      hash: `#setup/${i + 1}`,
      storage: { [WELCOME_KEY]: true, [DRAFT_KEY]: demo.demoDraft(5) },
    }),
  ),
];

if (args.list) {
  for (const s of SCREENS) console.log(`${s.id.padEnd(24)} ${s.what}`);
  process.exit(0);
}

const only = args.only ? new Set(args.only.split(",").map((s) => s.trim())) : null;
if (only) for (const id of only) if (!SCREENS.some((s) => s.id === id || s.id.startsWith(`${id}-`))) fail(`Unknown screen "${id}". See --list.`);
const screens = only ? SCREENS.filter((s) => only.has(s.id) || [...only].some((o) => s.id.startsWith(`${o}-`))) : SCREENS;

// ---------- demo files and API ----------

function writePublicDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rawjobs-shots-"));
  const put = (name: string, value: unknown) => {
    mkdirSync(resolve(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), JSON.stringify(value));
  };
  put("jobs.json", demo.JOBS);
  put("jobs-other.json", demo.JOBS_OTHER);
  put("meta.json", demo.META);
  put("discover.json", demo.DISCOVER);
  put("descriptions.json", demo.DESCRIPTIONS);
  put("catalog/directory.json", demo.DIRECTORY);
  put("catalog/additions.json", { companies: [] });
  return dir;
}

const DATA_FILES = /\/(jobs|jobs-other|meta|discover|descriptions)\.json(\?|$)/;
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Requests the mock didn't know (so missing fixtures show up in the log). */
const unmocked = new Set<string>();

function api(scenario: Scenario, health?: Screen["health"]) {
  let firstAsked: number | undefined;
  return async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const m = req.method();
    const configured = scenario !== "fresh";
    if (path === "/api/health" && m === "GET" && health) return json(route, health(Date.now() - (firstAsked ??= Date.now())));
    if (path === "/api/setup" && m === "GET") return json(route, configured ? { ...demo.SETUP_STATUS, hasData: scenario === "demo" } : demo.SETUP_STATUS_FRESH);
    if (path === "/api/setup/config" && m === "POST") return json(route, { ok: true, path: demo.SETUP_STATUS.configPath });
    if (path === "/api/setup/resume" && m === "GET") return json(route, { path: "profile/resume.md", text: demo.RESUME_TEXT, updatedAt: demo.NOW.toISOString() });
    if (path === "/api/setup/resume" && m === "POST") return json(route, { ok: true, path: "profile/resume.md" });
    if (path === "/api/setup/check" && m === "POST") return json(route, []);
    if (path === "/api/directory" && m === "GET") return json(route, demo.DIRECTORY_STATUS);
    if (path === "/api/directory/update" && m === "POST") return json(route, { updated: false, message: "Already up to date.", shared: 0 });
    if (path === "/api/companies/suggest" && m === "POST") return json(route, demo.SUGGESTIONS);
    if (path === "/api/scan/plan" && m === "GET") return json(route, demo.SCAN_PLAN);
    if (path === "/api/alerts/telegram" && m === "GET") return json(route, demo.TELEGRAM_STATUS);
    if (path.startsWith("/api/alerts/telegram/") && m === "POST") return json(route, { ok: true });
    if (path === "/api/schedule") return json(route, demo.SCHEDULE_STATUS);
    if (path === "/api/schedule/run" && m === "POST") return json(route, demo.SCHEDULE_STATUS);
    if (path === "/api/check" && m === "POST") return json(route, demo.SCAN_DONE);
    if ((path === "/api/run/stop" || path === "/api/run/notify") && m === "POST") return json(route, { ok: false });
    if (path === "/api/run" && m === "POST") return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: `${JSON.stringify(demo.SCAN_DONE)}\n` });
    unmocked.add(`${m} ${path}`);
    return route.fulfill({ status: 404, body: "" });
  };
}

// ---------- vite ----------

type ViteServer = { listen(): Promise<unknown>; close(): Promise<void> };
type ViteModule = { createServer(config: Record<string, unknown>): Promise<ViteServer> };
type PluginFactory = { default: (opts?: unknown) => unknown };

/** vite and its plugins as apps/web has them installed. */
async function fromWeb<T>(name: string): Promise<T> {
  const path = createRequire(join(webDir, "package.json")).resolve(name);
  return (await import(pathToFileURL(path).href)) as T;
}

function freePort(): Promise<number> {
  return new Promise((done, failed) => {
    const s = createNetServer();
    s.once("error", failed);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => done(port));
    });
  });
}

async function startVite(publicDir: string, cacheDir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const vite = await fromWeb<ViteModule>("vite");
  const react = await fromWeb<PluginFactory>("@vitejs/plugin-react");
  const tailwind = await fromWeb<PluginFactory>("@tailwindcss/vite");
  const port = await freePort();
  const server = await vite.createServer({
    configFile: false,
    root: webDir,
    base: "./",
    mode: "development",
    publicDir,
    cacheDir,
    plugins: [react.default(), tailwind.default()],
    server: { port, strictPort: true, host: "127.0.0.1", hmr: false },
    logLevel: "warn",
    clearScreen: false,
  });
  await server.listen();
  return { url: `http://127.0.0.1:${port}/`, close: () => server.close() };
}

// ---------- capture ----------

const NO_MOTION = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";

function initScript(storage: Record<string, string>) {
  // Runs in the page before any of its scripts (so before index.html's theme script).
  return `(() => {
    try {
      const s = ${JSON.stringify(storage)};
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    } catch {}
  })();`;
}

function storageFor(screen: Screen, theme: ThemeId): Record<string, string> {
  const t = THEMES[theme];
  const base: Record<string, unknown> = {
    // Already migrated, so the pre-rename copy step never runs.
    "rawjobs.migrated.v1": 1,
  };
  if (screen.scenario === "demo") base["rawjobs.state.v1"] = demo.USER_STATE;
  if (screen.scenario !== "fresh") base[WELCOME_KEY] = true;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...base, ...screen.storage })) out[k] = JSON.stringify(v);
  // Theme keys are plain strings (index.html reads them raw).
  out["rawjobs.theme"] = t.theme;
  out["rawjobs.contrast"] = t.contrast;
  return out;
}

type AxeResult = { id: string; impact: string | null; help: string; helpUrl: string; nodes: { target: unknown[] }[] };
type AxeEntry = { screen: string; theme: ThemeId; width: number; violations: AxeResult[] };

async function capture(browser: Browser, baseUrl: string, screen: Screen, theme: ThemeId, width: number, outDir: string, runAxe: boolean): Promise<AxeEntry | null> {
  const t = THEMES[theme];
  const context: BrowserContext = await browser.newContext({
    viewport: { width, height: HEIGHTS[width] ?? 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    colorScheme: t.colorScheme,
    contrast: t.contrast === "more" ? "more" : "no-preference",
    reducedMotion: "reduce",
    locale: "en-GB",
    timezoneId: "Europe/London",
    serviceWorkers: "block",
  });
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(demo.NOW);
    await page.emulateMedia({ colorScheme: t.colorScheme, contrast: t.contrast === "more" ? "more" : "no-preference", reducedMotion: "reduce" });
    // Nothing leaves this machine: only the demo server answers.
    await page.route(
      (url) => !url.href.startsWith(baseUrl),
      (route) => route.abort(),
    );
    await page.route(/\/api\//, api(screen.scenario, screen.health));
    if (screen.scenario !== "demo") await page.route(DATA_FILES, (route) => route.fulfill({ status: 404, body: "" }));
    await page.addInitScript(initScript(storageFor(screen, theme)));
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${baseUrl}${screen.path ?? ""}${screen.hash}`, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: NO_MOTION });
    await page
      .getByText("Loading…", { exact: true })
      .waitFor({ state: "detached", timeout: 15_000 })
      .catch(() => {});
    if (screen.ready) await page.getByText(screen.ready).filter({ visible: true }).first().waitFor({ timeout: 15_000 });
    if (screen.act) await screen.act(page);
    // Let delayed requests (suggestions wait 600 ms) and their renders finish.
    await page.waitForTimeout(900);
    await page.waitForLoadState("networkidle");
    await page.evaluate("document.fonts.ready.then(() => true)");
    // Skeletons and spinners: give them a moment to resolve.
    await page.waitForFunction('!document.querySelector(".animate-spin, .animate-pulse")', undefined, { timeout: 5_000 }).catch(() => {});
    if (errors.length) console.warn(`  page errors on ${screen.id}: ${errors.join(" | ")}`);
    // design/README.md: the page never scrolls sideways (tabs, boards and tables scroll inside themselves).
    const sideways = await page.evaluate<number>("document.documentElement.scrollWidth - document.documentElement.clientWidth");
    if (sideways > 1) throw new Error(`the page scrolls sideways by ${sideways}px`);

    const file = join(outDir, `${screen.id}-${theme}-${width}.png`);
    await page.screenshot({ path: file, fullPage: !screen.viewportOnly, animations: "disabled", caret: "hide" });

    if (!runAxe) return null;
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const violations = (await page.evaluate(`axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }).then((r) => r.violations)`)) as AxeResult[];
    return { screen: screen.id, theme, width, violations };
  } finally {
    await context.close();
  }
}

// ---------- axe report ----------

function writeAxeReport(outDir: string, entries: AxeEntry[]): number {
  writeFileSync(join(outDir, "axe-report.json"), JSON.stringify(entries, null, 2));
  const total = entries.reduce((n, e) => n + e.violations.length, 0);
  const lines: string[] = ["# Axe accessibility report", "", `Rules: wcag2a, wcag2aa, wcag21a, wcag21aa, best-practice. ${entries.length} screen/theme/width runs, ${total} violations.`, ""];

  const byTheme = new Map<ThemeId, Map<string, { impact: string | null; help: string; nodes: number; screens: Set<string> }>>();
  for (const e of entries) {
    const m = byTheme.get(e.theme) ?? new Map();
    byTheme.set(e.theme, m);
    for (const v of e.violations) {
      const row = m.get(v.id) ?? { impact: v.impact, help: v.help, nodes: 0, screens: new Set<string>() };
      row.nodes += v.nodes.length;
      row.screens.add(`${e.screen}@${e.width}`);
      m.set(v.id, row);
    }
  }
  lines.push("## Summary by theme", "");
  for (const [theme, m] of byTheme) {
    lines.push(`### ${theme}`, "");
    if (!m.size) {
      lines.push("No violations.", "");
      continue;
    }
    lines.push("| Rule | Impact | Nodes | Screens | Help |", "| --- | --- | ---: | ---: | --- |");
    for (const [id, r] of [...m].sort((a, b) => b[1].nodes - a[1].nodes)) lines.push(`| ${id} | ${r.impact ?? ""} | ${r.nodes} | ${r.screens.size} | ${r.help} |`);
    lines.push("");
  }
  lines.push("## Per screen", "");
  for (const e of entries) {
    lines.push(`### ${e.screen} · ${e.theme} · ${e.width}`, "");
    if (!e.violations.length) {
      lines.push("No violations.", "");
      continue;
    }
    for (const v of e.violations) {
      const targets = v.nodes.slice(0, 4).map((n) => `\`${n.target.map(String).join(" ")}\``);
      lines.push(`- **${v.id}** (${v.impact ?? "n/a"}), ${v.nodes.length} node${v.nodes.length === 1 ? "" : "s"}: ${v.help}`);
      lines.push(`  - ${targets.join(", ")}${v.nodes.length > 4 ? ", …" : ""}`);
    }
    lines.push("");
  }
  writeFileSync(join(outDir, "axe-report.md"), lines.join("\n"));
  return total;
}

// ---------- main ----------

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = resolve(repoRoot, args.out ?? join(".design-shots", stamp));
  mkdirSync(outDir, { recursive: true });

  const publicDir = writePublicDir();
  const cacheDir = mkdtempSync(join(tmpdir(), "rawjobs-shots-vite-"));
  const server = await startVite(publicDir, cacheDir);
  const browser = await chromium.launch({ channel: "msedge", headless: !args.headed });
  const axe: AxeEntry[] = [];
  let shots = 0;
  let failures = 0;
  try {
    // Warm up: the first page load makes Vite pre-bundle dependencies (and may reload once).
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.route(/\/api\//, api("demo"));
      await page.goto(server.url, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      await page.reload({ waitUntil: "networkidle" });
      await ctx.close();
    }
    for (const screen of screens) {
      const ws = widths.filter((w) => !screen.widths || screen.widths.includes(w));
      for (const theme of themes) {
        for (const width of ws) {
          const name = `${screen.id}-${theme}-${width}`;
          const started = Date.now();
          // axe once per screen and theme, at the widest captured width.
          const runAxe = args.axe && width === Math.max(...ws);
          try {
            const result = await capture(browser, server.url, screen, theme, width, outDir, runAxe);
            shots++;
            if (result) axe.push(result);
            const axeNote = result ? ` · axe ${result.violations.length} violation${result.violations.length === 1 ? "" : "s"}` : "";
            console.log(`ok   ${name.padEnd(36)} ${((Date.now() - started) / 1000).toFixed(1)}s${axeNote}`);
          } catch (err) {
            failures++;
            console.log(`FAIL ${name.padEnd(36)} ${(err as Error).message.split("\n")[0]}`);
          }
        }
      }
    }
  } finally {
    await browser.close();
    await server.close();
    rmSync(publicDir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  }

  if (unmocked.size) console.warn(`Unmocked API calls (answered 404): ${[...unmocked].join(", ")}`);
  let violations = 0;
  if (args.axe) {
    violations = writeAxeReport(outDir, axe);
    console.log(`axe: ${violations} violation${violations === 1 ? "" : "s"} across ${axe.length} runs (axe-report.md)`);
  }
  console.log(`${shots} screenshot${shots === 1 ? "" : "s"}${failures ? `, ${failures} failed` : ""} in ${relative(process.cwd(), outDir) || outDir}`);
  if (failures || violations) process.exitCode = 1;
}

await main();
