#!/usr/bin/env bash
# Working state the catalog workflows carry from one run to the next, kept as assets of the "state"
# release of $DATA_REPO. Two sets, one asset each, so their workflows never overwrite each other:
#   catalog  the directory runs (weekly rebuild, contributions), which take turns (one concurrency group)
#   jobs     the job feed's merge job: what it last published (the next change files are made against
#            it), and the hiring activity recorded so far
#   jobs-<group>  each feed group's last shards and ETags (sr, payroll, enterprise, rest; jobs.ts GROUPS)
#
#   state.sh restore [catalog|jobs|jobs-<group>]   download and unpack; fails if it exists but can't be
#                                     downloaded. Sets the step output restored=true|false.
#   state.sh save [catalog|jobs|jobs-<group>]      pack and upload; every run of a set saves the same files
#
# Needs GH_TOKEN and DATA_REPO. Run from the repo root.
set -euo pipefail

output() { if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1" >> "$GITHUB_OUTPUT"; fi; }

cd scripts/catalog
SET="${2:-catalog}"
ASSET="$SET-state.tar.gz"
TARBALL="${RUNNER_TEMP:-/tmp}/$ASSET"

# Every file any run of the set keeps. Missing ones are skipped.
case "$SET" in
  catalog)
    FILES=(
      out/checks.jsonl
      out/index-all.jsonl
      # Job titles checks read on the way, and the Wikidata companies with their industries: publish
      # tags industries from both, also in runs that don't fetch them again.
      out/titles.jsonl
      raw/wikidata/companies.json
      out/resolved.json
      out/resolved-bulk.json
      out/probe.jsonl
      out/probe-found.json
      raw/commoncrawl/boards.json
      raw/wayback/boards.json
      # Boards the job boards' jobs linked to, and when each feed was last read (feed-boards.ts).
      raw/feeds/boards.json
      # Last week's copies of the permissively licensed public lists (sources.ts only replaces a file
      # it downloaded), so one failed download doesn't shrink the directory. The lists we may only
      # use to confirm boards (feashliaa, upstreamit) are never republished, so they aren't kept.
      raw/latmay/*.csv
      raw/kalil0321/*.csv
      raw/openingsmcp/*.yaml
      raw/freehire/*.yml
      raw/conorscode/*.json
      raw/lastround/*.csv
      # Visa sponsor registers, as normalised names (visa.ts): a failed download keeps last week's.
      raw/visa/*.json
    )
    ;;
  jobs)
    # The feed's merge job: what it last published. The next run's change files are made against it.
    # activity-state.json: each company's new roles by day and month (activity.ts); losing it restarts the records.
    FILES=(out/jobs/jobs-manifest.json out/jobs/jobs-v2-manifest.json out/jobs/jobs-v3-manifest.json out/jobs/stats.json out/jobs/activity-state.json)
    for f in out/jobs/jobs-*.json.gz out/jobs/jobs-v2-snapshot-*.json.br out/jobs/jobs-v3-snapshot-*.txt.br; do FILES+=("$f"); done
    ;;
  jobs-sr | jobs-payroll | jobs-enterprise | jobs-rest)
    # One feed group (jobs.ts GROUPS): its last shards and ETags. Saved only by that group's job, so a
    # failed group leaves its previous copy for the merge job to fall back on.
    g="out/jobs/groups/${SET#jobs-}"
    FILES=("$g/group.json" "$g/etags.json")
    for f in "$g"/jobs-*.json.gz; do FILES+=("$f"); done
    ;;
  *)
    echo "unknown state set: $SET" >&2
    exit 2
    ;;
esac

case "${1:-}" in
  restore)
    # Only a missing release or asset means "no state"; any other error stops the run.
    if ! assets=$(gh release view state -R "$DATA_REPO" --json assets -q '.assets[].name' 2>&1); then
      grep -qi "not found" <<< "$assets" || { echo "Couldn't read the saved state: $assets" >&2; exit 1; }
      assets=""
    fi
    if ! grep -qx "$ASSET" <<< "$assets"; then
      echo "No saved state yet: this run starts from scratch (slow, once)."
      output restored=false
      exit 0
    fi
    # The state exists: failing to fetch it must stop the run, or its save would overwrite good state.
    gh release download state -R "$DATA_REPO" -p "$ASSET" -D "$(dirname "$TARBALL")" --clobber
    tar xzf "$TARBALL"
    echo "Restored the saved state."
    output restored=true
    ;;
  save)
    [ -d out ] || { echo "Nothing to save."; exit 0; }
    if [ "$SET" = catalog ]; then (cd ../.. && pnpm exec tsx scripts/catalog/compact.ts); fi
    present=()
    for f in "${FILES[@]}"; do if [ -f "$f" ]; then present+=("$f"); fi; done
    [ ${#present[@]} -gt 0 ] || { echo "Nothing to save."; exit 0; }
    tar czf "$TARBALL" "${present[@]}"
    gh release view state -R "$DATA_REPO" > /dev/null 2>&1 ||
      gh release create state -R "$DATA_REPO" --prerelease --title "Catalog working state" --notes "Internal: lets the catalog runs skip boards checked recently."
    gh release upload state "$TARBALL" -R "$DATA_REPO" --clobber
    echo "Saved: ${present[*]}"
    ;;
  *)
    echo "usage: state.sh restore|save" >&2
    exit 2
    ;;
esac
