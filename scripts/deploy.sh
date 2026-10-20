#!/bin/bash
# Ships the code to the VPS and (re)starts it. Run after code changes, the
# VPS counterpart of `npm run service update`.
#   npm run deploy               build + restart
#   npm run deploy -- --build-only
#   npm run deploy -- logs       follow the app's logs
set -euo pipefail
VPS="${VPS:-root@piet-brain}"
DIR=/opt/piet-brain
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="docker compose -f docker-compose.prod.yml"

if [ "${1:-}" = "logs" ]; then
  exec ssh -t "$VPS" "cd $DIR && $COMPOSE logs -f --tail 80 app"
fi

# .env* is excluded, so the VPS's .env.production is never overwritten or deleted.
rsync -az --delete --exclude-from="$ROOT/.dockerignore" "$ROOT/" "$VPS:$DIR/"

# First deploy: .env.production from .env.local, with the VPS's own database and URL.
if ! ssh "$VPS" "test -f $DIR/.env.production"; then
  HOST=$(ssh "$VPS" "tailscale status --json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')
  PASSWORD=$(openssl rand -hex 24)
  {
    grep -vE '^(DATABASE_URL|APP_URL|POSTGRES_PASSWORD|BACKGROUND_JOBS|TAILSCALE_HOST)=' "$ROOT/.env.local"
    echo "POSTGRES_PASSWORD=$PASSWORD"
    echo "DATABASE_URL=postgres://piet:$PASSWORD@db:5432/piet_brain"
    echo "APP_URL=https://$HOST"
  } | ssh "$VPS" "umask 077 && cat > $DIR/.env.production"
  echo "Created .env.production on the VPS (APP_URL=https://$HOST)"
fi

ssh "$VPS" "cd $DIR && $COMPOSE build app"
if [ "${1:-}" != "--build-only" ]; then
  ssh "$VPS" "cd $DIR && $COMPOSE up -d && docker image prune -f >/dev/null"
  echo "Deployed. Logs: npm run deploy -- logs"
fi
