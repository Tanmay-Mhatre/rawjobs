# Local install and updates: one line to install, updates by themselves (plan v1)

Status: **planned on 2026-10-11; steps 1–3 built the same day**. Written from the decisions made with the user on 2026-10-10/11, after a review of the code, of how competitors ship, and of signing rules on Windows and macOS.

## Goal
Anyone on Windows or macOS installs RawJobs by pasting one line, with no Node, pnpm, git or Claude needed. The dashboard is always there while the computer is on, without a terminal. New versions reach every user by themselves, safely. Nothing is hosted and nothing costs money.

## Decisions
| # | Decision |
|---|---|
| 1 | **Everything runs on the user's computer.** The dashboard is `http://127.0.0.1:4317`, served by their own machine; it is not on the internet and never depends on the maintainer's computer. |
| 2 | **Install with one line** in Terminal (`curl … \| bash`) or PowerShell (`irm … \| iex`). Files fetched this way aren't tagged "downloaded from the internet", so macOS Gatekeeper and Windows SmartScreen don't block them, and no Apple ($99/yr) or Windows signing account is needed. |
| 3 | **No admin rights.** Everything goes in a per-user folder. Node is the official, already signed build, kept private to RawJobs. |
| 4 | **The OS keeps the server alive**: a launchd agent (macOS) or a Task Scheduler task (Windows) starts it at login, hidden, and restarts it if it crashes. No terminal is involved. |
| 5 | **GitHub is the only distribution channel**: the install scripts in this repo, and the app bundle, manifest and checksums as GitHub Release assets. |
| 6 | **Updates are checked daily, verified with a free signing key we own (ed25519), applied when no scan is running, and rolled back automatically** if the new version doesn't start. |
| 7 | **The user's data is never touched by an update** except by a migration that backs it up first. |
| 8 | **A desktop app (Electron, signed) is a later option**, only if pasting a line stops too many users. Steps 1–3 below are shared with it, so nothing is wasted. |

## 1. Today, and what has to change
| Today | Problem | Fixed in |
|---|---|---|
| The 16 `/api/*` routes live in the Vite **dev** server (`apps/web/vite.config.ts`) | There is no production server; closing the terminal or Claude session kills the dashboard | Step 1 |
| Any website can POST to `127.0.0.1:5173/api/setup/reset`, `/api/schedule`… | No Origin or token check (fine in dev, not in a product) | Step 1 |
| `/api/run` pipes the scan to the tab | Closing the tab mid-scan probably stalls the scan on Windows (read, not reproduced) | Step 1 |
| Each request starts a fresh CLI through `tsx` | Suggestions re-read the 40 MB index each time (~10 s) | Step 1 |
| ~20 paths use `process.cwd()` / `repoRoot` | An install has no repo; the program folder must stay read-only | Step 2 |
| Statuses and notes live in browser `localStorage` | Tied to the address; a port change silently loses them; the CLI can't see them | Step 2 |
| Scheduled scans call `node` + `tsx` + the repo path (`packages/core/src/schedule.ts`) | Break when Node is upgraded or the repo moves | Step 3 |
| `pnpm install` + `pnpm dev` | Needs Node, pnpm, git and a terminal kept open | Steps 3–4 |

## 2. Target layout on the user's computer
`RAWJOBS_HOME` = `%LOCALAPPDATA%\RawJobs` (Windows) or `~/Library/Application Support/RawJobs` (macOS).

```
RAWJOBS_HOME/
  bin/rawjobs(.cmd)          launcher: stable path, never changes between versions
  runtime/node-v22.x.y/      official Node, private to RawJobs
  app/
    current.txt              "0.4.0" — which version runs (a file, not a symlink: works on Windows)
    previous.txt             the version to roll back to
    versions/0.3.2/  0.4.0/  at most two kept
  rawjobs.config.local.yaml  your profile
  profile/                   resume.md, secrets.json, tracking.json (statuses, notes, Radar preferences)
  data/                      scan output: jobs, history, the company directory
    backups/                 a copy before every migration
  logs/                      server.log, update.log (rotated)
  state.json                 port, token, update settings, last check
```

- The OS task and the shortcut both run `bin/rawjobs`, which reads `current.txt`. **An update never re-registers anything with the OS.**
- The app reads and writes only `rawjobs.config.local.yaml`, `profile/`, `data/`, `logs/` and `state.json`; `app/` and `runtime/` are replaced, never edited. Updates and uninstall treat all of the first three as the user's data.

## 3. Install
**macOS**
```bash
curl -fsSL https://raw.githubusercontent.com/Tanmay-Mhatre/rawjobs/main/install.sh | bash
```
**Windows (PowerShell)**
```powershell
irm https://raw.githubusercontent.com/Tanmay-Mhatre/rawjobs/main/install.ps1 | iex
```

The script, in order (about a minute, no admin):
1. Detects the OS and CPU (Windows x64/arm64, macOS arm64/x64) and stops with a clear message on anything else.
2. Downloads `latest.json` from the latest GitHub Release, then the bundle; **checks its SHA-256 and ed25519 signature** before unpacking.
3. Downloads the Node version the manifest names from nodejs.org and checks it against Node's `SHASUMS256.txt`.
4. Writes the layout above and `bin/rawjobs`.
5. Registers the server: Task Scheduler task "RawJobs" (at logon, hidden through `conhost --headless`, restart on failure) or `~/Library/LaunchAgents/com.rawjobs.server.plist` (`RunAtLoad`, `KeepAlive`, `ThrottleInterval`).
6. Adds a **RawJobs** shortcut (Start menu on Windows; a small `RawJobs.app` in `~/Applications` built locally with `osacompile` on macOS) that runs `rawjobs open`: start the server if it isn't running, then open the browser.
7. Adds `rawjobs` to the user's PATH (optional, for CLI users).
8. Opens the dashboard; setup starts as today, and the first scan downloads the company directory (~40 MB) as it already does.

**Running the same line again repairs or updates the install**, keeping `data/`.

## 4. Staying alive
| Situation | What happens |
|---|---|
| Browser or tab closed | Server keeps running; the shortcut reopens it instantly |
| Crash | launchd / Task Scheduler restart it within seconds |
| Restart or log in | Starts at login |
| Sleep | Pauses and resumes; missed scheduled scans catch up (already built) |
| Computer off | Nothing runs (unavoidable locally; see Future: GitHub Actions scans) |
| Port 4317 taken | Next free port, saved in `state.json`; the shortcut reads it |
| Second user on the same Mac/PC | Their own folder, task and port |

The page polls `/api/health`. If the server is restarting, it shows "Reconnecting…" instead of an error, and reloads by itself when the version changes.

## 5. Updates
### 5.1 What we publish per release (GitHub Release `v0.4.0`)
- `rawjobs-0.4.0.tar.gz`: the bundled server and CLI (esbuild, plain JS) plus the built dashboard. One file for every OS (no native modules).
- `latest.json`:
  ```json
  {
    "version": "0.4.0",
    "date": "2026-11-02",
    "bundle": { "url": "…/rawjobs-0.4.0.tar.gz", "sha256": "…" },
    "node": "22.21.0",
    "minVersion": "0.2.0",
    "critical": false,
    "notes": "Short what's-new, shown in the dashboard",
    "signature": "ed25519 signature of everything above"
  }
  ```
- `SHA256SUMS` and the release notes.

The app reads `https://github.com/Tanmay-Mhatre/rawjobs/releases/latest/download/latest.json`, a plain download, so the GitHub API rate limit doesn't apply.

### 5.2 On the user's computer
1. **Check** at server start and every 24 h (Settings → Updates: Automatic (default: patch and minor install themselves, major asks), Ask me, Off; channel Stable or Beta).
2. **Download** the bundle into `versions/0.4.0.partial`. Verify the SHA-256 and the signature against the public key built into the installed version. If either fails, drop the download and log it. If the Node version changed, download and verify Node too.
3. **Wait** until no scan is running (the scan lock already exists) and no setup is half done.
4. **Back up** your data (the config, `profile/`, and `data/` without caches) to `backups/pre-0.4.0/` when the new version has migrations. Keep the last 3.
5. **Switch**: `previous.txt` = old version, `current.txt` = new version, then the server exits and the OS starts it again on the new version.
6. **Health check**: the new version must answer `/api/health` within 60 s. If it doesn't, or it crashes 3 times in 5 minutes, the launcher switches back to `previous.txt`, restores the backup if migrations ran, and the dashboard says "Update to 0.4.0 failed, still on 0.3.2", with a link to `logs/update.log`.
7. **Tell the user**: a quiet "Updated to 0.4.0 — what's new" note; with Ask me, an "Update available" banner with an **Update now** button.
8. **Clean up**: delete versions older than `previous`.

### 5.3 Special cases
| Case | Handling |
|---|---|
| Critical fix (`critical: true`) | Applied at the next idle moment even on Ask me; a banner explains why |
| Version too old (< `minVersion`) | Banner: run the install line again (it updates in place) |
| Data format change | Numbered migrations in `data/`, each run once, with a `schemaVersion` and the backup above; never delete user data in a migration |
| The launcher itself changes | Rare. The new version rewrites `bin/rawjobs` after its health check passes, keeping a `.bak` |
| Offline | Check silently fails and tries tomorrow; the app works as before |
| GitHub down | Same as offline |
| Scheduled scan at update time | The update waits for it |
| User on CLI only | `rawjobs update` does the same steps; `rawjobs update --check` only reports |
| Downgrade | `rawjobs update --to 0.3.2` (also re-verified) |
| Users on the dev setup (`git clone`) | Not auto-updated; they `git pull` as today. The check is off when running from a repo |

### 5.4 Signing key (free, no account)
- An ed25519 key pair made once. The **private key** is a GitHub Actions secret (and an offline backup); the **public key** is in the source.
- It protects users even if a release file or download is tampered with. Rotating it: a release signed with the old key ships the new public key.
- If the private key leaks: revoke by shipping a new key in a release signed with the old one, then rotate the GitHub token and secret.

## 6. Releasing (maintainer side)
`pnpm release 0.4.0` bumps versions, updates `CHANGELOG.md`, tags `v0.4.0` and pushes. A GitHub Actions workflow then:
1. Runs `pnpm check`.
2. Builds the bundle and `latest.json`, signs it, and attaches everything to a **draft** release.
3. **Install test** on `windows-latest` and `macos-latest` runners: fresh install from the draft, `/api/health`, a small scan with `--offline` fixtures, uninstall.
4. **Upgrade test**: install the previous release, update to the draft, check data survived and the version changed; then force a broken version and check the rollback.
5. Publishes the release when all of that is green. Pre-release tags (`v0.5.0-beta.1`) go to the Beta channel only.

Adoption can be read from the release assets' download counts on GitHub. There is no telemetry.

## 7. Security and privacy
- The server listens on **127.0.0.1 only**. Every `/api` request must carry a loopback `Host` (stops DNS rebinding), and every request that changes something must carry an `Origin` equal to the server's own address (browsers always send it on POST/DELETE). This closes the cross-site requests above without a token. A per-install token can be added later if other programs on the same computer become a concern.
- Updates are accepted only with a valid signature; installs and Node downloads are checksum-checked.
- No admin rights are asked for, and nothing outside `RAWJOBS_HOME`, the user's LaunchAgents/Task Scheduler entry and the shortcut is touched.
- The data never leaves the computer except what the app does today (directory download, job sites, optional Telegram, optional contributions).
- `SECURITY.md` and `PRIVACY.md` get a section on the installer and updates.

## 8. Uninstall and support
- `rawjobs uninstall` (or `uninstall.ps1` / `uninstall.sh`): stops the server and removes the task, the shortcut, `app/` and `runtime/`. It **asks** before deleting `data/` (default: keep).
- `rawjobs doctor`: version, Node, port, task registered, last update, last scan, disk space, and a "Copy diagnostics" button in Settings (no personal data) for GitHub issues.
- Logs in `logs/`, rotated at 5 MB.

## 9. Risks and what to test on real machines
| Risk | Plan |
|---|---|
| Antivirus flags `irm … \| iex` or the hidden task | Test on Windows Defender; keep the script short, readable and checksum-verified; document what it does in the README |
| Locked-down work laptops (PowerShell or scheduled tasks blocked) | Clear error message, and a manual fallback (`rawjobs open` from the folder) |
| macOS 26 blocks the locally built `RawJobs.app` | Test; fallback is a `.webloc` link plus the login agent |
| Non-technical users afraid of Terminal | README with screenshots, or a short video. If it's a real blocker, move to the desktop app (Future) |
| Port conflicts | Fallback port, saved in `state.json` |
| Moving existing data from the dev setup | `rawjobs import --from <repo folder>` copies config, profile and data; statuses and notes move through Settings → Your data → Export / Import |

## 10. Build order (one PR each)
| Step | What | Effort (one person) |
|---|---|---|
| 1 | **Production server** `packages/server`: the 16 routes on `node:http`, the built dashboard and `data/` served from it, scans owned by the server (closing or reloading the tab never stops one; `GET /api/run` follows it again), Host + Origin check, `/api/health`, `pnpm start`. The Vite dev server reuses it. **Built 2026-10-11.** Calling the core in-process instead of starting the CLI per request moves to step 3, where tsx goes away. | 2–3 days |
| 2 | **Data folder and tracking on disk**: `RAWJOBS_HOME` (core `rawjobsHome()`, default: the folder RawJobs runs in, so a checkout works as before) for the config, `profile/` and `data/`; the server and scheduled scans run the CLI there. Statuses, notes, saved views, hidden companies and rules saved in `profile/tracking.json` (`GET/PUT /api/tracking`), with the browser copy kept for an instant first paint; the first page opened with this version uploads what its browser had. **Built 2026-10-11.** | 2–3 days |
| 3 | **Bundle and launcher**: `pnpm bundle` builds `dist/bundle/rawjobs-<version>/` (one `cli.mjs` with the CLI, the server and every dependency, 1.3 MB; `web/`; `bin/`; `package.json`). `rawjobs serve` runs the dashboard. `packaging/bin/rawjobs` and `rawjobs.cmd` run the version in `app/current.txt` with the Node in `runtime/current.txt` and set `RAWJOBS_HOME`; scheduled scans from an installed copy go through the launcher. `pnpm bundle --try <dir>` lays out a trial install; CI runs it on every push. **Built 2026-10-11.** A command starts in 0.3 s from the bundle (1.3 s through tsx), so calling the core in-process isn't needed. | 2 days |
| 4 | **Install scripts and the release workflow**: `install.sh`, `install.ps1`, uninstall, `latest.json` signing, install test on CI | 3–4 days |
| 5 | **Updater**: check, verify, switch, health check, rollback, migrations framework, Settings → Updates, upgrade and rollback tests on CI | 3–4 days |
| 6 | **Docs**: README getting started (one line per OS, with screenshots), SECURITY, PRIVACY, a troubleshooting page | 1 day |

About 3 weeks in all. After step 1 the dashboard already survives a closed terminal for anyone using `pnpm`.

## 11. Future
| When | What |
|---|---|
| Users want scans while their computer is off | **GitHub Actions scans** in the user's own private repo (phase 2 of `scheduled-scans.md`), sending matches to Telegram. Still nothing hosted by us. |
| Many users can't paste a line | **Desktop app**: Electron, its own window and tray, reusing steps 1–3. Costs: Apple Developer $99/yr (needed for macOS and for Mac auto-updates); Windows via the Microsoft Store (free; it signs the app) or a Certum open-source certificate (€49). Script installs get an update that offers to move over, keeping `data/`. |
| Technical users ask for package managers | A Homebrew **tap of our own** (a formula, not a cask, so no notarization) and a Scoop bucket, both calling the same bundle. winget once there's a signed installer. |
| Linux | `install.sh` with a systemd user service; `schedule.ts` already supports systemd. |

## 12. Cost
**$0** for everything above. Money is only needed for the desktop app route (about $99/yr, plus €49 if a signed direct Windows download is wanted).

## Settled on 2026-10-11
1. **Updates default to Automatic**: patch and minor releases install themselves; a major release shows a banner and waits for **Update now**.
2. **Port 4317**, with the fallback in section 4.
3. **The installer stops at opening the dashboard.** Telegram alerts and scheduled scans stay in the dashboard's setup and Settings.
