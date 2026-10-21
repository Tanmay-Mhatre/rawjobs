# PR C: CI / merge path speed-up (implementation plan)

Base: `origin/main` at `955a493`. I checked every path and line below with `git show origin/main:<path>`.
`ci.yml`, `install-test.yml`, `release.yml`, `release-reminder.yml` and `.mergify.yml` are identical on local
`main` and `origin/main`.

## Baseline (measured, last 200 CI runs plus 6 sampled in detail)

| Job | Wall time | Notes |
|---|---|---|
| `check` | ~100 s | `pnpm check` 72 s; not on the critical path |
| `node-22` | ~95 s | `pnpm test` 77 s; not required |
| `release-files` | ~32 s | critical path, part 1 |
| `install (ubuntu-24.04)` | ~80 s | |
| `install (windows-2025)` | ~128 s | serve 8 s, install 115 s |
| `install (macos-15)` | ~138 s | **serve 41-42 s in every sampled run**, install 90-95 s |

- **Critical path:** `release-files` (32 s), then `install (macos-15)` (138 s), about 172 s. A run takes about 3.0 min from created to updated.
- **Merge cadence:** the closest merges on 2026-10-21 were 4 min apart (11:08→11:12, 13:02→13:06). So one queue slot is about 3 min of CI plus about 1 min of Mergify overhead, which caps the queue at roughly **15 PRs/hour**.
- **Outliers:**
  - Waits for a macOS runner: 10 min in 39446821224 and 5.5 min in 39619395331. **Both are `push` runs on main.**
  - One `node-22` hang: 39279492146 attempt 1, cancelled at the 10-min job timeout. Its log has no test output before cleanup.
  - The 850-min Release run (39449942958, v0.6.19) was really about 2 min. The macOS install was re-run 14 h later.
- **Repo:** public, so Actions minutes are free. The real costs are runner concurrency (macOS especially) and wall time.
- **Branch protection on `main`:**
  - `strict: true`.
  - Required checks: `check`, `release-files`, `install / install (ubuntu-24.04|macos-15|windows-2025)`, all `app_id 15368` (GitHub Actions).
  - `enforce_admins: false`. The repo has no rulesets.

Suggested shape: one PR `ci-speed`, four commits (C1-C4 below). Every change is CI-only.
**Release note: none** (applies to the whole PR; no user-facing change).

---

## C1. macOS "Serve the release files" (41 s → about 2 s)

### Cause: what the logs show and what they don't

- **What I checked:** step logs of run 39631984859, job `install / install (macos-15)`.
  - The step header is at 16:08:35.59. The next step starts at 16:09:16.93: **41.3 s and no output in between.**
  - The step silences everything: Python goes to `>/dev/null 2>&1`, `curl -fs` is silent, and the loop never reports when it gives up.
- **So the logs cannot prove the cause.**
- **Evidence for the likely cause:**
  - The time is fixed at 41-42 s across 6 runs. That points to a **timeout**, not a variable cold start.
  - ubuntu takes 6 s and windows 8 s.
  - CPython's `http.server.HTTPServer.server_bind()` calls `socket.getfqdn(host)`, a reverse DNS lookup, before `server_activate()` (`listen()`). On macOS runners that lookup of `127.0.0.1` can stall on mDNS/DNS until it times out.
  - The loop also has no failure exit. If it runs out of tries it carries on silently, and the next step's `curl … install.sh` happens to succeed because the server is up by then.
- **Step 1 of the PR (diagnostic commit, removed again before queueing):** confirm on the PR's own macOS run before choosing the fix.
  ```bash
  python3 -c 'import socket,time; t=time.time(); socket.getfqdn("127.0.0.1"); print("getfqdn", round(time.time()-t,1), "s")'
  ```
  Also add `date +%T.%N` per loop iteration, and send server stderr to `$RUNNER_TEMP/serve.log` (printed after the loop).

### Location
`.github/workflows/install-test.yml:41-45`

### Current
```yaml
      - name: Serve the release files
        shell: bash
        run: |
          (cd release && python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1 &)
          for i in $(seq 1 20); do curl -fs http://127.0.0.1:8765/latest.json >/dev/null && break; sleep 1; done
```

### Proposed fix (if `getfqdn` is confirmed)
Keep Python, skip the reverse lookup, and fail loudly.
```yaml
      - name: Serve the release files
        shell: bash
        run: |
          # http.server's server_bind() does a reverse DNS lookup (socket.getfqdn) before it listens,
          # which takes ~40 s on macOS runners. Bind without it.
          cat > "$RUNNER_TEMP/serve.py" <<'EOF'
          import functools, http.server, socketserver
          class Server(http.server.ThreadingHTTPServer):
              def server_bind(self):
                  socketserver.TCPServer.server_bind(self)
                  self.server_name, self.server_port = "127.0.0.1", self.server_address[1]
          handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory="release")
          Server(("127.0.0.1", 8765), handler).serve_forever()
          EOF
          (python3 "$RUNNER_TEMP/serve.py" >"$RUNNER_TEMP/serve.log" 2>&1 &)
          for i in $(seq 1 30); do curl -fs http://127.0.0.1:8765/latest.json >/dev/null && break; sleep 0.5; done
          curl -fsS http://127.0.0.1:8765/latest.json >/dev/null || { echo "::error::the release file server didn't start"; cat "$RUNNER_TEMP/serve.log"; exit 1; }
```

### Fallback (if `getfqdn` is not the cause)
Serve with Node, which is preinstalled on all three hosted images. Use only `node:http` and `node:fs`, plus the same loud failure check. Make the decision after the diagnostic commit.

### Saving (honest arithmetic)
- **macOS job:** 138 s → about 98 s (−40 s of macOS runner time per run).
- **Critical path:** it moves to Windows: 32 + 128 = 160 s, against 32 + 138 = 170 s today. So **about 10 s of wall time per PR and per queue slot** (about 4% of a 4-min slot).
- **Reliability:** the silent wait becomes a clear failure with the server log printed.

### Risk and mitigation
- **Risk: low.** Step name, job name and check names don't change.
- **Release path:** `release.yml:85-89` calls the same file. The fix applies there too, which is wanted. The next tag exercises it.
- **Windows:** `bash` there is Git Bash and `python3` exists on windows-2025 today (the current step uses it). The heredoc stays inside `shell: bash`.

### How to test
1. On PR C, check that all three `install / install (…)` jobs pass.
2. Check the macOS serve step is under 5 s: `gh run view <id> --json jobs` and compare step `startedAt`/`completedAt`.
3. Negative test (one throwaway commit, reverted): serve from a wrong directory. The step must fail with "didn't start".

---

## C2. Step timeouts (a hang fails in 5 min, not 10+)

### Locations
- `.github/workflows/ci.yml:29`: `- run: pnpm check` in `check`.
- `.github/workflows/ci.yml:59`: `- run: pnpm test` in `node-22`.
- `.github/workflows/release.yml:91-93`: `publish` has no `timeout-minutes` (the default is 360 min).

### Proposed
```yaml
      - run: pnpm check          # ci.yml:29
        timeout-minutes: 5
...
      - run: pnpm test           # ci.yml:59
        timeout-minutes: 5
```
```yaml
  publish:                       # release.yml:91
    needs: test
    runs-on: ubuntu-24.04
    timeout-minutes: 10
```

### Saving
- On a hang (1 in the last 200 runs): about 5-7 min sooner to red and a re-run.
- Normal runs: 0 (72 s and 77 s are well under 5 min).

### Risk and mitigation
- **Risk: low.** If tests grow past 5 min this trips. The job timeout stays at 10 min as the outer bound.
- `node-22` isn't required, but a hang there still holds the run open.

### How to test
- PR C passes.
- Optional throwaway commit with `sleep 400` in a step, reverted, to watch the step timeout fire.

---

## C3. Skip the install matrix (and release files) on `push` to main

### Nothing depends on push runs (checked)
- **Branch protection / Mergify:** both judge PR checks only (required contexts are evaluated on the PR head; `.mergify.yml:19-23` reads PR checks).
- **`release.yml`:** triggered by `push: tags: ["v*"]` (line 11-13). It builds from the tag and runs its own `install-test.yml` on all 3 OS before `publish` (`needs: test`, lines 85-92). It never reads a CI run.
- **`release-reminder.yml`:** a separate `push: main` workflow (lines 7-10). It doesn't read CI.
- **No `workflow_run` triggers** exist anywhere in `.github/workflows`.
- **README badge** (`README.md:5`): it shows the latest `ci.yml` run on the default branch. With this change, push runs still run `check` and `node-22`, and the skipped jobs conclude success, so the badge stays meaningful.
- **Why it's safe:** with `strict: true` plus `update_method: merge` (`.mergify.yml:26`), the tree pushed to main equals the PR head CI already tested. So the push run's install matrix is a straight repeat. The release pipeline runs the install test again before anything ships.

### Why a job-level `if:` on `install` is not used
`install` is a reusable-workflow call with a matrix. Skipping it at the caller (`ci.yml:106`) reports one check named `install`. The matrix is never expanded, so `install / install (macos-15)` etc. never appear. That doesn't matter on push, but it would **leave the required checks pending forever on a PR** (see C4). One mechanism (below) is used for both cases.

### Location and current code
- `ci.yml:106-112` (caller).
- `install-test.yml:5-19` (inputs).
- `install-test.yml:30` (`runs-on`).
- Steps at `:37`, `:41`, `:47-48`, `:91-92`, `:98-99`, `:139-140`.
- `ci.yml:63-104` (`release-files` steps).

Current caller:
```yaml
  install:
    needs: release-files
    uses: ./.github/workflows/install-test.yml
    with:
      artifact: release-test
      public-key: ${{ needs.release-files.outputs.public-key }}
      update-test: true
```

### Proposed `install-test.yml`
A new input. The job keeps its matrix, so check names are unchanged. When skipping, it runs on ubuntu with every step off.
```yaml
      skip:
        description: Report the install checks as passed without running them (pushes to main, docs/site-only PRs)
        type: boolean
        default: false
...
    # Skipping still runs one job per OS, so the required checks named after the matrix report success;
    # on ubuntu, so a skip never waits for a macOS or Windows runner.
    runs-on: ${{ inputs.skip && 'ubuntu-24.04' || matrix.os }}
    steps:
      - name: Skipped
        if: inputs.skip
        run: echo "No changes the install test covers; skipped."
      - uses: actions/download-artifact@…   # add: if: ${{ !inputs.skip }}
      - name: Serve the release files        # add: if: ${{ !inputs.skip }}
      - name: Install, repair, uninstall (macOS, Linux)
        if: ${{ !inputs.skip && runner.os != 'Windows' }}
      - name: The logs, when something failed (macOS, Linux)
        if: ${{ !inputs.skip && failure() && runner.os != 'Windows' }}
      - name: Install, repair, uninstall (Windows PowerShell)
        if: ${{ !inputs.skip && runner.os == 'Windows' }}
      - name: The logs, when something failed (Windows)
        if: ${{ !inputs.skip && failure() && runner.os == 'Windows' }}
```
- **Every** step needs `!inputs.skip`. When skipping, `runner.os` is Linux, so the existing `runner.os != 'Windows'` gate on its own would run the macOS/Linux install.
- The default job name for a matrix job is `install (<matrix.os>)`. It comes from the matrix value, not from `runs-on`, so the names stay the same.
- `release.yml:85-89` passes no `skip`, so it defaults to `false` and releases are unchanged.

### Proposed `ci.yml`
- `release-files` steps after checkout: `if: github.event_name != 'push'`. The job still concludes success; push skips the 3 bundle builds.
- Caller, combined with C4:
```yaml
  install:
    needs: [changes, release-files]
    uses: ./.github/workflows/install-test.yml
    with:
      artifact: release-test
      public-key: ${{ needs.release-files.outputs.public-key }}
      update-test: true
      # == 'false', not != 'true': if the changes job misreports, run the install test.
      skip: ${{ github.event_name == 'push' || needs.changes.outputs.install == 'false' }}
```

### Saving (per merge)
- **Runner time:** about 350 s cut from each push run (80 + 128 + 138 s), including **one macOS job and one Windows job**, plus about 25 s of `release-files` builds.
- **Push run wall time:** about 3.0 min → about 1.8 min (bounded by `check`).
- **Queue throughput (indirect):** push runs were about 35% of all CI runs (71/200), and so about 35% of macOS demand. Both observed 5-10 min macOS waits were push runs competing with queue runs. If such a wait lands on the queued PR, its slot grows from 4 to 9-14 min, and C3 removes that contention.

### Risk and mitigation
- **Risk: low-medium.** Main no longer runs the install test after each merge.
- **Mitigation:**
  - The identical tree was tested on the PR (strict mode).
  - `release.yml` runs the full 3-OS install test before every publish.
  - Scheduled/dispatch workflows are untouched.

### How to test
1. **On PR C:** all checks green. Install jobs really run, because `pull_request` events never skip on the push condition.
2. **After merge:**
   - The first `push` run on main shows 3 `install (…)` jobs on ubuntu, each about 10 s with the "Skipped" step.
   - `release-files` succeeds with its build steps skipped.
   - The badge stays green.
3. **Next tag:** the Release run shows real installs on 3 OS (skip defaults to false).

---

## C4. Docs- and site-only PRs: skip the install test (and `check` for docs-only)

### How often
In the last 80 merged PRs:
- **2** were docs-only (`docs/**` and top-level `*.md`).
- **8** were docs/site-only (adding `apps/site/**`).

### Which paths, and why (checked)
- **The install test never touches the site.**
  - The installers come from `packaging/` (`scripts/release/manifest.ts:90`).
  - The bundle copies `apps/web/dist` and `LICENSE` (`scripts/bundle/build.ts:58,62`), not `apps/site`.
  - The site has its own `site.yml` PR check (`site.yml:18-23`).
- **Tests don't read `docs/` or top-level `*.md`:** `git grep` found no test reading `README`, `CONTRIBUTING` or `docs/`. Code mentions only appear in comments.
- **Two sets:**
  - `install` may be skipped when every changed file matches `^(docs/|apps/site/|[^/]+\.md$)`.
  - `code` (`check`, `node-22`) may be skipped only when every file matches `^(docs/|[^/]+\.md$)`. Site PRs still run `check` (biome lint and typecheck cover the repo).

### Skipped job vs skipped steps (why every required job must *run*)
- **GitHub branch protection:** a job skipped by job-level `if:` concludes `skipped`, which GitHub counts as passing for a required check.
- **Mergify:** `.mergify.yml:19-23` uses `check-success = …`. A `skipped` conclusion is not `success` (Mergify has a separate `check-skipped` condition). A PR whose `check` was skipped at job level would therefore **never enter or merge from the queue**. Confirm this in Mergify's docs during the build; the design avoids depending on it either way.
- **Reusable `install` call:** a job-level skip doesn't expand the matrix, so `install / install (<os>)` never reports (C3).
- **So:**
  - Required jobs (`check`, `release-files`, `install`) always run and skip **steps**. Their conclusion is `success`.
  - Only the non-required `node-22` may use a job-level `if:`.

### Proposed `changes` job (new, not required; parallel with `release-files`)
```yaml
  # Which tests this change needs. Not a required check: if it fails, the jobs that need it don't
  # run, the required checks stay missing and the PR can't merge (fails closed).
  changes:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    outputs:
      code: ${{ steps.diff.outputs.code }}
      install: ${{ steps.diff.outputs.install }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 2
      - id: diff
        shell: bash
        run: |
          code=true install=true
          if [ "$GITHUB_EVENT_NAME" = pull_request ]; then
            # The PR's merge commit: its first parent is main.
            files="$(git diff --name-only HEAD^1 HEAD)"
            printf '%s\n' "$files"
            if [ -n "$files" ] && ! printf '%s\n' "$files" | grep -qvE '^(docs/|[^/]+\.md$)'; then code=false; fi
            if [ -n "$files" ] && ! printf '%s\n' "$files" | grep -qvE '^(docs/|apps/site/|[^/]+\.md$)'; then install=false; fi
          fi
          echo "code=$code" >> "$GITHUB_OUTPUT"
          echo "install=$install" >> "$GITHUB_OUTPUT"
```
- **Fail-safe:** if `git diff` errors, `bash -e` fails the step, so the job fails and dependents don't run (fails closed). An empty file list means "run everything". A change to `.github/**` or anything else counts as code.

### Gating `check` (required: steps only)
```yaml
  check:
    needs: changes
    ...
    steps:
      # every step: checkout, pnpm setup, setup-node, install, pnpm check, validate, bundle test
      - uses: actions/checkout@…
        if: needs.changes.outputs.code != 'false'
```
- Use `!= 'false'` on every step, so a missing output runs the steps.

### Gating `node-22` (not required)
```yaml
  node-22:
    needs: changes
    if: needs.changes.outputs.code != 'false'
```

### Gating `release-files` (required: steps only, no `needs`)
- No `needs`, so the critical path doesn't grow.
- Its steps use `if: github.event_name != 'push'` (from C3). It still builds on docs/site PRs (about 32 s on ubuntu, off any OS-matrix cost). Gating it on `changes` would add about 10 s to every normal PR's critical path, which isn't worth it.

### Gating `install`
`skip: ${{ github.event_name == 'push' || needs.changes.outputs.install == 'false' }}` (see C3).

### Saving
- **Normal PRs:**
  - `changes` takes about 10 s and runs alongside `release-files` (32 s), so `install` gains nothing on the critical path.
  - `check` and `node-22` start about 10 s later and finish about 110 s in, still under the 160-170 s critical path. Cost: **about 0 s.**
- **Docs/site PRs (about 10%):** about 170 s → about 110 s (bounded by `check`). **About 60 s faster**, and 3 OS installs (incl. macOS) avoided.
- **Docs-only PRs (about 2.5%):** about 170 s → about 45 s (`release-files` plus the stub installs).
- **Average per PR:** about 0.10 × 60 s ≈ 6 s. The bigger win is about 10% fewer macOS/Windows jobs.
- **Queue throughput:** about 1-2% more on average. These PRs go through a slot in about 3 min instead of 4.

### Risk and mitigation
- **Risk: medium.** The danger is a required check that never reports or never reaches `success`, which stalls the PR or the queue. Mitigations:
  - **Check names don't change:** no job is renamed, the matrix is kept and no `name:` key is added.
  - **Tested on the PR itself:** `pull_request` runs use the PR's own workflow files. A wrong name or skip shows on PR C before it merges, and can't break main.
  - **Wrong classification:** the allowlist is narrow and the default is "run". A missed path means running too much, never too little.
- **`.mergify.yml` is not touched.** If it ever were: queue only after Mergify's "Configuration changed" check passes.

### How to test
1. **PR C (touches `.github/`):** everything runs in full, and `changes` outputs `code=true install=true`.
2. **Throwaway draft PR** based on PR C's branch, changing only `docs/plans/_ci-test.md`. Never labelled `queue`; closed after.
   - Expect: `check` success with steps skipped, `node-22` skipped, `release-files` success, 3 × `install / install (…)` success on ubuntu.
   - Mergify's summary shows all `check-success` conditions met.
3. **Second throwaway draft PR** touching only `apps/site/src/index.html`.
   - Expect: `check` runs in full, installs are stubs, `site.yml` runs.
4. Close both drafts. Don't merge them.

---

## Totals

| Change | Per normal PR (wall) | Per docs/site PR | Per merge (push run) | Queue slot |
|---|---|---|---|---|
| C1 serve fix | −10 s | −10 s | 0 after C3 | about −4% |
| C2 timeouts | 0 (−5 min on a hang) | 0 | 0 | tail only |
| C3 push skip | 0 | 0 | −350 s runner time incl. macOS + Windows | indirect: removes about 35% of macOS demand |
| C4 changes job | about 0 | −60 s (−125 s docs-only) | — | about +1-2% |

Combined, a queue slot goes from about 4.0 min to about 3.8 min on average. The big win is cutting the 5-10 min macOS-wait tail. C1-C4 can't make a slot shorter than about 2.7 min of CI, which is bounded by Windows install plus `release-files`.

---

## Appendix: user decision only (not recommended without the user): Mergify batching / speculative checks

This is the only lever that changes throughput by a large factor. Per `CLAUDE.md` ("Don't change `main`'s branch protection or `.mergify.yml` to get your PR in faster"), only the user decides and applies it.

### What it requires
1. **Branch protection (user, by hand):** turn off "Require branches to be up to date before merging" on `main`. This is `required_status_checks.strict: false`; the required contexts stay. Mergify then enforces up-to-date itself by testing the queue state in its own draft PRs. `.mergify.yml:7-8` notes the current in-place mode exists only because of `strict`.
2. **`.mergify.yml` diff:**
   ```diff
   -# main requires branches to be up to date, which Mergify supports only when it checks PRs in place:
   -# one at a time, batches of one, and the same conditions to join the queue as to merge.
   +# Mergify tests the queue in its own draft PRs (main + the PRs ahead), so main no longer needs the
   +# "up to date" rule: up to 3 PRs per batch, and the next batch is checked while one runs.
    merge_queue:
   -  max_parallel_checks: 1
   +  max_parallel_checks: 2
   ...
   -    batch_size: 1
   +    batch_size: 3
   +    batch_max_wait_time: 2 min
   ```
   - `queue_conditions` and `merge_conditions` can stay as they are.
   - The draft PRs come from Mergify's `mergify/merge-queue/*` branches and trigger `ci.yml`'s `pull_request`, so the same required check names report on them.
3. **"Configuration changed" check:** Mergify always runs the config on `main`. Queue the PR only after this check on it reports the new config valid. If the queue breaks afterwards, the user merges the fix by hand (CLAUDE.md).
4. **Behaviour change:** a failing batch is split and re-tested (bisected), so one bad PR costs the others extra CI rounds. Also, PR authors no longer see main merged into their branch before the merge.

### Gain
- Today: 1 PR per about 4 min, so about 15/h at most.
- `batch_size: 3`: 3 PRs per about 4 min plus up to 2 min of wait, so about 30-45/h.
- With `max_parallel_checks: 2` (speculative): up to about 2× on top.
- Real demand on 2026-10-21 was about 12 merges in 6 h. The gain matters only during bursts when several sessions queue at once.

---

## Rollback
- Each commit is self-contained. Reverting PR C, or one commit, through the normal queue restores the old behaviour. `release.yml` doesn't depend on C3/C4 (`skip` defaults to `false`).
- If a bad merge ever left required checks unreported, the queue would stall. Then the user merges the revert by hand (the same exception CLAUDE.md gives for a broken `.mergify.yml`).
- PR C's own run makes this unlikely, because it exercises the new workflow before merge.

## Open questions
1. C1: keep Python with the `server_bind` override, or switch to a Node server? Decide after the diagnostic commit's `getfqdn` timing.
2. C3: should push runs on main also skip `check`/`node-22` (whole run about 20 s)? The cost would be the README badge only reflecting the stub. The plan keeps them.
3. C4: are `apps/site/**` PRs safe to skip installs on? I checked that the bundle and installers don't come from the site, but the user may prefer docs-only.
4. C4: confirm in Mergify docs that `check-success` does not accept a `skipped` conclusion. The plan doesn't rely on it, but if it did, step-level gating of `check` could become job-level.
5. Ship C1-C4 as one PR, or split into C1+C2 (low risk) and C3+C4 (needs the throwaway-PR test)?
