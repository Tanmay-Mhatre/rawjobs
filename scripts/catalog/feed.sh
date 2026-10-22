#!/usr/bin/env bash
# Download the shared job feed (the "jobs" release, built daily by jobs-daily.yml) into
# scripts/catalog/out/feed, so index.ts can take its rows from it instead of reading those boards again,
# and publish.ts can tag industries from the job titles of companies the job index doesn't read (Workday,
# and boards it didn't reach this run). Best effort: without the feed, the index reads every board live
# and those companies just keep fewer tags. Writes format=v2|v1 to $GITHUB_OUTPUT on Actions.
#
# Reads the second format's full copy (jobs-v2-manifest.json and the snapshot it names, ~20 MB). Only
# when that can't be downloaded, the first format's shards (jobs-manifest.json), while they're published.
#
# The manifests' .sig files aren't checked here: apps check them because they download from a public
# release over the internet, while this runs in our own workflow, downloads with the workflow's token
# from our own release, and only reads job titles from it (nothing is run, and file names from a
# manifest are checked below before anything is downloaded by them).
#
#   GH_TOKEN=… DATA_REPO=owner/repo bash scripts/catalog/feed.sh
set -uo pipefail
dir=scripts/catalog/out/feed
rm -rf "$dir"
mkdir -p "$dir"
warn() {
  echo "$1" >&2
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::warning title=Job feed::$1"; fi
}
get() { gh release download jobs -R "$DATA_REPO" -p "$1" -D "$dir" --clobber; }

# The second format: one full copy.
v2() {
  get jobs-v2-manifest.json || { warn "Couldn't download the job feed's jobs-v2-manifest.json."; return 1; }
  local f
  f=$(jq -r '.snapshot.file // empty' "$dir/jobs-v2-manifest.json") || f=
  # The name comes from the manifest: only a plain snapshot file name.
  if ! [[ "$f" =~ ^jobs-v2-snapshot-[0-9]+\.json\.br$ ]]; then
    warn "Skipped an unexpected job feed snapshot name: '$f'"
    return 1
  fi
  get "$f" || { warn "Couldn't download the job feed's full copy $f."; return 1; }
  echo "Job feed: full copy $f ($(wc -c <"$dir/$f") bytes) in $dir"
}

# The first format: a shard per hiring system.
v1() {
  if ! get jobs-manifest.json; then
    warn "Couldn't download the job feed's manifest: industry tags from job titles cover only the job index this time."
    return 0
  fi
  for f in $(jq -r '.shards[]?.file' "$dir/jobs-manifest.json"); do
    # Names come from the manifest: only plain shard file names.
    if ! [[ "$f" =~ ^jobs-[a-z0-9-]+-[0-9A-Za-z]+\.json\.gz$ ]]; then
      warn "Skipped an unexpected job feed file name: $f"
      continue
    fi
    get "$f" || warn "Couldn't download $f: its companies keep fewer industry tags this time."
  done
  echo "Job feed: $(ls "$dir" | grep -c '\.json\.gz$') shards in $dir"
}

# Which format landed, for the workflow: the job index takes rows from the feed only with the second.
format=v2
if ! v2; then
  # Don't let a half-downloaded second format be read instead of the first.
  rm -f "$dir"/jobs-v2-*
  warn "Reading the job feed's first format instead."
  v1
  format=v1
fi
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "format=$format" >> "$GITHUB_OUTPUT"; fi
exit 0
