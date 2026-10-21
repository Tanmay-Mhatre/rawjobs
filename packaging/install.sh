#!/bin/sh
# RawJobs installer for macOS and Linux. In Terminal:
#
#   curl -fsSL https://github.com/Tanmay-Mhatre/rawjobs/releases/latest/download/install.sh | sh
#
# What it does, without admin rights:
#   1. Downloads the latest RawJobs and the Node it runs on (from nodejs.org) into your user folder
#      (macOS: ~/Library/Application Support/RawJobs, Linux: ~/.local/share/rawjobs), and checks
#      both against the release's signed checksums.
#   2. Starts RawJobs now and every time you log in, in the background, and restarts it if it stops.
#   3. Adds a RawJobs app (macOS: ~/Applications; Linux: your app menu) and a shortcut on the
#      Desktop, and opens the dashboard: http://127.0.0.1:4317
# Running it again updates or repairs RawJobs. Your profile, tracking and scan data are never touched
# (and are backed up first, to backups/); a scan that's running gets time to finish.
# Uninstall: "<that folder>/bin/rawjobs" uninstall
#
# Settings (environment variables, all optional):
#   RAWJOBS_HOME          install somewhere else
#   RAWJOBS_RELEASE_URL   download from somewhere else (a folder with latest.json and the bundle)
#   RAWJOBS_NO_OPEN=1     don't open the browser at the end
set -eu

# The release signing key's public half (packages/core/src/release.ts has the same).
PUBLIC_KEY='MCowBQYDK2VwAyEAJFEm6OjkG2omc8RkYCVBBvcuGeIjl6MVvRy4eFX8Jtc='
# Tests sign their own releases with a throwaway key.
if [ -n "${RAWJOBS_PUBLIC_KEY:-}" ]; then PUBLIC_KEY="$RAWJOBS_PUBLIC_KEY"; fi
RELEASE="${RAWJOBS_RELEASE_URL:-https://github.com/Tanmay-Mhatre/rawjobs/releases/latest/download}"
RELEASE="${RELEASE%/}"
LABEL='com.rawjobs.server'
UNIT='rawjobs.service'

# How it looks: RawJobs' wordmark and live steps in a terminal that can show them, plain lines
# everywhere else (a log, a pipe, NO_COLOR, TERM=dumb, a locale without UTF-8).
FANCY=""
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != dumb ]; then
  case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in *[Uu][Tt][Ff]-8* | *[Uu][Tt][Ff]8*) FANCY=yes ;; esac
fi
STEP=""
FRAME=0
COLS=80
C_SIG="" C_OK="" C_WARN="" C_BAD="" C_DIM="" C_BOLD="" C_LINK="" C_OFF=""
if [ -n "$FANCY" ]; then
  COLS="$(tput cols 2>/dev/null || echo 80)"
  E="$(printf '\033')"
  # brand-signal (#ff5a1f) for the logo's cursor and live progress only, or the nearest of 256
  # colours. Text keeps the terminal's own colours, so it reads on light and dark themes alike.
  case "${COLORTERM:-}" in truecolor | 24bit) C_SIG="$E[38;2;255;90;31m" ;; *) C_SIG="$E[38;5;202m" ;; esac
  C_OK="$E[32m" C_WARN="$E[33m" C_BAD="$E[31m" C_DIM="$E[90m" C_BOLD="$E[1m" C_LINK="$E[4m" C_OFF="$E[0m"
fi

say() { printf '  %s\n' "$1"; }
line() { printf '\r\033[2K%s' "$1"; }
# The step on screen, with the next spinner frame (and how much of the download $1, of $2 bytes, is here).
draw() {
  [ -n "$STEP" ] || return 0
  FRAME=$((FRAME + 1))
  got=""
  if [ -n "${1:-}" ]; then got="$( (wc -c <"$1") 2>/dev/null | tr -d ' ')"; got="${got:-0}"; fi
  line "$(awk -v f="$FRAME" -v step="$STEP" -v got="$got" -v total="${2:-0}" -v sig="$C_SIG" -v dim="$C_DIM" -v off="$C_OFF" 'BEGIN {
    n = split("⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏", s, " ")
    out = "  " sig s[f % n + 1] off " " step
    if (got != "" && total > 0) {
      d = int(20 * got / total); if (d > 20) d = 20
      bar = ""; for (i = 0; i < 20; i++) { if (i == d) bar = bar dim; bar = bar (i < d ? "█" : "░") }
      out = out "  " sig bar off sprintf(" %d%%  ", 100 * got / total) dim sprintf("%.1f / %.1f MB", got / 1048576, total / 1048576) off
    } else if (got != "") out = out "  " dim sprintf("%.1f MB", got / 1048576) off
    printf "%s", out
  }')"
}
# A step starts: a spinner line (a plain line without colours).
step() {
  if [ -z "$FANCY" ]; then say "$1"; return 0; fi
  STEP="$1"
  printf '\033[?25l'
  draw
}
ok() {
  [ -n "$FANCY" ] || return 0
  line "  ${C_OK}✓$C_OFF $1"
  printf '\n'
  draw
}
# The step is finished: its line becomes a ticked one, or goes without $1.
finish() {
  [ -n "$FANCY" ] || return 0
  STEP=""
  if [ -n "${1:-}" ]; then ok "$1"; else line ''; fi
  printf '\033[?25h'
}
warn() {
  if [ -z "$FANCY" ]; then say "($1)"; return 0; fi
  line "  $C_WARN! $1$C_OFF"
  printf '\n'
  draw
}
fail() {
  if [ -n "$STEP" ]; then line "  ${C_BAD}✗ $STEP$C_OFF"; printf '\n'; STEP=""; fi
  printf '\n%sRawJobs couldn'\''t be installed: %s%s\n' "$C_BAD" "$1" "$C_OFF" >&2
  exit 1
}
banner() {
  printf '\n'
  if [ -z "$FANCY" ]; then printf 'Installing RawJobs\n'; return 0; fi
  if [ "$COLS" -ge 60 ] 2>/dev/null; then
    # The wordmark: lowercase rawjobs in the terminal's own colour, then the signal cursor.
    c="$C_SIG███$C_OFF"
    printf '  %s%s%s\n' "$C_BOLD" '                         ▀▀        ██' "$C_OFF"
    printf '  %s%s%s %s\n' "$C_BOLD" '██▄█▀ ▄████▄ ██    ██    ██ ▄████▄ ██▄██▄ ▄█▀▀▀▀' "$C_OFF" "$c"
    printf '  %s%s%s %s\n' "$C_BOLD" '██▀   ▄▄▄▄██ ██ ██ ██    ██ ██  ██ ██  ██ ▀████▄' "$C_OFF" "$c"
    printf '  %s%s%s %s\n' "$C_BOLD" '██    ██  ██ ██ ██ ██    ██ ██  ██ ██  ██     ██' "$C_OFF" "$c"
    printf '  %s%s%s %s\n' "$C_BOLD" '██    ▀███▀█ ▀██▀▀██▀    ██ ▀████▀ ██▄▄█▀ ▀████▀' "$C_OFF" "$c"
    printf '  %s%s%s\n' "$C_BOLD" '                      ▀███▀' "$C_OFF"
  else
    printf '  %srawjobs%s%s█%s\n' "$C_BOLD" "$C_OFF" "$C_SIG" "$C_OFF"
  fi
  printf '  Jobs, straight from the source.\n'
}
# The last words, in a box when it fits: $1 the headline, $2 the link, then the notes.
box() {
  head="$1" link="$2"
  shift 2
  bw=0
  for bl in "$head" "$link" "$@"; do
    bn="$(printf '%s' "$bl" | wc -m | tr -d ' ')"
    [ "$bn" -le "$bw" ] || bw="$bn"
  done
  if [ $((bw + 10)) -gt "$COLS" ]; then
    printf '  %s●%s %s%s%s\n    %s%s%s\n\n' "$C_OK" "$C_OFF" "$C_BOLD" "$head" "$C_OFF" "$C_LINK" "$link" "$C_OFF"
    for bl; do say "  $bl"; done
    return 0
  fi
  rule="$(printf "%$((bw + 6))s" '' | sed 's/ /─/g')"
  printf '  %s╭%s╮%s\n' "$C_DIM" "$rule" "$C_OFF"
  box_row "$C_OK●$C_OFF" "$C_BOLD" "$head"
  box_row ' ' "$C_LINK" "$link"
  box_row ' ' '' ''
  for bl; do box_row ' ' '' "$bl"; done
  printf '  %s╰%s╯%s\n' "$C_DIM" "$rule" "$C_OFF"
}
box_row() {
  bn="$(printf '%s' "$3" | wc -m | tr -d ' ')"
  printf '  %s│%s  %s %s%s%s%s  %s│%s\n' "$C_DIM" "$C_OFF" "$1" "$2" "$3" "$C_OFF" "$(printf "%$((bw - bn))s" '')" "$C_DIM" "$C_OFF"
}
download() {
  if [ -n "$STEP" ] && command -v curl >/dev/null 2>&1; then
    # In the background, to show how much is here; the size comes from the headers, when they say.
    total="$(curl -fsIL --max-time 10 "$1" 2>/dev/null | tr -d '\r' | awk 'tolower($1) == "content-length:" { n = $2 } END { print n + 0 }')"
    curl -fsSL --retry 2 -o "$2" "$1" </dev/null &
    pid=$!
    while kill -0 "$pid" 2>/dev/null; do draw "$2" "$total"; sleep 0.1; done
    wait "$pid" || fail "couldn't download $1"
    return 0
  fi
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 2 -o "$2" "$1" || fail "couldn't download $1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1" || fail "couldn't download $1"
  else
    fail "this computer has neither curl nor wget."
  fi
}
sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d ' ' -f 1; else sha256sum "$1" | cut -d ' ' -f 1; fi
}
fetch_text() {
  if command -v curl >/dev/null 2>&1; then curl -fs --max-time 2 "$1" 2>/dev/null; else wget -q -T 2 -O - "$1" 2>/dev/null; fi
}
# One value from latest.json, which has one key per line.
field() { sed -n "s/^ *\"$1\": \"\\([^\"]*\\)\",\\{0,1\\}\$/\\1/p" "$MANIFEST" | head -n 1; }
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

banner

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Darwin)
    OSKEY=darwin
    # A Terminal running under Rosetta still gets the Apple silicon build.
    if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then ARCH=arm64; fi
    DEFAULT_HOME="$HOME/Library/Application Support/RawJobs"
    ;;
  Linux)
    OSKEY=linux
    DEFAULT_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/rawjobs"
    ;;
  *) fail "this installer is for macOS and Linux (on Windows, use install.ps1); this computer is $OS." ;;
esac
case "$ARCH" in
  arm64 | aarch64) ARCH=arm64 ;;
  x86_64 | amd64) ARCH=x64 ;;
  *) fail "RawJobs runs on 64-bit computers (x64 or ARM64); this one is $ARCH." ;;
esac
PLATFORM="$OSKEY-$ARCH"
DIR="${RAWJOBS_HOME:-$DEFAULT_HOME}"
mkdir -p "$DIR"
DIR="$(cd "$DIR" && pwd)"

TMP="$(mktemp -d 2>/dev/null || mktemp -d -t rawjobs)"
# A step that stopped with an error (one fail didn't raise) still gets its cross.
trap 'rm -rf "$TMP"; if [ -n "$STEP" ]; then line "  ${C_BAD}✗ $STEP$C_OFF"; printf "\n"; fi; if [ -n "$FANCY" ]; then printf "\033[?25h"; fi' EXIT INT TERM

# 1. What the latest release is, and its signature.
MANIFEST="$TMP/latest.json"
download "$RELEASE/latest.json" "$MANIFEST"
download "$RELEASE/latest.json.sig" "$TMP/latest.json.sig"
[ "$(field app)" = rawjobs ] || fail "$RELEASE/latest.json isn't a RawJobs release."
VERSION="$(field version)"
NODE_VERSION="$(field nodeVersion)"
NODE_SHA="$(field "$PLATFORM")"
BUNDLE_FILE="$(field bundleFile)"
BUNDLE_SHA="$(field bundleSha256)"
[ -n "$VERSION" ] && [ -n "$NODE_VERSION" ] && [ -n "$NODE_SHA" ] && [ -n "$BUNDLE_FILE" ] || fail "$RELEASE/latest.json is incomplete."
# Checked before they name any path: the signature is checked only once Node is here (step 3).
printf '%s' "$NODE_VERSION" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || fail "$RELEASE/latest.json names an unexpected Node version."
printf '%s' "$BUNDLE_FILE" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*$' || fail "$RELEASE/latest.json names an unexpected file."
printf '%s' "$NODE_SHA$BUNDLE_SHA" | grep -Eq '^[0-9a-f]{128}$' || fail "$RELEASE/latest.json has malformed checksums."
NODE_NAME="node-$NODE_VERSION-$PLATFORM"
if [ -n "$FANCY" ]; then printf '  %sVersion %s, for %s%s\n\n' "$C_DIM" "$VERSION" "$PLATFORM" "$C_OFF"; else say "Version $VERSION, for $PLATFORM"; fi

# 2. Node, from nodejs.org, checked against the release's checksum (kept when already there).
NODE="$DIR/runtime/$NODE_NAME/bin/node"
if [ ! -x "$NODE" ]; then
  step "Downloading Node $NODE_VERSION"
  download "https://nodejs.org/dist/$NODE_VERSION/$NODE_NAME.tar.gz" "$TMP/node.tar.gz"
  [ "$(sha256 "$TMP/node.tar.gz")" = "$NODE_SHA" ] || fail "the Node download doesn't match the release's checksum."
  mkdir -p "$TMP/node" "$DIR/runtime"
  tar -xzf "$TMP/node.tar.gz" -C "$TMP/node" || fail "couldn't unpack Node."
  rm -rf "$DIR/runtime/$NODE_NAME"
  mv "$TMP/node/$NODE_NAME" "$DIR/runtime/$NODE_NAME"
  finish "Downloaded Node $NODE_VERSION"
fi

# 3. The release's signature, checked with that Node, before anything from the release runs.
CHECK="const c=require('crypto'),f=require('fs');const k=c.createPublicKey({key:Buffer.from(process.argv[1],'base64'),format:'der',type:'spki'});process.exit(c.verify(null,f.readFileSync(process.argv[2]),k,Buffer.from(f.readFileSync(process.argv[3],'utf8').trim(),'base64'))?0:1)"
"$NODE" -e "$CHECK" "$PUBLIC_KEY" "$MANIFEST" "$TMP/latest.json.sig" </dev/null || fail "the release's signature is not valid, so it wasn't installed."
ok "Checked the release's signature"

# 4. RawJobs itself.
step "Downloading RawJobs"
download "$RELEASE/$BUNDLE_FILE" "$TMP/bundle.tar.gz"
[ "$(sha256 "$TMP/bundle.tar.gz")" = "$BUNDLE_SHA" ] || fail "the download doesn't match the release's checksum."
mkdir -p "$TMP/app"
tar -xzf "$TMP/bundle.tar.gz" -C "$TMP/app" --strip-components=1 || fail "couldn't unpack RawJobs."
finish "Downloaded RawJobs $VERSION"

# 5. Let a running scan finish (or stop it so it can carry on later), back up your data, stop the
#    running copy (if any), then put the new one in place.
LOCK="$DIR/data/scan.lock"
LOCK_PID="$(cat "$LOCK" 2>/dev/null || true)"
case "$LOCK_PID" in '' | *[!0-9]*) LOCK_PID="" ;; esac
if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
  step "A scan is running: waiting up to 10 minutes for it to finish"
  i=0
  while [ $i -lt 120 ] && kill -0 "$LOCK_PID" 2>/dev/null; do sleep 5; draw; i=$((i + 1)); done
  if kill -0 "$LOCK_PID" 2>/dev/null; then
    # It saves its progress and stops; the next scan carries on from there.
    finish
    step "Stopping the scan (the next scan carries on where it stopped)"
    : >"$DIR/data/scan-stop"
    i=0
    while [ $i -lt 12 ] && kill -0 "$LOCK_PID" 2>/dev/null; do sleep 5; draw; i=$((i + 1)); done
    finish "Stopped the scan (the next scan carries on where it stopped)"
  else
    finish "The scan finished"
  fi
fi
if [ -f "$DIR/app/current.txt" ]; then
  step "Backing up your data"
  B="$DIR/backups/$(date -u +%Y-%m-%dT%H-%M-%S-000Z)-before-$VERSION"
  mkdir -p "$B"
  for f in rawjobs.config.local.yaml rawjobs.config.local.backup.yaml profile; do
    if [ -e "$DIR/$f" ]; then cp -R "$DIR/$f" "$B/"; fi
  done
  if [ -d "$DIR/data" ]; then
    # Not what downloads again (caches, the company directory), nor a scan's own flags.
    mkdir -p "$B/data"
    for f in "$DIR/data/"* "$DIR/data/".[!.]*; do
      [ -e "$f" ] || continue
      case "$(basename "$f")" in cache | catalog | scan.lock | scan-stop | scan-notify) ;; *) cp -R "$f" "$B/data/" ;; esac
    done
    if [ -f "$DIR/data/catalog/additions.json" ]; then mkdir -p "$B/data/catalog" && cp "$DIR/data/catalog/additions.json" "$B/data/catalog/"; fi
  fi
  # The last three backups are kept.
  n="$(ls -1d "$DIR/backups/"*/ 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$n" -gt 3 ]; then ls -1d "$DIR/backups/"*/ | sort | head -n "$((n - 3))" | while IFS= read -r old; do rm -rf "$old"; done; fi
  finish "Backed up your data"
fi

if [ "$OSKEY" = darwin ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
else
  systemctl --user stop "$UNIT" >/dev/null 2>&1 || true
fi
pkill -f "$DIR/runtime/" >/dev/null 2>&1 || true

mkdir -p "$DIR/app/versions" "$DIR/bin" "$DIR/logs"
rm -rf "$DIR/app/versions/$VERSION"
mv "$TMP/app" "$DIR/app/versions/$VERSION"
PREVIOUS=""
if [ -f "$DIR/app/current.txt" ]; then PREVIOUS="$(cat "$DIR/app/current.txt")"; fi
if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$VERSION" ] && [ -d "$DIR/app/versions/$PREVIOUS" ]; then printf '%s' "$PREVIOUS" >"$DIR/app/previous.txt"; fi
printf '%s' "$VERSION" >"$DIR/app/current.txt"
printf '%s' "$NODE_NAME" >"$DIR/runtime/current.txt"
# Keep this version and the one before it (to go back to).
for v in "$DIR/app/versions/"*; do
  name="$(basename "$v")"
  if [ "$name" != "$VERSION" ] && [ "$name" != "$PREVIOUS" ]; then rm -rf "$v"; fi
done
cp "$DIR/app/versions/$VERSION/bin/rawjobs" "$DIR/bin/rawjobs"
cp "$DIR/app/versions/$VERSION/bin/rawjobs.cmd" "$DIR/bin/rawjobs.cmd"
chmod +x "$DIR/bin/rawjobs"
LAUNCHER="$DIR/bin/rawjobs"
LOG="$DIR/logs/server.log"

# 6. Start now and at every log in, in the background; restart if it stops.
step "Starting RawJobs (and at every log in)"
started=""
if [ "$OSKEY" = darwin ]; then
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$LAUNCHER")</string>
    <string>serve</string>
    <string>--log</string>
    <string>$(xml "$LOG")</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml "$DIR")</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Standard</string>
</dict>
</plist>
EOF
  if launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || launchctl load -w "$PLIST" >/dev/null 2>&1; then started=yes; fi
else
  UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  mkdir -p "$UNIT_DIR"
  cat >"$UNIT_DIR/$UNIT" <<EOF
[Unit]
Description=RawJobs: the dashboard on http://127.0.0.1:4317

[Service]
ExecStart="$LAUNCHER" serve --log "$LOG"
WorkingDirectory=$DIR
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
  if systemctl --user daemon-reload >/dev/null 2>&1 && systemctl --user enable --now "$UNIT" >/dev/null 2>&1; then started=yes; fi
fi
if [ -z "$started" ]; then
  warn "Couldn't register RawJobs to start at log in here: starting it now. Use the RawJobs app to start it later."
  # </dev/null: with curl | sh, the rest of this script is on stdin.
  nohup "$LAUNCHER" serve --log "$LOG" </dev/null >/dev/null 2>&1 &
fi

# 7. The RawJobs app (~/Applications on macOS, the app menu on Linux) and a shortcut on the Desktop,
#    with RawJobs' icon: they open the dashboard on whatever port it's on (and start RawJobs if it
#    isn't running).
if "$LAUNCHER" shortcuts --desktop </dev/null >/dev/null 2>&1; then
  if [ "$OSKEY" = darwin ]; then ok "Added RawJobs to ~/Applications and the Desktop"; else ok "Added RawJobs to your app menu and the Desktop"; fi
else
  warn "Couldn't add the RawJobs shortcuts; open http://127.0.0.1:4317 instead."
fi

# 8. Wait for it to answer, then open the dashboard.
URL=""
i=0
while [ $i -lt 60 ] && [ -z "$URL" ]; do
  sleep 0.5
  draw
  i=$((i + 1))
  PORT="$(sed -n 's/^ *"port": \([0-9]*\),\{0,1\}$/\1/p' "$DIR/state.json" 2>/dev/null || true)"
  PORT="${PORT:-4317}"
  if fetch_text "http://127.0.0.1:$PORT/api/health" | grep -q "\"version\":\"$VERSION\""; then URL="http://127.0.0.1:$PORT"; fi
done
[ -n "$URL" ] || fail "RawJobs was installed but didn't start. See $LOG."
finish "Started RawJobs (and at every log in)"

printf '\n'
if [ "$OSKEY" = darwin ]; then WHERE="~/Applications"; else WHERE="your app menu"; fi
if [ -n "$FANCY" ]; then
  box "RawJobs $VERSION is running" "$URL" "Installed in $DIR" "It starts by itself when you log in. Open it any time:" "RawJobs, on the Desktop or in $WHERE." \
    "To update or repair it, run the same line again." "To uninstall: \"$LAUNCHER\" uninstall"
else
  printf 'RawJobs %s is running at %s\n' "$VERSION" "$URL"
  say "Installed in $DIR"
  say "It starts by itself when you log in. Open it any time: RawJobs, on the Desktop or in $WHERE."
  say "To update or repair it, run the same line again."
  say "To uninstall: \"$LAUNCHER\" uninstall"
fi
printf '\n'
if [ -z "${RAWJOBS_NO_OPEN:-}" ]; then
  if [ "$OSKEY" = darwin ]; then open "$URL" >/dev/null 2>&1 || true; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true; fi
fi
