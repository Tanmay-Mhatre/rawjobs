# Auto-queue Dependabot's weekly minor/patch PRs

## Problem

Dependabot PRs only join the merge queue when someone adds the `queue` label. Nobody does, so they
sit there. #199 and #200 (2026-10-14) were green, conflict-free and still unmerged.

## What Dependabot sends (from `.github/dependabot.yml` and PR history)

| Kind | Branch | Examples | Safe to auto-merge? |
| --- | --- | --- | --- |
| npm dev deps, minor/patch, grouped | `dependabot/npm_and_yarn/dev-dependencies-<hash>` | #84, #90, #199 | Yes |
| npm prod deps, minor/patch, grouped | `dependabot/npm_and_yarn/dependencies-<hash>` | #85, #200 | Yes |
| npm majors, one PR each | `dependabot/npm_and_yarn/<name>-<version>` | #86, #91, #92 (all closed by hand) | No, they need a person |
| GitHub Actions, grouped, **any update type, majors included** | `dependabot/github_actions/actions-<hash>` | #83 | No (see below) |

The groups only take minor and patch updates (`update-types: [minor, patch]`), so a grouped npm
branch can never contain a major. Majors always get their own branch name, which the rule below
won't match.

## Change: one new rule in `.mergify.yml`

```yaml
  - name: Queue Dependabot's grouped minor and patch updates
    conditions:
      - author = dependabot[bot]
      - head ~= ^dependabot/npm_and_yarn/(dev-)?dependencies-
    actions:
      queue:
        name: default
```

- It uses the existing `default` queue rule, so the PR still waits for the same five required
  checks, goes through the queue one at a time, and leaves the queue on a conflict or a failed check.
- Two conditions, so a person's branch named like Dependabot's can't sneak in.
- It matches on the branch name instead of Mergify's `dependabot-update-type` attribute because a
  grouped PR holds several updates, and the branch name is something this repo controls.

### Leave GitHub Actions out (recommended)

The `actions` group has no `update-types`, so majors land there too. Some workflows don't run on
PRs, like `release.yml` and the scheduled data jobs, so CI can't catch an action upgrade that
breaks them. Queue those by hand, or add `update-types: [minor, patch]` to the group first and then
widen the regex.

## Not covered

- Majors and Dependabot security PRs that aren't in a group stay manual.
- CLAUDE.md still says sessions never touch Dependabot PRs. Mergify queues them itself, so no change
  is needed there.

## Rollout (`.mergify.yml` rules from CLAUDE.md)

1. One small PR: the rule above plus a comment line in `.mergify.yml`'s header ("Dependabot's grouped
   minor/patch PRs queue themselves").
2. Add the `queue` label only after Mergify's "Configuration changed" check passes on the PR.
3. After it merges, #199 and #200 should queue themselves: Mergify re-checks open PRs when the
   config changes. If they don't, tick the box in Mergify's comment on each.
4. Release note: `none` (CI/config only).
