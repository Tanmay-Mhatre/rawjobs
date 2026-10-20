# Privacy

RawJobs runs on your computer. Your profile, resume and searches stay there. This page lists
everything the app sends over the network, and to whom.

## What stays on your computer

| What | Where |
|---|---|
| Your profile: roles, places, topics, companies | `rawjobs.config.local.yaml` (or `rawjobs.config.yaml`), gitignored |
| Your resume | `profile/resume.md`, gitignored |
| Telegram bot token and chat id | `profile/secrets.json` (gitignored), or the `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` environment variables |
| Run history, jobs found, scan results | `data/`, gitignored |
| Statuses, notes, saved and applied jobs, Radar views and hidden companies | `profile/tracking.json` (gitignored), with a copy in your browser's storage (export them in Settings for a backup) |
| Your LinkedIn connections (names, profile links, company, position, date connected), your own positions and schools, and who you marked as a close contact, from the export you download | `profile/network.json` (gitignored). Delete it in Settings → Data & privacy → LinkedIn connections. |

Scoring and filtering happen on your computer. Nothing above is uploaded by the app.

### Your LinkedIn connections (only if you import them)
You download your own data export from LinkedIn and choose the file in RawJobs. Your browser opens
the ZIP and reads only Connections.csv, Positions.csv and Education.csv. It never opens your
messages, invitations or anything else in it, and RawJobs never keeps email addresses. Nothing is
sent to LinkedIn or anyone else.

Your connections file (`network.json`) isn't backed up or synced. People you add to a job's
contacts are part of your tracking data, so they're in its browser copy, its backups and its
exports. Deleting your connections in Settings, or starting setup over, removes `network.json`
and the files next to it.

### Picking up the file from Downloads (only if you leave it ticked)
In the Connect LinkedIn dialog, "Pick up the file from my Downloads folder by itself" is ticked by
default. With it ticked, opening LinkedIn's data page starts a watch:

- Every 10 seconds, RawJobs on your computer lists the **names** of the files in your Downloads
  folder (not its subfolders). On Windows it asks the registry where that folder is; on Linux it
  reads `~/.config/user-dirs.dirs`. It isn't offered on macOS.
- It opens only a file named like LinkedIn's export (`Basic_LinkedInDataExport_….zip`) that was
  saved after the watch started, and reads only Connections.csv, Positions.csv and Education.csv
  from it. It never opens any other file, and never moves or deletes your file.
- It stops once it has imported the file, or after 24 hours, whichever comes first.
- Stop it any time with "Stop" next to "Watching Downloads until …" on a job or in Settings →
  Data & privacy → LinkedIn connections. Choosing the file yourself stops it too.

While it runs, the watch is kept in `profile/network-watch.json`, so it carries on if RawJobs
restarts. The server log notes when it starts, finds a file and stops, with the file's name and
size only.

### Find friends at a company (the paste box)
"Find friends at {Company}" opens LinkedIn's own people search in your browser. If you copy that
results page and paste it into RawJobs, it is read on this computer and kept only until you reload
the page: it isn't saved, backed up or sent anywhere. Only the people you choose to add to a job
are saved, as that job's contacts.

## What the app sends, and to whom

### Company job boards
Scans fetch public job postings straight from each company's hiring system (Greenhouse, Lever,
Workday and others). These requests come from your computer, so those sites see your IP address,
like any website you visit. The app identifies itself with a RawJobs User-Agent. It never sends
your profile or resume to them, and never touches apply forms.

### Public job boards you add
If you add Hacker News "Who is hiring", Remotive, Arbeitnow, Remote OK, Himalayas, Jobicy, We Work Remotely or Remote First Jobs, the app reads their free
public APIs from your computer (Hacker News through Algolia's HN API), at most a few times a day.
Nothing about you is sent; those sites see your IP address, like any website you visit.

### The shared company directory
The app downloads the company directory and job index (`manifest.json`, `directory.json.gz`,
`index.json.gz`) and the shared job feed (`jobs-manifest.json` and its shards, from the `jobs` release)
from GitHub Releases of `Tanmay-Mhatre/rawjobs-directory`. GitHub sees your IP address, as with
any download. Everyone downloads the same files, and your filters are applied on your computer, so
nothing about you is uploaded and the downloads don't reveal what you're looking for.

### Sharing companies you add (on by default)
When you add a company by its careers link, and it isn't in the directory yet, the app sends that
board to the project's contribution inbox, so everyone can find it. This is **on by default**.

What is sent:
- the hiring system and the board name (for example `lever` and `acme`), plus the Workday
  shard and site, or the EU region, when needed;
- the company's name;
- the app name (`rawjobs`), optionally with a version number.

Never sent: your profile, resume, searches, statuses, notes, or which jobs you open.

The inbox is a small Cloudflare Worker (`services/contribute`). What it does with a request:
- **Your IP address** is used only by Cloudflare's rate limiter (20 requests a minute per address),
  and, for move reports, to make the keyed hash described below. The Worker doesn't store it, and we haven't turned on Cloudflare's request logs. Cloudflare
  itself handles the traffic under its own privacy policy.
- **It stores** the boards, the time they arrived, and the `client` field only if it is exactly the
  app name and version (like `rawjobs/0.1.0`); anything else in that field is dropped. Any
  other field in the request is ignored.
- **It also keeps** a list of the boards accepted each day (no IP, no time beyond the date) for 8
  days, to skip repeats and enforce a daily limit.
- Stored boards are deleted once the directory workflow has processed them, and after 30 days at
  most.

The inbox can also receive **move reports**: "this company's careers page moved from this board to
that one". A move names two boards (the old one and the new one, each a hiring system and a board
name) and a company name, nothing else. For each move the inbox stores those, when it first and
last arrived, and a short keyed hash of your IP address together with the old board. The hash
can't be turned back into your IP address; it only lets us count how many different people
reported the same move. Your IP address itself isn't stored. A move report is deleted once the
directory workflow has processed it, and after 30 days at most.

Boards that pass a live check are then published in `contributions.json` in the public directory
repo, as a hiring system, a board name and a company name. They aren't linked to you.

### Sharing a company's new careers link (same setting)
When a company's careers page moves and you confirm its new link, the app can report the move
so others following that company get the new link too, after the project's own checks. This
follows the same Sharing setting as above.

What is sent:
- the company's name;
- its old board and its new board (hiring system and board name, plus the Workday shard and site,
  or the EU region, when needed);
- the app name (`rawjobs`), optionally with a version number.

A move report names a company you follow, and the board you were following it on, which sharing
an added company doesn't reveal. To make it harder to tie to you, it isn't sent when you click:
it waits in `data/catalog/moves-outbox.json` and goes with the next regular directory update. The
inbox handles it like added boards (rate limit, nothing about you stored, deleted once processed
and after 30 days at most). With the report it keeps a short code made from your IP address and
the old board (a keyed hash, not the address itself, deleted with the report), only to count how
many different people reported the same move.

### Telegram alerts (only if you set them up)
Alerts are sent through Telegram's API (`api.telegram.org`) with your own bot. They contain job
titles, companies and links. Once it's set up, scheduled scans and every scan you start from the dashboard send one
message when they finish.

### Installing and updating (installed copies only)
The install line downloads RawJobs from this repository's GitHub Releases and Node from
`nodejs.org`. An installed copy then reads a small file every few minutes,
`https://www.rawjobs.workers.dev/v1/latest.json`, which only names the newest version. When it
names a newer one, the copy downloads `latest.json` from the latest GitHub release (with "test
versions" on, it lists releases through `api.github.com`) and the new version. Cloudflare (which
serves that file), GitHub and nodejs.org see your IP address, as with any download. Nothing about
you is sent, and Cloudflare Web Analytics doesn't count these requests. If Telegram alerts are on,
the "update ready" message goes from your computer to your own bot, like scan alerts. Turn the
checks off in Settings → About → Updates. A copy run from the source code (`pnpm start`) never
checks.

### Links you open
On each job, the search links under "Talk to someone who works here" open LinkedIn or Blind in
your browser, and the "Book a call" links open ADPList or Topmate. Those sites see what you
searched for (the company's name, a role, a school or a past employer) like any visit, and your IP
address. RawJobs itself never contacts these sites, and the dashboard sends no referrer, so they
don't see which RawJobs page you came from.

Message drafts ("Draft a message") are filled in on your computer and only copied to your
clipboard: you paste and send them yourself. RawJobs never sends a message, and "Copy a prompt for
your own AI" only copies text for you to paste wherever you choose.

### No telemetry
The app has no analytics, no crash reporting and no usage tracking. The web dashboard loads no
outside scripts or fonts.

## This website

The project website (<https://www.rawjobs.workers.dev>) uses Cloudflare Web Analytics: cookieless,
no personal data, counts of visits only. The app itself has none (see "No telemetry" above).

## Turning sharing off

Either:
- **Settings → Data & privacy → Sharing**: switch off "Share companies I add or update by link"; or
- in your config file:

  ```yaml
  directory:
    share_additions: false
  ```

Anything still waiting to be sent when sharing is off (added boards in `data/catalog/outbox.json`,
shown in the directory bar as "waiting to be shared", and careers-link moves in
`data/catalog/moves-outbox.json`) is dropped at the next directory update, never sent. While
sharing is off, confirming a new careers link doesn't queue a move at all.

## Your company in the directory

If you run a company and want it removed from the published directory, see
[Takedown and opt-out](https://github.com/Tanmay-Mhatre/rawjobs-directory/blob/main/NOTICE.md#takedown-and-opt-out).

## Questions

Open an issue on [GitHub](https://github.com/Tanmay-Mhatre/rawjobs/issues).
