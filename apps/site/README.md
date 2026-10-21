# RawJobs site

The marketing page at <https://www.rawjobs.workers.dev>. One static HTML page built from the app's own design files, so the site and the dashboard stay in sync:

- tokens, fonts and logos from `apps/web/src/design`
- components (`rj-*` classes) from `design/components/bundle.css`
- page content in `src/index.html`, the features page in `src/features.html` (served at `/features`; every claim on it comes from the main README, and the examples inside its small mocks say so), the 404 page in `src/404.html` (all three get the tokens and the theme script at build time), static files (the share image) in `public/`
- the install steps in Get it pick the visitor's computer (Windows, Mac, Linux) and show a mock of their screen at each step; its colors imitate those systems, so they are fixed values marked `design-lint-ignore`
- `/install` redirects to the install steps (`public/_redirects`)
- the share image, `public/og.png`, is rendered from `src/og.html`: run `pnpm site:og` after changing it
- the hero's wall is about 520 real careers-page addresses: `build.mjs` picks them from the directory release it already downloads (live boards only, a seeded sample that mixes hiring systems) and fills `<!--__WALL__-->`. Offline it uses `src/wall-fallback.json`; refresh that with `node apps/site/build.mjs --wall-fallback`. The seven stamped matches are a curated list in `src/index.html` (`#wall-data`), and the build puts each of their addresses in the wall
- the cinematic layer (end of the page's `<style>`, and the last `<script>`) builds on the tokens with site-only extras: display type sizes, one accent serif (Instrument Serif Italic, OFL, self-hosted in `public/fonts/` with its licence), longer `--duration-cinematic`/`--duration-reveal` motion, glass surfaces and a soft glow behind "signal" moments. The dashboard never loads it
- the hero radar is a 2D canvas behind the wall: a seeded field of dots, a sweep every 6s, and an orange blip on each stamped match that flashes the stamp when the sweep reaches it. It pauses off screen and in background tabs; reduced motion, Save-Data and devices with fewer than 4 cores get one still frame
- the hiring systems marquee under the numbers repeats the FAQ's list (`__ATS__` is filled everywhere it appears) and is hidden from screen readers, which get the FAQ list
- Get it: a step bar over the five steps, and the mock screen sits in a frame shaped like the visitor's machine (a MacBook, a Windows monitor on a stand, a Linux laptop). Like the mock screen, the frame's hardware colors are fixed values marked for the design lint
- Where your resume goes is full width: each stop is an icon card, the middlemen stamp the resume ("Copied", "Held") as it passes, "No reply" lands with a jolt and "Hiring team" with a green pulse, over a dotted grid with a red and a green glow
- an intro animation can hold the wall's scan: add the `intro` class to `<html>`, then dispatch `rawjobs:intro-done` on `window` (or call `window.rawjobsWall.start()`); it starts on its own after 4.5s

`pnpm design:lint` checks `src/` too, with CSS-aware rules: no accent tokens outside their four jobs, durations only from the motion tokens, no px type sizes.

```bash
pnpm site:build     # writes apps/site/dist
pnpm site:dev       # build, then serve it locally with wrangler
pnpm site:og        # re-render public/og.png from src/og.html (uses the system Edge)
```

`build.mjs` needs only Node, no install. It reads these optional environment variables:

| Variable | Default | What it does |
| --- | --- | --- |
| `SITE_URL` | `https://www.rawjobs.workers.dev` | Canonical URL, share image URL, sitemap, robots.txt. Set it when a custom domain is connected. |
| `CF_ANALYTICS_TOKEN` | unset | Cloudflare Web Analytics site token. Unset means no analytics script at all. |
| `DATA_REPO` | `Tanmay-Mhatre/rawjobs-directory` | Where the directory and job feed releases live (for the page's numbers). |

## Deploy

`.github/workflows/site.yml` builds on every pull request that touches the site, and deploys on every push to `main` and every Monday (to refresh the numbers). It deploys the `www` Worker, which is static assets only, so requests don't count against the Workers request quota.

One-time setup, in the repo's **Settings → Secrets and variables → Actions**:

- Secrets: `CLOUDFLARE_API_TOKEN` (a token with **Edit Cloudflare Workers** permission) and `CLOUDFLARE_ACCOUNT_ID`.
- Optional: the `SITE_URL` variable, and `CF_ANALYTICS_TOKEN` as a variable or a secret (it's a public token, so either works).

To deploy without pushing, run the workflow from the Actions tab with **Run workflow**.

Jobs in the scoring demo and the dashboard screenshots are made-up examples. The hero's stamped matches are real postings from the 11 Oct 2026 feed with example scores for a sample resume, and the page says so. The scoring demo's rules are in `src/score.js`, and `packages/core/test/site-demo.test.ts` checks them against `packages/core/src/score.ts` for every choice the demo offers: change the scorer and that test tells you to update the demo.

Next to every "Star on GitHub" the build shows the repo's star count, and under the numbers a line with the latest release (tag and date) and the star count, all read from the GitHub API at build time (with `GITHUB_TOKEN` when set). When GitHub can't be reached, each is left out rather than shown stale.

The page's numbers (companies in the directory, companies hiring, jobs in the daily feed, build dates) are read from the directory repo's latest release at build time. The Site workflow also runs every Monday after the directory rebuild, so they stay current. Without network access the build uses the last known numbers and says so.
