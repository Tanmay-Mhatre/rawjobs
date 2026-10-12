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
  "Greenhouse",
  "Lever",
  "Ashby",
  "SmartRecruiters",
  "Workday",
  "Workable",
  "Recruitee",
  "Personio",
  "BambooHR",
  "Breezy HR",
  "Teamtailor",
  "Pinpoint",
  "Rippling",
  "HiBob",
  "Freshteam",
  "Comeet",
  "Oracle Recruiting",
  "SAP SuccessFactors",
  "Taleo",
  "iCIMS",
  "Jobvite",
  "JazzHR",
  "Zoho Recruit",
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

/** The whole directory (companies with name, ats, careers_url, status...). */
async function getDirectory(url) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const d = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"));
  return Array.isArray(d) ? d : (d.companies ?? []);
}

// ---------- the hero wall: real careers-page addresses from the directory ----------
const WALL_SIZE = 520;
const WALL_FALLBACK = join(SITE, "src/wall-fallback.json");
/** "https://jobs.ashbyhq.com/airwallex/" -> "jobs.ashbyhq.com/airwallex"; hosts that carry the company in the path keep it. */
export function wallHost(url) {
  const parts = String(url)
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .split("/");
  let h = parts[0];
  if (/greenhouse|ashbyhq|lever\.co|smartrecruiters|workable|rippling|comeet|jobvite/.test(h) && parts[1]) h += "/" + parts[1];
  h = h.toLowerCase();
  return h.length <= 38 && /^[a-z0-9./_-]+$/.test(h) ? h : null;
}
/**
 * A deterministic, varied sample of live boards: every hiring system gets a share in proportion to
 * its live boards (at least 6), picked by a seeded shuffle of the sorted directory, then interleaved.
 * The same directory always gives the same wall; a new directory gives a new one.
 */
export function wallSample(companies, size = WALL_SIZE) {
  let seed = 20261011;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const live = companies.filter((c) => c.status === "live" && c.careers_url).sort((a, b) => String(a.key ?? a.name).localeCompare(String(b.key ?? b.name)));
  const by = new Map();
  let usable = 0;
  for (const c of live) {
    const h = wallHost(c.careers_url);
    if (h) {
      (by.get(c.ats) ?? by.set(c.ats, []).get(c.ats)).push(h);
      usable++;
    }
  }
  const seen = new Set();
  const out = [];
  for (const [, hosts] of [...by].sort((a, b) => a[0].localeCompare(b[0]))) {
    const take = Math.max(6, Math.ceil((size * hosts.length) / usable));
    let n = 0;
    for (const h of shuffle(hosts)) {
      if (n >= take) break;
      if (!seen.has(h)) {
        seen.add(h);
        out.push(h);
        n++;
      }
    }
  }
  return shuffle(out).slice(0, size);
}

async function directoryNumbers() {
  const base = `https://github.com/${DATA_REPO}/releases`;
  try {
    const [dir, feed, companies] = await Promise.all([
      getJson(`${base}/latest/download/manifest.json`),
      getJson(`${base}/download/jobs/jobs-manifest.json`),
      getDirectory(`${base}/latest/download/directory.json.gz`),
    ]);
    // Directory companies whose job board answered at the last check (status "live"; the rest are dormant).
    const liveBoards = companies.filter((c) => c.status === "live").length;
    const feedJobs = Object.values(feed.shards ?? {}).reduce((sum, s) => sum + (s.jobs ?? 0), 0);
    if (!(dir.companies > 0 && dir.indexed > 0 && feedJobs > 0 && liveBoards > 0)) throw new Error("manifest without counts");
    const wall = wallSample(companies);
    if (wall.length < WALL_SIZE / 2) throw new Error("directory without enough live boards for the wall");
    return { companies: dir.companies, liveBoards, indexed: dir.indexed, builtAt: dir.generated_at, feedJobs, feedAt: feed.generated_at, wall, live: true };
  } catch (err) {
    console.warn(`Directory numbers: ${err.message}. Using the last known ones.`);
    return { ...FALLBACK, wall: JSON.parse(read(WALL_FALLBACK)), live: false };
  }
}

const n = await directoryNumbers();
const int = (x) => x.toLocaleString("en-US");
const day = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
/** 21,485 -> "21,000+"; 1,338,418 -> "1.3M+": numbers in prose round down, so they stay true for a while. */
const atLeast = (x) => (x >= 1e6 ? `${Math.floor(x / 1e5) / 10}M+` : `${int(Math.floor(x / 1000) * 1000)}+`);
const VERSION = JSON.parse(read(join(ROOT, "package.json"))).version;
const NUMBERS = {
  __VERSION__: VERSION,
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
tokens = tokens.replace('[data-theme="dark"] {', '[data-theme="dark"] { color-scheme: dark;').replace('[data-theme="dark-hc"] {', '[data-theme="dark-hc"] { color-scheme: dark;');
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
// The wall's addresses, with the hero's example stamps forced in so each stamp sits on a real address.
// Pass --wall-fallback to also save this build's wall as src/wall-fallback.json (the offline list).
const stampHosts = [...read(join(SITE, "src/index.html")).matchAll(/"host":\s*"([^"]+)"/g)].map((m) => m[1]);
const wallHosts = n.wall.filter((h) => !stampHosts.includes(h)).slice(0, WALL_SIZE - stampHosts.length);
for (const [i, h] of stampHosts.entries()) wallHosts.splice(Math.round(((i + 0.5) * wallHosts.length) / stampHosts.length), 0, h);
if (process.argv.includes("--wall-fallback") && n.live) writeFileSync(WALL_FALLBACK, JSON.stringify(n.wall, null, 0) + "\n");
const escHtml = (x) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const wallMarkup = wallHosts.map((h) => `<span>${escHtml(h)}</span>`).join("");
const ats = SYSTEMS.map((s) => `<li class="ats">${s}</li>`).join("");
// The scoring demo's rules, inlined as a plain script (packages/core/test/site-demo.test.ts checks them).
const score = read(join(SITE, "src/score.js")).replace(/^export /gm, "");
const analytics = ANALYTICS_TOKEN ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${JSON.stringify({ token: ANALYTICS_TOKEN })}'></script>` : "";

const page = (name) => {
  let out = read(join(SITE, "src", name))
    .replace("/*__TOKENS__*/", () => tokens)
    .replace("/*__BUNDLE__*/", () => bundle)
    .replace("/*__SCORE__*/", () => score)
    .replaceAll("__WORDMARK__", () => wordmark)
    .replace("__ATS__", () => ats)
    .replace("<!--__WALL__-->", () => wallMarkup)
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
writeFileSync(join(DIST, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_URL}/</loc></url>\n</urlset>\n`);

console.log(
  `Built ${DIST} for ${SITE_URL}${ANALYTICS_TOKEN ? " (with Web Analytics)" : ""}: ${Math.round(Buffer.byteLength(html) / 1024)} KB page, ` +
    `${NUMBERS.__COMPANIES__} companies (${n.live ? "live" : "last known"}).`,
);
