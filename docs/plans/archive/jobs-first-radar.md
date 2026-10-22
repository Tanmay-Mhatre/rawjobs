# Jobs-first Radar + my companies (plan v1)

Status: Shipped (PR #1 / v0.1.0), steps 0–4. Notes on what changed from the plan are under each step. Replaces the "Suggested for you" part of `companies-flow.md`.
Built from a code and data review, a two-agent debate (job-first vs company-first), and the user's decisions.

## Decisions
| # | Decision |
|---|---|
| 1 | The Radar shows **every job that passes your title and location rules**, from the whole directory, best match first. |
| 2 | Your companies are a **highlight, not a gate**: their jobs are **always on top** (above any other job, whatever the score), with a "Your company" badge. |
| 3 | A **"My companies" view** on the Radar shows only their jobs. With no companies yet, it sends you to the Companies page. |
| 4 | The **Companies page** becomes your list: add (search the directory or paste a link), see what each one has for you, remove. The "Suggested for you" card wall goes. |
| 5 | **Live check is on** (switch in Settings): each scan also checks up to **30 companies you haven't added**, so the top of the list gets full scores and real apply links. |
| 6 | Index jobs (not checked yet) show an **estimated** score and link to the careers page. They never trigger "new strong match" alerts. |

## Measured on the current profile (index of 6 Oct)
- Today: 200 companies → 16,426 jobs downloaded in 219 s → 108 matches at 31 companies.
- Whole index: 766 eligible jobs at 476 companies; 306 posted in the last 30 days; ~101 at the 200 tracked companies.
- 208 untracked companies have a fresh (≤30 d) eligible job: all live-checked within ~4 days at 30 per scan, 2 scans a day; then ~8–10 new companies a day.
- Index-only score tops out at 65 (no description → no keyword points).

## End-to-end flow
1. **Scan** (`jobhunter run`, "Scan now", later the daily Action):
   1. Gate the downloaded index (`data/catalog/index.json`) with your rules → candidate rows. No web requests.
   2. Pick the live-check batch: up to `discovery.verify_per_run` (default 30) untracked, unmuted companies, best estimated
      score then freshest first, skipping any checked in the last 7 days.
   3. Fetch **your companies + the batch** with the existing connectors; full scoring as today.
   4. Merge into history. Jobs from checked companies stay until that company is next checked (normal close rules).
   5. Write the rest of the candidate rows (companies not live-checked) to `discover.json` as index jobs.
2. **Radar**: loads `jobs.json` + `discover.json`; your companies' jobs first, then the rest by score.
3. **Companies page**: your list with per-company matches and health; add / remove; muted companies.

## Work, in order

### 0. Data fixes (both lists depend on them) ✅ done
- **Real ages** ✅: `rowPostedAt(ageDays, generatedAt)` in `core/suggest.ts` anchors index ages to the index's
  `generated_at`; the CLI passes it. `discover.ts` will reuse it.
- **Greenhouse locations**: dropped. Greenhouse's list call returns office names only with `content=true`
  (docs.greenhouse.io/job-board.html), ~15× heavier per board. Not needed: once a company is live-checked its index
  rows are dropped, so index rows never have to match live jobs.
- **Industry tags from job titles** ✅: a higher threshold can't work (at 15% Anthropic and Cohere lose "AI" while
  Warner Music keeps it: titles say what a company hires for, not what it is). Instead `publish.ts` now writes
  `tags` (from source lists / seed list) and `title_tags` (from job titles only). Suggestions treat title-only
  industries as "Hires for … roles" worth 10 of 30 points, never "Your industry"; the Radar's industry filter uses
  `tags` only. Takes effect with the next directory release after this merges (weekly rebuild).
- **One entry per company** in directory search ✅: `groupBoards` in `apps/web/src/lib/companies.ts`; best board
  leads, other live boards fold under "N other boards", dead boards hidden when a live one exists (unless watched).

### 1. Core: discovery + live check ✅ done
Built as `core/discover.ts` (candidates, `pickChecks`, ledger, `toIndexJobs`) and `core/scan.ts` (one scan for the
CLI and "Scan now"). Config keys: `discovery.check_per_scan` (default 30) and `companies_muted`. Checked companies keep
only jobs that pass the gates. A scan works with no companies of your own.
First real scan (current profile, copy of data/): 194 matches (was 108), 50 strong (was 28); the 30 checked
companies added 86 matches / 21 strong in 72 s; 582 index jobs written (190 posted in the last 30 days). Total 281 s (was 219 s).

Original plan:
- `packages/core/src/discover.ts` (new):
  - `findCandidates(profile, index, now)` → eligible rows with estimated score (`gateOf` + `scoreJob` without description).
  - `pickVerifyBatch(candidates, tracked, muted, ledger, limit)` → companies to live-check.
  - `toIndexJobs(candidates, skipKeys)` → dashboard rows: id `index:{companyKey}:{hash(title|location)}`,
    `source: "index"`, `url` = careers URL, `estimated: true`. Capped at 1,000 rows (broad profiles).
- `run.ts`: `runRadar` takes the extra batch; each job carries `source: "tracked" | "checked"`.
- `diff.ts` `mergeHistory`: today it **drops jobs of companies not in the config**. Keep jobs of companies in the
  discovery ledger (checked in the last 30 days); close them with the same missed-runs rule when re-checked.
- Ledger `data/discovery.json`: `{ [companyKey]: { lastChecked, matches } }`.
- Config: `discovery: { verify_per_run: 30 }` (0 = off) and `companies_muted: []` in `schema.ts`.
- `store.ts` `saveRun`: also writes `discover.json`; meta keeps per-run "checked N new companies".
- CLI: progress lines for the batch ("Checking 30 more companies hiring for you…"); `--no-discover` flag.
- Tests: candidates, batch picking (skip window, muted, tracked), merge keeps checked companies' jobs, index-job ids stable.

### 2. Radar ✅ done
Also: industry is no longer a default Radar filter (only 13% of directory companies have one, so it hid most jobs); every job carries its company's directory industries. Index ages count from each company's `fetched_at` (the weekly build reuses fetches up to 7 days old). Check now doesn't add to the run history.

Original plan:
- `lib/data.ts`: load `discover.json` (optional file; older data works without it).
- `lib/filters.ts` `sortJobs`: every sort puts **your companies first**, then the chosen order. New `Filters.mine` flag.
- `RadarPage.tsx`:
  - built-in view **"My companies"**; with no companies it shows "Pick the companies you want to work at → Companies".
  - section split: "Your companies (N)" then "All jobs for you (N)".
  - index jobs: "Estimated · from weekly index · posted ~X days ago" chip, "Check now" (1 request), apply → careers page.
  - default hides index jobs older than 30 days, with a toggle.
- `JobCard.tsx` / `JobDetail.tsx`: "Your company" badge; **Add company** and **Mute company** on every job.
- New-job badges and alerts only for tracked and live-checked jobs.

### 3. Companies page ✅ done
The "remove?" flag needs 10+ scans in a row with nothing for you over 7+ days (run history keeps 30 scans, so "30 days" wasn't measurable).

Original plan:
- Replace `CompanyFinder` tabs with: search box over the directory (fuzzy, one row per company, shows "N roles match you"),
  "Add by link" (kept), your list merged with the health table (sortable: matches, jobs, status), muted list.
- Prompt "Nothing for you in 30 days, remove?" on tracked companies with no matches.
- Remove "Suggested for you", "Add all", the "On your shortlist" label and the capped counts.

### 4. Settings + docs ✅ done

Original plan:
- Settings: "Also check up to 30 new companies each scan" switch (on), number field.
- README: how the Radar finds jobs, fair use note updated (your companies + 30 per scan).

**Total: ~7 days.**

## Risks
- **Index jobs may be closed** (up to 7 days old). Labelled "estimated", never alerted; "Check now" confirms.
- **Broad profiles** (e.g. "engineer, US + remote": ~32k eligible): 30 checks per scan only cover the freshest;
  the list is capped and setup nudges a narrower title above 2,000 matches.
- **Fair use**: tracked companies + 30 per scan. A user with 200 tracked companies still makes ~230 requests per scan;
  the remove prompt helps.
- **Static build / GitHub Actions**: works, since `discover.json` is written by the run; no local API needed.
- Companies on hiring systems we can't read (Workday etc.) appear in neither list.

## Later
- ETag / 304 for unchanged Greenhouse boards (verified to return 0 bytes): cheaper daily scans.
- Daily index refresh for recently active companies (needs runner-time measurement).
- Topic hits in the index for better estimates (only helps profiles whose keywords are in the topic list).
