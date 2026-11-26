#!/usr/bin/env bash
# Fetch the live copy of a published data file from the public data repo, with no token, for the
# signing job's check (check-manifest.mjs). Plain curl: the signing job runs no gh, pnpm or repo code.
#
#   DATA_REPO=owner/repo bash scripts/catalog/live-copy.sh <release tag|latest> <asset> <out file>
#
# Nothing published yet (404) leaves <out file> empty, which check-manifest.mjs reads as "nothing live".
# Any other answer stops the run, so a network blip can never skip the check.
set -euo pipefail
tag="$1" asset="$2" out="$3"
if [ "$tag" = latest ]; then url="https://github.com/$DATA_REPO/releases/latest/download/$asset"; else url="https://github.com/$DATA_REPO/releases/download/$tag/$asset"; fi
code=$(curl -sSL --retry 4 --retry-delay 10 --retry-all-errors -o "$out" -w '%{http_code}' "$url" || true)
case "$code" in
  200) echo "Live $asset ($tag): $(wc -c < "$out") bytes." ;;
  404) : > "$out"; echo "No live $asset ($tag) yet." ;;
  *) echo "::error::Couldn't fetch the live $asset ($tag): HTTP ${code:-none}." >&2; exit 1 ;;
esac
