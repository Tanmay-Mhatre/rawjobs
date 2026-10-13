# Shared company directory

The company list (and job index) behind the Radar's jobs and the Companies tab search lives online, is rebuilt weekly,
and grows with every company a user adds by link. Every install downloads it; nothing about the
user is ever uploaded.

```
 Each install                                   Online
 ────────────                                   ──────
 Add by link ── live check ── outbox ──POST──►  Contribution inbox (Cloudflare Worker)
                                                   │ keeps boards only (no user data), 30 days max
                                                   ▼ every 3 h
                                                Contributions workflow (GitHub Actions, code repo)
                                                   pulls the inbox, live-checks each board again,
                                                   appends good ones to contributions.json,
                                                   publishes an updated directory, acknowledges
                                                   ▼
 data/catalog ◄── download (weekly, checksum) ── Public directory repo: rawjobs-directory
   directory.json, index.json, manifest.json       releases/latest: manifest.json,
                                                   directory.json.gz, index.json.gz
                                                   ▲ every Monday
                                                Weekly rebuild workflow
                                                   public lists + our crawls (Common Crawl, Wayback)
                                                   + contributions + seeds (industry list, Wikidata)
                                                   + boards found by trying known companies elsewhere
                                                   → check → index → tag → publish → release
```

## Pieces

| Piece | Where | What it does |
|---|---|---|
| Outbox and sharing | `packages/core/src/directory.ts`, CLI `setup check` | Boards found by Add by link (and not in the directory) are queued in `data/catalog/outbox.json` and sent to the inbox. Kept until sent. Off with `directory.share_additions: false`. |
| Moves outbox | `packages/core/src/directory.ts` (`queueMove`, `sendMoves`), `POST /api/directory/moves` | When you confirm a company's new careers link, the local server queues `{ name, from, to }` (boards checked like additions, from ≠ to) in `data/catalog/moves-outbox.json`, once per from+to. `rawjobs directory update` (and `share`) sends them to the inbox's `POST /v1/moves`, 10 a request, never at the moment of the click. 2xx or 400: dropped. 404 (an inbox from before moves), 429 (full or rate-limited), 503 (not open yet), other errors, offline: kept. Same switch as additions; with it off, nothing is queued and anything waiting is dropped unsent. The directory bar's "waiting to be shared" counts added boards only (`outbox`); `GET /api/directory` reports waiting moves separately as `moves`. |
| Directory download | `packages/core/src/directory.ts`, `rawjobs directory update` | Reads `manifest.json`, downloads newer files, checks SHA-256, swaps them in. The dev server runs it weekly in the background (`directory.auto_update`). |
| Contribution inbox | `services/contribute` | Cloudflare Worker. `POST /v1/contributions` (public, rate-limited, shape-checked, capped at `DAILY_CAP` boards a day for everyone, repeats within 7 days skipped); `GET /v1/pending` (500 a page, `?cursor=` for the next) and `POST /v1/ack` (up to 1,000 ids) for the workflow (token). Move reports ("this careers page moved"): `POST /v1/moves` (public, same rate limiter, up to 10 moves, each two boards and a company name; at most `MOVES_DAILY_CAP` new ones a day; distinct reporters counted with a keyed hash of IP + old board, made with `REPORTER_SECRET`, 503 without it); `GET /v1/moves/pending` (reporter count only, never the hashes) and `POST /v1/moves/ack` for the workflow (token). Moves are kept under `m:` keys, which `/v1/pending` never lists. |
| Contributions workflow | `.github/workflows/directory-contributions.yml` | Every 3 hours: accept, publish incrementally, commit `contributions.json`, acknowledge. Then review move reports (below). |
| Move review | `scripts/catalog/moves.ts`, `moves-approve.ts`, `lib/moves.ts`, `.github/workflows/directory-move-approval.yml` | Moved careers pages users report: checked and recorded every 3 hours by the contributions workflow, approved by a maintainer on a GitHub issue. Record-only: nothing is accepted automatically. See [Moved careers pages](#moved-careers-pages). |
| Weekly rebuild | `.github/workflows/directory-rebuild.yml` | Full rebuild and a dated release, in two jobs: `collect` gathers and checks boards, `publish` builds, gates and releases, and runs even if `collect` failed or ran out of time. The working state is saved as the `state` release, so the next run skips recently checked boards. Each collector runs under its own time cap (`scripts/catalog/capped.sh`) and may stop early without stopping the rebuild, so build and publish always get their turn. A run that doesn't publish opens a "Directory rebuild did not publish" issue. GitHub's schedules are best effort, so Monday has backup times (03:07, 05:37, 09:41, and Tuesday 03:13); each runs only if no rebuild has published in the last 5 days. The contributions, Common Crawl and job-feed workflows also start it when it's overdue (`scripts/catalog/watchdog.sh`: nothing for 8 days, or none yet this week by Monday 12:00 UTC), at most once a day and not while a "did not publish" issue is open; they also keep the scheduled workflows from being switched off after 60 quiet days. The directory runs share one concurrency group with `queue: max`, so a waiting run is never cancelled by a newer one. A published rebuild starts the site deploy. To test the workflow without publishing: `gh workflow run directory-rebuild.yml -f smoke=true` (about 25 minutes). |
| Releases | `rawjobs-directory` releases | Every publish is a new dated release, so earlier ones stay: `directory-YYYY-MM-DD` from the weekly rebuild, `directory-YYYY-MM-DD-HHMM-shared` when users' companies are added in between. Apps read the one marked latest. **Roll back:** `gh release edit <tag> -R Tanmay-Mhatre/rawjobs-directory --latest`. |
| Daily Common Crawl | `.github/workflows/directory-commoncrawl.yml` | 45 minutes a day of the Common Crawl URL index (the 12 newest crawls), on top of the rebuild's 35 minutes a week. Resumes per query; stops when the index keeps failing. The boards it finds are merged and checked by the next contributions run or rebuild. |
| Release gate | `scripts/catalog/guard.ts`, `gate.sh` | Runs before every upload, in the rebuild and the contributions workflow. Refuses a directory under 90% of the live release's companies or 85% of its indexed ones, under 20,000 / 10,000, with broken rows, or with broken or more than 50 new moves. A deliberate shrink: `gh workflow run directory-rebuild.yml -f allow_shrink=true`. |
| Finding more companies | `scripts/catalog/` | See [Coverage](#coverage) below. |
| Public directory repo | `Tanmay-Mhatre/rawjobs-directory` | Releases (the files apps download), `contributions.json`, `coverage.md`, attribution. |

Overrides: `RAWJOBS_DIRECTORY_URL` (download base) and `RAWJOBS_CONTRIBUTE_URL` (inbox) point an install at your own copies (the older `JOBHUNTER_` names still work). See [self-hosting.md](self-hosting.md).

## Coverage

The goal is to hold at least 90% of the companies on each hiring system the directory tracks
(Greenhouse, Lever, Ashby; at least 80% for SmartRecruiters and Workday). The weekly rebuild grows the list from five directions:

| Step | Script | What it adds | Per run |
|---|---|---|---|
| Common Crawl URL index | `commoncrawl.ts --per-run 3` | Board URLs in the last ~24 crawls, including the boards' API URLs. Incremental: only crawls not read yet. | ≤ 3 crawls |
| Wayback Machine URL index | `wayback.ts --max-minutes 60` | Board URLs the Internet Archive kept (snapshots from the last 3 years). Resumable; a full pass takes a few weeks, then starts again after 30 days. | 60 min |
| Wikidata companies | `seeds-bulk.ts`, `resolve.ts --bulk --limit 1500` | About 18k companies (50+ staff or listed, CC0), resolved from their own websites. Results are reused for 90 days. | 1,500 companies |
| Try known companies elsewhere | `crossprobe.ts --max-minutes 45` | Dead or empty boards (the company usually moved systems), companies whose site had no readable board, and Workday tenants whose site is dead. A board counts only if it is live and its own name matches the company. Attempts are kept for 90 days. | 45 min |
| Add by link | contributions | Boards users add (see above). | – |

`coverage.md` (in the directory repo) opens with the **Universe** table:
- **Sample coverage** is the figure the target is measured on: the share of Wikidata companies' live boards that our URL sources already had.
- **Estimate** is a lower bound from how often the URL sources agree (Chao2).
- A **hold-one-out** table shows how many live boards only one source lists.

Restricted lists (share-alike or no licence) are only counted, never published. yc-oss/api was left out because it has no licence.

## Industry tags

"My companies + my industries" scans, the Companies page's industry filter and the starter packs
only see directory companies with an industry, so `publish.ts` tags as many as it can verify. No AI:
each tag comes from one of these sources (`scripts/catalog/lib/tags.ts`):

| Source | `tag_src` | How | Kept in |
|---|---|---|---|
| Hand-made lists | (absent) | The seed list (`seeds/industries.json`), the curated list's `segment`, crypto-jobs-fyi's `category`. The other public lists have no industry column. | `tags` |
| Wikidata (CC0) | `wikidata` | The industries (P452) of the ~18k companies `seeds-bulk.ts` reads, fetched by two more item-pair queries in the same run (seconds each). Mapped by a fixed table of Wikidata items (`lib/wikidata.ts`; broad ones like "financial services" count only when nothing more specific does). A company matches by the board `resolve.ts --bulk` found on its website, or by the same name (one Wikidata company has it) and a board named like its website (`visa` for visa.com). | `tags` |
| Job titles | `titles` | `industriesFromTitles` (8% of titles, at least 2). Titles come from the job index (Greenhouse, Lever, Ashby, SmartRecruiters); else from the daily job feed's shards (Workday, and boards the index didn't reach), downloaded by `scripts/catalog/feed.sh`; else from the titles a live check read anyway (systems with no cheap count read the whole list: up to 60 distinct titles go to `out/titles.jsonl`, kept in the saved state). No extra requests. | `title_tags` |

In `directory.json` (and `index.json`) each company keeps `tags` (what the company is: lists,
Wikidata) and `title_tags` (what it hires for: titles only), as apps have always read them; scans
use both. `tag_src` (new, ignored by older apps) names the source of each tag that isn't from a
hand-made list, e.g. `{"payments": "titles", "banking": "wikidata"}`; the Companies page shows it
after the industry ("Payments · from its job titles"). `out/tags.json` records every source of
every tag. The publish log prints how many live companies have an industry, by source.

Measured on 2026-10-13 (the saved state, today's job feed and Wikidata): the 2026-10-12 release had
an industry on 6,176 of 38,302 live companies (16%). The same inputs built today hold 91,140 live
companies; the old rules tag 6,307 of them, the new ones 10,161 (+1,198 through Wikidata, +2,656
more through the job feed's titles, mostly Workday), before any check has kept titles. A sample of 400 live boards on the other
systems found titles for 398 and an industry for 134 (34%): about 20,000 more companies once their
monthly recheck has run.

## What is shared, and what isn't

Shared (on by default, off with `directory.share_additions: false` or Settings → Sharing): hiring
system, board slug (plus Workday shard/site, EU region), company name, and the app name
(`rawjobs`, optionally `/version`; older apps send `job-hunter`; any other value is dropped).
Confirmed careers-link moves (same switch): the company name and its old and new board, sent with
the next directory update. A move names a company the user follows, which additions don't.
Never shared: profile, resume, searches, statuses, which jobs you open. The inbox uses the IP
address only for rate limiting and stores none; for move reports it keeps a keyed hash of IP + old
board (30 days) to count distinct reporters. Full details for users: [PRIVACY.md](../PRIVACY.md).

The published data is CC BY 4.0 (`LICENSE-DATA` in the directory repo); sources and credits are
in its `NOTICE.md`. Public job boards (Hacker News, Remotive, Arbeitnow, Remote OK, Himalayas, Jobicy, We Work Remotely) are
never published.

## Denylist

Companies removed on request (takedowns, see `NOTICE.md` in the directory repo; we reply within 7
days) are listed in `denylist.json` at the root of the directory repo:

```json
{
  "companies": [
    { "key": "lever:acme", "reason": "Asked by the company (issue #123)", "added": "2026-10-09" },
    { "domain": "example.com", "reason": "Not a real employer", "added": "2026-10-09" },
    { "name": "Example Holdings", "reason": "Asked by the company", "added": "2026-10-09" }
  ]
}
```

Each entry has `reason` and `added` (`YYYY-MM-DD`) and at least one of:
- `key`: a directory key, `{ats}:{slug}` as in `directory.json` (case-insensitive);
- `domain`: matches a company whose careers page, or the website it was resolved from, is on this
  domain or a subdomain of it;
- `name`: matches the company name exactly, ignoring case and extra spaces.

How it's applied (`scripts/catalog/lib/denylist.ts`, read from `DENYLIST_FILE`):
- `build.ts` leaves matching companies out of `directory.json`, so they're also left out of the
  index and the release built from it;
- `jobs.ts` leaves them out of the job feed;
- `contributions.ts` rejects matching boards, so a user can't add one back by link;
- every workflow reads `denylist.json` from the directory repo; a missing file means nothing is
  removed, and an unreadable one fails the run (never publish without it);
- apps need no change: a removed company disappears with the next download.

## Moved careers pages

When a company's board stops working and a user finds its new one, the app can report the move
(`POST /v1/moves` on the inbox; plan: `docs/plans/update-careers-link-plan.md`, PR 3). Moves are
**record-only** for now: every report is checked and recorded, and a maintainer approves the good
ones. Nothing is accepted automatically.

**Files in the directory repo** (written by the workflows, next to `denylist.json`):
- `moves-pending.json`: reports waiting, keyed by the old board (`ats:slug|shard|site`), each with its
  candidate new boards, reporter counts, the old board's checks, each candidate's gate results and its
  review issue. Holds expire 30 days after the first report.
- `moves.json`: accepted moves (`by: "review"`), and later reverts (`reverted: true`, `reverted_at`).

**Every 3 hours** (`directory-contributions.yml`, after the contributions): `scripts/catalog/moves.ts`
pulls `GET /v1/moves/pending` (an inbox without it answers 404 and the steps are skipped), copies the
reports into `moves-pending.json`, commits it, then acknowledges them. It checks up to 50 old boards a
run (10 minutes at most, the usual HttpClient and user agent; an old board at most every 6 hours) and
runs the gates, cheapest first:

1. Denylist: neither board, nor the name.
2. The old board is in the directory under that name (the live release's `directory.json`), or was
   when it was first checked (the build drops dead boards).
3. The old board is gone: a 404/410 on two checks at least 24 hours apart with no 200 in between, on
   Greenhouse, Lever or Ashby. Anything else that doesn't answer for 24 hours (SmartRecruiters' 0
   jobs, a page read's "not found", Workday, timeouts) is *not proven*: it still goes to review, marked
   so. Until then the report is held; an old board that answers again is held too.
4. The new board is live with open jobs.
5. The new board isn't a different company in the directory (the same name is fine), and wasn't
   first contributed less than 30 days ago.
6. No chains or cycles: the new board isn't itself reported or accepted as moved, the old board
   hasn't moved already, and nothing moved to the old board.
7. If the company has another live board, it's recorded as a removal, not a move.

For every old board with a candidate that passes, it opens **one** issue, "Move review: <old board>",
labelled `move-review`, and keeps it up to date. Names and slugs are only inside a code block (no `@`,
no backticks); the only links are careers URLs computed from the checked board shape. A closed issue
is never reopened. The run summary counts new, passing, held, rejected, removed and expired reports,
and one "Move reports need a look" issue opens on a spike or when a run can't take everything.

**Approving** (`directory-move-approval.yml`): add the `move-approved` label to the issue. If more than
one candidate passes, first tick exactly one box in the issue (each box names a candidate by an id
computed from `moves-pending.json`). The workflow then:
- ignores the label unless whoever added it has **maintain or admin** access (asked of the API);
- reads the move from `moves-pending.json` by the issue number, never from the issue's text;
- runs every gate again with fresh checks;
- appends it to `moves.json`, comments and closes the issue; or comments why not and removes the label.

To refuse, close the issue. Only one candidate per old board can be approved.

**Build and release:** `build.ts` reads `moves.json` (`MOVES_FILE`) and adds a `moves` list to
`directory.json`: `[{ from, to, name, accepted_at }]` (board keys), accepted and not reverted, and
only when the new board is in the directory. They aren't counted as companies. A moved-away board is
left out of the directory, so it's never scanned or indexed again (a warning if it answers again).
The release gate refuses a directory whose moves point at a board it doesn't list, that still lists a
moved-away board, or that adds more than 50 moves since the live release. Older apps read only
`companies` and ignore `moves`. An approval reaches apps with the next release (the next
contributions publish or the weekly rebuild).

**Auto-accept** isn't built. `AUTO_ACCEPT` (the `MOVES_AUTO_ACCEPT` repo variable) is a placeholder
that changes nothing yet; the TODO in `scripts/catalog/lib/moves.ts` lists the company-owned evidence
it will need (a redirect from the old careers URL, or the company's own site linking the new board).

**Setup** (once): create the two labels in the code repo, then deploy the inbox Worker with `/v1/moves`:

```bash
gh label create move-review -R Tanmay-Mhatre/rawjobs --color FBCA04 --description "A reported careers page move to review"
gh label create move-approved -R Tanmay-Mhatre/rawjobs --color 0E8A16 --description "Maintainer approval of a move (maintain/admin only)"
```

## Job feed

Every day, `Jobs · daily feed` (`.github/workflows/jobs-daily.yml`, script `scripts/catalog/jobs.ts`)
reads every live directory board on Greenhouse, Lever, Ashby, SmartRecruiters and Workday once, for
everyone, and publishes slim rows (job id, title, location, workplace, posted date; no descriptions)
as one gzipped shard per hiring system on the `jobs` release of the directory repo.
`jobs-manifest.json` lists the shards with their SHA-256 and `schema` version; it's uploaded last.

- **Cheap to run:** Greenhouse, Lever and Ashby boards that haven't changed answer an empty 304
  (ETags are kept in the feed's own saved state, the `jobs-state.tar.gz` asset of the `state` release).
  A board that fails, or that the 5-hour limit leaves out, keeps yesterday's rows and date.
- **How apps use it** (`packages/core/src/job-feed.ts`): every scan downloads the shards that changed,
  then fetches live only the directory companies whose jobs could pass the user's filters, plus any
  the feed doesn't cover or that are more than 3 days old. Every job shown is still checked live;
  the feed only decides which companies are worth a request. `rawjobs scan --full` skips the feed.
- **Watching it:** the workflow opens an issue when a run fails, or when jobs or companies move more
  than 20% from the day before. It also re-enables itself each run, so GitHub doesn't switch the
  schedule off after 60 quiet days.
- **Format changes:** bump `JOB_FEED_SCHEMA`; older apps ignore a feed they don't understand and
  scan live.

### Second format: a full copy, then a change file a day

About 31% of companies change on a given day but only about 5% of jobs, so re-downloading the whole
feed daily (25 MB) wastes almost all of it. The second format (`packages/core/src/job-feed-diff.ts`,
`scripts/catalog/lib/feed-v2.ts`) works like OpenStreetMap's update files:

- `jobs-v2-snapshot-<seq>.json.br`: the full copy, brotli (about 18.5 MB), for new installs.
- `jobs-v2-diff-<seq>.json.br`: that day's changes. Per company, the job ids that closed or changed
  and the jobs that are new or changed. Also the companies that were added, dropped, or not read that
  day. On real data, a day's file is about 0.85 MB.
- `jobs-v2-manifest.json` (uploaded last): version `seq`, the fingerprint of the full state
  (`feedStateHash`), the snapshot, and the last 14 change files.

The build checks every change file before publishing it: yesterday's copy plus the change file must
reproduce today's copy exactly, or only the full copy is published. Apps apply the change files since
their version and check the result against the manifest's fingerprint. When they're more than 14 days
behind, a file is missing, or the fingerprint doesn't match, they take the full copy. They keep the
copy in `catalog/jobs/v2-state.json.br`, and remember which companies matched so that after an update
only companies whose jobs changed are checked again.

On real data (1.28M jobs), a day's update takes about 3 s and filtering about 2.5 s; with nothing new,
filtering is instant. The first format is still published next to it while installs update; drop it
(and the shard code in `jobs.ts` and `syncJobFeed`) once every supported app reads the second. The
directory build reads the first format's shards for industry tags (`feed.sh`, `readFeedTitles`):
move those to the full copy first.

## One-time setup

1. **GitHub permission for workflow files** (once): `gh auth refresh -s workflow`
2. **Public directory repo**: `gh repo create Tanmay-Mhatre/rawjobs-directory --public`, then add the files from `services/directory-repo-template/`.
3. **Seed it** from an existing local build so the first weekly run is quick:
   `pnpm catalog:release --out dist`, then `gh release create directory-YYYY-MM-DD dist/* --latest -R <repo>`;
   and upload `catalog-state.tar.gz` (out/checks.jsonl, out/index-all.jsonl, out/titles.jsonl, out/resolved.json, raw/wikidata/companies.json) to a prerelease tagged `state`.
4. **Inbox** (Cloudflare account needed): in `services/contribute`
   (after `pnpm install` at the repo root) `npx wrangler login`, `npx wrangler kv namespace create INBOX` (put the id in `wrangler.toml`),
   `npx wrangler secret put INBOX_TOKEN` (a long random string), `npx wrangler secret put REPORTER_SECRET`
   (another long random string, kept only in the Worker; it keys the reporter hashes on move reports, and
   without it `/v1/moves` answers 503), `npx wrangler deploy`. `DAILY_CAP` and `MOVES_DAILY_CAP` are in `wrangler.toml`.
5. **Secrets in the code repo** (`gh secret set NAME`):
   - `INBOX_URL`: the Worker URL from step 4
   - `INBOX_TOKEN`: the same string as step 4
   - `DATA_REPO_TOKEN`: a fine-grained token with *Contents: read and write* on the directory repo only, expiring in 90 days
     (rotation steps: [self-hosting.md](self-hosting.md#tokens))
   - `RAWJOBS_DATA_SIGNING_KEY`: the private data signing key (PEM). Apps accept `manifest.json`,
     `jobs-manifest.json` and `jobs-v2-manifest.json` only with a valid `.sig` made with it
     (`packages/core/src/data-signing.ts`; making the key: [self-hosting.md](self-hosting.md#run-your-own-directory))
     The publishing workflows sign what they publish. To sign what's already out there (the first
     time, after a failed signing step, or after changing the key), run **Data · sign what's
     published** from the Actions tab: a minute, no rebuild.
6. **Point apps at the inbox**: set `DEFAULT_CONTRIBUTE_URL` in `packages/core/src/directory.ts` to the Worker URL.

## Cost

Free tiers cover it: Cloudflare Workers + KV (well under the daily limits), GitHub Releases for the
files (about 7 MB per directory release, roughly 10–20 MB for the job feed), and GitHub Actions, which
is free and unmetered for public repos.
