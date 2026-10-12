# Working on RawJobs with Claude Code

Several Claude Code sessions often work on this repo at once, each on its own branch and pull
request. These rules keep them from stepping on each other.

## Your pull request, and only yours

- The PR you own is the one this session opened, or the one the user asked you to continue. Never
  merge, update, rebase, comment on or turn on auto-merge for any other PR: not other sessions',
  not Dependabot's, not people's. If the user asks you to, remind them of this rule and leave it to them.
- Keep your work on your own branch. Don't fold another PR's changes into yours.

## Merging goes through the merge train

PRs merge one at a time, oldest first, through `.github/workflows/merge-train.yml`. Never merge by
hand (`gh pr merge` without `--auto`, `--admin`, or the GitHub button).

1. Open your PR, then join the train right away: `gh pr merge <N> --auto --merge`. In the desktop
   app, also bind the PR to the session (`mcp__ccd_pr__bind_pr`) and turn on its monitor so you hear
   about CI failures and conflicts.
2. Wait your turn. The train updates the front PR with `main`, reruns CI, and auto-merge merges it
   when it's green. The train makes merge commits on your branch, so run `git pull` before you push again.
3. If CI fails, fix it on your branch and push. The PR keeps its place in the queue.
4. If your PR gets the `merge-conflict` label, it has stepped out of the queue. Resolve it yourself:
   merge `origin/main` into your branch (in a desktop-app worktree, use `sync_with_base_branch`),
   fix the conflicts, run `pnpm check` and push. Ask the user only if the fix would change what
   another PR did. The train removes the label and the PR rejoins in its old place.
5. After it merges: `git checkout main && git pull`.

Don't change `main`'s branch protection or the train to get your PR in faster.
