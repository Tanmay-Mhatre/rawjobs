# RawJobs

**Jobs, straight from the source.** · [rawjobs.workers.dev](https://www.rawjobs.workers.dev)

[![CI](https://github.com/Tanmay-Mhatre/rawjobs/actions/workflows/ci.yml/badge.svg)](https://github.com/Tanmay-Mhatre/rawjobs/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![Latest release](https://img.shields.io/github/v/release/Tanmay-Mhatre/rawjobs)](https://github.com/Tanmay-Mhatre/rawjobs/releases/latest)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/radar-dark.png">
  <img alt="The RawJobs Radar: a list of scored jobs on the left, and on the right why the selected job matched." src="docs/images/radar-light.png">
</picture>

A free, self-hosted job radar. Tell it the roles, places and industries you want; RawJobs scans company careers pages, from a shared directory of companies' hiring systems that grows every week ([current size](https://www.rawjobs.workers.dev)), scores every opening against your profile with clear keyword rules, and shows you the matches, with the companies you'd most like to join starred and their newest jobs up top. A Pipeline then tracks what you applied to, what's due next and who you know there.

Good roles often appear on company careers pages (Greenhouse, Lever, Ashby, Workday…) before LinkedIn, or never reach it. Checking 50 careers pages by hand doesn't happen. This does it for you.

> **Status: runs on your computer, installs with one line on Windows, macOS and Linux, and updates when you click Update.** A web dashboard and a CLI with connectors for Greenhouse, Lever, Ashby, Workday, SmartRecruiters and [many more hiring systems and public job boards](docs/hiring-systems.md), scoring, a Pipeline, scheduled scans and Telegram alerts. See [Roadmap](#roadmap).

Built by Tanmay Mhatre.

## Getting started

Paste one line into a terminal. No Node, git, account or admin rights needed.

**Windows** (PowerShell):

```powershell
irm https://github.com/Tanmay-Mhatre/rawjobs/releases/latest/download/install.ps1 | iex
```

**macOS and Linux** (Terminal):

```bash
curl -fsSL https://github.com/Tanmay-Mhatre/rawjobs/releases/latest/download/install.sh | sh
```

It installs RawJobs in your user folder, starts it now and every time you log in, adds a **RawJobs** shortcut to your Desktop and Start menu / Applications, and opens the dashboard at http://127.0.0.1:4317. New versions download in the background within minutes of a release and install when you click Update (at the top of the dashboard, or Settings → Updates). What it changes on your computer, how to uninstall, and troubleshooting: [docs/install.md](docs/install.md).

**From the source code** (needs Node 22+ and [pnpm](https://pnpm.io)):

```bash
pnpm install
pnpm start              # builds the dashboard and opens http://127.0.0.1:4317 in your browser
```

`pnpm start` runs the dashboard and its local API; only this computer can reach it. A scan keeps going if you close or reload the tab, and the dashboard picks it up again when you come back. Working on RawJobs itself? `pnpm dev` (http://127.0.0.1:5173) reloads as you edit.

The dashboard walks you through setup the first time (about 3 minutes; you can skip it and come back from any page):

1. **Resume**: paste your resume, or, if you keep several versions for different roles, copy the provided prompt into your own Claude or ChatGPT, attach them all, and paste the answer back. You get one master resume plus suggested roles, places and topics. It's saved to `profile/resume.md` (gitignored, never sent anywhere). Optional.
2. **Roles**: pick your job family; its titles appear as chips to select or deselect. Switching family resets titles and exclusions to that family's defaults (with Undo). Add titles from any other family with search.
3. **Locations**: search any country, city or region in the world. A country is one selection (its short names and main cities included); remove it in one click, or expand it to drop single cities. Choose whether remote roles count, and where.
4. **Industries**: pick the industries you'd like to work in (Crypto, Fintech, AI…, in groups). Jobs at companies in them rank higher, and those companies are suggested to you. They don't decide what a scan fetches. Optional.
5. **Review**: read it back in plain words, choose what counts as a strong match, and press **Save & find my jobs**.

Saving runs your first scan (see [Scans](#scans)), each company fetched live. Then, optionally, pick the companies you'd love to work at in the **Companies** tab (search the directory, or paste a careers link): they're checked every scan, starred, and nudged up the list. Topics (keywords that rank a job higher) are prefilled from your resume and live in **Settings → Profile → Topics**.

Setup writes `rawjobs.config.local.yaml` (gitignored, commented, safe to edit by hand). After that, the Radar shows a checklist of anything still missing, explains a scan with no matches (and what to change), and flags companies whose links broke. Change anything later in **Settings**, or start over with **Settings → Data & privacy → Start setup over**.

Prefer the terminal? Copy `rawjobs.config.example.yaml` to `rawjobs.config.local.yaml`, edit it, then `pnpm rawjobs validate` and `pnpm rawjobs scan`.

## Dashboard

- **Radar**: every job for you in one list, best match first: fit, then freshness (the boost halves every 3 days), with **your companies starred (★)**, nudged up by 10 and their three newest jobs in a strip on top. Newest, salary and company sorts mean exactly that. One company shows two roles before the rest fold into "+N more". Quick filters **My companies**, **New** and **Strong** (keys `1`–`3`; they combine, so New + Strong is new strong jobs), plus views you save yourself. Saved and applied jobs live on the Pipeline. Sort by best match, newest, highest salary or company. Filter by date posted, country, location, workplace, seniority, industry, company, keywords, match and hiring system; search.
- **Job detail**: score breakdown (why it matched), description, salary, notes, status, copy the description for CV tailoring. It also shows the company's **hiring activity** (how many roles it posted lately, against its usual pace) and **Talk to someone who works here**: your LinkedIn connections there, people search links and message drafts you copy and send yourself.
- **Pipeline**: Saved → Applied → Interviewing → Offer → Closed. Drag cards between columns, or focus one and press `[` / `]` (on phones, one column at a time). See [Pipeline](#pipeline).
- **Companies**: My companies, with what each has for you now, scan health and broken links; companies with nothing for you in 10+ scans over a week are flagged for removal. **Starter packs** add the companies of your industries in one click; **Suggestions** and **Browse all** search the directory; **Add by link** takes any careers page. Hidden companies, with Show again.
- **Settings**:
  - **Profile**: master resume, roles, locations, industries, topics, dealbreakers.
  - **Matching**: the strong-match threshold, **Hide jobs older than**, and your **Not interested** rules.
  - **Companies**: the companies you'd love to work at.
  - **Scans**: what Scan now covers, scheduled scans, checking every company now, and the company directory download.
  - **Notifications**: Telegram alerts, the daily summary, and which messages to send.
  - **Appearance**: light, dark or system theme, an increased-contrast option, and job list density.
  - **Keyboard**: every shortcut.
  - **Data & privacy**: export / import your tracking data, LinkedIn connections, sharing, tips you've closed, start setup over.
  - **Updates**: your version and the newest one, the Desktop shortcut, watching for new versions and test versions early.
  - **What's new**: the release notes of every version.

Statuses and notes are saved on your computer in `profile/tracking.json` (export them for backup). **Scan now** in the header scans on your machine and shows its progress there (hover it for details); with Telegram set up, you get a message when it's done.

Marking a job **Not interested** asks why, in one optional tap. A reason that maps to a clear rule offers it ("Hide all senior roles?"), and nothing is hidden until you confirm; the rules are listed on Settings → Matching.

**LinkedIn connections** (optional): download your own data export from LinkedIn and choose it in Settings → Data & privacy → LinkedIn connections, or from a job. RawJobs reads only your connections, positions and schools, on this computer, and shows who you know at each company. See [PRIVACY.md](PRIVACY.md#your-linkedin-connections-only-if-you-import-them).

Installed copies show an **Update to 0.x.y** button at the top of the dashboard when a new version has downloaded, and **What's new** once after updating ([docs/install.md](docs/install.md#updates)).

Keyboard: `j`/`k` move, `Enter` open, `s` save, `a` applied, `x` not interested, `c` copy description, `f` full window, `r` scan now, `/` search, `1`–`3` Radar quick filters (`1`–`4` switch sections elsewhere), `g` then `r`/`p`/`c`/`s` go to Radar, Pipeline, Companies or Settings from anywhere, `[`/`]` move a pipeline card, `?` help, `Esc` close.

### Pipeline

Every job you save, apply to or track by hand (**Track a job**, for one RawJobs didn't find) gets a card. Each card shows its next step, worked out from what you logged:

- **Next steps** at the top lists what's overdue, due today and due this week: apply by a date you set, follow up when an application goes quiet, a thank-you after an interview, an interview coming up, answering an offer by its deadline, and closing a job that never answered.
- Each job has an **Activity** log (messages sent and received, stage changes, notes), a **People** tab for your contacts there, and an **Interviews** tab for each round.
- After you open a job's apply page, RawJobs asks **Did you apply?** when you come back, so the Pipeline stays true without typing.
- Moving a card to **Closed** asks how it ended. A summary shows your week against a weekly plan you set.

With Telegram set up, the optional **daily summary** (Settings → Notifications) sends one morning message with what's due today. From the terminal: `rawjobs today`.

## Scans

A scan has one of three scopes:

| Scope | Covers | Time |
| --- | --- | --- |
| **Scan now** (`mine`, default) | your companies, companies that matched you before, and the ones the shared job feed picks out for you; then a quiet background check of every other company (off with `--no-background`, or in Settings → Scans) | a minute or two, then the background check |
| **My companies** (`yours`) | only your companies | quickest |
| **All companies** (`all`) | your companies, plus every company in the directory | longer; can be stopped and resumed |

Your industries only rank jobs higher; they never decide what a scan fetches. The background check is quiet: you only hear about it if it finds something new, and you can pause it and pick it up later.

Every scan:

1. **Syncs the directory**: a small manifest check, and a download only when there's a newer version.
2. **Uses the shared job feed** to skip directory companies that have nothing passing your title and location gates. Your own companies, companies the feed doesn't cover, and feed data older than 3 days are always fetched live.
3. **Fetches live** from each remaining company's hiring system, scores every job, and merges the result into `data/`. Every job you see was fetched by your own scan.

Jobs keep their first-seen date, and a job missing from two successful scans of its company is marked closed. A company whose feed fails never closes its jobs.

### Scheduled scans and alerts

- **Scheduled scans** (Settings → Scans): pick one or two times a day and a scope. RawJobs registers the scan with your computer's own scheduler (Windows Task Scheduler, macOS launchd, or a systemd user timer on Linux). It runs while the computer is on and catches up on a missed run. From the terminal: `pnpm rawjobs schedule install --time 08:00 --scope mine`.
  - Linux without systemd: add a cron line instead, for example `0 8 * * * ~/.local/share/rawjobs/bin/rawjobs scan --notify` (installed) or `0 8 * * * cd /path/to/rawjobs && pnpm rawjobs scan --notify` (from source).
- **Telegram alerts** (Settings → Notifications): a 2-minute guided setup with your own bot (make a bot with @BotFather, press Start, done), then a test message. Scan messages give counts, not job details; you open RawJobs to see the jobs:
  - a scan you start from the dashboard sends one message when it finishes or stops, with how many jobs are available to apply;
  - each scheduled scan sends how many new jobs and strong fits it found, and nothing when nothing is new (turn off "only jobs I haven't been sent before" to get every strong fit instead); the background check sends only jobs new to you;
  - the **daily summary** (off until you turn it on) sends one morning message with what's due in your Pipeline today, naming the jobs and companies;
  - installed copies send one message when a new version is ready (you can turn that off).

  The bot token and chat ID are kept in `profile/secrets.json` (gitignored), or read from `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

## Command line

The examples use `pnpm rawjobs`, as in a copy of the source code. An installed copy has the same command as `rawjobs` in its `bin` folder (see [docs/install.md](docs/install.md#using-it)).

`pnpm rawjobs scan` (alias `run`) prints every job that passes your title and location gates, best first, with the reason for its score:

```
★  74  Head of Product, Exchange
        Acme · Abu Dhabi; Dubai · hybrid · posted 2026-10-02
        title 30 · place 20 · keywords 14 (crypto, exchange, tokenization) · industry 10
        https://jobs.lever.co/acme/...
```

Useful flags:

| Flag | What it does |
| --- | --- |
| `--scope mine\|yours\|all` | What to scan (see [Scans](#scans)) |
| `--no-background` | After a `mine` scan, skip the background check of every other company |
| `--only <company>` | Test one of your companies |
| `--check <ats:slug>` | Check one directory company |
| `--full` | Fetch every company live, without the job feed |
| `--offline` | Skip the directory sync |
| `--fresh` | Start over instead of resuming a stopped scan |
| `--plan` | Show what each scope covers, without scanning |
| `--notify` | Send new matches to Telegram |
| `--all` | Also show gated-out jobs |
| `--dry-run` | Save nothing |
| `--json out/run.json` | Write the raw result |

Other commands:

```
rawjobs schedule <status|install|remove|run>     scans on a schedule on this computer
                 [--time 08:00] [--scope mine|yours|all]
rawjobs alerts telegram <status|token|connect|test|on|off|forget>
rawjobs today [--notify] [--test]                what's due in your Pipeline today (--notify: to Telegram)
rawjobs today <status|install|remove> [--time 09:00]   send it every morning
rawjobs shortcuts [--desktop]                    make or repair the RawJobs shortcut
rawjobs detect <url>...                          careers URLs → config lines
rawjobs validate                                 check your config file
rawjobs companies suggest                        directory companies that fit your profile
rawjobs directory <status|update|share>          the shared company directory
rawjobs serve [--port <n>] [--open]              run the dashboard (pnpm start does this)
rawjobs open                                     open the dashboard, starting it if needed
rawjobs update [--check] [--to <version>]        install the newest version (installed copies)
rawjobs uninstall [--keep-data|--delete-data]    remove an installed copy
```

### Adding companies

Paste careers URLs into `detect` and copy the lines into `companies:`:

```bash
pnpm rawjobs detect https://jobs.lever.co/somecompany https://job-boards.greenhouse.io/other
```

RawJobs reads many hiring systems, including Greenhouse, Lever, Ashby, Workday and SmartRecruiters: [the full list, and what their careers links look like](docs/hiring-systems.md).

[Public job boards](docs/hiring-systems.md) are added the same way, by pasting their link.

## The shared directory and job feed

Two things are built for everyone by GitHub Actions and published as releases of the directory repo. Neither knows anything about you.

- **The directory** (rebuilt weekly): which companies exist, which hiring system and board each one uses, whether it's live, and its industries, plus the open job titles and places at the companies we can index. The [website](https://www.rawjobs.workers.dev) shows its current size.
- **The job feed** (refreshed regularly): every open job on the live Greenhouse, Lever, Ashby, SmartRecruiters and Workday boards, as a full copy plus a small change file per refresh. Scans use it only to skip companies with nothing for you.

How the directory is built (no AI, `scripts/catalog/`):

1. **Merge** public, permissively licensed lists of company job boards (CC BY 4.0, MIT, Apache-2.0), our own Common Crawl and Wayback Machine queries, Wikidata, and the **industry seed list**. Share-alike and non-commercial lists only cross-check, never add companies.
2. **Resolve** the seed list (`seeds/industries.json`, must-have companies per industry, editable): read each company's website the way a person would (homepage → careers link → the board it embeds) to find its hiring system. Polite: one request at a time per site, robots.txt honoured.
3. **Check** every board live with the cheapest call each hiring system offers (live / dormant / dead).
4. **Index** each live company's open job titles and locations (no descriptions).
5. **Tag** companies by industry from four sources: the source lists' own labels, the seed list, Wikidata's industry statements (CC0), and their job titles (e.g. many "Forex" or "MT5" roles means a brokerage), read from the job index, the daily job feed or the live checks. Industries a company merely hires for (`title_tags`, e.g. "hires AI roles") are kept apart, and `tag_src` says which tags came from Wikidata or job titles ([details](docs/shared-directory.md#industry-tags)).
6. **Publish** to `data/catalog/`, and write **`out/coverage.md`**: per industry, how many must-have companies we can track, and which hiring systems to support next.

The dashboard downloads a newer directory by itself when yours is more than a week old (Settings → Scans → Company directory). To rebuild it locally:

```bash
pnpm catalog:refresh
```

A company missing? Add it with **Add by link** (shared with the directory if sharing is on), or add it to `scripts/catalog/seeds/industries.json` in a pull request. Links people share are checked and added every few hours.

Source attribution: see `scripts/catalog/seeds/NOTICE.md` and the source list in `scripts/catalog/merge.ts`. Running your own directory: [docs/shared-directory.md](docs/shared-directory.md) and [docs/self-hosting.md](docs/self-hosting.md).

## How scoring works

No AI, fully explainable: every rule is in `packages/core/src/score.ts`, and a job's detail shows each part. Every job is scored 0–100:

1. **Gates.** The title must contain a `titles.include` term and no `titles.exclude` term. The location must match `locations.include`, or `locations.remote_ok` without also matching `locations.remote_exclude`, and the workplace (on-site, hybrid, remote) must be one you accept. Fail either and the job scores 0 and is hidden by default.
2. **Title, up to 30.** 15 for a title match, up to 5 more for focus (how much of the title your role and level words explain: "Senior Product Designer" all of it, "Product Designer, Growth Platform" a little less), then +10 at your level (a `seniority_boost` term in the title, or the same level as one), +5 one level away (a plain "Product Manager" when you're senior), nothing two or more levels away.
3. **Location, up to 20.** 20 for an included place, 15 for an accepted remote region (or remote with no place named).
4. **Topics, up to 40.** The share of your topic weight the job mentions, where min(total weight, 12) fills the bar, so about three core topics are enough and a short list isn't penalised. A topic named once counts three quarters of its weight; three times, or in the title, in full. A topic the posting lists only as a nice-to-have ("Kafka is a plus") counts half. Topics in the title alone are worth up to 20. Your industries add their own topics (payments, trading…) that you haven't listed, at weight 2 and at most 4 together. A job with no description gets 15 here, plus up to 10 for topics in its title.
5. **Industry, up to 10.** 10 if the company is in one of your `industries` (or is one of your companies, or you picked no industries), 5 if its industry isn't known, 0 if it's in another one.
6. **Years.** When the posting's must-haves ask for more years than your `experience_years`, one year short is fine; more takes the level a step down and costs 3 points for each year past the first (at most 10).

With no `keywords` at all, title + location + industry (out of 60) are scaled to 0–100. The detail also says, for place, level, pay, visa, must-haves and years, whether the job meets yours or the posting doesn't say.

**Dealbreakers** (optional, in Settings → Profile → Dealbreakers or the config) are what a posting says that rules it out, whatever else fits:

- `salary_floor` (`{ amount, currency, period }`): the posted range tops out more than 5% under it, same currency. Pay is read from the hiring system, or from the description ("base AED 28,000 - 32,000 per month").
- `work_authorization` (countries you can work in without a visa sponsor; `eu` for the EU/EEA, `none` if you need one everywhere): the posting says it won't sponsor ("unable to sponsor", "must be authorised to work in the US") for a country not on your list.
- `avoid` (work you won't do: `frontend`, `credit risk`): it's in the title, or the description keeps coming back to it (three mentions, or two with the first in the opening), not a passing mention.
- Always, when your places name a country: the posting is only for people already living in another one ("US residents only", "must already live in the Netherlands").

A job that breaks one keeps showing, with the reason on its row and in its detail, but its score is halved and kept under `min_score`, so it's never a strong match and never alerts as one. Pay or sponsorship a posting doesn't mention never counts against it.

The score says how well a job fits, not how old it is. The Radar's **Best match** order adds freshness when you look: score + 15 × 0.5^(age in days ÷ 3), +10 for your companies, and postings older than 30 days slowly lose a little (at most 12). So a strong job posted today beats an equal one from last week, and a weak new job never leaps a strong one.

Best match also **learns from you**, on this computer only (`packages/core/src/learn.ts`): from the jobs you save, apply to or move further, against the ones you mark Not interested, it finds which parts of the score matter more to you and moves the order by at most 8 points. It starts after a few choices of each kind, checks itself and switches off when it doesn't help, and never changes a score, a dealbreaker, a filter or an alert.

Sandbox, training and test boards (e.g. "Lever Implementation Training Environment") are left out of the directory and never scanned.

Terms match whole words, case-insensitively: `ai` matches "AI-native" but not "maintain"; `product manager` matches "Product-Manager".

## Privacy

Your profile, resume, config, Telegram token and run history stay on your computer. The app has no telemetry. It talks to the companies' job boards (to scan), GitHub (to download the shared directory, job feed and topic word list), the project website (installed copies only: a small file every few minutes that names the newest version; turn that off in Settings → Updates) and, if you set up alerts, Telegram. Installing also downloads Node from nodejs.org.

**Sharing is on by default:** when you add a company by link that the directory doesn't have, its careers board (hiring system, board name, company name) is sent to the project's contribution inbox so everyone can find it. Nothing about you is sent. Turn it off in **Settings → Data & privacy → Sharing** or with `directory.share_additions: false`. Full details: [PRIVACY.md](PRIVACY.md).

Your config lists the companies you're targeting. If you run RawJobs from GitHub, **create your copy as a private repository** (use "Use this template" → Private, not Fork; forks of public repos must stay public).

## Data & licenses

- **Code:** MIT ([LICENSE](LICENSE)), copyright Tanmay Mhatre. Use, change and share it freely; copies must keep the copyright and license notice.
- **Shared directory and job index:** CC BY 4.0. Sources and credits (Common Crawl, the Wayback Machine, Wikidata, permissively licensed board lists, user contributions) are in the directory repo's `NOTICE.md` ([template](services/directory-repo-template/NOTICE.md)).
- **Public job boards** (Hacker News "Who is hiring", Remotive, Arbeitnow, Remote OK, Himalayas, Jobicy, We Work Remotely, Remote First Jobs) are fetched on your own computer only, at most a few times a day, credited by name with every job linking back to the board, and never shared or redistributed. (The Muse isn't included: its terms weren't confirmed.)
- **Remove a company:** open a [takedown request](.github/ISSUE_TEMPLATE/takedown.yml). We reply within 7 days, and removed companies go into `denylist.json`.
- **Running a fork with your own data:** [docs/self-hosting.md](docs/self-hosting.md).

## Fair use

RawJobs only reads public job postings that companies publish for their own careers pages. A scan makes a few requests per company it fetches (a list, then details for jobs that pass your gates on some systems, or one page at a time on Workday), and the shared job feed lets it skip most companies with nothing for you. It spaces requests to the same host (about one a second), identifies itself with a User-Agent, slows down on rate limits, links to the original posting and never touches apply endpoints or candidate data. Keep it that way: prefer the default scope, keep your own list to the companies you really want (the Companies tab flags ones that never have anything for you), and don't scan more than a couple of times a day.

RawJobs is an independent project. It isn't affiliated with or endorsed by Greenhouse, Lever, Ashby, Workday or any other hiring system or job board named here; their names are used only to say which careers pages it can read.

## Development

```bash
pnpm check          # lint + format check + design tokens + design lint + typecheck + tests
pnpm test:watch
pnpm hooks:install  # once per clone: no direct pushes to main, and pnpm check before every push
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes go through pull requests. `main` is protected: a pull request can only merge once CI passes on its latest commit: `check`, and the install test on Windows, macOS and Linux.

**Releasing:** only a tag you push releases anything; merging a PR doesn't. After every merge, the [release reminder](.github/workflows/release-reminder.yml) keeps one issue open, assigned to you, with what's waiting and the tag message drafted from each PR's **Release note** (`pnpm release:notes` prints the same). To release, push an annotated tag: `git tag -a v0.6.1 -F notes.txt` and `git push origin v0.6.1` (the tag names the version; no version bump needed). In the message, lines starting `New:`, `Improved:` or `Fixed:` show in the app's "What's new" with a tag each; `Update: mandatory` makes it a required update; `Min-version: 0.5.0` makes older versions reinstall instead. The [release workflow](.github/workflows/release.yml) builds the bundle, signs it with the `RAWJOBS_SIGNING_KEY` secret, installs and updates it on all three systems, publishes it, then deploys the site, which updates the beacon (`v1/latest.json`). Installed copies read the beacon every few minutes, download the new version and show an Update button (and send a Telegram message when alerts are set up).

```
packages/core       connectors, normalise, score, scan scopes, job feed, directory sync,
                    history, schedule, Telegram (shared Job types)
packages/cli        rawjobs scan | schedule | alerts | today | detect | validate | companies
                    | directory | setup (JSON API used by the dashboard)
packages/server     the local server: the dashboard's API, the built dashboard, updates,
                    rawjobs serve | open | update | uninstall | shortcuts
apps/web            React + Vite + Tailwind dashboard (reads data/ and the local API)
apps/site           the project website, which also serves the update beacon (v1/latest.json)
packaging/          the installers (install.ps1, install.sh) and the launchers in bin/
scripts/bundle      pnpm bundle: the copy that installs, needing only Node
scripts/release     pnpm release:files: the signed release (see .github/workflows/release.yml)
scripts/catalog     builds the shared directory, the shared job feed and the topic word list
scripts/design      design tokens, design lint, screenshots (pnpm design:build | design:lint | design:shots)
scripts/site        the website's share image (pnpm site:og)
scripts/hooks       the git pre-push hook (pnpm hooks:install)
services/contribute the contribution inbox (Cloudflare Worker)
services/feed-trigger  starts the job feed workflow on time every 6 hours (Cloudflare Worker)
services/directory-repo-template  the files the public directory repo starts from
design/             brand book, component specs and screenshots
docs/               install, hiring systems, shared directory, self-hosting, plans
```

Connector tests use saved feed responses in `packages/core/test/fixtures`, so tests never hit live sites. `pnpm jobhunter` still works as an alias of `pnpm rawjobs`, and old `jobhunter.config*.yaml` files are still read.

## Roadmap

| Phase | Scope |
| --- | --- |
| 0. Core ✅ | Schema, config validation, Greenhouse / Lever / Ashby, scoring, CLI, tests |
| 1. Daily radar ✅ | [Hiring system connectors](docs/hiring-systems.md), shared directory and job feed, run history, scheduled scans on your computer, Telegram alerts and the daily summary |
| 2. Dashboard ✅ | Radar, job detail, Pipeline with next steps, companies, settings, light and dark themes, each with an increased-contrast version |
| 3. Open-source launch ✅ | Setup wizard, contributor docs, privacy page, self-hosting guide |
| 3b. Install for everyone ✅ | One-line install for Windows, macOS and Linux, start at log in, signed releases, updates that go back if a new version doesn't start ([plan](docs/plans/local-install.md)) |
| Later (ideas, not scheduled) | Scheduled scans in your own GitHub Actions, email alerts, a hosted dashboard |

## License

[MIT](LICENSE) © 2026 Tanmay Mhatre.
