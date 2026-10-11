#!/usr/bin/env bash
# Working state the catalog workflows carry from one run to the next, kept as assets of the "state"
# release of $DATA_REPO. Two sets, one asset each, so their workflows never overwrite each other:
#   catalog  the directory runs (weekly rebuild, contributions), which take turns (one concurrency group)
#   jobs     the daily job feed: yesterday's shards and ETags
#
#   state.sh restore [catalog|jobs]   download and unpack; fails if it exists but can't be downloaded.
#                                     Sets the step output restored=true|false.
#   state.sh save [catalog|jobs]      pack and upload; every run of a set saves the same files
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
      out/resolved.json
      out/resolved-bulk.json
      out/probe.jsonl
      out/probe-found.json
      raw/commoncrawl/boards.json
      raw/wayback/boards.json
      # Last week's copies of the permissively licensed public lists (sources.ts only replaces a file
      # it downloaded), so one failed download doesn't shrink the directory. The lists we may only
      # use to confirm boards (feashliaa, upstreamit) are never republished, so they aren't kept.
      raw/latmay/*.csv
      raw/kalil0321/*.csv
      raw/conorscode/*.json
      raw/lastround/*.csv
    )
    ;;
  jobs)
    FILES=(out/jobs/etags.json out/jobs/jobs-manifest.json out/jobs/jobs-v2-manifest.json out/jobs/stats.json)
    # Yesterday's shards and full copy: today's change file is made against them.
    for f in out/jobs/jobs-*.json.gz out/jobs/jobs-v2-snapshot-*.json.br; do FILES+=("$f"); done
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
