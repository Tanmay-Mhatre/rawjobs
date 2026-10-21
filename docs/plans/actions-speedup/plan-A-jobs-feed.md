# Plan A: job feed speed-up ("Jobs · feed every 6 h")

Base: origin/main 955a493. Every path and line below was checked with `git show origin/main:<path>`.
Owner rule: no company is dropped. Every change here gets more boards read per minute; none reads fewer.

## 0. What the runs show (evidence)

Runs 39554080479 (main) and 39593366900 (#325 branch). Per-system lines come from the crawl logs; HTTP
stats come from the merge job's `jq '{generated_at, groups, ...}'` output.

| Job | Min | Bound by | Arithmetic |
|---|---|---|---|
| payroll (paycom) | 195 | Paycom **API host** `portal-applicant-tracking.us-cent.paycomonline.net`, which has no entry in `CI_HOST_DELAYS`, so it keeps the default 1 s gap | payroll 42,590 req − paylocity 12,258 − hireology 4,436 − workable 4,134 ≈ 21.7k paycom req ≈ 10.9k session pages (www, 667 ms) + 10.9k API calls (1 s) → API side 10.9k s ≈ observed 11,679 s |
| sr | 126 | `api.smartrecruiters.com` 500 ms fixed gap | 15,150 req × 0.5 s = 7,575 s ≈ observed 7,576 s |
| rest (dayforce) | 100 (after #325) | `jobs.dayforcehcm.com` default 1 s gap | 1,748 CSRF + ~4,000 search pages (80,971 jobs / PAGE 25, at least 1 per board) ≈ 5,750 req × 1 s ≈ observed 6,015 s |
| enterprise | 67 | workday 65 min (285 × 429 on wd1 hosts, already handled), eightfold 57 min (WORKERS 1, deliberate) | not on the critical path after this plan |
| join (#325) | 240 (cap) | 2 × 429 early in the run doubled the fixed gap twice: 300 → 600 → 1,200 ms, held for 4 h | 12,038 req / 14,410 s = 0.84/s ≈ 1/1.2 s. #325 head 4191ba8 already fixes this with `adaptive: group === "join"` |
| merge | 16 + 3 | not profiled; suspect brotli q11 / lgwin 24 on the v2+v3 snapshots (`lib/feed-v2.ts:41`) | measure first (A3) |

Main finding: **the feed doesn't use adaptive pacing** (`HttpClient` default `adaptive: false`,
http.ts:235). Every host waits its fixed gap: `CI_HOST_DELAYS`, or 1 s by default. A 429 calls
`slowDown` (http.ts:525-530), which doubles that host's gap for the rest of the run and never recovers.
The app's `PACES` (http.ts:144-157, ceilings measured for the app) are ignored on CI.

Every crawl job also runs well short of its parallel capacity: payroll and sr made 0 × 429 and 0 timeouts.

## 1. The double trigger: decision

Today:
- Cloudflare `13 */6` (services/feed-trigger/wrangler.toml:13) and GitHub `23 */6` (jobs-daily.yml:17)
  both start the workflow.
- The guard skips a run when the feed is under 4 h old (jobs-daily.yml:75).
- Concurrency group `jobs`, `cancel-in-progress: false` (jobs-daily.yml:31-33).

Because a run takes about 4 h 20 m, more than 4 h, the guard never skips. The runs queue back to back, and
GitHub keeps only **one pending** run per group, so the older pending run is cancelled. The "4 of 7 failed"
scheduled runs (39547399020, 39465516250, 39418167086, 39335432443) have **0 jobs**: they were replaced
while waiting, not failed. createdAt→updatedAt also counts that queue time, which is why the reported
durations of 346–486 min look worse than the real ~260.

**Decision: keep both triggers, the guard and the concurrency group unchanged in PR A.**
- The Cloudflare Worker isn't deployed by CI (wrangler.toml header), so GitHub's cron is the fallback if
  the Worker or its token breaks. Removing either trigger removes that safety net.
- Once a run takes about 2 h (well under the 4 h guard), the :13 dispatch finds no run in progress. The
  :23 cron, or a late one, either queues behind it or starts after it, and then the guard skips it
  because the feed is under 4 h old. At most one run is ever pending, so nothing is cancelled any more.
  The noise was a symptom of the >4 h runs.
- Rejected: moving concurrency to job level. A matrix job with `concurrency: jobs` would run the crawl
  groups one after another.
- Rejected: a Worker "skip if running" check. That's extra code and token scope for a problem the
  speed-up removes.
- Follow-up only if cancellations continue after A1 lands: let feed-trigger skip the dispatch when
  `GET /repos/{repo}/actions/workflows/jobs-daily.yml/runs?status=in_progress` (or `queued`) is non-empty.
  Its token already has "Actions: read and write".

## 2. PRs and order

| Order | PR | Contents | Saving (critical path) |
|---|---|---|---|
| 0 | **#325 (open, queued, other session)** | JOIN group, saved ids, `adaptive` for join | join leaves rest; rest 240 → 100 |
| 1 | **A1** feed pacing | adaptive pacing for `sr` + `payroll`; Paycom API host gap; hireology gap; WORKERS for sr/paycom/paylocity/workable | payroll 195 → ~70, sr 126 → ~55 |
| 2 | **A2** Dayforce | one CSRF pair per run + workers + gap | rest 100 → ~60 |
| 3 | **A3** merge timing | timings only; decide on brotli later | 0 now; maybe 5–10 later |

Expected wall time (crawl critical path + ~19 min merge + ~1 min setup):
- Today: ~260 min.
- After #325 + A1: max(sr 55, payroll 70, enterprise 67, rest 100, join ~76*) + 20 ≈ **~2 h**.
- After A2: about max(join 76, payroll 70, enterprise 67) + 20 ≈ **~1 h 40 m**.

\* JOIN after #325, once ids are saved: ~1.05 req/board × ~12.9k boards ≈ 13.6k req / 3 per s ≈ 76 min.
Its first publishing run still reads every careers page (~2 req/board) and may take ~150 min, under the
240 cap.

**Conflicts with #325.** Both PRs touch scripts/catalog/jobs.ts:
- the `WORKERS` line (71): #325 adds `join: 6`;
- the `new HttpClient({...})` block (191-199): #325 adds `adaptive: group === "join"`.

A doesn't touch jobs-daily.yml or state.sh, so those don't conflict.

**Recommended order: #325 first** (it's already queued), then build A1 on the new main. If A1 has to go
first, it uses a set without join (see A1.1). When #325 is then merged with main, whoever resolves the
conflict keeps both `join: 6` and adds "join" to the set. Either way this session never edits #325.

---

## A1: adaptive pacing and wider lanes for sr and payroll

### A1.1 Turn on adaptive pacing for the groups whose hosts are in PACES

1. **Where:** scripts/catalog/jobs.ts:191-199 (`const http = new HttpClient({ ... })` in `crawl`).
2. **Current (origin/main):**
   ```ts
   const http = new HttpClient({
     cache: etags,
     timeoutMs: 20_000,
     retries: 2,
     backoffMs: 3_000,
     breakAfter: 8,
     hostDelays: { ...CI_HOST_DELAYS, ...slowHosts(directory) },
     userAgent: "RawJobs-feed/0.2 (...)",
   });
   ```
3. **Proposed** (after #325, which adds `adaptive: group === "join"`):
   ```ts
   /**
    * Groups paced like the app paces them (http.ts PACES: each shared API climbs to its ceiling, halves on a
    * 429 or a slow answer and climbs back). A fixed gap that a 429 doubles stays doubled for the whole run.
    */
   const ADAPTIVE_GROUPS = new Set(["sr", "payroll", "join"]);
   ...
     adaptive: ADAPTIVE_GROUPS.has(group),
   ```
   If A1 lands before #325, the set is `["sr", "payroll"]` and the property is new.
4. **Why and saving:**
   - With `adaptive`, a host in PACES keeps no fixed gap of its own (`waitForHost`, http.ts:474-479:
     `pace && !pace.spec.hostGap ? 0 : delay`). It's paced at `pace.rate`, which starts at 1/s and rises
     by ceiling/20 per good answer (http.ts:505), so it reaches the ceiling within ~20 answers.
   - SmartRecruiters: ceiling 5 (http.ts:145). 15,150 req / 5 = 3,030 s ≈ **50 min (126 → ~55, −70 min)**.
   - Paylocity: ceiling 3 (http.ts:152). 12,258 / 3 ≈ 68 min (was 113).
   - Paycom www session pages: ceiling 3 (http.ts:153). 10.9k / 3 ≈ 61 min. The API host is in A1.2.
   - Workable: ceiling 3 (http.ts:151). 4,134 / 3 ≈ 23 min (was 69).
   - Hosts not in PACES (hireology and the Paycom API host) keep their `hostDelays` gap.
   - The `CI_HOST_DELAYS` entries for `api.smartrecruiters.com`, `recruiting.paylocity.com` and
     `www.paycomonline.net` (jobs.ts:76-81) are then unused in these groups. Leave them in place: they
     still apply if adaptive is turned off again (rollback), and a comment should say so.
5. **Risk and mitigation:**
   - These are the app's ceilings, measured from home connections, now held for about an hour from one CI
     IP.
   - On a 429, a 503, a timeout, or an answer more than 4 × usual latency and over 3 s, the pace halves
     (http.ts:503-517), at most once every 2 s, to no lower than 0.25/s. It then climbs back. That's
     strictly safer than today's fixed gap, which only ever gets slower.
   - Paylocity's "slow down" 403 is already treated as a push-back (http.ts:452, 504).
   - If the runner is blocked outright, `BREAK_ATS_AFTER = 100` failures in a row stop the system, and the
     merge keeps the previous rows, so no company is lost.
   - Residual risk: oscillation on slow-answering hosts (the spike rule). The test run shows it in `downs`.
6. **Test:**
   - Run `gh workflow run jobs-daily.yml --ref <A1 branch> -f publish=false -f force=true`. It gets its
     own concurrency group (`jobs-test-<branch>`), so the real run isn't held up.
   - Read, in the crawl logs:
     - `smartrecruiters: N companies ... in S s`, `paycom: ...`, `paylocity: ...`, `workable: ...`;
     - `Group sr|payroll: S s, R requests`.
   - Read, in the merge log `groups.<g>.http`: `rateLimited`, `timeouts`, `slowedHosts`, and
     `paces.{smartrecruiters,paylocity,paycom,workable}.{rate,downs}`.
   - Success:
     - sr ≤ 70 min and payroll ≤ 90 min;
     - companies per system within ±1 % of the baseline (sr 13,145; paycom 10,080; paylocity 12,258;
       workable 4,134; hireology 4,436);
     - failed counts at or below the baseline (paycom ~49, others under 20);
     - each pace's final rate ≥ half its ceiling, with `downs` ≤ 10;
     - `tripped` false everywhere.
   - Caveat: the prod run is probably crawling at the same time, so the test doubles the load. Any 429s
     there are a pessimistic sign.

### A1.2 A gap for Paycom's API host and for Hireology

1. **Where:** jobs.ts:76-81 `CI_HOST_DELAYS`.
2. **Current:**
   ```ts
   const CI_HOST_DELAYS: Record<string, number> = {
     ...HOST_DELAYS,
     "api.smartrecruiters.com": 500,
     "recruiting.paylocity.com": 550,
     "www.paycomonline.net": 667,
   };
   ```
3. **Proposed:** add
   ```ts
     // Paycom's API (the session page names it; paycom.ts session()): one search per board after the page.
     "portal-applicant-tracking.us-cent.paycomonline.net": 333,
     "api.hireology.com": 500,
   ```
   The host name comes from packages/core/test/paycom.test.ts:8-9. **Check it's the only one**: run once
   with `FEED_DEBUG=1`, or have the crawl log `slowedHosts` / a host count. If Paycom has other regions,
   list them too.
4. **Why and saving:**
   - Today this host has the default 1 s gap, so 10.9k API calls take ≈ 182 min. That's the bottleneck.
   - At 333 ms: 10.9k × 0.333 ≈ 61 min, matching the 3/s www side.
   - Paycom 195 → **~65 min**. Payroll is then bound by paylocity at ~68 min (**−125 min** for payroll).
   - Hireology: 4,436 × 0.5 ≈ 37 min (was 74). Off the critical path, but keeps it under paylocity.
5. **Risk and mitigation:**
   - These are fixed gaps, so a 429 doubles them for the rest of the run, as today.
   - Worst case after one 429: 666 ms, about 2× faster than now.
   - The gap is per host, so other employers are unaffected.
6. **Test:**
   - Same run as A1.1. Read `paycom: ... in S s` and `hireology: ... in S s`.
   - The `slowedHosts` lists for payroll should be empty, or the plan's numbers are off.
   - Success: paycom ≤ 80 min with failures ≈ 49; hireology ≤ 45 min.

### A1.3 More boards in flight for the faster systems

1. **Where:** jobs.ts:71.
2. **Current:**
   `const WORKERS: Record<string, number> = { workday: 20, icims: 10, successfactors: 8, eightfold: 1 };`
   After #325: `{ workday: 20, icims: 10, successfactors: 8, join: 6, eightfold: 1 }`.
3. **Proposed:**
   ```ts
   const WORKERS: Record<string, number> = {
     workday: 20, icims: 10, successfactors: 8, join: 6, eightfold: 1,
     smartrecruiters: 10, paycom: 10, paylocity: 8, workable: 6, hireology: 4,
   };
   ```
   Keep `eightfold: 1`. The comment at jobs.ts:68-70 and `CI_BOARD_GAPS` (jobs.ts:86-91) record that
   Eightfold's CloudFront refuses the runner's IP above ~1 req/s across boards. Enterprise (67 min) isn't
   on the critical path, so there's nothing to gain from it.
4. **Why (Little's law: lanes needed = rate × seconds per board):**
   - SR at 5/s with ~1.15 req/board and ~0.5–1 s latency needs about 5 × 1 = 5 lanes, plus headroom → 10.
     With the default 4 lanes, SR would top out below 5/s.
   - Paycom does 2+ requests in a row per board (session page, then search). At ~3 boards/s × ~2–3 s per
     board it needs 6–9 lanes → 10.
   - Paylocity: 3/s × ~1.5 s → 5 → 8.
   - Workable: 3/s × ~1 s → 3–4 → 6.
   - Lanes add no load beyond the pace, because the shared pace and host gaps still decide when each
     request leaves. They only stop slow answers from holding the rate below the pace.
   - Saving: this is what makes A1.1 and A1.2 achievable. With 4 lanes, paycom ran at 0.86 boards/s even
     though its slower host allowed 1/s.
5. **Risk:** low. More lanes mean more memory per group (payroll has 6 GB via `NODE_OPTIONS`; shards
   are small). JOIN's lane count stays with #325.
6. **Test:** same run. If a system finishes well over `count / ceiling` seconds with its pace `rate` at
   the ceiling and `downs` at 0, it's short of lanes: raise them.

**Release note (A1):** `Improved: The shared job feed refreshes in about two hours instead of four, so new jobs reach you sooner.`

---

## A2: Dayforce, one CSRF pair per run (separate PR, connector change)

1. **Where:** packages/core/src/connectors/dayforce.ts:33-43 (`csrf`) and :47 (`await csrf(http)` in
   `list`, once per board).
2. **Current:**
   `async function csrf(http)` → `GET ${BASE}/api/auth/csrf`, returning `{ cookie, token }`. It's called
   for every board.
3. **Proposed:**
   - Keep one in-flight promise per `HttpClient`:
     `const pairs = new WeakMap<Ctx["http"], Promise<{cookie, token}>>()`.
   - `list` uses `pairs.get(http) ?? fresh`.
   - When a search answers 400, 401, 403 or 419 (a stale or refused token), drop the pair, fetch a new
     one and retry that page once.
   - In jobs.ts:71, add `dayforce: 6`.
   - In `CI_HOST_DELAYS`, add `"jobs.dayforcehcm.com": 400`. `rest` stays non-adaptive: turning on
     adaptive for `rest` would also change lever, greenhouse (up to 8/s), ashby, rippling and comeet, which
     is too much change for one PR.
4. **Why and saving:**
   - Removes ~1,748 requests per run (one per board), leaving ~4,000 search pages.
   - 4,000 × 0.4 s ≈ 27 min, against 100 min today.
   - `rest` is then bound by adp (~57 min), so rest 100 → **~60 min (−40)**.
   - This matters only once #325 has moved JOIN out of `rest`.
5. **Risk:**
   - The pair might be bound to a tenant or expire. Mitigation: refresh-and-retry once, then fail the
     board as today (it keeps its previous rows).
   - The app's live scans use the same connector, so the change also cuts their requests. Add tests: the
     pair is reused across two boards; a 401 triggers one refresh.
   - The fixed 400 ms gap doubles on a 429, as today.
6. **Test:**
   - `pnpm check`, plus new tests in packages/core/test/dayforce.test.ts.
   - Run the feed with publish=false and read `dayforce: N companies ... failed ... in S s`.
   - Success: dayforce ≤ 35 min; companies ≈ 1,748; failed ≤ the baseline (4); `Group rest` ≤ 65 min.

**Release note (A2):** `Improved: Dayforce boards are checked with fewer requests.`

**Not proposed: Paycom session reuse.** `session()` (paycom.ts:34-40) reads `sessionJWT` from each
portal's own page. It's probably scoped to that portal, so it can't be shared across boards, and caching it
between runs means handling expiry. After A1.2, Paycom isn't the bottleneck, so the risk isn't worth it.

---

## A3: profile the merge step (timings only)

1. **Where:**
   - scripts/catalog/jobs.ts:366 `function merge`: around the shard reads, `stateOf`, and `writeFeed` for
     v2 (444) and v3 (445).
   - scripts/catalog/lib/feed-v2.ts:39-41 `brotli` (quality 11, lgwin 24).
2. **Current:** no timings; the step takes 15–16 min and activity takes 3 min.
3. **Proposed:**
   - `const t = Date.now(); ...; console.error(\`merge: <phase> ${Math.round((Date.now()-t)/1000)} s\`)`
     around each phase.
   - In `brotli`, log the input MB and the seconds taken.
   - No behaviour change.
4. **Why:** if brotli at q11 takes most of the 16 min, a later PR can try q10 (often 3–5× faster for a few
   % larger files). That needs the owner's call, because every app downloads the snapshot. The saving
   would be maybe 5–10 min.
5. **Risk:** none.
6. **Test:** a publish=false run. Read the `merge: ...` lines and the brotli MB/s.

**Release note (A3):** `none`. It can be folded into A1 to save a PR; the timings fit in the same diff.

---

## Rollback

- **A1:** revert the PR, or set `ADAPTIVE_GROUPS` back to `["join"]`. The `CI_HOST_DELAYS` entries are
  still there, so the old fixed paces come back. Group state isn't affected: shards and ETags have the same
  format.
- **A2:** revert. The connector goes back to one CSRF pair per board.
- If a run trips or fails a group, the merge job's existing fallback (jobs-daily.yml:174-183) restores
  that group's previous copy. Nothing is lost for a run.
- Watch the first two scheduled runs after each merge (the "Job feed" summary table and `alerts`).

## Open questions

1. Is the owner OK with SmartRecruiters reaching 5/s from CI? The app's ceiling was set as "until
   measured". If not, add a CI-only cap: either a `paceCeilings` override in HttpClient options, or keep SR
   non-adaptive at 300 ms (≈ 76 min).
2. Does Paycom use API hosts other than `us-cent`? Check before A1.2 (FEED_DEBUG or a temporary log of
   distinct hosts).
3. Is the Dayforce CSRF pair tenant-independent and long-lived? Probe once before A2.
4. #325 is queued. If it merges before A1 is built, A1 is built on top of it. If it's dropped, A1 still
   works with `["sr", "payroll"]`, but JOIN stays in `rest` and `rest` stays at the 240-min cap. Then the
   JOIN fix (adaptive for `rest`, or JOIN's own group) has to be redone.
5. A3: is a slightly larger snapshot acceptable for a faster merge? Decide after the timings.
