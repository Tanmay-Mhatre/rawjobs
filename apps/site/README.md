# RawJobs site

The marketing page at <https://www.rawjobs.workers.dev>. One static HTML page built from the app's own design files, so the site and the dashboard stay in sync:

- tokens, fonts and logos from `apps/web/src/design`
- components (`rj-*` classes) from `design/components/bundle.css`
- page content in `src/index.html`, the 404 page in `src/404.html` (both get the tokens and the theme script at build time), static files (the share image) in `public/`
- the install steps in Get it pick the visitor's computer (Windows, Mac, Linux) and show a mock of their screen at each step; its colors imitate those systems, so they are fixed values marked `design-lint-ignore`
- `/install` redirects to the install steps (`public/_redirects`)
- the share image, `public/og.png`, is rendered from `src/og.html`: run `pnpm site:og` after changing it

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

Jobs shown on the page are made-up examples. The scoring demo's rules are in `src/score.js`, and `packages/core/test/site-demo.test.ts` checks them against `packages/core/src/score.ts` for every choice the demo offers: change the scorer and that test tells you to update the demo.

The page's numbers (companies in the directory, companies hiring, jobs in the daily feed, build dates) are read from the directory repo's latest release at build time. The Site workflow also runs every Monday after the directory rebuild, so they stay current. Without network access the build uses the last known numbers and says so.
