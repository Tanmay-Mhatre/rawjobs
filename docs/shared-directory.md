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
| Contributions workflow | `.github/workflows/directory-contributions.yml` | Every 3 hours: read the job boards for links to companies' own boards (`feed-boards.ts`, see [Coverage](#coverage)), accept, publish incrementally, commit `contributions.json`, acknowledge. Then review move reports (below). |
| Move review | `scripts/catalog/moves.ts`, `moves-approve.ts`, `lib/moves.ts`, `.github/workflows/directory-move-approval.yml` | Moved careers pages users report: checked and recorded every 3 hours by the contributions workflow, approved by a maintainer on a GitHub issue, or accepted automatically with company-owned evidence when `MOVES_AUTO_ACCEPT` is set. See [Moved careers pages](#moved-careers-pages). |
| Weekly rebuild | `.github/workflows/directory-rebuild.yml` | Full rebuild and a dated release, in two jobs: `collect` gathers and checks boards, `publish` builds, gates and releases, and runs even if `collect` failed or ran out of time. The working state is saved as the `state` release, so the next run skips recently checked boards. Each collector runs under its own time cap (`scripts/catalog/capped.sh`) and may stop early without stopping the rebuild, so build and publish always get their turn. A run that doesn't publish opens a "Directory rebuild did not publish" issue. GitHub's schedules are best effort, so Monday has backup times (03:07, 05:37, 09:41, and Tuesday 03:13); each runs only if no rebuild has published in the last 5 days. The contributions, Common Crawl and job-feed workflows also start it when it's overdue (`scripts/catalog/watchdog.sh`: nothing for 8 days, or none yet this week by Monday 12:00 UTC), at most once a day and not while a "did not publish" issue is open; they also keep the scheduled workflows from being switched off after 60 quiet days. The directory runs share one concurrency group with `queue: max`, so a waiting run is never cancelled by a newer one. A published rebuild starts the site deploy. To test the workflow without publishing: `gh workflow run directory-rebuild.yml -f smoke=true` (about 25 minutes). |
| Releases | `rawjobs-directory` releases | Every publish is a new dated release, so earlier ones stay: `directory-YYYY-MM-DD` from the weekly rebuild, `directory-YYYY-MM-DD-HHMM-shared` when users' companies are added in between. Apps read the one marked latest. **Roll back:** `gh release edit <tag> -R Tanmay-Mhatre/rawjobs-directory --latest`. |
| Daily Common Crawl | `.github/workflows/directory-commoncrawl.yml` | 45 minutes a day of the Common Crawl URL index (the 12 newest crawls), on top of the rebuild's 35 minutes a week. Resumes per query; stops when the index keeps failing. The boards it finds are merged and checked by the next contributions run or rebuild. |
| Release gate | `scripts/catalog/guard.ts`, `gate.sh` | Runs before every upload, in the rebuild and the contributions workflow. Refuses a directory under 90% of the live release's companies or 85% of its indexed ones, under 20,000 / 10,000, with broken rows, or with broken or more than 50 new moves. A deliberate shrink: `gh workflow run directory-rebuild.yml -f allow_shrink=true`. |
| Finding more companies | `scripts/catalog/` | See [Coverage](#coverage) below. |
| Visa sponsors | `scripts/catalog/visa.ts`, `lib/visa.ts`, `packages/core/src/catalog/visa.ts` | Government lists of employers that may sponsor work visas, matched to directory companies by name. See [Visa sponsors](#visa-sponsors). |
| Public directory repo | `Tanmay-Mhatre/rawjobs-directory` | Releases (the files apps download), `contributions.json`, `coverage.md`, attribution. |

Overrides: `RAWJOBS_DIRECTORY_URL` (download base) and `RAWJOBS_CONTRIBUTE_URL` (inbox) point an install at your own copies (the older `JOBHUNTER_` names still work). See [self-hosting.md](self-hosting.md).

## Coverage

The goal is to hold at least 90% of the companies on each hiring system the directory tracks
(Greenhouse, Lever, Ashby; at least 80% for SmartRecruiters and Workday). The weekly rebuild grows the list from six directions:

| Step | Script | What it adds | Per run |
|---|---|---|---|
| Common Crawl URL index | `commoncrawl.ts --per-run 3` | Board URLs in the last ~24 crawls, including the boards' API URLs. Incremental: only crawls not read yet. | ≤ 3 crawls |
| Wayback Machine URL index | `wayback.ts --max-minutes 60` | Board URLs the Internet Archive kept (snapshots from the last 3 years). Resumable; a full pass takes a few weeks, then starts again after 30 days. | 60 min |
| Wikidata companies | `seeds-bulk.ts`, `resolve.ts --bulk --limit 1500` | About 18k companies (50+ staff or listed, CC0), resolved from their own websites. Results are reused for 90 days. | 1,500 companies |
| Try known companies elsewhere | `crossprobe.ts --max-minutes 45` | Dead or empty boards (the company usually moved systems), companies whose site had no readable board, and Workday tenants whose site is dead. A board counts only if it is live and its own name matches the company. Attempts are kept for 90 days. | 45 min |
| Job board links | `feed-boards.ts --max-minutes 5` (contributions workflow, every 3 hours) | Boards the public job boards' jobs link to (apply links, links in Hacker News posts), kept in `raw/feeds/boards.json` with which feed saw each and when. Only the board is kept, never the jobs. Each feed is read at most as often as its connector allows (Himalayas daily, Hacker News twice a day, the rest every 6 hours). | 7 feeds |
| Add by link | contributions | Boards users add (see above). | – |

`coverage.md` (in the directory repo) opens with the **Universe** table:
- **Sample coverage** is the figure the target is measured on: the share of Wikidata companies' live boards that our URL sources already had.
- **Estimate** is a lower bound from how often the URL sources agree (Chao2).
- A **hold-one-out** table shows how many live boards only one source lists.

Restricted lists (share-alike or no licence) are only counted, never published. yc-oss/api was left out because it has no licence.

## Visa sponsors

Governments publish lists of employers allowed to sponsor work visas. The weekly rebuild downloads
them (`pnpm catalog:visa`, before the build), keeps each as normalised names in
`scripts/catalog/raw/visa/<country>.json` (in the saved state, so a failed download uses last week's
copy, and the contributions publishes keep the field), and `publish.ts` tags each company it finds:

```json
{ "key": "greenhouse:acme", "name": "Acme", "visa": { "GB": "2026-10-13", "US": "FY2026", "CA": "2026Q1", "NL": "2026-10-05" } }
```

Country code → the list the company was on: a date (UK, Netherlands), a US fiscal year, or a
quarter (Canada). The same field is on `index.json` companies. It's optional and new: older apps
read directory files with a plain JSON parse and only the fields they know, so they ignore it.

Sources (each with its own terms; the app names the source on every job it shows the badge on):

| Country | Register | Terms | What's used |
|---|---|---|---|
| GB | Home Office, [Register of licensed sponsors: workers](https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers) | Open Government Licence v3.0 | Work routes: Skilled Worker, Global Business Mobility (Senior or Specialist, Graduate Trainee, UK Expansion), Scale-up |
| US | USCIS, [H-1B Employer Data Hub](https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub) | US government work, public domain | Last two fiscal years with data; employers with at least one new-employment or continuation approval |
| CA | ESDC, [Positive LMIA employers list](https://open.canada.ca/data/en/dataset/90fed587-1364-4f33-a9ee-208181dc0b97) | Open Government Licence – Canada | Last four quarters, every stream except primary agriculture |
| NL | IND, [Public register of recognised sponsors](https://ind.nl/en/public-register-recognised-sponsors/public-register-work) (work) | "Reuse of content is allowed, if you mention the source" ([proclaimer](https://ind.nl/en/proclaimer)) | The whole work register |

**Matching** (`scripts/catalog/lib/visa.ts`) is by name only, since no register lists websites, and
prefers missing a sponsor to tagging the wrong company. Names are lower-cased, stripped of accents,
punctuation, a leading "The" and trailing legal forms and fillers (Ltd, Limited, LLC, Inc, Corp, PLC,
GmbH, LLP, B.V., & Co, UK, USA, Group, Holdings…); a trading name ("t/a", "DBA") counts as a second
name. A directory name is never matched when it is:
- shorter than 4 letters, only digits, or on the stoplist (`VISA_STOPLIST`: "Digital", "Solutions"…);
- shared by several directory companies;
- common on the registers (other employers use it: "Passion" is in "Passion Foods", "Passion
  Care"…): from 3 such names only for a company with 25+ open jobs or on the curated list, from 10
  never ("Nationwide", "Ideal").

The run log prints matches per country and how many names were skipped. To check matches by eye:
`pnpm catalog:visa --match` (against `out/directory.json`).

**In the app:** a job whose company is on the register for the job's country (any of a role's
places) shows "Sponsors visas", with the register, the list's date and its source on the job page,
and Radar › More › "Only companies that sponsor visas" keeps only those. It's a filter only: it
doesn't change scores or order. A company on the list can sponsor; that doesn't mean a given role will.

## Industry tags

"My companies + my industries" scans, the Companies page's industry filter and the starter packs
only see directory companies with an industry, so `publish.ts` tags as many as it can verify. No AI:
each tag comes from one of these sources (`scripts/catalog/lib/tags.ts`):

| Source | `tag_src` | How | Kept in |
|---|---|---|---|
| Hand-made lists | (absent) | The seed list (`seeds/industries.json`), the curated list's `segment`, crypto-jobs-fyi's `category`. The other public lists have no industry column. | `tags` |
| Wikidata (CC0) | `wikidata` | The industries (P452) of the ~18k companies `seeds-bulk.ts` reads, fetched by two more item-pair queries in the same run (seconds each). Mapped by a fixed table of Wikidata items (`lib/wikidata.ts`; broad ones like "financial services" count only when nothing more specific does). A company matches by the board `resolve.ts --bulk` found on its website, or by the same name (one Wikidata company has it) and a board named like its website (`visa` for visa.com). | `tags` |
| Job titles | `titles` | `industriesFromTitles` (8% of titles, at least 2). Role words ("Store Manager", "Cashier") count anywhere; an industry's generic words ("retail", "healthcare", "banking") don't count where they name a customer segment: in a business-to-business selling title ("Account Executive, Retail", "Healthcare Solutions Engineer") or after "for"/"to", so a restaurant-software company isn't tagged Retail. Measured with `scripts/catalog/industry-precision.ts`. Titles come from the job index (Greenhouse, Lever, Ashby, SmartRecruiters); else from the daily job feed's full copy (`jobs-v2-snapshot-<seq>.json.br`; the first format's shards if it can't be downloaded) for Workday and boards the index didn't reach, downloaded by `scripts/catalog/feed.sh` (one row per job id, up to 300 titles per company); else from the titles a live check read anyway (systems with no cheap count read the whole list: up to 60 distinct titles go to `out/titles.jsonl`, kept in the saved state). No extra requests. | `title_tags` |

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
in its `NOTICE.md`. Public job boards (Hacker News, Remotive, Arbeitnow, Remote OK, Himalayas, Jobicy, We Work Remotely, Remote First Jobs) are
never published; only the hiring-system boards their jobs link to are kept, as a source of companies.

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
(`POST /v1/moves` on the inbox; plan: `docs/plans/update-careers-link-plan.md`, PR 3). Every report
is checked and recorded, and a maintainer approves the good ones. A move whose company page proves it
can also be accepted automatically, but only with the `MOVES_AUTO_ACCEPT` repo variable set (see
[Company evidence and auto-accept](#company-evidence-and-auto-accept); plan: `docs/plans/auto-accept-moves.md`).

**Files in the directory repo** (written by the workflows, next to `denylist.json`):
- `moves-pending.json`: reports waiting, keyed by the old board (`ats:slug|shard|site`), each with its
  candidate new boards, reporter counts, the old board's checks, each candidate's gate results and its
  review issue. Holds expire 30 days after the first report.
- `moves.json`: accepted moves (`by: "review"` or `"auto"`), and later reverts (`reverted: true`,
  `reverted_at`). Auto moves also keep `evidence_url`, `verified` and `confirmed_at`.
- `moves-blocked.json`: moves nobody may make again: a maintainer closed the review, or an auto move
  was reverted. Gate 0 rejects them, for the scheduled run and for approvals. Only editing this file
  lifts a block.
- `moves-baselines.json`: snapshots of company careers pages (which boards each one linked, and when),
  taken 40 a run, so a later before/after swap can be proven.

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

### Company evidence and auto-accept

Only the company itself can point at its new board, so evidence comes from one page: the
company-hosted careers page the directory already had for the old board (its `careers_url` on a host
that isn't a hiring system), plus that same host's homepage. Never a sibling subdomain, never anything
a reporter or a board owner typed, never a name match (`scripts/catalog/lib/evidence.ts`).
- **S1:** the page links exactly one hiring-system board, and it's the candidate. URLs are pulled out
  (after undoing JSON and HTML escapes) and run through the board detectors, so `acme` never matches
  `acme-fake`, and an Oracle board on another career site doesn't count. Several boards on the page
  (group or subsidiary sites) go to a person.
- **S2:** the old careers URL now redirects to the candidate, every hop before the last on the trusted host.
- **Old board gone:** besides 404/410 on Greenhouse, Lever and Ashby, a vendor-provisioned host (Taleo,
  Workday, Oracle, SuccessFactors) that is NXDOMAIN on two checks 24 h apart is proven gone.
- **Domain age:** RDAP (IANA bootstrap): the domain must be over a year old, and not registered after
  our first snapshot of the page. Some TLDs have no RDAP (`.ae`, `.io`, `.co`): unknown age means a
  person approves.

Pages are fetched by `lib/safe-fetch.ts`: https on port 443 only, every hop's host resolved and refused
if it's private, loopback, link-local or CGNAT, redirects followed by hand (5 at most), a 2 MB body cap,
no cookies, and a strict robots.txt (a 4xx allows, a 5xx or no answer disallows).

Each passing candidate gets a **verdict**, shown in a "Company evidence" block on the review issue:
- `auto`: S1 or S2, the old board proven gone (or a before/after swap against a snapshot from before
  the report), a domain old enough, and not a pack company (an industry-tagged one; those always get a person);
- `fast`: S1 or S2, but something above is missing. The issue opens with that candidate's box ticked,
  and a maintainer adds `move-approved`;
- `manual`: no usable evidence.
A company page that points at a board no one reported is flagged on the issue for a person.

With `MOVES_AUTO_ACCEPT` unset (the default), that's all: **shadow mode**. The run summary counts
"would auto-accept" and fast-track, so you can see the volume before switching it on. Set it to `true`
and the scheduled run accepts `auto` verdicts itself, at most 10 a run and 20 a day:
- the move is written with `by: "auto"` but **not published** until a look at the company page at
  least a day later still shows it (`confirmed_at`). Until then nothing is delisted and no app sees it;
- the review issue is closed with the evidence;
- for 30 days the page is checked again every 6 hours. Only a contradiction (the page now points at a
  different board) reverts the move and blocks it for good; an unreadable or bot-blocked page doesn't,
  it's just looked at again later. A revert opens or comments on the "Move reports need a look" issue.
  An auto move never confirmed within those 30 days is dropped (reverted, but not blocked).
Apps show auto moves like approved ones ("checked by RawJobs").

Undo an auto move by hand: set `reverted: true` (and `reverted_at`) on it in `moves.json`, and add the
pair to `moves-blocked.json`. Both workflows run `scripts/catalog/moves-lint.ts` after rebasing, so a
race between an approval and an auto-accept can't leave two active moves for one old board.

**Setup** (once): create the two labels in the code repo, then deploy the inbox Worker with `/v1/moves`:

```bash
gh label create move-review -R Tanmay-Mhatre/rawjobs --color FBCA04 --description "A reported careers page move to review"
gh label create move-approved -R Tanmay-Mhatre/rawjobs --color 0E8A16 --description "Maintainer approval of a move (maintain/admin only)"
```

## Job feed

Every 6 hours, `Jobs · feed every 6 h` (`.github/workflows/jobs-daily.yml`, script `scripts/catalog/jobs.ts`)
reads every live directory board on every hiring system with a connector once, for everyone, and
publishes slim rows (job id, title, location, workplace, posted date; for Workday's "3 Locations"
jobs, where they are; no descriptions) on the `jobs` release of the directory repo.

- **Four groups, one merge:** a crawl job per group of systems (`GROUPS` in `jobs.ts`: SmartRecruiters;
  Paylocity, Paycom, Hireology, Workable; Workday and the other enterprise systems; everything else)
  runs side by side, each with its own saved state (`jobs-<group>-state.tar.gz` on the `state`
  release). The merge job alone writes, signs and publishes; a group that failed is replaced by its
  previous saved copy. CI paces the shared APIs faster than the app does (`CI_HOST_DELAYS`).
- **Started twice, run once:** GitHub's cron often starts hours late, so a Cloudflare cron
  (`services/feed-trigger`) also starts the workflow. The first job skips the run when this schedule
  slot's feed is already built (`scripts/catalog/slot-covered.mjs`; `force` overrides). `publish: false` runs everything but publishes,
  saves and opens nothing (and a run publishes only from `main`).
- **Cheap to run:** Greenhouse, Lever and Ashby boards that haven't changed answer an empty 304.
  A board that fails, or that the 4-hour limit leaves out, keeps its previous rows and time. A system
  with 100 failed boards in a row is stopped for the run (a blocked runner).
- **How apps use it** (`packages/core/src/job-feed.ts`): every scan brings its copy up to date, then
  fetches live only the directory companies whose jobs could pass the user's filters, plus any the
  feed doesn't cover, that are more than 3 days old, or whose board stopped at a cap (`partial`).
  Every job shown is still checked live; the feed only decides which companies are worth a request.
  `rawjobs scan --full` skips the feed.
- **Watching it:** the merge job opens (or comments on) one issue per hiring system that stops, has
  more than 30% of its boards fail, or moves more than 20% in jobs, and one when a run fails. It also
  re-enables itself each run, so GitHub doesn't switch the schedule off after 60 quiet days.

### Formats: a full copy, then a change file per run

Only a few % of jobs change between runs, so apps download a full copy once and then only change files
(`packages/core/src/job-feed-diff.ts`, `scripts/catalog/lib/feed-v2.ts`), the way OpenStreetMap ships
updates:

- `jobs-v3-snapshot-<seq>.txt.br`: the full copy of every system in the compact text format
  (`job-feed-compact.ts`: each title and place stored once, each company's jobs one string), so an app
  holds millions of jobs in a few hundred MB. `jobs-v3-diff-<seq>.json.br`: one run's changes.
  `jobs-v3-manifest.json` (uploaded last): version `seq`, the fingerprint of the full state
  (`feedStateHash`), the snapshot, and the last 56 change files (14 days).
- `jobs-v2-*` (JSON) and the first format (`jobs-manifest.json`, one gzipped shard per system) stay
  frozen to Greenhouse, Lever, Ashby, SmartRecruiters and Workday, for apps from before the third.

The build checks every change file before publishing it: the previous copy plus the change file must
reproduce this copy exactly, or only the full copy is published. Apps apply the change files since
their version and check the result against the manifest's fingerprint; when they're too far behind,
a file is missing, or the fingerprint doesn't match, they take the full copy. The previous run's full
copy and shards stay published one more run, for apps part-way through downloading them. Apps keep
the copy in `catalog/jobs/v3-state.txt.br` and remember which companies matched, so after an update
only companies whose jobs changed are checked again. The directory build reads the second format's
full copy for industry tags (`feed.sh`, `readFeedTitles`).

**Format changes:** bump the schema; older apps ignore a feed they don't understand and scan live.

### Hiring activity

After the feed is built, `scripts/catalog/activity.ts` reads today's change file and records each
company's new roles (`packages/core/src/activity.ts`, `scripts/catalog/lib/activity.ts`). A new role
is a job id first seen that day whose title (groupKey's title part: place left out) the company hasn't
listed in the last 60 days, so reposts and one role posted per city don't count; a company's first day
in the feed (or its first day back after it was dropped) is its starting point, not new roles. Titles
are also sorted into internships, graduate and early-career roles, and the rest, from their words.

- `activity-state.json` (kept in the saved state, about 18 MB): per company, its titles of the last
  60 days, new roles per day for 60 days and per month for 13 months. Losing it restarts the records.
- `jobs-activity-<seq>.json.br` (listed as `activity` in `jobs-v2-manifest.json`, with its SHA-256;
  about 0.2 MB): per company, new roles per month (total, internships, graduate), new roles and roles
  posted (from posted dates) in the last 30 days, the day its records start when later than the
  file's `since`, and `e: 1` for mass posters (over 500 open jobs and new ids mostly reposts, or new
  roles over half the open jobs: lists turning over at a hiring system's cap). Mass posters are never
  a hiring surge.

The step may fail without stopping the feed: the manifest then has no `activity` entry that day and
apps keep what they have. A day without a change file (the feed published only a full copy) or a day
the step didn't run goes uncounted. Apps compare the last 30 days with the usual pace after 42 days
of records (`BASELINE_MIN_DAYS`).

In the app, the activity file comes with the feed (checked against the signed manifest's SHA-256,
kept as `catalog/jobs/activity.json.br`, ignored once over 7 days old). Each scan writes
`data/activity.json` for the companies in your history: the feed's numbers where it covers the company,
else the same numbers from your own scans (`localActivity`: records start the day the company was first
scanned). The job drawer shows "Hiring at {company}"; a company with at least 5 new roles in the last 30
days, twice its usual pace or more, gets a "Hiring surge" tag and the Radar's "Only companies with a
hiring surge" filter. Both stay hidden until some company has 6 weeks of records (`meta.json`
`hiringReady`), so nobody sees a filter that can only be empty. None of it changes a job's score.

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
