// Builds the RawJobs marketing site into apps/site/dist (served by Cloudflare, see wrangler.toml).
//
//   pnpm site:build                     # https://www.rawjobs.workers.dev
//   SITE_URL=https://example.com pnpm site:build
//
// The page's numbers (companies, jobs, dates) come from the shared directory's latest release at
// build time; the Site workflow rebuilds weekly, after the directory does. Offline, the last known
// numbers are used and the build says so.
//
// The page uses the app's own design files, so the site and the dashboard never drift:
// tokens and fonts from apps/web/src/design, components from design/components/bundle.css.
// No dependencies: plain Node, so it runs in CI without installing the workspace.
import { copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const SITE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SITE, "../..");
const DS = join(ROOT, "apps/web/src/design");
const DIST = join(SITE, "dist");

const SITE_URL = (process.env.SITE_URL || "https://www.rawjobs.workers.dev").replace(/\/$/, "");
// Cloudflare Web Analytics site token (public, cookieless). Unset: no analytics script.
const ANALYTICS_TOKEN = (process.env.CF_ANALYTICS_TOKEN || "").trim();
const DATA_REPO = process.env.DATA_REPO || "Tanmay-Mhatre/rawjobs-directory";

// The 23 hiring systems with a connector in packages/core (README, "Adding companies").
const SYSTEMS = [
  "Greenhouse", "Lever", "Ashby", "SmartRecruiters", "Workday", "Workable", "Recruitee", "Personio",
  "BambooHR", "Breezy HR", "Teamtailor", "Pinpoint", "Rippling", "HiBob", "Freshteam", "Comeet",
  "Oracle Recruiting", "SAP SuccessFactors", "Taleo", "iCIMS", "Jobvite", "JazzHR", "Zoho Recruit",
];

const read = (p) => readFileSync(p, "utf8");

// ---------- numbers from the directory's releases ----------
// Last known values, used only when GitHub can't be reached (and the build log says so).
const FALLBACK = { companies: 47737, liveBoards: 37004, indexed: 16997, builtAt: "2026-10-11T12:22:00Z", feedJobs: 1338418, feedAt: "2026-10-10T10:42:06Z" };

async function getJson(url) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Directory companies whose job board answered at the last check (status "live"; the rest are dormant). */
async function liveBoardCount(url) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const d = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"));
  const list = Array.isArray(d) ? d : (d.companies ?? []);
  return list.filter((c) => c.status === "live").length;
}

async function directoryNumbers() {
  const base = `https://github.com/${DATA_REPO}/releases`;
  try {
    const [dir, feed, liveBoards] = await Promise.all([
      getJson(`${base}/latest/download/manifest.json`),
      getJson(`${base}/download/jobs/jobs-manifest.json`),
      liveBoardCount(`${base}/latest/download/directory.json.gz`),
    ]);
    const feedJobs = Object.values(feed.shards ?? {}).reduce((sum, s) => sum + (s.jobs ?? 0), 0);
    if (!(dir.companies > 0 && dir.indexed > 0 && feedJobs > 0 && liveBoards > 0)) throw new Error("manifest without counts");
    return { companies: dir.companies, liveBoards, indexed: dir.indexed, builtAt: dir.generated_at, feedJobs, feedAt: feed.generated_at, live: true };
  } catch (err) {
    console.warn(`Directory numbers: ${err.message}. Using the last known ones.`);
    return { ...FALLBACK, live: false };
  }
}

const n = await directoryNumbers();
const int = (x) => x.toLocaleString("en-US");
const day = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
/** 21,485 -> "21,000+"; 1,338,418 -> "1.3M+": numbers in prose round down, so they stay true for a while. */
const atLeast = (x) => (x >= 1e6 ? `${Math.floor(x / 1e5) / 10}M+` : `${int(Math.floor(x / 1000) * 1000)}+`);
const NUMBERS = {
  __COMPANIES__: int(n.companies),
  __COMPANIES_ROUND__: atLeast(n.companies),
  __LIVE_ROUND__: atLeast(n.liveBoards),
  __INDEXED__: int(n.indexed),
  __FEED_JOBS__: atLeast(n.feedJobs),
  __DIR_DATE__: day(n.builtAt),
  __FEED_DATE__: day(n.feedAt),
};

// Fonts are served as files next to the page instead of the app's relative ./fonts/ paths.
let tokens = read(join(DS, "tokens.css")).replace(/url\('\.\/fonts\//g, "url('/fonts/");
// Follow the OS when no theme is set yet (and when scripts are off): reuse the theme blocks.
const block = (id) => {
  const m = tokens.match(new RegExp(`\\[data-theme="${id}"\\] \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`tokens.css: ${id} theme block not found`);
  return m[1];
};
const [dark, lightHc, darkHc] = ["dark", "light-hc", "dark-hc"].map(block);
tokens = tokens
  .replace('[data-theme="dark"] {', '[data-theme="dark"] { color-scheme: dark;')
  .replace('[data-theme="dark-hc"] {', '[data-theme="dark-hc"] { color-scheme: dark;');
tokens += `
@media (prefers-color-scheme: dark) { :root:not([data-theme]) {${dark}\n  color-scheme: dark;\n} }
@media (prefers-contrast: more) { :root:not([data-theme]) {${lightHc}\n} }
@media (prefers-contrast: more) and (prefers-color-scheme: dark) { :root:not([data-theme]) {${darkHc}\n  color-scheme: dark;\n} }
`;

const bundle = read(join(ROOT, "design/components/bundle.css"));
// The letters follow the text color; the cursor is brand-signal, the same orange in every theme.
const wordmark = read(join(DS, "logos/rawjobs-wordmark-ink.svg"))
  .trim()
  .replace('fill="#151412"', 'fill="currentColor"')
  .replace('fill="#ff5a1f"', 'style="fill: var(--brand-signal)"')
  .replace('role="img" aria-label="rawjobs"', 'aria-hidden="true" focusable="false"');
const ats = SYSTEMS.map((s) => `<li class="ats">${s}</li>`).join("");
// The scoring demo's rules, inlined as a plain script (packages/core/test/site-demo.test.ts checks them).
const score = read(join(SITE, "src/score.js")).replace(/^export /gm, "");
const analytics = ANALYTICS_TOKEN
  ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${JSON.stringify({ token: ANALYTICS_TOKEN })}'></script>`
  : "";

const page = (name) => {
  let out = read(join(SITE, "src", name))
    .replace("/*__TOKENS__*/", () => tokens)
    .replace("/*__BUNDLE__*/", () => bundle)
    .replace("/*__SCORE__*/", () => score)
    .replaceAll("__WORDMARK__", () => wordmark)
    .replace("__ATS__", () => ats)
    .replace("<!--__ANALYTICS__-->", () => analytics)
    .replaceAll("__SITE_URL__", () => SITE_URL);
  for (const [key, value] of Object.entries(NUMBERS)) out = out.replaceAll(key, () => value);
  const left = out.match(/__[A-Z_]+__/);
  if (left) throw new Error(`Unfilled placeholder ${left[0]} in src/${name}`);
  return out;
};
const html = page("index.html");

rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, "fonts"), { recursive: true });
writeFileSync(join(DIST, "index.html"), html);
// Same tokens and theme script as the home page, so it follows all four themes.
writeFileSync(join(DIST, "404.html"), page("404.html"));
// The share image's template, only when asked (pnpm site:og renders it to public/og.png).
if (process.argv.includes("--og")) writeFileSync(join(DIST, "og.html"), page("og.html"));
for (const f of readdirSync(join(DS, "fonts"))) copyFileSync(join(DS, "fonts", f), join(DIST, "fonts", f));
copyFileSync(join(DS, "logos/rawjobs-mark.svg"), join(DIST, "favicon.svg"));
cpSync(join(SITE, "public"), DIST, { recursive: true });
// The dashboard screenshots the README uses (pnpm design:shots, demo data only).
mkdirSync(join(DIST, "images"));
for (const f of ["radar-light.png", "radar-dark.png"]) copyFileSync(join(ROOT, "docs/images", f), join(DIST, "images", f));
writeFileSync(join(DIST, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
writeFileSync(
  join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_URL}/</loc></url>\n</urlset>\n`,
);

console.log(
  `Built ${DIST} for ${SITE_URL}${ANALYTICS_TOKEN ? " (with Web Analytics)" : ""}: ${Math.round(Buffer.byteLength(html) / 1024)} KB page, ` +
    `${NUMBERS.__COMPANIES__} companies (${n.live ? "live" : "last known"}).`,
);
