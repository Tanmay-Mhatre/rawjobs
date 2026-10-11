# Install RawJobs

RawJobs runs on your computer. Installing it takes about a minute and one line in a terminal. You
don't need Node, git or an account, or admin rights.

## Install

**Windows** (Windows 10 version 1803 or newer, 11): open **PowerShell** (Start menu → type
"PowerShell"), paste this line and press Enter:

```powershell
irm https://github.com/Tanmay-Mhatre/rawjobs/releases/latest/download/install.ps1 | iex
```

**macOS** (Apple silicon or Intel) and **Linux** (x64 or ARM64): open **Terminal**, paste this line
and press Enter:

```bash
curl -fsSL https://github.com/Tanmay-Mhatre/rawjobs/releases/latest/download/install.sh | sh
```

When it's done, the dashboard opens in your browser at **http://127.0.0.1:4317** and walks you
through setup (about 3 minutes).

You can read the script before running it: open the same address in your browser, or download it
and look at it. It's [packaging/install.ps1](../packaging/install.ps1) and
[packaging/install.sh](../packaging/install.sh) in this repository.

## What the installer does

1. Downloads the newest RawJobs from this repository's
   [releases](https://github.com/Tanmay-Mhatre/rawjobs/releases) and the version of Node it runs on
   from [nodejs.org](https://nodejs.org). It checks both against checksums in the release, and the
   release's signature against RawJobs' signing key, before running anything (see
   [Security](#security)).
2. Puts everything in one folder in your user account:

   | | Folder |
   |---|---|
   | Windows | `%LOCALAPPDATA%\RawJobs` |
   | macOS | `~/Library/Application Support/RawJobs` |
   | Linux | `~/.local/share/rawjobs` |

   The Node it downloads is private to RawJobs: nothing is installed system-wide, and any Node you
   already have is left alone.
3. Starts RawJobs in the background now and every time you log in, and starts it again if it ever
   stops:

   | | How |
   |---|---|
   | Windows | A task called **RawJobs Server** in Task Scheduler |
   | macOS | A launch agent, `~/Library/LaunchAgents/com.rawjobs.server.plist` |
   | Linux | A systemd user service, `rawjobs.service` |

4. Adds a **RawJobs** shortcut (Windows: Start menu; macOS: `~/Applications`; Linux: your app menu)
   that opens the dashboard, and starts RawJobs first if it isn't running.

Nothing else on your computer changes. RawJobs only answers on `127.0.0.1`, so other computers on
your network can't reach it.

## Using it

- Open **RawJobs** from the shortcut, or go to http://127.0.0.1:4317. Closing the browser doesn't
  stop RawJobs; it keeps running in the background, using very little.
- Scheduled scans (Settings → Scans & alerts) run while your computer is on, and catch up when it
  wakes up.
- From a terminal, the `rawjobs` command is in the `bin` folder of the install folder, for example
  `"%LOCALAPPDATA%\RawJobs\bin\rawjobs.cmd" scan` on Windows or
  `~/Library/Application\ Support/RawJobs/bin/rawjobs scan` on macOS. See
  [Command line](../README.md#command-line).

## Updates

RawJobs checks for a new version once a day and, by default, installs it when no scan is running.
It takes a few seconds; the dashboard shows "Reconnecting…" and reloads by itself.

- **Settings → Updates**: Automatic (the default), Ask me, or Off; and whether to get test versions
  early.
- Before an update, your profile, tracking and scan data are backed up to the `backups` folder (the
  last three are kept).
- If a new version doesn't start within a minute, RawJobs goes back to the one you had, puts the
  backup back and tells you. It won't try that version again by itself.
- To update by hand, run the install line again, or `rawjobs update`.

## Uninstall

**Windows**:

```powershell
& "$env:LOCALAPPDATA\RawJobs\bin\rawjobs.cmd" uninstall
```

**macOS**:

```bash
"$HOME/Library/Application Support/RawJobs/bin/rawjobs" uninstall
```

**Linux**:

```bash
~/.local/share/rawjobs/bin/rawjobs uninstall
```

It stops RawJobs and removes it from start-at-login, its scheduled scans, the shortcut and the
program files. It asks whether to delete your profile, resume, tracking and scan data too. Add
`--keep-data` or `--delete-data` to answer in advance.

## Where your data is

Everything is in the install folder: your profile (`rawjobs.config.local.yaml`), resume, tracking
and Telegram settings (`profile/`), and scan results (`data/`). Nothing about you is uploaded; see
[PRIVACY.md](../PRIVACY.md).

Already running RawJobs from the source code? An installed copy starts fresh. To bring your setup
across, copy `rawjobs.config.local.yaml` and the `profile` folder from your checkout into the install
folder, then open the dashboard. Statuses and notes can also be moved with Settings → Your data →
Export, then Import.

## Troubleshooting

**"irm" or "curl" isn't recognised.** On Windows, use PowerShell, not Command Prompt. On Linux,
install `curl` (or use `wget -qO- <address> | sh`).

**Your antivirus or work computer blocks the script.** Some security tools stop scripts that
download and run programs. Download `install.ps1` or `install.sh` from the
[latest release](https://github.com/Tanmay-Mhatre/rawjobs/releases/latest), read it, and run it
from the file. If scheduled tasks are blocked on Windows, the installer uses your Startup folder
instead, so RawJobs still starts at log in.

**The dashboard doesn't open.** Open the RawJobs shortcut: it starts RawJobs if needed. If that
doesn't help, look at `logs/server.log` in the install folder. Running the install line again
repairs an install and keeps your data.

**Port 4317 is in use.** RawJobs uses the next free port (4318, 4319…), and the shortcut finds it.

**"Reconnecting to RawJobs…" stays up.** RawJobs isn't running. Open the RawJobs shortcut, or run
the install line again.

**An update went back.** The note at the top of the dashboard says which version didn't start; `logs/update.log` and
`logs/server.log` in the install folder say why. Please
[open an issue](https://github.com/Tanmay-Mhatre/rawjobs/issues) with them.

**Linux without systemd** (some containers and minimal systems): RawJobs starts, but not at log in.
Open it from the app menu, or add `~/.local/share/rawjobs/bin/rawjobs serve` to whatever starts
programs at log in.

## Security

- Each release's `latest.json` lists the exact SHA-256 of its RawJobs bundle and of Node for each
  system, and is signed with RawJobs' release key (ed25519). The installer and the updater refuse a
  release whose signature or checksums don't match, before running anything from it.
- Node comes straight from nodejs.org, and must match the checksum the signed release names.
- Releases are built, signed and test-installed on Windows, macOS and Linux by
  [GitHub Actions](../.github/workflows/release.yml), from a tag in this repository.
- To report a problem, see [SECURITY.md](../SECURITY.md).
