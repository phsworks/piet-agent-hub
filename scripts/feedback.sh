#!/bin/bash
# Feedback Piet sent via Telegram (🛠 Feedback, /fb), read from the VPS database.
#   npm run feedback                 open items (plus ones the bot already applied)
#   npm run feedback -- all          everything
#   npm run feedback -- done <id> [note]       mark handled after a code change
#   npm run feedback -- dismiss <id> [note]
set -euo pipefail
VPS="${VPS:-root@piet-brain.tail4b403a.ts.net}"
DIR=/opt/piet-brain
psql() { ssh "$VPS" "cd $DIR && docker compose -f docker-compose.prod.yml exec -T db psql -U piet -d piet_brain -v ON_ERROR_STOP=1 $*"; }
quote() { printf "'%s'" "${1//\'/\'\'}"; }

case "${1:-open}" in
  open|all)
    where=$([ "${1:-open}" = all ] && echo "true" || echo "status in ('open','applied')")
    psql "-c \"select left(id::text, 8) as id, status, to_char(created_at at time zone 'Europe/Amsterdam', 'DD-MM HH24:MI') as at, text, coalesce(resolution, '') as resolution from feedback where $where order by created_at\""
    ;;
  done|dismiss)
    [ -n "${2:-}" ] || { echo "Usage: npm run feedback -- $1 <id> [note]"; exit 1; }
    status=$([ "$1" = done ] && echo done || echo dismissed)
    note=$(quote "${3:-}")
    id=$(quote "${2}%")
    psql "-c \"update feedback set status = '$status', resolved_at = now(), resolution = coalesce(nullif($note, ''), resolution) where id::text like $id returning left(id::text, 8), status\""
    ;;
  *) echo "Usage: npm run feedback [-- all | done <id> [note] | dismiss <id> [note]]"; exit 1 ;;
esac
