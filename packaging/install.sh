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
#   3. Adds a RawJobs app (macOS: ~/Applications; Linux: your app menu) and opens the dashboard:
#      http://127.0.0.1:4317
# Running it again updates or repairs RawJobs. Your profile, tracking and scan data are never touched.
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

say() { printf '  %s\n' "$1"; }
fail() {
  printf '\nRawJobs couldn'\''t be installed: %s\n' "$1" >&2
  exit 1
}
download() {
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

printf '\nInstalling RawJobs\n'

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
trap 'rm -rf "$TMP"' EXIT INT TERM

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
NODE_NAME="node-$NODE_VERSION-$PLATFORM"
say "Version $VERSION, for $PLATFORM"

# 2. Node, from nodejs.org, checked against the release's checksum (kept when already there).
NODE="$DIR/runtime/$NODE_NAME/bin/node"
if [ ! -x "$NODE" ]; then
  say "Downloading Node $NODE_VERSION"
  download "https://nodejs.org/dist/$NODE_VERSION/$NODE_NAME.tar.gz" "$TMP/node.tar.gz"
  [ "$(sha256 "$TMP/node.tar.gz")" = "$NODE_SHA" ] || fail "the Node download doesn't match the release's checksum."
  mkdir -p "$TMP/node" "$DIR/runtime"
  tar -xzf "$TMP/node.tar.gz" -C "$TMP/node" || fail "couldn't unpack Node."
  rm -rf "$DIR/runtime/$NODE_NAME"
  mv "$TMP/node/$NODE_NAME" "$DIR/runtime/$NODE_NAME"
fi

# 3. The release's signature, checked with that Node, before anything from the release runs.
CHECK="const c=require('crypto'),f=require('fs');const k=c.createPublicKey({key:Buffer.from(process.argv[1],'base64'),format:'der',type:'spki'});process.exit(c.verify(null,f.readFileSync(process.argv[2]),k,Buffer.from(f.readFileSync(process.argv[3],'utf8').trim(),'base64'))?0:1)"
"$NODE" -e "$CHECK" "$PUBLIC_KEY" "$MANIFEST" "$TMP/latest.json.sig" </dev/null || fail "the release's signature is not valid, so it wasn't installed."

# 4. RawJobs itself.
say "Downloading RawJobs"
download "$RELEASE/$BUNDLE_FILE" "$TMP/bundle.tar.gz"
[ "$(sha256 "$TMP/bundle.tar.gz")" = "$BUNDLE_SHA" ] || fail "the download doesn't match the release's checksum."
mkdir -p "$TMP/app"
tar -xzf "$TMP/bundle.tar.gz" -C "$TMP/app" --strip-components=1 || fail "couldn't unpack RawJobs."

# 5. Stop the running copy (if any), then put the new one in place.
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
say "Starting RawJobs (and at every log in)"
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
  <key>ProcessType</key><string>Background</string>
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
  say "(Couldn't register RawJobs to start at log in here: starting it now. Use the RawJobs app to start it later.)"
  # </dev/null: with curl | sh, the rest of this script is on stdin.
  nohup "$LAUNCHER" serve --log "$LOG" </dev/null >/dev/null 2>&1 &
fi

# 7. The RawJobs app: opens the dashboard (and starts RawJobs if it isn't running).
if [ "$OSKEY" = darwin ]; then
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/RawJobs.app"
  osacompile -o "$HOME/Applications/RawJobs.app" -e "do shell script quoted form of \"$LAUNCHER\" & \" open >/dev/null 2>&1 &\"" >/dev/null 2>&1 ||
    say "(Couldn't add the RawJobs app; open http://127.0.0.1:4317 instead.)"
else
  APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  mkdir -p "$APPS"
  cat >"$APPS/rawjobs.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=RawJobs
Comment=Open the RawJobs dashboard
Exec="$LAUNCHER" open
Terminal=false
Categories=Office;
EOF
fi

# 8. Wait for it to answer, then open the dashboard.
URL=""
i=0
while [ $i -lt 60 ] && [ -z "$URL" ]; do
  sleep 0.5
  i=$((i + 1))
  PORT="$(sed -n 's/^ *"port": \([0-9]*\),\{0,1\}$/\1/p' "$DIR/state.json" 2>/dev/null || true)"
  PORT="${PORT:-4317}"
  if fetch_text "http://127.0.0.1:$PORT/api/health" | grep -q "\"version\":\"$VERSION\""; then URL="http://127.0.0.1:$PORT"; fi
done
[ -n "$URL" ] || fail "RawJobs was installed but didn't start. See $LOG."

printf '\nRawJobs %s is running at %s\n' "$VERSION" "$URL"
say "Installed in $DIR"
if [ "$OSKEY" = darwin ]; then say "It starts by itself when you log in. Open it any time: RawJobs in ~/Applications."; else say "It starts by itself when you log in. Open it any time: RawJobs in your app menu."; fi
say "To update or repair it, run the same line again."
say "To uninstall: \"$LAUNCHER\" uninstall"
printf '\n'
if [ -z "${RAWJOBS_NO_OPEN:-}" ]; then
  if [ "$OSKEY" = darwin ]; then open "$URL" >/dev/null 2>&1 || true; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true; fi
fi
