# Scheduled scans: sync the directory, scan live, notify on Telegram (plan v1)

Status: **phase 1 (1a, 1b, 1c) built on 2026-10-08; phase 2 (GitHub) to do**. Written from the decisions made with the user on 2026-10-08 and amended the same day: there are two scan types, and phase 1 is scheduling on the user's computer, with GitHub moving to phase 2.

## Goal
Every scan shows the newest jobs, fetched live by the user's own scan. Scans can run on a schedule (daily, at a time the user picks), and new matches go to the user on Telegram.

## Decisions
| # | Decision |
|---|---|
| 1 | **The master directory is a phone book**: which companies exist, and which hiring system and board each one uses. It never decides which jobs a user sees. |
| 2 | **Jobs are always fetched by the user's own scan**, on their computer or in their own GitHub Actions. Nothing about the user is sent to us. |
| 3 | **Every scan starts by syncing the directory**: a small manifest check, then a download only when there's a newer version. Then it refreshes board details for the companies on the user's list, then scans. |
| 4 | **Two scan types**, picked per scan and per schedule: **All companies** (every live, trackable board in the directory, about 17,000, see the cost note below), or **My companies + my industries** (the user's list plus every live, trackable directory company tagged with their industries, about 265 for the current profile, 1–2 min). |
| 5 | **The shared job index stays, for suggestions only** ("Picked for you" on day one). Scans never rely on it. |
| 6 | **Phase 1 schedules scans on the user's computer** (runs only while it's on, and catches up when it's back on). **GitHub Actions** (always on, in the user's own private repo) is **phase 2**, with the same command. |
| 7 | **Default schedule**: daily, at a time the user picks; twice a day is an option. |

## 1. One scan command
The command is `rawjobs scan [--scope all|mine] [--notify]`, where `mine` means my companies + my industries. It replaces `run` for scheduled and button scans; `run` stays as an alias.

1. **Sync.** `updateDirectory()` is called with no 7-day wait. The manifest version is checked every time, but files are downloaded only when the version changed. If it fails (offline), the scan continues on the local copy and the report says so.
2. **Refresh the list.** For each company on the list, look it up in the directory by key or name. When its board moved (new ATS or slug) or went dormant, update the config line and report "Kraken moved from Lever to Ashby". New boards are never added automatically.
3. **Pick companies.**
   - `mine`: the user's enabled companies, plus directory companies where `status === "live"`, the ATS is supported, `tags` intersect `profile.industries`, and the company isn't muted.
   - `all`: the user's companies, plus every live directory board on a supported ATS that isn't muted.
   - Both are deduped by company name with `groupBoards` (one board per company); the user's own companies always come first.
   - The discovery "+30" (`pickChecks`) is removed from scans.
4. **Fetch live.** Use the existing `runRadar`. Add concurrency **across hosts** while keeping 1 request per second per host, so ~250 companies spread over 4 hiring systems take about 1–2 minutes instead of about 4.
5. **Merge, save and notify.** Use the existing `mergeHistory` and `saveRun`. When `--notify` is set and Telegram is configured, send the new matches.

**Files:**
- `packages/core/src/scan.ts`: scope and sync steps; drop `pickChecks`
- `packages/core/src/run.ts`: per-host concurrency
- `packages/core/src/directory.ts`: `syncDirectory()`
- `packages/cli/src/index.ts`: the `scan` command

**Cost of "All companies".** There are 16,970 live boards today: Greenhouse 7,274, Ashby 3,817, SmartRecruiters 3,722 and Lever 2,157. Greenhouse is the bottleneck: at 1 request per second per host, a full scan takes **about 2 hours**.

How the app handles that:
- The scope picker shows the estimate ("about 2 h · keep this computer on").
- The scan can be stopped, and it resumes where it stopped. A per-scan ledger records the boards already fetched today.
- Jobs from your own companies are saved and shown first, before the long tail.
- If a host starts answering 429 (too many requests), the scan slows that host down.
- **Default** for button scans and new schedules is **My companies + my industries**.

## 2. Telegram
- **New `packages/core/src/notify.ts`** calls the Telegram Bot API `sendMessage` with:
  - one digest message per scan: the new jobs at or above `min_score` (or all new jobs, per `alerts.only_new`), up to 10 lines of "Title · Company · Place · score", with links, and "+n more"
  - nothing when nothing is new
- **Secrets** come from the environment (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) or a gitignored `profile/secrets.env` locally. They are never written to the config.
- **Settings → Alerts** gets a 2-minute guided setup:
  1. Create a bot with @BotFather and paste its token.
  2. Send the bot "hi".
  3. We read the chat ID with `getUpdates`.
  4. **Send test message.**

## 3. Scheduling on this computer (phase 1)
**Settings → "Scheduled scans"** card:
- A time picker, daily or twice a day, and the scan type (All companies, or My companies + my industries).
- **Windows:** `Register-ScheduledTask` with:
  - `-StartWhenAvailable`: a scan missed while the PC was off runs once it's back on
  - `-WakeToRun`: wakes the PC from sleep, but can't start it when it's shut down
- **macOS:** launchd (runs after wake).
- **Linux:** a systemd timer with `Persistent=true`, or cron.
- **The task runs** `rawjobs scan --scope <type> --notify` from the repo folder. It doesn't need the dashboard to be open.
- **What the app shows:**
  - "Scans only run while this computer is on (or asleep). A missed scan runs when it's back on."
  - The last run (time, result) and the next run.
  - With All companies picked: "Each scan takes about 2 h."
- **CLI:** `rawjobs schedule install --time 08:00 [--twice] --scope mine|all`, plus `schedule remove` and `schedule status`.
- **Scan now** stays, with the same scan-type picker next to it.

## Phase 2: Scheduling on GitHub (later)
- A workflow template `.github/workflows/radar.yml`:
  - a cron trigger (converted from the user's local time to UTC)
  - runs `pnpm rawjobs scan --notify`
  - commits `data/` to a `data` branch
- A guided setup: make a **private** repo from the template, add 2 secrets, and push the config.
- **Minutes:** "My companies + my industries" is 1–2 min per run, which is fine on the free tier. "All companies" is about 2 h per run, roughly 3,600 min a month daily, which is **over the 2,000 free minutes** for private repos. GitHub mode will warn about this or offer only the smaller scan type.
- GitHub can start scheduled runs 5–30 minutes late.

## 4. UI
- **Scan progress** shows the steps: "Syncing directory… → Checking 29 of your companies + 207 in your industries…" Board-move notices appear in the scan summary.
- **The Companies page** loses nothing. Suggestions still come from the shared index (decision 5).

## Phases
| Phase | Scope |
|---|---|
| **1a** ✅ | `scan` command: sync step, list refresh, the two scan types, per-host concurrency, stop and resume for long scans, remove discovery checks; Scan-now type picker |
| **1b** ✅ | Telegram: `notify.ts`, guided setup in Settings, test message (so scheduled scans can tell you what they found) |
| **1c** ✅ | Scheduling on this computer: Task Scheduler / launchd / systemd install, last and next run in Settings |
| **2** | Scheduling on GitHub: workflow template, `data` branch, guided setup, minutes warning |

## Verification
- **Unit tests:**
  - scope selection (all vs mine, muted excluded, one board per company, your companies first)
  - list refresh (a moved board gets updated, a missing one is kept and flagged)
  - the per-host limiter (never more than 1 request per second per host)
  - the Telegram digest formatting (with a fake fetch)
- **Locally:**
  - `pnpm rawjobs scan --scope mine` finishes in under 3 minutes for about 265 companies.
  - `--scope all` shows the right estimate, can be stopped and resumes without refetching boards done today.
  - A second run with an unchanged directory downloads nothing.
- **Telegram:** the test message arrives; a scan with new jobs sends exactly one digest.
- **Windows:** install a task 2 minutes ahead and confirm it runs. Sleep the PC through the scheduled time and confirm it runs on wake.
- **GitHub (phase 2):** a `workflow_dispatch` run in a private test repo sends the digest and commits `data/`.

## Open items
1. Per-host concurrency limits: Greenhouse, Lever, Ashby and SmartRecruiters publish no rate limits. Start at 1 request per second per host and back off on 429.
2. In GitHub mode, the resume is optional. If it's left out, suggestions still work from the profile.
