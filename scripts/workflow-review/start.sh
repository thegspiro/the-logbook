#!/bin/sh
# Launch the application for a workflow review: a dedicated database, the
# backend on WR_BACKEND_PORT and the Vite dev server on WR_FRONTEND_PORT.
#
#   scripts/workflow-review/start.sh           reuse the review database
#   scripts/workflow-review/start.sh --reset   drop it and start from a fresh install
#   scripts/workflow-review/start.sh --stop    stop both servers and the driver
#
# The review runs against its own database, never DB_NAME: a review onboards a
# department through the real UI, and an organization left in the test
# database makes the onboarding tests fail with "An organization has already
# been created".
#
# Connection settings come from the environment (DB_HOST, DB_PORT, DB_USER,
# DB_PASSWORD, REDIS_HOST, REDIS_PORT, REDIS_PASSWORD), as they do for the
# backend. Nothing here is a credential: the encryption key, salt and secret
# key are generated on first run and kept in the state directory, because data
# encrypted under one key cannot be read under the next.
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
STATE_DIR=${WR_STATE_DIR:-"$ROOT/.workflow-review"}
WR_DB_NAME=${WR_DB_NAME:-logbook_workflow_review}
WR_REDIS_DB=${WR_REDIS_DB:-3}
WR_BACKEND_PORT=${WR_BACKEND_PORT:-3001}
WR_FRONTEND_PORT=${WR_FRONTEND_PORT:-3000}
DB_HOST=${DB_HOST:-127.0.0.1}
DB_PORT=${DB_PORT:-3306}
DB_USER=${DB_USER:-intranet_user}
REDIS_HOST=${REDIS_HOST:-127.0.0.1}
REDIS_PORT=${REDIS_PORT:-6379}
PYTHON=${PYTHON:-python3}

log() { printf '[workflow-review] %s\n' "$*"; }
die() { printf '[workflow-review] ERROR: %s\n' "$*" >&2; exit 1; }

# The name is interpolated into SQL below, so it is held to an identifier.
case $WR_DB_NAME in
  *[!A-Za-z0-9_]* | '') die "WR_DB_NAME must be letters, digits and underscores only" ;;
esac
# Guard the test database: --reset drops the review database.
if [ "$WR_DB_NAME" = "${DB_NAME:-intranet_db}" ] || [ "$WR_DB_NAME" = intranet_db ]; then
  die "WR_DB_NAME ($WR_DB_NAME) must not be the application or test database"
fi
case $WR_REDIS_DB in *[!0-9]* | '') die "WR_REDIS_DB must be a number" ;; esac

stop_one() {
  pidfile="$STATE_DIR/$1.pid"
  [ -f "$pidfile" ] || return 0
  pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    log "stopping $1 (pid $pid)"
    # Each server runs as its own process group (setsid), so npm's child
    # vite and uvicorn's workers go with it.
    kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  fi
  rm -f "$pidfile"
}

stop_all() {
  stop_one driver
  stop_one frontend
  stop_one backend
}

RESET=0
case ${1:-} in
  --stop) stop_all; exit 0 ;;
  --reset) RESET=1 ;;
  '') ;;
  *) die "unknown argument: $1 (expected --reset or --stop)" ;;
esac

[ -n "${DB_PASSWORD:-}" ] || die "DB_PASSWORD is not set"
command -v mysql >/dev/null 2>&1 || die "the mysql client is required"
command -v curl >/dev/null 2>&1 || die "curl is required"

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
stop_all

# MYSQL_PWD keeps the password off the process list.
sql() {
  MYSQL_PWD=$DB_PASSWORD mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -N -B -e "$1"
}

redis_flush() {
  command -v redis-cli >/dev/null 2>&1 || { log "redis-cli not found; review Redis db $WR_REDIS_DB not flushed"; return 0; }
  if [ -n "${REDIS_PASSWORD:-}" ]; then
    REDISCLI_AUTH=$REDIS_PASSWORD redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" -n "$WR_REDIS_DB" FLUSHDB >/dev/null
  else
    redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" -n "$WR_REDIS_DB" FLUSHDB >/dev/null
  fi
}

if [ "$RESET" -eq 1 ]; then
  log "resetting: dropping $WR_DB_NAME and the seeded accounts"
  sql "DROP DATABASE IF EXISTS \`$WR_DB_NAME\`;"
  rm -f "$STATE_DIR/accounts.json" "$STATE_DIR"/auth-*.json
  redis_flush
fi

# utf8mb4_unicode_ci matches docker-compose; a foreign key across two
# collations fails in the migrations (see .claude/hooks/session-start.sh).
sql "CREATE DATABASE IF NOT EXISTS \`$WR_DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

KEYS="$STATE_DIR/keys.env"
if [ ! -f "$KEYS" ]; then
  log "generating encryption keys in $KEYS"
  umask 077
  "$PYTHON" - >"$KEYS" <<'PY'
import secrets
print(f"SECRET_KEY={secrets.token_urlsafe(64)}")
print(f"ENCRYPTION_KEY={secrets.token_hex(32)}")
print(f"ENCRYPTION_SALT={secrets.token_hex(16)}")
PY
fi
# shellcheck disable=SC1090
. "$KEYS"

export SECRET_KEY ENCRYPTION_KEY ENCRYPTION_SALT DB_HOST DB_PORT DB_USER DB_PASSWORD
export REDIS_HOST REDIS_PORT
export DB_NAME="$WR_DB_NAME"
export REDIS_DB="$WR_REDIS_DB"
export ENVIRONMENT=development
export DEBUG=false
export ALLOWED_ORIGINS="http://localhost:$WR_FRONTEND_PORT,http://127.0.0.1:$WR_FRONTEND_PORT"

# Both steps, in this order, as the session-start hook and production do:
# some tables are only ever built by create_all, which repair_schema performs.
log "building the schema in $WR_DB_NAME"
(
  cd "$ROOT/backend"
  "$PYTHON" -m alembic upgrade head >"$STATE_DIR/alembic.log" 2>&1 \
    || { tail -n 20 "$STATE_DIR/alembic.log" >&2; exit 1; }
  "$PYTHON" scripts/repair_schema.py >"$STATE_DIR/repair.log" 2>&1 \
    || { tail -n 20 "$STATE_DIR/repair.log" >&2; exit 1; }
) || die "the schema did not build; logs are in $STATE_DIR"

port_busy() {
  curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$1/" 2>/dev/null
}
port_busy "$WR_BACKEND_PORT" && die "port $WR_BACKEND_PORT is already in use (set WR_BACKEND_PORT)"
port_busy "$WR_FRONTEND_PORT" && die "port $WR_FRONTEND_PORT is already in use (set WR_FRONTEND_PORT)"

log "starting the backend on :$WR_BACKEND_PORT"
(
  cd "$ROOT/backend"
  setsid "$PYTHON" -m uvicorn main:app --host 127.0.0.1 --port "$WR_BACKEND_PORT" \
    >"$STATE_DIR/backend.log" 2>&1 &
  echo $! >"$STATE_DIR/backend.pid"
)

log "starting the frontend on :$WR_FRONTEND_PORT"
(
  cd "$ROOT/frontend"
  VITE_BACKEND_URL="http://127.0.0.1:$WR_BACKEND_PORT" setsid npm run dev -- \
    --port "$WR_FRONTEND_PORT" --strictPort --host 127.0.0.1 \
    >"$STATE_DIR/frontend.log" 2>&1 &
  echo $! >"$STATE_DIR/frontend.pid"
)

wait_for() {
  name=$1 url=$2 tries=$3
  i=0
  while [ "$i" -lt "$tries" ]; do
    if curl -sf --max-time 3 "$url" >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  tail -n 30 "$STATE_DIR/$name.log" >&2
  stop_all
  die "$name did not come up at $url"
}

wait_for backend "http://127.0.0.1:$WR_BACKEND_PORT/health" 90
wait_for frontend "http://127.0.0.1:$WR_FRONTEND_PORT/" 60

cat >"$STATE_DIR/env.json" <<JSON
{"baseUrl": "http://127.0.0.1:$WR_FRONTEND_PORT", "backendUrl": "http://127.0.0.1:$WR_BACKEND_PORT", "database": "$WR_DB_NAME"}
JSON

log "ready: http://127.0.0.1:$WR_FRONTEND_PORT (database $WR_DB_NAME, logs in $STATE_DIR)"
