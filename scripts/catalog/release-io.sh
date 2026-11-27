# shellcheck shell=bash
# Release-asset helpers for the data workflows. Source it: . scripts/catalog/release-io.sh
# Needs GH_TOKEN and DATA_REPO.
#
# GitHub's release API answers 5xx now and then (4 Nov: HTTP 502 saving a feed group's state, and
# HTTP 500 publishing). So:
#   retry CMD...                 run CMD up to RETRIES times, RETRY_SECONDS apart
#   swap_upload TAG FILE...      replace assets without a gap: upload each as NAME.next, then delete
#                                the old NAME and rename NAME.next to NAME. `gh release upload --clobber`
#                                deletes before it uploads, so a failed upload left a manifest (or saved
#                                state) missing until the next run; now it's missing for one API call at most.
#   push_with_retry [CHECK...]   git push from the current directory, rebasing onto what another workflow
#                                pushed meanwhile (needs no GH_TOKEN or DATA_REPO); see below.

RETRIES="${RETRIES:-5}"
RETRY_SECONDS="${RETRY_SECONDS:-20}"

retry() {
  local i
  for ((i = 1; i <= RETRIES; i++)); do
    "$@" && return 0
    if [ "$i" -lt "$RETRIES" ]; then
      echo "Failed (try $i of $RETRIES): ${*:1:3}; trying again in $RETRY_SECONDS s." >&2
      sleep "$RETRY_SECONDS"
    fi
  done
  echo "Gave up after $RETRIES tries: $*" >&2
  return 1
}

# The API URL of TAG's asset NAME, or nothing when there's none.
asset_url() {
  gh release view "$1" -R "$DATA_REPO" --json assets -q ".assets[] | select(.name == \"$2\") | .apiUrl"
}

# Delete an asset by API URL. Already gone (a retry after a delete that went through) counts as done.
delete_asset() {
  local out
  out=$(gh api -X DELETE "$1" 2>&1) || grep -q "HTTP 404" <<< "$out" || { echo "$out" >&2; return 1; }
}

swap_upload() {
  local tag="$1" tmp f name url old
  shift
  tmp=$(mktemp -d)
  # Every new file first, so a manifest and its signature change as close to together as they can.
  for f in "$@"; do
    name=$(basename "$f")
    cp "$f" "$tmp/$name.next"
    retry gh release upload "$tag" "$tmp/$name.next" -R "$DATA_REPO" --clobber || return 1
  done
  for f in "$@"; do
    name=$(basename "$f")
    url=$(retry asset_url "$tag" "$name.next") || return 1
    [ -n "$url" ] || { echo "Uploaded $name.next but can't find it on $tag." >&2; return 1; }
    old=$(retry asset_url "$tag" "$name") || return 1
    if [ -n "$old" ]; then retry delete_asset "$old" || return 1; fi
    retry gh api -X PATCH "$url" -f name="$name" --silent || return 1
  done
  rm -rf "$tmp"
}

# The directory repo has more than one writer (the move approval workflow pushes moves.json in its
# own concurrency group), so a plain `git push` can be refused as non-fast-forward. Rebase onto the
# remote and push, 3 tries, 5 and 10 s apart. Any arguments are a check run after each rebase (the
# merged result must still be valid): when it fails, nothing is pushed.
push_with_retry() {
  local try
  for try in 1 2 3; do
    if git pull --rebase --quiet; then
      if [ "$#" -gt 0 ]; then "$@" || return 1; fi
      git push && return 0
    else
      # A conflicting rebase stops halfway; undo it so the next try starts clean.
      git rebase --abort 2> /dev/null || true
    fi
    if [ "$try" -lt 3 ]; then
      echo "Push failed (try $try of 3); trying again in $((try * 5)) s." >&2
      sleep $((try * 5))
    fi
  done
  echo "Gave up pushing after 3 tries." >&2
  return 1
}
