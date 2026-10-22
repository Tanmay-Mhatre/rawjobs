# GitHub Actions speed-up: plan and review

2026-10-21. Base: origin/main 955a493. Four authors measured the runs and wrote one plan each
(plan-A to plan-D beside this page). A lead review, then an independent four-specialist review
(Actions/Mergify platform, crawler pacing, data reliability, devil's advocate) checked them against
the code and official docs. **The amendments below override the plan files where they differ.**
Nothing is built until the owner says go.

| Plan | Scope | Today | After | Risk |
|---|---|---|---|---|
| [A](plan-A-jobs-feed.md) | Jobs feed (`jobs-daily.yml`, `jobs.ts`, `http.ts`, Dayforce connector) | ~4 h 20 m a run | ~2 h (A1), ~1 h 40 m (A2), less with A3 | medium |
| [B](plan-B-directory.md) | Weekly directory rebuild + daily URL indexes | ~168 m (heavy ~268) | ~86 m (heavy ~140) | low → medium |
| [C](plan-C-ci.md) | CI, install test, merge path | ~3 min a PR; 5-10 min macOS waits | fewer macOS jobs, waits mostly gone | low → medium |
| [D](plan-D-safety.md) | Release, site deploy, health-check safety | no speed change | no lost deploys, no 6 h hangs | low |
| E (new) | Directory index built from the feed | 27-39 min index step | a few minutes | medium |

## Confirmed facts (checked against origin/main and docs)

- Most "slow" numbers in run lists are queue time (createdAt → updatedAt), not work.
- The feed paces with fixed gaps: `HttpClient` defaults to `adaptive: false` (`packages/core/src/http.ts:235`).
  The app's measured ceilings in `PACES` (http.ts:144-157) go unused on CI.
- Paycom's API host is read from each portal page (`packages/core/src/connectors/paycom.ts:37`,
  `portal-applicant-tracking\.[a-z0-9-]+\.paycomonline\.net`), so the region varies.
- `eightfold: 1` in `WORKERS` (`scripts/catalog/jobs.ts:71`) is deliberate. Keep it.
- PR #325 merged on 2026-10-21 (`join: 6`, `adaptive: group === "join"`). PR #337 then made a scheduled run skip a slot another run already covers (`scripts/catalog/slot-covered.mjs`), which fixes the double trigger Plan A section 1 describes.
- `concurrency.queue: max` is a documented GitHub key (up to 100 pending runs, FIFO, not with
  `cancel-in-progress: true`). It has been on every `directory` member since 6619e50.
- Mergify `check-success` accepts only a `success` conclusion, not `skipped`. So C4 must gate steps,
  not jobs.
- `site.yml:31-33`'s `group: site-deploy` also covers its `pull_request` runs, with no `queue`.
- Action pins and runner images (ubuntu-24.04, macos-15, windows-2025) are current. Nothing is
  deprecated except Node 22 (see Upgrades).

## Amendments from the reviews

### Plan A (jobs feed)
1. **Paycom API pace by pattern, not one host.** Don't hardcode `...us-cent...` in `CI_HOST_DELAYS`.
   Give every `portal-applicant-tracking.*.paycomonline.net` host one shared pace in `PACES`
   (key `paycom-api`, ceiling 3), so all regions get it and it backs off adaptively.
2. **A slower climb after a slow-down.** Today a halved pace is back at its ceiling in ~10 answers
   (http.ts:505), so a host whose real limit sits below the ceiling keeps getting 429s. After a
   slow-down, hold the rate for 60 s (or climb by ceiling/100). "Adaptive is strictly safer" was wrong
   without this.
3. **`hostRests: true` for the feed's paced groups.** With `breakAfter: 8` and no rests, one bad
   minute skips a whole host (e.g. every SmartRecruiters board) for the rest of the run.
4. **SmartRecruiters: 8 workers, not 10.** Their docs allow 8 concurrent requests.
5. **The fallback text is wrong.** A tripped group still writes `group.json` (jobs.ts:335). What protects
   it is each board keeping its previous rows (jobs.ts:14), not jobs-daily.yml's group fallback.
6. **A3 does real work:** compress the v2/v3 snapshots and diffs side by side with async
   `zlib.brotliCompress` (byte-identical output, ~5-8 min off a ~19 min merge tail). Keep the timings
   too.
7. **Test runs must not overlap real runs.** A `jobs-test-*` run doubles the load on the same hosts
   and skews the `downs` / `tripped` pass criteria. Start a test only when no `jobs` run is in progress.
8. Keep the `jobs` group without `queue: max`: a newer waiting run replacing an older one is correct
   for the feed.

### Plan B (directory)
1. **Blocker, B3 artifact paths.** `upload-artifact` roots at the common ancestor of the *patterns*.
   `check-known`'s root is `out/`, so the files would land in `scripts/catalog/` and the week's
   recheck would be lost silently. Fix: upload as `out/checks-known.jsonl` / `out/titles-known.jsonl`,
   which `readChecks` and `compact.ts:68-70` already union with `checks.jsonl`. Download each artifact
   by name to an explicit path. Assert with `test -s`.
2. **Re-run safety:** that union rule also stops a "re-run failed jobs" from wiping rows a contributions
   run added in between. Name artifacts with `${{ github.run_attempt }}`.
3. **`!cancelled()`, not `always()`,** on `collect`, `publish` and the upload steps.
4. **Job timeouts:** `resolve` 100 min, `check-known` 105 min, daily URL-index job 125 min.
5. **B1 must not lose boards:** `resolve.ts:212` overwrites a found board with an `error` result.
   Keep the previous `board` when the new status is `error`. Watch the board / none / error mix, not
   just errors. Set `UV_THREADPOOL_SIZE=32` for DNS.
6. **Gentler Wayback:** a 4-5 s gap (not 3 s) and a contact URL in its user agent. Use soft cap 25 /
   hard cap 50. Update the timing comments (connector-health.yml:10, commoncrawl.yml:11) and
   docs/shared-directory.md lines 23, 39, 41 and 57.
7. **Coverage line in the run summary (required for B and A):** rows before/after, this run's checks,
   the resolve tally, Wayback/Common Crawl boards, which artifacts arrived, which caps were hit. Warn
   on a missing or empty artifact. This is the proof that no company was dropped.

### Plan C (CI)
1. **The C4 `changes` script fails open.** Under `pipefail`, `printf | grep -q` can get SIGPIPE on a
   large file list, and `!` then classes the PR as docs-only. Use `grep -qvE '…' <<<"$files"`.
2. Fix the C4 comment: a failed `changes` makes `check` report `skipped` (which passes for GitHub). It's
   Mergify's `check-success` and the missing `install / …` checks that block the PR.
3. **C1:** 41 s is the 20-try loop running out, so the cause isn't proven. The diagnostic commit is
   mandatory; use the Node server if `getfqdn` isn't it.
4. **C3:** say in the PR that admins can push to `main` untested (`enforce_admins: false`).

### Plan D (safety)
1. ~~Add `site.yml`~~ **Retracted in the debate:** #336 (993ea84) already gives PR runs their own
   `site-pr-<number>` group (site.yml:31-35). No `queue: max` on deploys: every deploy builds the latest
   state, so a newer waiting deploy replacing an older one loses nothing.
2. D owns the `release.yml` `publish` timeout (removed from C2).

### Batching appendix (owner only)
- Its description is correct. If adopted, also update CLAUDE.md "Merging" step 2: Mergify stops
  merging `main` into the PR. Set `batch_max_wait_time` deliberately, because batch PRs also run
  `ci.yml` and `site.yml`.

## New: Plan E, the directory index built from the feed

The directory's "Index open jobs" step (27-39 min, the largest part of `publish`) reads greenhouse,
lever, ashby and smartrecruiters live, which the feed already reads every 6 h. `feed.sh` downloads the
feed in the same job. Build those rows from the feed snapshot and read live only the boards the feed
lacks. First check that feed rows carry the fields the index needs (location, workplace, age). This
also stops a second run of reads against SmartRecruiters from another IP. Effort: one PR, medium.

## Upgrades

| Upgrade | Why | When | Gain / risk |
|---|---|---|---|
| **Node 22 → 24** (`node-version: 22` in jobs-daily, directory-*, concepts-weekly, connector-health, sign-data, `ci.yml:56`; `engines` `>=22`) | Node 22 reaches end of life on 2027-04-30 | **Required** before April 2027 | Also removes the `node-22` job's second test run / low |
| `ubuntu-24.04-arm` for `check`, `node-22`, `changes`, `release-files`, C3 stubs | Free on public repos, ~10-20% faster for Node/pnpm, separate runner pool | Optional, after C | ~3-6 s off the PR critical path / low (first check the bundle builds nothing x64-only) |
| Not needed | Actions pins (latest majors), runner images, pnpm 10.34.6, caching (installs ~4 s), paid larger runners, matrix sharding of crawl groups (would multiply per-IP load: a ToS risk) | | |

## Debate outcome (2026-10-21)

Authors A-D and the four specialists argued each open decision over two rounds. These verdicts override
the amendments and the plan files where they differ.

| # | Decision | Verdict | Who agreed | Switch trigger |
|---|---|---|---|---|
| 1 | SmartRecruiters pace from CI | **Cap ~3.3/s** through a CI-only ceiling override (PACES is shared with the app). Costs ~6 min: payroll is the slower group | A author, crawler | 5/s after 2 scheduled runs with `rateLimited` 0 and `downs` ≤ 2 |
| 2 | B1 gain: time or coverage | **Coverage, in steps:** 32 workers with keep-board-on-error, `--limit 2000` | B author, SRE, crawler | 2400 when the `none` (35.6%) and `error` (20.7%) shares stay within 3 points of 19 Oct and the step prints `Done.` in 45 min |
| 3 | Wayback cadence | **Tue/Thu/Sat** (never Monday), soft cap 25 / hard cap 50, 4.5 s gap, contact URL. Daily Common Crawl 45 → 50 min | B author, SRE (crawler conceded to daily mid-debate; 2 of 3) | Daily after 2 clean weeks: 0 × 429 and `web.archive.org` never in `brokenHosts`. A data-health alert on a block or on no progress over 2 runs |
| 4 | C4 docs/site install skip | **Split.** The C author now says docs + site, last, as its own PR. The Actions specialist now says never (rare PRs, ~6 s average, hand-gated required checks). **Lead call: drop it.** Risk outweighs ~6 s | tie | Revisit if docs/site PRs pass ~25% of all PRs |
| 5 | Feed every 3 h | **No, keep 6 h.** With ~2 h runs the feed stays 2-8 h old, under the app's 12 h live recheck (`scan.ts:127`) | all four who argued it | Data showing users miss jobs aged 5-8 h, or a 3 h run limited to ETag hosts |
| 6 | Merge-queue batching | **No, not now.** Busiest hour was 6 merges against a ~15/h capacity. Batching gives up strict up-to-date and puts tags on untested combinations | all four who argued it | Median label-to-merge wait above 15 min after C lands |
| 7 | arm64 runners | **Later, a separate small PR after C,** on a trial. `install (ubuntu-24.04)` stays x64 | C author, Actions; D author OK with a trial | Adopt only if `release-files` is at least 5 s faster with a clean `--frozen-lockfile` |

Other settlements:
- **B3 artifact check:** warn and keep the restored copy when an artifact is missing. Fail the download
  step when an artifact arrived but `out/checks-known.jsonl` didn't land.
- **Plan E is safe to build.** The feed stores `fetched_at` per company (`jobs.ts:295, 301, 431`). Use a
  feed row only when it is 7 days old or less, and read the rest live. Turn E off for the run if
  `feed.sh` failed or fell back to v1. Log feed / live / refused-as-stale counts.
- **A7 test overlap:** the first A1 test may overlap a real run (runs go back to back today), so read
  its numbers as a worst case. After A1, test only between runs.
- **A2 climb:** a 60 s hold after a slow-down, as a CI-only option so the app's scans don't change.
- **A6 parallel brotli:** measure the peak heap in the same PR. The payroll group already runs with a
  large `NODE_OPTIONS` heap.
- **C1:** the cause is unproven either way. The diagnostic commit runs first, and C1 ships after it.

## Build order

Two lead changes after the debate (owner-approved 2026-10-21):
- **P0, the coverage summary, ships first and on its own,** so a few runs record a "before" baseline.
  Every switch trigger above (SR 5/s, `--limit 2400`, daily Wayback) and the no-drop rule read from it.
- **A1 is split into A1a, A1b and A3,** so a bad test run points at one change:
  - **A1a (safety + Paycom):** `hostRests` for the paced groups, the CI-only 60 s hold after a slow-down
    (`climbHoldMs`), the shared `paycom-api` pace for every `portal-applicant-tracking.*.paycomonline.net`
    host, and adaptive pacing for `payroll` (a shared pace only applies in an adaptive group, so Paycom's
    API needs it).
  - **A1b (speed):** adaptive pacing for `sr` with the SR CI cap of ~3.3/s, and the workers (SR 8, paycom
    10, paylocity 8, workable 6, hireology 4).
  - **A3 (merge):** parallel brotli + phase timings + peak heap.

Two chains edit shared files, so each goes one PR at a time: `jobs.ts` (P0 → A1a → A1b → A3 → A2)
and `directory-rebuild.yml` (P0 → B1+B2 → B3). C and D share no file with A, B or P0. Queue
workflow-changing PRs one after another, not back to back.

**Now, in parallel sessions:**
1. **P0:** coverage summary for the feed (`jobs-daily.yml` summary) and the rebuild (Summary job).
2. **D:** release concurrency + `publish` timeout + health-check concurrency.
3. **C2 + C3:** step timeouts; skip the install matrix on push to `main`.

**After P0 merges and records a baseline** (feed: ~4 runs, one day; rebuild: the Monday 26 Oct run):
4. **A1a**, then **A1b**, then **A3**. One test run each, not overlapping a real run
   where possible.
5. **B1 + B2:** resolve 32 workers + keep-board-on-error + `UV_THREADPOOL_SIZE`, `--limit 2000`, Wayback
   Tue/Thu/Sat, Common Crawl daily at 50, both out of the rebuild, Wayback block alert.

**Then:**
6. **C1** after its diagnostic.
7. **A2:** Dayforce CSRF reuse, after a session probe.
8. **E:** index from the feed, after one measured rebuild.
9. **B3:** collect fan-out with the artifact fixes.
10. **arm64 trial**, then **Node 24** (before 2027-04-30).

Time savings come from one or two measured runs each: treat them as estimates until P0's summaries
confirm them.

## Owner decisions

Settled 2026-10-21: the owner accepted the debate verdicts (C4 dropped, Wayback Tue/Thu/Sat first) and
the lead changes above, and said go.

## Expected result

- Jobs feed: ~4 h 20 m → ~2 h (A1+A3) → ~1 h 40 m (A2). Runs no longer overlap the 6 h cycle.
- Directory rebuild: ~168 → ~86 min typical, ~268 → ~140 heavy, and less again with E.
- CI: one macOS and one Windows job fewer per merge. A hang fails in 5 min.
- No company dropped: every saving comes from pacing, parallel work or skipping repeated reads, and the
  coverage summary proves it each run.
