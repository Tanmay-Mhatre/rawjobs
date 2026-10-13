#!/usr/bin/env bash
# The release gate, as both directory workflows run it before uploading: fetch the live release's
# manifest (and its directory's `moves`) as the baseline, then let guard.ts compare the candidate in
# dist/ and dist-data/. Only "release not found" (nothing published yet) means no baseline; any
# other error stops the upload, so a network blip can never skip the gate.
#
#   GH_TOKEN=… DATA_REPO=owner/repo [ALLOW_SHRINK=1] bash scripts/catalog/gate.sh
set -euo pipefail
prev="$RUNNER_TEMP/live-manifest.json"
prev_moves="$RUNNER_TEMP/live-moves.json"
if ! out=$(gh release download -R "$DATA_REPO" -p manifest.json -O "$prev" --clobber 2>&1); then
  if echo "$out" | grep -qi "release not found"; then
    echo "No live release yet: only the floors and integrity rules apply."
    : > "$prev"
  else
    echo "$out" >&2
    echo "::error::Couldn't fetch the live release's manifest, so the gate can't run."
    exit 1
  fi
fi
# The live moves, to count how many this release adds (directory.json has `moves` since the move review).
: > "$prev_moves"
if [ -s "$prev" ]; then
  gh release download -R "$DATA_REPO" -p directory.json.gz -O "$RUNNER_TEMP/live-directory.json.gz" --clobber
  gunzip -c "$RUNNER_TEMP/live-directory.json.gz" | jq -c '[(.moves // [])[] | "\(.from)>\(.to)"]' > "$prev_moves"
fi
pnpm exec tsx scripts/catalog/guard.ts --prev "$prev" --prev-moves "$prev_moves" --dist dist --data dist-data
