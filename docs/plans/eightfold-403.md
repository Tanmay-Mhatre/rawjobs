# Eightfold boards failing in the job feed (#232)

## What we know (2026-10-15)

- Test run 38707810379 (publish off, with #241's failure reasons): `eightfold: 10 companies, 5795 jobs (5 fetched, 27 failed [HTTP 403 ×27])`.
- Every 403 is on a later page, never page 1, on both APIs: `bayer … /api/apply/v2/jobs?…&start=570`, `ericsson … /api/pcsx/search?…&start=390`, `bostonscientific … &start=420` (page 40–58).
- From a home connection, Ericsson's board crawled end to end at the feed's pace (1 request a second, one board at a time, feed User-Agent) answered 200 for all 71 pages, past the depth where the runner got 403. So it's not a pagination-depth limit or the User-Agent.
- Page size is fixed at 10 (`num`, `count`, `limit`, `pageSize` are ignored): a 1,000-posting board takes 100 requests.
- The feed's client (`scripts/catalog/jobs.ts`, `new HttpClient`) isn't adaptive, so `PACES` and the Paylocity 403-as-pushback rule in `http.ts` don't run there. Each tenant host keeps the default 1 s gap, with 4 boards in flight: about 4 requests a second to Eightfold overall.
- A 403 fails the board at once (only 429 and 5xx are retried), and the pages already read are thrown away: `keep(key)` falls back to the previous run's rows.
- Boards saved with `partial: true` aren't counted as covered by the feed (`packages/core/src/job-feed.ts`, `covered` leaves out `partial`), so the app reads them live during a scan.

**Reading:** a rate limit on GitHub's datacenter IPs that home connections don't hit. It's either per host (each board trips after ~40–60 requests) or for the whole IP (~4 requests a second across boards); page 1 still working on later boards points to per host. Pacing fixes a rate limit but not a WAF challenge or a block of the runner's IP ranges, so the fix also records what the 403 is.

## Fix (one PR)

1. **Record what the 403 is.** `packages/core/src/http.ts`: on a 403, before dropping the body, add an optional `detail` to `HttpError` with the `server`, `x-cache`, `retry-after` and any `x-amzn-waf-*` headers plus the first 120 characters of the body. `failReason` in `jobs.ts` stays "HTTP 403"; the per-board example lines in the run log print the detail, so they show a CloudFront/WAF page vs Eightfold's own JSON.
2. **Keep the pages read when a later page is refused.** `packages/core/src/connectors/eightfold.ts`, the paging loop in `list()`: a 403 on a page after the first stops paging and returns the jobs read so far, and `fetch()` calls `partial()`. No retries in the connector: a WAF window usually outlasts a few seconds, and the page-1 "PCSX not enabled" 403 still switches to the v2 API at once. The board is then fresh and partial instead of failed, and the app reads it live.
3. **Slower pace for Eightfold in the feed only.** `scripts/catalog/jobs.ts`: when crawling, add each Eightfold board's host (the directory's slug, which also covers companies' own hosts such as `explore.jobs.netflix.net`) to the feed's host gaps at 2.5 s, keeping 4 boards in flight. That's ~1.6 requests a second in total, lower both per host and overall, so it tests both readings. Worst case ~32 boards × 100 pages × 2.5 s ÷ 4 ≈ 33 min, alongside Workday's ~2 h in the same group. The desktop app's pace is unchanged (`CI_HOST_DELAYS` is the feed's own).
4. **Don't count a partial board as a swing.** `scripts/catalog/jobs.ts`: leave boards saved as partial this run out of the `same` jobs count, so partial boards don't trip `sameSwing`. The log's "capped" count becomes "partial", since a board can now be cut short as well as capped.

## Test run 1 (2.5 s, 4 boards in flight) and the change it led to

Run 38721164398: 9 fetched (6 of them partial), 23 failed. Every refusal came from CloudFront itself (`server: CloudFront; x-cache: Error from cloudfront`, its HTML error page). After about 4 minutes at ~1.6 requests a second, each new board was refused on its first page. So the limit covers the runner's IP for all of Eightfold, not each board. Changed step 3 to one board at a time (`WORKERS.eightfold = 1`) with a 1.25 s gap: ~0.8 requests a second overall, ~45–55 min for ~32 boards, alongside Workday's ~2 h.

## Check before merging

- Unit tests (fake client): a later page answers 403 → pages so far plus `partial()`; pcsx page 1 answers 403 → v2, then a later v2 page answers 403 → partial, not failed; page 1 answers 403 on v2 too → failed as today. `HttpError.detail` filled on a 403. `same` leaves out partial boards.
- `pnpm check`.
- A test run of the branch (`gh workflow run jobs-daily.yml --ref <branch> -f publish=false -f force=true`), cancelled once Eightfold's line is in the enterprise job's log. Aim: 0 failed and few partial boards. The 403 detail says what's left.

## If it still fails

- The detail shows a WAF challenge or an IP block (HTML page, `x-amzn-waf-*`): pacing won't help. Stop crawling Eightfold in the feed and leave its ~30 boards to the app's live scans, which work from home connections.
- Still a plain rate limit: lower the pace further (e.g. 5 s, or 2 boards in flight) from the test run's numbers.
