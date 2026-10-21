#!/usr/bin/env bash
# Run one collector of the weekly rebuild under a hard time cap, so a slow source can never eat the
# time build and publish need (on 10 Oct 2026 Common Crawl alone took 4h17m and nothing shipped).
# The script's own --max-minutes should stop it well before this; the cap is the backstop.
# coreutils timeout signals the whole process group (pnpm, tsx, node), with KILL 60 s after TERM.
#
#   bash scripts/catalog/capped.sh "Common Crawl" 70 pnpm exec tsx scripts/catalog/commoncrawl.ts --max-minutes 60
set -uo pipefail
label=$1
minutes=$2
shift 2
timeout -k 60 "${minutes}m" "$@"
rc=$?
if [ "$rc" -ne 0 ]; then
  if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then why="hit its ${minutes}-minute hard cap"; else why="failed (exit $rc)"; fi
  echo "::warning title=${label}::${label} ${why}; the rebuild continues with what it has."
  # Also in the run summary, so a run's caps can be read next to its numbers.
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "- ${label} ${why}." >> "$GITHUB_STEP_SUMMARY"; fi
fi
exit "$rc"
