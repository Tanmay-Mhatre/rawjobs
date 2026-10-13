#!/usr/bin/env bash
# Download the shared job feed's current shards (the "jobs" release, built daily by jobs-daily.yml)
# into scripts/catalog/out/feed, so publish.ts can tag industries from the job titles of companies the
# job index doesn't read (Workday, and boards it didn't reach this run). Already fetched for everyone:
# no board is asked again. Best effort: without the feed, those companies just keep fewer tags.
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
if ! gh release download jobs -R "$DATA_REPO" -p jobs-manifest.json -D "$dir" --clobber; then
  warn "Couldn't download the job feed's manifest: industry tags from job titles cover only the job index this time."
  exit 0
fi
for f in $(jq -r '.shards[]?.file' "$dir/jobs-manifest.json"); do
  # Names come from the manifest: only plain shard file names.
  if ! [[ "$f" =~ ^jobs-[a-z0-9-]+-[0-9A-Za-z]+\.json\.gz$ ]]; then
    warn "Skipped an unexpected job feed file name: $f"
    continue
  fi
  gh release download jobs -R "$DATA_REPO" -p "$f" -D "$dir" --clobber || warn "Couldn't download $f: its companies keep fewer industry tags this time."
done
echo "Job feed: $(ls "$dir" | grep -c '\.json\.gz$') shards in $dir"
