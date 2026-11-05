# Scheduled workflows: on time, never skipped

## What the audit found (6 Oct to 5 Nov 2026)

- GitHub's scheduled crons started runs 3 to 10 hours late, and some slots never ran.
- Directory · contributions (`17 */3 * * *`) ran in about 110 of its about 238 slots.
- In the job feed, the `rest` crawl group (every system without its own group) took about 195 of
  its 240 minutes, so a slow week can push it past the limit.
- Only the job feed had an on-time starter (`services/feed-trigger`). Commit 7e9eb8c already made
  the workflows ready for one: a `source` input, runs named `<workflow> · scheduler`, and a slot
  guard (`scripts/catalog/slot-covered.mjs`) so the later of two triggers for a slot skips.

## Four pull requests, in order

1. **Scheduler Worker** (this one). `services/scheduler` (`rawjobs-scheduler`) wakes every 5 minutes
   and dispatches each scheduled workflow 10 minutes before its GitHub cron, which stays as the
   backup. It replaces `services/feed-trigger`. Data · health opens "Scheduler: no runs started"
   when a workflow had no scheduler run recently (for example, the Worker's token expired). Deploy
   steps: docs/shared-directory.md, "Scheduler".
2. **No dropped feed runs.** `queue: max` on the shared `jobs` concurrency group (jobs-daily.yml and
   sign-data.yml), so a waiting run is never cancelled by a newer one. The `engage` hiring system
   (en-gage.net) gets its own crawl group (`GROUPS` in scripts/catalog/jobs.ts), reads its boards
   oldest-first, and reads quiet boards only every 4th run.
3. **Fewer failed runs.** Retries on the state restore and the directory downloads. Upload the
   manifest as `.next`, then rename it, so apps never see a manifest without its files.
4. **Quieter alerts.** "Needs a look" issues close by themselves after 2 healthy runs. The rebuild
   guard counts only full rebuilds.
