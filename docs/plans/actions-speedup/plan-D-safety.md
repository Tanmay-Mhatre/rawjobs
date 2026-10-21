# PR D: workflow safety and hygiene (plan)

Base: `origin/main` at `955a493`. I checked every path, line number and snippet below with
`git show origin/main:<path>`. Run data comes from `gh run list` / `gh api .../jobs` on 2026-10-21.

## Correction to the earlier audit

The audit said `directory` group runs could be dropped (GitHub keeps only one pending run per group).
**That is already fixed on main.** Commit `6619e50` (2026-10-12) added `queue: max` to every
`directory` member:

- `directory-commoncrawl.yml` lines 16-19
- `directory-contributions.yml` lines 18-21
- `directory-rebuild.yml` lines 51-54
- `sign-data.yml`, job `directory`, lines 36-39

Contributions runs have succeeded on it since (latest 2026-10-21 11:55Z). My first grep missed the
`queue:` key. So PR D changes **no directory file**, and there is no catalog-state ordering for PR D
to manage (see "Sequencing with PR B").

## Scope and ownership

| File | PR D does | Owned elsewhere |
|---|---|---|
| `.github/workflows/release.yml` | workflow-level `concurrency`; `timeout-minutes` on `publish` | Its `test` job calls `install-test.yml`: PR C territory, don't touch |
| `.github/workflows/connector-health.yml` | add `concurrency` | none |
| `.github/workflows/data-health.yml` | add `concurrency` | none |
| `.github/workflows/concepts-weekly.yml` | **no change**: it already has `group: concepts`, `cancel-in-progress: false` (lines 20-22) | none |
| `.github/workflows/release-reminder.yml` | **no change** (reasons below) | none |
| `directory-*.yml`, `sign-data.yml` (`directory` job) | **no change** | PR B (directory fan-out) |
| `jobs-daily.yml`; `sign-data.yml` job `jobs` (group `jobs`, lines 70-72, no `queue: max`) | **no change** | PR A, see "Overlaps" |
| `ci.yml`, `install-test.yml` | **no change** | PR C |

---

## Change 1: release.yml, serialise tag runs and never cancel one

**Location:** `.github/workflows/release.yml`, insert after `permissions:` (lines 15-16) and before
`env:` (line 18).

**Current (lines 11-19):**
```yaml
on:
  push:
    tags: ["v*"]

permissions:
  contents: read

env:
  TAG: ${{ github.ref_name }}
```

**Proposed:** insert between `permissions` and `env`:
```yaml
# One release at a time, in the order the tags were pushed. Never cancel one that has started
# (a half-published release), and queue: max so a third tag pushed meanwhile doesn't replace the
# second one's waiting run (the default keeps only one waiting run per group).
concurrency:
  group: release
  cancel-in-progress: false
  queue: max
```

**Why:**
- Today there is no concurrency, so two tags pushed close together run in parallel.
- Each `publish` runs `gh release create`, which by default makes the release created last the
  "latest" one.
- Each `publish` also starts `site.yml`, which writes the update beacon `v1/latest.json`, and closes
  the `release-pending` issue.
- If v0.7.0 finishes after v0.7.1, the older version can become "latest" and the beacon can point
  backwards.
- Serialising keeps the order. `cancel-in-progress: false` means a release in progress is never
  cancelled. `queue: max` means no waiting tag is dropped. It's the same pattern the `directory`
  group has used since 6619e50.

**Why workflow-level and not just on `publish`:** sign and test take about 4-6 min in total. Queueing
the whole run keeps one tag's artifacts and install test together with its publish. It costs a few
minutes of latency for a rare double tag. Real gaps between tags are at least about 2 h:
- v0.7.0 → v0.7.1: 11:53 → 15:53
- v0.6.20 → v0.6.21: 06:52 → 09:56

**Risk:** low.
- A re-pushed or deleted-and-re-pushed tag queues behind the running one instead of racing it. That
  is the wanted behaviour.
- `queue: max` caps the queue at 100 waiting runs.

**Test:**
1. Run `actionlint .github/workflows/release.yml` (via `npx`/`go run` or the Docker image; it isn't in
   the repo). Older actionlint may flag `queue:`. If so, cross-check with the 4 files that already
   use it.
2. On the PR: GitHub parses the workflow on push, and a parse error shows as a failed "Release"
   workflow file in the Actions tab.
3. Behaviour can't be tested without pushing a tag, and a tag publishes a real release. So no tag
   push: verify on the user's next release that the run header shows "concurrency group: release".

## Change 2: release.yml, give `publish` a time limit

**Location:** `.github/workflows/release.yml`, job `publish`, lines 91-93.

**Current:**
```yaml
  publish:
    needs: test
    runs-on: ubuntu-24.04
    permissions:
```

**Proposed:**
```yaml
  publish:
    needs: test
    runs-on: ubuntu-24.04
    # Usually 10-17 s (v0.6.9-v0.7.1); the rest is headroom for a slow asset upload.
    timeout-minutes: 10
    permissions:
```

**Why:**
- `publish` is the only job in any workflow without `timeout-minutes`, so it defaults to 360 min.
- Its real durations over the last 15 releases (v0.6.9 to v0.7.1) were 10-17 s:
  - build: 66-99 s
  - sign: 6-19 s
- 10 min is about 35× the slowest run. That is room for a slow GitHub upload of the release assets,
  without a hung `gh` holding the new `release` group for 6 h.

**Risk:** very low. If an upload ever takes more than 10 min, the job fails and `gh release create`
may have made a partial release. Recover by hand (`gh release delete <tag>` then re-run the job),
which is the same as any other failure today.

**Test:** actionlint; check the timeout on the next release run.

## Change 3: connector-health.yml, one run at a time

**Location:** `.github/workflows/connector-health.yml`, insert after the `env:` block (lines 19-21)
and before `jobs:` (line 23).

**Current (lines 19-23):**
```yaml
env:
  DATA_REPO: ${{ vars.DATA_REPO || 'Tanmay-Mhatre/rawjobs-directory' }}
  TITLE: "Hiring system checks failing"

jobs:
```

**Proposed:** insert before `jobs:`:
```yaml
# One check at a time: two runs (the schedule and a manual one) could both find no open issue and
# open two. A newer waiting run replacing an older waiting one is fine: only the latest result matters.
concurrency:
  group: connector-health
  cancel-in-progress: false
```

**Why:**
- The job finds an issue by `TITLE` and then opens, updates or closes it.
- Two runs that overlap (the cron at 06:53 plus a `workflow_dispatch`, about 3 min each) can both
  miss the issue and open duplicates, or race close against update.
- `cancel-in-progress: false` so the issue edit is never cut short.
- No `queue: max`: dropping a stale waiting check is correct.

**Risk:** nil. The only behaviour change is that a manual run started during the scheduled run waits
about 3 min.

**Test:** actionlint. Then, with the user's OK, dispatch twice on the PR branch:
`gh workflow run connector-health.yml --ref <branch>`, twice. The second run should show "Waiting"
until the first ends. Note: it reads live data and may open or close the real issue, the same as the
daily run would.

## Change 4: data-health.yml, one run at a time

**Location:** `.github/workflows/data-health.yml`, insert after the `env:` block (lines 20-22) and
before `jobs:` (line 24).

**Current (lines 20-24):**
```yaml
env:
  DATA_REPO: ${{ vars.DATA_REPO || 'Tanmay-Mhatre/rawjobs-directory' }}
  TITLE: "Shared data needs attention"

jobs:
```

**Proposed:**
```yaml
# One check at a time, so two runs can't both open the "needs attention" issue.
concurrency:
  group: data-health
  cancel-in-progress: false
```

**Why:** the same open/update/close-by-title pattern as connector-health. It runs twice a day (11:37
and 23:37) plus by hand, about 1 min each.

**Risk:** nil.

**Test:** the same as Change 3, with `data-health.yml`.

## No change: concepts-weekly.yml

It already has workflow-level `concurrency: { group: concepts, cancel-in-progress: false }` (lines
20-22) and `timeout-minutes: 60`. Nothing to do. Say so in the PR so reviewers don't look for it.

## No change: release-reminder.yml (keep it on every push to main)

Checked against `scripts/release/notes.ts`:
- Line 24 runs `git tag -l v*`. Line 29 runs
  `git log --first-parent --merges <lastTag>..HEAD` and counts every `Merge pull request #N`.
- Lines 31-33 call `gh pr view` for each PR.
- `draft.ts` imports `@rawjobs/core/release`, which is why it needs `pnpm install` and tsx.

Reasons to leave it as it is:
- **A path filter would make it wrong.** Every merged PR counts toward the reminder, docs-only ones
  included. If a filtered-out merge doesn't run it, the issue's count, "next" version and tag message
  go stale until the next unfiltered merge.
- **`fetch-depth: 0` is needed** for the tag list and the `tag..HEAD` log. (`filter: blob:none` would
  shave about 1-2 s off a 3 s checkout. Not worth a change.)
- **It's cheap.** The latest run took about 26 s in total: install 5 s, draft 2 s, issue 4 s. Its
  `concurrency: release-reminder` with `cancel-in-progress: true` already folds bursts of merges into
  the last one, which recomputes everything from git, so nothing is lost.

## Sequencing with PR B (directory fan-out)

PR D touches no directory file, so it has no merge-order dependency on B: either can merge first.

Constraints for B to keep (put these in B's plan, not D's diff):
1. Every workflow or job that restores or saves `catalog` state (`state.sh restore|save` with no
   argument), or publishes a `directory-*` release, must stay in `group: directory` with
   `cancel-in-progress: false` and `queue: max`.
2. Keep the group at the **workflow** level when one run spans collect → publish.
   `directory-rebuild.yml` line 49 explains why: per job, another run could take the group between
   them.
3. If B fans collect out into a matrix whose shards each save state, the shards need distinct state
   set names, as `jobs-<group>` does in `scripts/catalog/state.sh`. Otherwise they overwrite one
   `catalog-state.tar.gz`.
4. `sign-data.yml`'s `directory` job (lines 36-39) must keep the same group name if B renames it.

## Overlaps with other PRs

- **PR A (jobs-daily double trigger):**
  - `jobs-daily.yml` group `jobs` (lines 31-33) has no `queue: max`, and neither does `sign-data.yml`
    job `jobs` (lines 70-72). A pending scheduled feed run can therefore replace a pending dispatched
    one, or a pending manual sign run (these are the 10 "cancelled" schedule runs this week).
  - If PR A adds `queue: max` to `jobs-daily.yml`, it should add it to `sign-data.yml` lines 70-72
    in the same PR, so the whole group behaves one way.
  - PR D leaves both alone.
- **PR C (ci.yml push trigger):**
  - `release.yml` `test` (lines 85-89) and `ci.yml` `install` both call `install-test.yml`.
  - PR D doesn't touch `install-test.yml` or `ci.yml`. If C changes `install-test.yml` inputs, it
    must keep `release.yml`'s call (`with: artifact: release`) working.
- **PR B:** see "Sequencing with PR B". No shared files.

## Checks before opening the PR

- Run `pnpm install`, then `pnpm check`. It doesn't lint YAML (`check` = biome + design + typecheck
  + test), so it only proves nothing else broke.
- Run actionlint on the 3 changed files.
- Re-read the diff: 3 files and about 20 added lines, no removed lines.
- After the push, open the Actions tab and confirm none of the 3 workflows shows "Invalid workflow
  file".
- No UI change, so no screenshots.

## Release note

`none` (CI only; nothing changes in the app).

## Commit / PR text (draft)

Title: `Workflows: serialise releases, time limit on publish, one health check at a time`
