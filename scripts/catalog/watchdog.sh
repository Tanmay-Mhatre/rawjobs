#!/usr/bin/env bash
# Safety nets for GitHub's schedules, which run "best effort": late, and some never (on 12 Oct 2026 the
# 3-hourly contributions run fired 3 times of 8 and the Monday rebuild not at all). Every scheduled
# directory workflow ends with these, so whichever run does fire checks on the rest.
#
#   bash scripts/catalog/watchdog.sh latest      when the newest weekly rebuild published (empty: none found)
#   bash scripts/catalog/watchdog.sh rebuild     start the weekly rebuild if it's overdue
#   bash scripts/catalog/watchdog.sh keepalive   re-enable the scheduled workflows (the 60-day inactivity switch-off)
#   bash scripts/catalog/watchdog.sh overdue PUBLISHED_AT   exit 0 if a rebuild last published then is overdue
#                                                (WATCHDOG_NOW=<epoch> to test)
#
# Needs GH_TOKEN (this repo: actions: write, issues: read), DATA_REPO and GITHUB_REPOSITORY.
set -euo pipefail

REBUILD=directory-rebuild.yml
# What a failed rebuild opens (directory-rebuild.yml, "Report a run that didn't publish").
FAILED_TITLE="Directory rebuild did not publish"

# The weekly rebuild's releases are directory-YYYY-MM-DD (-HHMM for a second one that day);
# contributions' end in -shared. Every page: a busy week of -shared releases can't hide the last rebuild.
latest() {
  gh api --paginate "repos/$DATA_REPO/releases?per_page=100" \
    -q '.[] | select((.draft | not) and (.tag_name | startswith("directory-")) and (.tag_name | endswith("-shared") | not)) | .published_at' |
    sort | tail -n 1
}

# Overdue: nothing for 8 days (the stale alert's limit), or it's Monday afternoon or Tuesday and this
# week's rebuild hasn't published. The 5-day floor matches the rebuild's own gate, so a rebuild run
# by hand mid-week doesn't trigger another one days later and shift the weekly rhythm.
overdue() {
  local last="$1" now age dow monday
  [ -n "$last" ] || return 0
  now=${WATCHDOG_NOW:-$(date -u +%s)}
  age=$((now - $(date -u -d "$last" +%s)))
  [ "$age" -lt $((8 * 86400)) ] || return 0
  dow=$(date -u -d "@$now" +%u)
  monday=$(date -u -d "$(date -u -d "@$now" +%F) -$((dow - 1)) days" +%s)
  [ "$dow" -le 2 ] && [ "$now" -ge $((monday + 12 * 3600)) ] && [ "$((now - age))" -lt "$monday" ] && [ "$age" -ge $((5 * 86400)) ]
}

rebuild() {
  local last runs recent
  last=$(latest)
  if ! overdue "$last"; then
    echo "Weekly rebuild last published ${last}; not overdue."
    return 0
  fi
  runs=$(gh run list -R "$GITHUB_REPOSITORY" --workflow "$REBUILD" --limit 20 --json status,conclusion,createdAt)
  # Queued, waiting on the directory group, or running: it's on its way.
  if [ "$(jq '[.[] | select(.status != "completed")] | length' <<< "$runs")" != 0 ]; then
    echo "Weekly rebuild overdue (last: ${last:-none}), but one is already queued or running."
    return 0
  fi
  # At most one try a day: a rebuild that runs but can't publish (say the release gate refuses it)
  # would otherwise start again on every check and hold the directory group for hours each time.
  # A run that never got going (cancelled, or failed to start) isn't a try; a failed one is.
  recent=$(jq -r '[.[] | select(.conclusion != "cancelled" and .conclusion != "startup_failure") | .createdAt] | max // ""' <<< "$runs")
  if [ -n "$recent" ] && [ $(($(date -u +%s) - $(date -u -d "$recent" +%s))) -lt 86400 ]; then
    echo "Weekly rebuild overdue (last: ${last:-none}), but one started in the last 24 hours ($recent)."
    return 0
  fi
  # A rebuild that ended without a release needs a person; don't keep retrying until it's closed.
  if [ -n "$(gh issue list -R "$GITHUB_REPOSITORY" --state open --search "\"$FAILED_TITLE\" in:title" --json number -q '.[0].number')" ]; then
    echo "::warning::Weekly rebuild overdue (last: ${last:-none}); not starting it while the \"$FAILED_TITLE\" issue is open."
    return 0
  fi
  # No inputs: never a shrink past the release gate, never a smoke run.
  gh workflow run "$REBUILD" -R "$GITHUB_REPOSITORY" --ref main
  echo "::notice::Weekly rebuild overdue (last: ${last:-none}); started it."
}

# Re-enabling through the API resets the 60-day switch-off with no commit (not documented as such;
# cheap insurance, since commits reset it too). A workflow turned off by hand stays off.
# The list is every workflow file with a schedule trigger, read from the checkout so it can't go
# stale (a fixed list still named weekly-release.yml after it was deleted). Best effort: insurance
# only, so a failure is a warning and never turns a finished run red.
keepalive() {
  local f wf state
  for f in .github/workflows/*.yml .github/workflows/*.yaml; do
    [ -f "$f" ] && grep -qE '^[[:space:]]+schedule:' "$f" || continue
    wf=$(basename "$f")
    # On an HTTP error gh prints the error JSON to stdout, so set the state rather than keep it.
    state=$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/$wf" -q .state 2> /dev/null) || state=unknown
    case "$state" in
      active | disabled_inactivity)
        if gh api -X PUT "repos/$GITHUB_REPOSITORY/actions/workflows/$wf/enable" > /dev/null; then
          echo "$wf: enabled (was $state)"
        else
          echo "::warning::keepalive: couldn't re-enable $wf (was $state)"
        fi
        ;;
      unknown) echo "::warning::keepalive: couldn't read $wf's state; skipped" ;;
      *) echo "$wf: left $state" ;;
    esac
  done
  return 0
}

case "${1:-}" in
  latest) latest ;;
  rebuild) rebuild ;;
  keepalive) keepalive ;;
  overdue) overdue "${2:-}" ;;
  *) echo "Usage: watchdog.sh latest|rebuild|keepalive|overdue PUBLISHED_AT" >&2 && exit 2 ;;
esac
