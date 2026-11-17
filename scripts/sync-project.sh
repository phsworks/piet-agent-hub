#!/bin/bash
# Sends Piet's local Kova project (also work that isn't pushed yet) to the hub,
# so the generator on the VPS writes docs from the code as it is on his Mac.
# Only text files git knows about or would add (.gitignore respected), never
# .env files or node_modules. Goes over Tailscale HTTPS, so no SSH login.
#   npm run sync-project              send it now
#   npm run sync-project install      every 15 minutes while the Mac is on
#   npm run sync-project uninstall
set -euo pipefail

PROJECT="${KOVA_DIR:-$HOME/Desktop/ICT/Projects/start-up-impact-ai-kova}"
HUB="${HUB_URL:-https://piet-brain.tail4b403a.ts.net}"
LABEL="com.piet.kova-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/piet-kova-sync.log"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="gui/$(id -u)"

case "${1:-}" in
  install)
    mkdir -p "$(dirname "$PLIST")"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$ROOT/scripts/sync-project.sh</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin</string></dict>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
    launchctl bootout "$TARGET/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$TARGET" "$PLIST"
    echo "Kova syncs every 15 minutes (log: $LOG)"
    exit 0
    ;;
  uninstall)
    launchctl bootout "$TARGET/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Kova sync removed"
    exit 0
    ;;
esac

cd "$PROJECT"
ZIP="$(mktemp -t kova-sync).zip"
rm -f "$ZIP"
trap 'rm -f "$ZIP"' EXIT

# Tracked + new files, text only, no secrets or lock files.
{ git ls-files; git ls-files --others --exclude-standard; } \
  | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|py|prisma|sql|md|ya?ml|json|css|html)$' \
  | grep -vE '(^|/)\.env|(^|/)(node_modules|dist|build|\.next|coverage)/|lock\.json$|\.lock$|tsbuildinfo' \
  | sort -u | zip -q "$ZIP" -@

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
COMMIT="$(git log -1 --format='%h %s')"
DIRTY="$(git status --porcelain | wc -l | tr -d ' ')"

curl -fsS -X POST "$HUB/api/school/local-project" \
  -H "content-type: application/zip" \
  -H "x-branch: $BRANCH" \
  -H "x-commit: $(printf '%s' "$COMMIT" | tr -cd '[:print:]' | cut -c1-150)" \
  -H "x-changed: $DIRTY" \
  --data-binary "@$ZIP"
echo " ($(date '+%H:%M'))"
