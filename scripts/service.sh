#!/bin/bash
# Runs Piet's Brain as a macOS background service (launchd), so it's always up
# after login without starting it from this folder.
#   npm run service install    build + start now and at every login
#   npm run service update     rebuild after code changes + restart
#   npm run service stop       stop until next login (e.g. to run `npm run dev`)
#   npm run service start
#   npm run service logs
#   npm run service uninstall
set -euo pipefail

LABEL="com.piet.brain"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/piet-brain.log"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="gui/$(id -u)"
NPM="$(command -v npm)"

write_plist() {
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>ProgramArguments</key>
  <array><string>$NPM</string><string>run</string><string>start</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$(dirname "$NPM"):/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
}

stop() {
  launchctl bootout "$TARGET/$LABEL" 2>/dev/null || true
  # bootout returns before the job is gone; starting again too early fails.
  for _ in $(seq 20); do
    launchctl print "$TARGET/$LABEL" >/dev/null 2>&1 || return 0
    sleep 0.5
  done
}
start() { launchctl bootstrap "$TARGET" "$PLIST"; }

case "${1:-}" in
  install|update)
    (cd "$ROOT" && docker compose up -d && npm run build)
    stop
    write_plist
    start
    echo "Piet's Brain runs on http://localhost:3210 (logs: npm run service logs)"
    ;;
  start) start ;;
  stop) stop ;;
  logs) tail -n 80 -f "$LOG" ;;
  uninstall) stop; rm -f "$PLIST"; echo "Service removed." ;;
  *) sed -n '2,9p' "$0"; exit 1 ;;
esac
