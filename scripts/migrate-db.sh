#!/bin/bash
# One-time move from the Mac to the VPS: builds there, stops the Mac service
# (only one process may poll the Telegram bot), copies the database over and
# starts the VPS. Google, TickTick and iCloud stay connected: their tokens
# live in the database.
# Undo: on the VPS `docker compose -f docker-compose.prod.yml stop app`, then
# remove BACKGROUND_JOBS=off from .env.local and run `npm run service install`.
set -euo pipefail
VPS="${VPS:-root@piet-brain}"
DIR=/opt/piet-brain
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="docker compose -f docker-compose.prod.yml"
DUMP="$(mktemp -t piet-brain).dump"

echo "1/5 Building on the VPS (the Mac keeps running meanwhile)…"
bash "$ROOT/scripts/deploy.sh" --build-only

echo "2/5 Stopping the Mac service…"
bash "$ROOT/scripts/service.sh" uninstall

echo "3/5 Dumping the Mac database…"
docker exec piet-agent-hub-db-1 pg_dump -U piet --format=custom --no-owner piet_brain > "$DUMP"
scp -q "$DUMP" "$VPS:$DIR/restore.dump"
rm -f "$DUMP"

echo "4/5 Restoring on the VPS…"
ssh "$VPS" "cd $DIR && $COMPOSE up -d db \
  && until $COMPOSE exec -T db pg_isready -U piet -d piet_brain >/dev/null; do sleep 1; done \
  && $COMPOSE exec -T db pg_restore -U piet -d piet_brain --clean --if-exists --no-owner < restore.dump \
  && rm restore.dump"

echo "5/5 Starting the app on the VPS…"
ssh "$VPS" "cd $DIR && $COMPOSE up -d"

# Local dev from now on: no bot, no coach, no cron jobs (they'd answer twice).
grep -q '^BACKGROUND_JOBS=' "$ROOT/.env.local" || echo "BACKGROUND_JOBS=off" >> "$ROOT/.env.local"
echo "Done. The hub runs on the VPS; local dev (npm run dev) no longer runs the bot or jobs."
