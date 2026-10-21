# Plan B: directory rebuild speed-up

Verified against `origin/main` (955a493). `directory-rebuild.yml`, `directory-commoncrawl.yml`,
`state.sh`, `capped.sh`, `resolve.ts` and `watchdog.sh` are identical to local HEAD, so line numbers
below hold. `wayback.ts` differs only by 10 new queries (lines 119-128, Avature/PageUp/... from #277),
which makes the Wayback move more valuable.

## Baseline (measured)

| Run | Total | Collect | Publish | Collect stages (min) |
|---|---|---|---|---|
| 39286952948 (19 Oct, sched.) | 168 | 137 | 31 (index 27.6) | CC 8.3, Wayback 45.9, seeds 2.5, bulk 49.2, check1 10.1, crossprobe 20.1, check2 <1 |
| 38453097334 (13 Oct, disp.) | 268 | 226 | 42 (index 38.7) | CC 35.1, Wayback 45.1, seeds 2.5, bulk 46.9, check1 60, crossprobe 20.1, check2 15 |

The other steps take under 1 minute each: setup, pnpm install (1.9 s, cache hit), restore, save, merges and package.
The bulk resolve log for 19 Oct says: `17862 seeds, 14374 due, resolving 1500` and then
`Stopped after 45 min: 300 left`. That is 1200 companies in 45 minutes, or 26.7 per minute with 16 workers.
The collectors are time-boxed, and the time boxes run one after another, so the wall time is the sum of the caps.

## PR order

| PR | Change | Saves (typical / heavy run) | Risk |
|---|---|---|---|
| B1 | Bulk resolve: 32 workers | ~18 / ~16 min | low |
| B2 | Wayback moves to the daily URL-index run; Common Crawl leaves the rebuild | ~54 / ~80 min | low |
| B3 | Fan out collect: `resolve` and `check-known` run in parallel, then `collect` finishes | ~10 / ~34 min | medium |
| Total | | 168 → ~86 min; 268 → ~140 min | |

Each PR is small and can be reverted on its own. Land B1 and B2 first and measure one rebuild before B3,
because B3's gain depends on what is left after B1 and B2.

---

## B1: more bulk resolve workers

1. **Location.** `scripts/catalog/resolve.ts:38`.
2. **Current code.**
   ```ts
   // Every company is a different website, so bulk runs can use more workers without loading any one host.
   const WORKERS = BULK ? 16 : 6;
   ```
3. **Proposed code.**
   ```ts
   // Every company is a different website, so bulk runs can use more workers without loading any one host
   // (HttpClient still spaces requests to each host by hostDelayMs).
   const WORKERS = BULK ? 32 : 6;
   ```
   The workflow keeps `--limit 1500 --max-minutes 45` (`directory-rebuild.yml:166`) unchanged, so the
   same companies are resolved, only sooner.
4. **Minutes saved.** At 26.7/min × 2 ≈ 53/min, 1500 companies take ≈ 28 min. Adding seeds-bulk.ts (≈ 3 min, a Wikidata
   fetch) gives ≈ 31 min against 49.2 measured, so about **18 min** saved, and the 300 companies cut
   off each week now also finish. Option instead: keep 45 minutes and raise `--limit` to about 2400, which
   drains the 14,374 backlog faster with no time saved. See open questions.
5. **Risk and mitigation.**
   - Each host is still hit at most once a second (`hostDelayMs: 1_000`, resolve.ts:42), so politeness per site is unchanged.
   - Possible strain: sockets, DNS, and memory (up to `MAX_PAGES = 8` HTML pages per company, ×32).
     The ubuntu-24.04 runner has 4 vCPU and 16 GB, which is enough.
   - Watch the `error` share in the closing tally. It was 1171 of 5654 on 19 Oct (20.7%). If it rises
     by more than 5 points (timeouts from contention), fall back to 24 workers.
6. **How to test.**
   - Run locally, read-only on the real state, with
     `pnpm exec tsx scripts/catalog/resolve.ts --bulk --limit 300 --max-minutes 10` at 16 and at 32 workers.
     Compare companies per minute and the error share.
   - Then dispatch `gh workflow run directory-rebuild.yml` and check that the "Resolve Wikidata companies"
     step is about 31 minutes or less, shows `Done.` (not `Stopped`), and that the release's `companies` is at
     least the previous release's.

**Release note:** none

---

## B2: Wayback daily, Common Crawl out of the rebuild

### B2a. Add Wayback to the daily URL-index workflow

1. **Location.** `.github/workflows/directory-commoncrawl.yml`:
   - header: lines 1-5
   - `timeout-minutes: 70`: line 33
   - Common Crawl step: lines 50-54
   - save: lines 56-60
2. **Current code.**
   ```yaml
     read:
       runs-on: ubuntu-24.04
       timeout-minutes: 70
   ...
         - name: Common Crawl
           if: steps.state.outputs.restored == 'true'
           continue-on-error: true
           timeout-minutes: 57
           run: bash scripts/catalog/capped.sh "Common Crawl" 55 pnpm exec tsx scripts/catalog/commoncrawl.ts --crawls 12 --per-run 2 --max-minutes 45

         - name: Save the working state
   ```
3. **Proposed YAML.** Same job, so the restore and the single save already in place are reused, and no new
   save can race:
   ```yaml
     read:
       runs-on: ubuntu-24.04
       # Common Crawl hard cap 55 + Wayback hard cap 45 + ~5 setup/save.
       timeout-minutes: 110
   ...
         - name: Common Crawl
           ...unchanged...

         # The Wayback CDX index, moved here from the weekly rebuild: 30 minutes a day instead of 45 a
         # week. Same politeness as before (wayback.ts): one request at a time, 3 s apart, and it stops
         # after 3 failures in a row. A query in flight can run past the soft cap (retries on a slow index).
         - name: Wayback
           if: steps.state.outputs.restored == 'true'
           continue-on-error: true
           timeout-minutes: 47
           run: bash scripts/catalog/capped.sh "Wayback" 45 pnpm exec tsx scripts/catalog/wayback.ts --max-minutes 30

         - name: Save the working state
   ```
   - Update the header comment (lines 1-5): it reads two URL indexes, and the rebuild no longer reads either.
   - Keep the file name and the `name:`. The keepalive (`watchdog.sh keepalive`) loops over every
     `.github/workflows/*.yml`, so nothing else needs changing.
   - The cron stays at `"40 13 * * *"` (line 12). The worst case ends about 15:30, so the 15:17 contributions run
     queues briefly behind it (`queue: max`, line 19). That is acceptable.
   - Hard cap check: the Wayback soft cap is 30 and a query can overrun by about 22 minutes (rebuild comment, line 152),
     making 52. That is over a 45 hard cap, so `capped.sh` may kill it mid-query. This is safe because wayback.ts saves per page
     (`writeFileAtomic` at line 150) and resumes per query, but it wastes the query in flight. Option: soft cap
     25, hard cap 50, job timeout 115.
4. **Minutes saved in the rebuild.** The Wayback step is 45.1-45.9 minutes in every measured run, and all of it is
   saved. Coverage goes up: 7 × 30 = 210 minutes of Wayback reading a week, against 45 now.
5. **Risk and mitigation.**
   - **archive.org load.** The request rate is unchanged (one request at a time, `hostDelayMs: 3_000`,
     `breakAfter: 3`, wayback.ts:33-40), but there are about 4.7 times more requests a week. Once a pass completes,
     `REPASS_DAYS = 30` (line 30) makes the daily runs end almost at once until it is due again, so the
     extra load lasts only until the backlog clears. If the owner wants a gentler load, run it on 3 days a week
     with `if: contains(fromJSON('[1,3,5]'), ...)`, or use a separate cron. See open questions.
   - **Concurrency.** This is the same `directory` group, with `cancel-in-progress: false` and `queue: max`,
     so a pending run is never replaced, and the rebuild and contributions still take turns. The daily job holds
     the group for about 80-105 minutes instead of about 50.
   - **Monday backup crons.** The rebuild runs at 03:07, 05:37 and 09:41, and on Tuesday at 03:13. After B2 and B3 a rebuild
     takes about 1.5-2.5 hours, so even the 09:41 backup ends before 13:40. If it overlaps, the daily run
     queues and does not get cancelled.
   - **State.** Wayback state (`raw/wayback/boards.json`) is already in the catalog file list
     (state.sh:38), so it is saved by the daily job's existing save and read by the rebuild's restore and merge.
     Nothing is lost.
6. **How to test.**
   - Dispatch `gh workflow run directory-commoncrawl.yml` and confirm the Wayback step ends with its
     soft-cap message and that "Save the working state" lists `raw/wayback/boards.json`.
   - Then check the next contributions run's merge log: Wayback boards are at least what they were before.

### B2b. Drop Common Crawl and Wayback from the rebuild

1. **Location.** `.github/workflows/directory-rebuild.yml`:
   - lines 141-153 (comment, Common Crawl step, Wayback step)
   - time-budget comment, lines 12-23
2. **Current code.**
   ```yaml
         # Our own URL lists: new Common Crawl crawls, and the next stretch of the Wayback index.
         - name: Common Crawl
           id: commoncrawl
           ...
           run: bash scripts/catalog/capped.sh "Common Crawl" ${{ inputs.smoke && 5 || 45 }} pnpm exec tsx scripts/catalog/commoncrawl.ts --crawls 12 --per-run 1 --max-minutes ${{ inputs.smoke && 2 || 35 }}

         - name: Wayback
           id: wayback
           ...
   ```
3. **Proposed change.** Delete both steps and replace the comment with:
   ```yaml
         # Our own URL lists (Common Crawl, Wayback) are read daily by directory-commoncrawl.yml; their
         # results are in the restored state and picked up by the merge below.
   ```
   - Update the budget table (lines 15-23): remove those two rows and recompute "Collect's hard caps
     add up to about …" (335 − 45 − 70 = 220 of 350).
   - Lower `collect`'s `timeout-minutes` (line 94) from 350 to 240.
   - Update docs/shared-directory.md lines 23, 39 and 41, which say the rebuild reads Common Crawl for 35 minutes a week.
4. **Minutes saved.** Common Crawl was 8.3 minutes (typical) or 35.1 (heavy), and Wayback 45.9 or 45.1, so
   **54 / 80 minutes** saved.
5. **Risk and mitigation.**
   - **Common Crawl reading time.** It drops from 35 + 7×45 = 350 to 315 minutes a week, about 10% less.
     The number of boards does not drop: everything found so far is kept in `raw/commoncrawl/boards.json`.
   - **Owner rule.** To keep reading time at least what it is, raise the daily run's `--max-minutes` from 45 to 50
     (adds 35 a week), with the step hard cap 55 → 60 and `timeout-minutes` 57 → 62.
   - **Daily run fails for a week.** The rebuild then ships with the last saved URL-index results: the same
     boards, nothing new. The watchdog and the stale alert still apply.
6. **How to test.**
   - Dispatch the rebuild with `smoke: true` (about 25 minutes, nothing published). The step list no longer has Common Crawl or Wayback, and the canary passes.
   - Then run a real dispatch, and compare `jq .companies,.indexed dist/manifest.json` (in the run summary,
     "This run's directory" against "Live release") with the previous `directory-*` release's manifest. The
     gate (`gate.sh`) already refuses a shrink beyond its limit, and both counts must be at least the previous ones.

**Release note:** none

---

## B3: fan out collect (parallel resolve and known-board check)

After B2 the only collector left before checking is resolve (seeds + bulk). Check 1 rechecks
known boards (`--recheck-days 30`) and needs only the merged list from saved state, not this week's
resolve output. Resolve and check 1 write different files:
- resolve writes `raw/wikidata/companies.json`, `out/resolved.json` and `out/resolved-bulk.json`
- check writes `out/checks.jsonl` and `out/titles.jsonl`

So they can run at the same time. Only the last job saves state, so the single tarball (state.sh:97-100)
is never written by two jobs.

1. **Location.** `.github/workflows/directory-rebuild.yml`:
   - `collect` job: lines 90-201
   - `publish` `needs`/`if`: lines 204 and 208
   - `COLLECT` env: line 350
   - Summary job filter: line 371
2. **Current layout.** One `collect` job does, in order: restore → sources → [canary] → CC → Wayback → seeds →
   bulk → merge → check1 → crossprobe → merge → check2 → save. `publish` has `needs: collect`.
3. **Proposed layout.** Job names `resolve` and `check-known` are new; `collect` keeps its name, so `publish`,
   the docs and the issue text barely change. The artifact pins are the ones already used in
   `jobs-daily.yml:132,170`.

```yaml
  # Parallel stage 1a: company-first resolving (industry seeds, then the next batch of Wikidata companies).
  # Restores state to read last week's results; never saves it: it hands its files to collect.
  resolve:
    needs: due
    if: needs.due.outputs.run == 'true'
    runs-on: ubuntu-24.04
    timeout-minutes: 80
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Restore the catalog's working state
        id: state
        env: { GH_TOKEN: "${{ secrets.DATA_REPO_TOKEN }}" }
        run: bash scripts/catalog/state.sh restore
      - name: Resolve industry seeds
        continue-on-error: true
        timeout-minutes: 17
        run: bash scripts/catalog/capped.sh "Industry seeds" ${{ inputs.smoke && 5 || 15 }} pnpm exec tsx scripts/catalog/resolve.ts --max-minutes ${{ inputs.smoke && 2 || 10 }}
      - name: Resolve Wikidata companies
        continue-on-error: true
        timeout-minutes: 59
        run: bash scripts/catalog/capped.sh "Wikidata companies" ${{ inputs.smoke && 8 || 57 }} bash -c "pnpm exec tsx scripts/catalog/seeds-bulk.ts && pnpm exec tsx scripts/catalog/resolve.ts --bulk --limit ${{ inputs.smoke && 20 || 1500 }} --max-minutes ${{ inputs.smoke && 2 || 45 }}"
      # Also after a timeout: resolve.ts saves what it resolved on SIGTERM (resolve.ts:198-203).
      # Only when the restore worked, so a from-scratch result never replaces good state.
      - name: Hand the results to collect
        if: always() && steps.state.outcome == 'success'
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: catalog-resolve
          path: |
            scripts/catalog/raw/wikidata/companies.json
            scripts/catalog/out/resolved.json
            scripts/catalog/out/resolved-bulk.json
          if-no-files-found: ignore
          retention-days: 3

  # Parallel stage 1b: monthly recheck of boards already known (from the saved state). New boards
  # this week's resolve finds are merged and checked by collect ("Check new boards").
  check-known:
    needs: due
    if: needs.due.outputs.run == 'true'
    runs-on: ubuntu-24.04
    timeout-minutes: 85
    env:
      CONTRIBUTIONS_FILE: ${{ github.workspace }}/directory-repo/contributions.json
      DENYLIST_FILE: ${{ github.workspace }}/directory-repo/denylist.json
    steps:
      - (checkout, pnpm, node, install: as in resolve)
      - name: Check out the public directory repo   # as today (lines 107-112)
      - name: Restore the catalog's working state
        id: state
        ...as above...
      - name: Download the public lists             # as today (lines 120-124)
      - name: Merge
        timeout-minutes: 5
        run: pnpm exec tsx scripts/catalog/merge.ts
      - name: Check boards
        continue-on-error: true
        timeout-minutes: 72
        run: bash scripts/catalog/capped.sh "Check boards" ${{ inputs.smoke && 5 || 70 }} pnpm exec tsx scripts/catalog/check.ts --recheck-days 30 --max-minutes ${{ inputs.smoke && 2 || 60 }}
      - name: Hand the results to collect
        if: always() && steps.state.outcome == 'success'
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: catalog-check-known
          path: |
            scripts/catalog/out/checks.jsonl
            scripts/catalog/out/titles.jsonl
          if-no-files-found: ignore
          retention-days: 3

  # Stage 2: the only job that saves the catalog state. Runs even when a stage-1 job failed or timed
  # out: it then keeps that part's restored copy (last week's), so nothing is lost.
  collect:
    needs: [due, resolve, check-known]
    if: always() && needs.due.outputs.run == 'true'
    runs-on: ubuntu-24.04
    timeout-minutes: 120
    env: (as today, lines 95-97)
    steps:
      - (checkout, pnpm, node, install, directory repo, restore id: state, sources, canary + check: as today, lines 99-139)
      - name: Take the parallel jobs' results
        if: steps.state.outcome == 'success'
        uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          pattern: catalog-*
          path: scripts/catalog
          merge-multiple: true
        continue-on-error: true   # a missing artifact = keep the restored copy
      - name: Merge                 # as today (lines 168-170)
      - name: Cross-probe           # as today (lines 179-183)
      - name: Merge again           # as today (lines 185-187)
      - name: Check new boards      # lines 189-193, cap raised: soft 15 → 25, hard 20 → 30, step 22 → 32
      - name: Save the working state  # as today (lines 195-201)
```

   Other edits in the same file:
   - `publish` keeps `needs: collect` and `if: always() && needs.collect.result != 'skipped'` (lines 204 and 208).
   - Summary (line 371): change `select(.name == "collect" or .name == "publish")` to
     `select(.name == "resolve" or .name == "check-known" or .name == "collect" or .name == "publish")`.
   - "Report a run that didn't publish" (line 350): add `RESOLVE: ${{ needs.resolve.result }}` and
     `CHECK_KNOWN: ${{ needs.check-known.result }}` to the env, and to the issue body's step list. This
     needs `publish` to have `needs: [resolve, check-known, collect]`, with the `if` unchanged.
   - The time-budget comment (lines 5-25): describe three jobs with their own caps.
   - docs/shared-directory.md line 39: "in four jobs".

   **Artifact paths.** Upload paths keep the `scripts/catalog/` prefix, so they come back relative to
   `scripts/catalog` and land exactly on the files state.sh packs (state.sh:27-51, relative to
   `scripts/catalog` after its `cd`). `upload-artifact` with several paths keeps the least common ancestor
   (`scripts/catalog/`), so downloading into `path: scripts/catalog` restores `out/…` and `raw/…`. Verify
   this in the smoke run with `ls -la` (a temporary debug line, removed before the PR is queued).

4. **Minutes saved.** Resolve after B1 is about 2.5 + 31 = 33.5 minutes.
   - Typical run: collect today (after B1 and B2) = 33.5 + check1 10 + crossprobe 20 + check2 ~1 + merges ~1 ≈ 66.
     With the fan-out: max(33.5, 10) + about 2 for setup and download + 20 + 1 + 1 ≈ 58. **About 8-10 minutes** saved.
   - Heavy run: 33.5 + 60 + 20 + 15 + 1 ≈ 130, against max(33.5, 60) + 2 + 20 + 15 + 1 ≈ 98. **About 32-34 minutes** saved.
     Raising the check2 cap adds up to 10 back, but only when the cap is used.
5. **Risk and mitigation.**
   - **Single-tarball race.** `resolve` and `check-known` never run `state.sh save`. Only `collect` saves,
     as `collect` and `publish` already do one after the other. The contributions and daily runs can't interleave
     because the concurrency group is workflow-level (lines 49-54), and it is held for the whole run
     including the parallel jobs.
   - **Pending run replacement.** `queue: max` and `cancel-in-progress: false` stay. They apply per
     workflow run, not per job, so the fan-out doesn't change queueing.
   - **A stage-1 job dies with no artifact.** `collect` keeps the restored file (last week's results) and
     loses only that job's progress this week. This is the same outcome as a collector failing today. Both
     scripts already save on SIGTERM, and the upload runs `if: always()`. The step caps (≤ 59 and ≤ 72)
     sit well inside the job timeouts (80 and 85), so the job itself never times out and skips the upload.
   - **Stale artifact.** The artifacts belong to the run, so a re-run of a failed job only re-uploads
     that job's artifact. A "re-run failed jobs" of `collect` alone downloads the original attempt's
     artifacts, which is fine.
   - **New boards from resolve are checked later.** They used to be checked in check1 (60-minute cap); now
     check2 handles them, and check.ts orders `new` first (check.ts:47-63). Raising the check2 cap to 25
     covers about 1,200 new boards: the 19 Oct check1 did 2,193 checks in 10 minutes. The 3-hourly contributions
     backlog step (30 min, 8 a day) catches any rest before the next release. No board is dropped, so the owner rule holds.
   - **checks.jsonl overwrite.** `check-known` appends to the restored copy and uploads the whole file, so
     replacing the restored copy in `collect` loses nothing. Check2 then appends to it.
   - **Backup Monday crons.** `due` still gates all jobs (all `needs: due`), so a backup cron that finds this
     week's release published skips every job.
   - **Smoke mode.** `inputs.smoke` is passed through exactly as today, and the canary stays in `collect`.
6. **How to test.**
   - Dispatch with `smoke: true` on the PR branch (`gh workflow run directory-rebuild.yml --ref <branch> -f smoke=true`).
     Expect `resolve` and `check-known` to start together, `collect` to start after both, the artifacts
     `catalog-resolve` and `catalog-check-known` to be present, "Save the working state" to list the same files as before, and nothing
     published.
   - Failure path: dispatch smoke with a temporary `exit 1` in `resolve` (not committed), or cancel
     `resolve` by hand mid-run. `collect` must still run and save, and its merge log must show resolved companies
     from the restored state.
   - Real dispatch after merge. Compare:
     - wall time (target ≤ 100 minutes for collect plus publish on a typical week)
     - `companies` and `indexed` in the run summary against the previous release, which must be at least as high
     - the Summary table now shows four jobs
     - the size and line count of `out/checks.jsonl` in the saved state, which must be at least as large as before

**Release note:** none

---

## Not in scope (measured, left alone)

- Crossprobe `WORKERS = 8` (crossprobe.ts:34). It hits its 20-minute cap, but the same API hosts are spaced
  250 ms apart, so more workers wouldn't help.
- Index in publish (11-39 minutes). It needs the build. A later idea is a matrix by `--ats`, following the check.ts pattern.
- Contributions (median 2.8, max 18.9 minutes). That maximum is the 30-minute backlog box doing its job.
- Move approval. It has no runs yet and installs nothing for an unauthorised label.

## Rollback

Each PR is one revert (`git revert <merge>`) with no state migration. The state file list and the
tarball format are unchanged in all three PRs.
- Reverting B2 puts Common Crawl and Wayback back in the rebuild.
- Reverting B3 returns to the single collect job. Artifacts expire in 3 days.
- If B1 raises errors, set `WORKERS` to 24 (or back to 16).

Releases are unaffected: the gate still refuses a shrink, and installs keep the current release.

## Open questions for the owner

1. B1: spend the gain as time (keep `--limit 1500`, about 18 minutes saved) or as coverage (`--limit ~2400` at 45
   minutes, draining the 14,374 backlog about 1.6× faster)?
2. B2: is daily Wayback (7 × 30 minutes) acceptable load for archive.org, or would you prefer 3 days a week? The per-request
   politeness is unchanged either way.
3. B2: raise the daily Common Crawl to 50 minutes so its weekly reading time doesn't drop (315 → 350)?
4. B3: raise the check2 cap to 25 minutes as proposed, so new resolved boards ship the same week?
5. Should B3 wait for one measured rebuild after B1 and B2? Recommended, since its gain is 8-34 minutes.
