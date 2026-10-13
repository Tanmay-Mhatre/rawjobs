# Working on RawJobs with Claude Code

Several Claude Code sessions often work on this repo at once, each on its own branch and pull
request. These rules keep them from stepping on each other.

## Your pull request, and only yours

- The PR you own is the one this session opened, or the one the user asked you to continue. Never
  merge, update, rebase, label, comment on or queue any other PR: not other sessions', not
  Dependabot's, not people's. If the user asks you to, remind them of this rule and leave it to them.
- Keep your work on your own branch. Don't fold another PR's changes into yours.
- Work in your own worktree. Other sessions switch branches in the main checkout.

## Merging goes through the merge queue

PRs merge one at a time, in the order they joined, through Mergify (`.mergify.yml`). Never merge
any other way: no `gh pr merge` (with or without `--auto`), no `--admin`, no GitHub button, and
no GitHub auto-merge (`mcp__ccd_pr__set_auto_merge`). Those skip the queue.

1. Open your PR, then queue it: `gh pr edit <N> --add-label queue`. In the desktop app, bind the PR
   to the session (`mcp__ccd_pr__bind_pr`) and turn on Auto-fix (`mcp__ccd_pr__set_monitor` with
   `auto_fix: true`). The app then wakes the session when CI fails, the PR conflicts with `main`
   or someone comments.
2. Wait your turn. When your PR is at the front, Mergify merges `main` into it, waits for CI and
   merges it. Mergify pushes to your branch, so run `git pull` before you push again.
3. If your PR leaves the queue (Mergify comments on why: a conflict or failing CI), fix it
   yourself. For a conflict, merge `origin/main` into your branch (in a desktop-app worktree, use
   `sync_with_base_branch`) and resolve it. Run `pnpm check`, push, then remove and add the `queue`
   label to rejoin. Ask the user only if the fix would undo what another PR did.
4. After it merges: `git checkout main && git pull`.

Don't change `main`'s branch protection or `.mergify.yml` to get your PR in faster.

## UI and UX changes: show the user a screenshot

After any change the user can see (layout, copy, styling, a new state or interaction), once the
checks pass, run the app and take a screenshot of the changed screen in the state that shows the
change, and send it to the user so they can check it. Use a scratch copy of the data
(`RAWJOBS_HOME`), never their real config. Send one screenshot per changed screen or state, and say
in a line what each one shows. When phones or dark mode are affected, include those too.

## Releasing: remind the user to tag

Merging releases nothing: a release happens only when the user pushes a version tag
(`.github/workflows/release.yml`). So after any PR merges into `main` (yours, or one you watched
merge), end your message with a reminder that it isn't released yet, with the commands to release
it: the next version (the latest `vX.Y.Z` tag with the patch + 1) and a tag message drafted from the
merged PRs' "Release note" lines (`pnpm release:notes` prints it). For example:

```bash
git tag -a v0.6.1 -m "RawJobs 0.6.1" -m "New: …" -m "Fixed: …"
git push origin v0.6.1
```

Write a "Release note" section in every PR you open (`New:` / `Improved:` / `Fixed:` lines, or
`none`): it becomes the app's "What's new". Never push a tag yourself unless the user asks.

### Pull requests that change `.mergify.yml`

Mergify always uses the config on `main`, so these go through the queue like any other PR. The
queue doesn't test the new config, though, and a broken one on `main` stops the queue for everyone.
So add the `queue` label only after Mergify's "Configuration changed" check on the PR says the new
config is valid. If Mergify refuses the PR or the queue breaks after a config change, ask the user
to merge the fix by hand.
