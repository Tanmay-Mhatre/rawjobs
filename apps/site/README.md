# RawJobs site

The marketing page at <https://www.rawjobs.workers.dev>. One static HTML page built from the app's own design files, so the site and the dashboard stay in sync:

- tokens, fonts and logos from `apps/web/src/design`
- components (`rj-*` classes) from `design/components/bundle.css`
- page content in `src/index.html`, the features page in `src/features.html` (served at `/features`; every claim on it comes from the main README, and the examples inside its small mocks say so), the 404 page in `src/404.html` (all three get the tokens and the theme script at build time), static files (the share image) in `public/`
- the install steps in Get it pick the visitor's computer (Windows, Mac, Linux) and show a mock of their screen at each step; its colors imitate those systems, so they are fixed values marked `design-lint-ignore`
- `/install` redirects to the install steps (`public/_redirects`)
- the share image, `public/og.png`, is rendered from `src/og.html`: run `pnpm site:og` after changing it
- the hero's wall is a few hundred real careers-page addresses (`WALL_SIZE` in `build.mjs`): `build.mjs` picks them from the directory release it already downloads (live boards only, a seeded sample that mixes hiring systems) and fills `<!--__WALL__-->`. Offline it uses `src/wall-fallback.json`; refresh that with `node apps/site/build.mjs --wall-fallback`. The seven stamped matches are a curated list in `src/index.html` (`#wall-data`), and the build puts each of their addresses in the wall
- the cinematic layer (end of the page's `<style>`, and the last `<script>`) builds on the tokens with site-only extras: display type sizes, one accent serif (Instrument Serif Italic, OFL, self-hosted in `public/fonts/` with its licence), longer `--duration-cinematic`/`--duration-reveal` motion, glass surfaces and a soft glow behind "signal" moments. The dashboard never loads it
- the hero radar is a 2D canvas behind the wall: a seeded field of dots, a sweep every 6s, and an orange blip on each stamped match that flashes the stamp when the sweep reaches it. It pauses off screen and in background tabs; reduced motion, Save-Data and devices with fewer than 4 cores get one still frame
- scroll scenes use native scrolling only (no smooth-scroll library): a 2px reading bar at the top of both pages, the hero's copy drifting up and its radar zooming out as you leave it, and each section entering as a sequence (label, heading, then the rest). Reduced motion keeps only the reading bar
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
| `APP_REPO` | `Tanmay-Mhatre/rawjobs` | Whose GitHub releases and stars the build reads (the update beacon, the latest release line, the star count). |
| `GITHUB_TOKEN` | unset | Sent with the GitHub API calls, for the higher rate limit. The Site workflow sets it. |
| `REQUIRE_BEACON` | unset | `1` makes the build fail when it can't write the update beacon, so a deploy never drops it. The Site workflow sets it on every run except pull requests. |

## Update beacon

The build also writes `dist/v1/latest.json`, served at `/v1/latest.json`: the newest RawJobs version on each channel (`stable`, and `beta` when a newer pre-release exists), read from the app's GitHub releases. Installed copies read it to find out an update is out (`fetchBeacon` in `packages/core/src/update.ts`). The release workflow starts a site deploy when it publishes a release, so the beacon follows each release.

## Deploy

`.github/workflows/site.yml` builds on every pull request that touches the site, and deploys on every push to `main` that touches it (`apps/site/`, `apps/web/src/design/`, `design/components/bundle.css` or the workflow itself), every Monday (to refresh the numbers), and when the release workflow or the directory rebuild starts it. It deploys the `www` Worker, which is static assets only, so requests don't count against the Workers request quota.

One-time setup, in the repo's **Settings → Secrets and variables → Actions**:

- Secrets: `CLOUDFLARE_API_TOKEN` (a token with **Edit Cloudflare Workers** permission) and `CLOUDFLARE_ACCOUNT_ID`.
- Optional: the `SITE_URL` variable, and `CF_ANALYTICS_TOKEN` as a variable or a secret (it's a public token, so either works).

To deploy without pushing, run the workflow from the Actions tab with **Run workflow**.

Jobs in the scoring demo and the dashboard screenshots are made-up examples. The hero's stamped matches are real postings from the 11 Oct 2026 feed with example scores for a sample resume, and the page says so. The scoring demo's rules are in `src/score.js`, and `packages/core/test/site-demo.test.ts` checks them against `packages/core/src/score.ts` for every choice the demo offers: change the scorer and that test tells you to update the demo.

Next to every "Star on GitHub" the build shows the repo's star count, and under the numbers a line with the latest release (tag and date) and the star count, all read from the GitHub API at build time (with `GITHUB_TOKEN` when set). When GitHub can't be reached, each is left out rather than shown stale.

The page's numbers (companies in the directory, companies hiring, jobs in the job feed, build dates) are read from the directory repo's latest release at build time. The directory rebuild starts a site deploy when it publishes, and the Monday run is the backup, so they stay current. Without network access the build uses the last known numbers and says so.
