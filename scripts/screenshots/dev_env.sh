#!/usr/bin/env bash
# Bring up everything the screenshot pipeline needs, and wait until it answers.
#
# The pipeline drives the real application, so it needs the database, cache,
# API and dev server all running. Starting them by hand is four commands and a
# guess at when each is ready; this is one command that blocks until the stack
# actually responds. Safe to re-run — each service is skipped if already up.
#
# Usage:
#   scripts/screenshots/dev_env.sh          # start and wait
#   scripts/screenshots/dev_env.sh --status # report what is up, start nothing

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="${SCREENSHOT_LOG_DIR:-/tmp/logbook-screenshots}"
BACKEND_URL="http://127.0.0.1:3001"
FRONTEND_URL="http://localhost:3000"

mkdir -p "$LOG_DIR"

backend_up() { curl -sf -m 2 -o /dev/null "$BACKEND_URL/health"; }
frontend_up() { curl -sf -m 2 -o /dev/null "$FRONTEND_URL/"; }
db_up() { mariadb -e "SELECT 1" >/dev/null 2>&1 || mysql -e "SELECT 1" >/dev/null 2>&1; }
redis_up() { redis-cli ping >/dev/null 2>&1; }

if [[ "${1:-}" == "--status" ]]; then
  for check in db_up redis_up backend_up frontend_up; do
    if $check; then printf '%-12s up\n' "${check%_up}"; else printf '%-12s DOWN\n' "${check%_up}"; fi
  done
  exit 0
fi

# MariaDB needs its socket directory to exist and be owned by mysql; a container
# restart wipes /run.
if ! db_up; then
  echo "starting mariadb..."
  mkdir -p /run/mysqld && chown mysql:mysql /run/mysqld 2>/dev/null
  setsid mariadbd --user=mysql >"$LOG_DIR/mariadb.log" 2>&1 &
fi

if ! redis_up; then
  echo "starting redis..."
  setsid redis-server >"$LOG_DIR/redis.log" 2>&1 &
fi

until db_up; do sleep 2; done
until redis_up; do sleep 1; done
echo "database and cache ready"

# setsid detaches these from the calling shell so they survive it exiting.
if ! backend_up; then
  echo "starting backend..."
  cd "$REPO_ROOT/backend" || exit 1
  setsid nohup .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 3001 \
    >"$LOG_DIR/backend.log" 2>&1 </dev/null &
fi

if ! frontend_up; then
  echo "starting frontend..."
  cd "$REPO_ROOT/frontend" || exit 1
  VITE_BACKEND_URL="$BACKEND_URL" setsid nohup npm run dev \
    >"$LOG_DIR/frontend.log" 2>&1 </dev/null &
fi

# The backend rebuilds its schema on a cold database, which is slow but bounded.
deadline=$((SECONDS + 420))
until backend_up && frontend_up; do
  if (( SECONDS > deadline )); then
    echo "timed out waiting for the stack; see $LOG_DIR/backend.log" >&2
    exit 1
  fi
  sleep 3
done

echo "stack ready — backend $BACKEND_URL, frontend $FRONTEND_URL"
