#!/bin/bash
# Prepare a web session to run this repo's real test suite.
#
# Without a database, `pytest` does not fail loudly — it ERRORs out of fixture
# setup, and a casual reading of the summary line ("6720 passed") hides that
# 1035 DB-backed tests never ran at all. That happened on 2026-08-24 and the
# suite was reported green twice before anyone noticed. The same session then
# found two defects the moment a real MariaDB existed: migrations that crashed
# on any fresh database, and a stale generated schema reference.
#
# So this installs the toolchain AND stands up MariaDB + Redis AND builds the
# schema the way production does (alembic upgrade head, then repair_schema.py,
# which is what main.py's startup performs). Mirrors .github/actions/
# backend-db-setup so a green run here means something about CI.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

REPO="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$REPO"

log() { echo "[session-start] $*"; }

# ── Database credentials ─────────────────────────────────────────────────────
# Matches the CI jobs' env so a failure here reproduces there and vice versa.
DB_NAME="intranet_db"
DB_USER="intranet_user"
DB_PASSWORD="test_password"

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export DB_HOST=127.0.0.1"
    echo "export DB_PORT=3306"
    echo "export DB_NAME=$DB_NAME"
    echo "export DB_USER=$DB_USER"
    echo "export DB_PASSWORD=$DB_PASSWORD"
    echo "export REDIS_HOST=127.0.0.1"
    echo "export REDIS_PORT=6379"
    echo "export ENVIRONMENT=testing"
    echo "export SECRET_KEY=session-start-secret-not-for-production"
    echo "export JWT_SECRET=session-start-jwt-not-for-production"
  } >> "$CLAUDE_ENV_FILE"
fi

export DB_HOST=127.0.0.1 DB_PORT=3306 DB_NAME="$DB_NAME" DB_USER="$DB_USER" \
       DB_PASSWORD="$DB_PASSWORD" REDIS_HOST=127.0.0.1 REDIS_PORT=6379 \
       ENVIRONMENT=testing \
       SECRET_KEY=session-start-secret-not-for-production \
       JWT_SECRET=session-start-jwt-not-for-production

# ── System packages ──────────────────────────────────────────────────────────
if ! command -v mariadbd >/dev/null 2>&1 && ! command -v mysqld >/dev/null 2>&1; then
  log "installing mariadb-server and redis-server"
  apt-get update -qq >/dev/null 2>&1 || true
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q \
    mariadb-server redis-server >/dev/null 2>&1
fi

# ── Python dependencies ──────────────────────────────────────────────────────
# --ignore-installed: several packages are also present as Debian system
# packages with no RECORD file, and pip refuses to uninstall those.
#
# pywebpush/http-ece are dropped: http-ece has no wheel for this Python and its
# sdist build fails. Web push is an optional feature and tests/test_push_
# service.py skips itself when py_vapid is missing, so the cost is one skip.
if ! python3 -c "import fastapi" >/dev/null 2>&1; then
  log "installing backend dependencies"
  grep -v '^pywebpush\|^http-ece' backend/requirements.txt > /tmp/session-reqs.txt
  pip install -q --ignore-installed -r /tmp/session-reqs.txt >/dev/null 2>&1 || {
    log "WARNING: backend dependency install reported errors"
  }
fi

# ── Node dependencies ────────────────────────────────────────────────────────
# From the repo root: npm workspaces, one lockfile. `install` rather than `ci`
# so a cached container reuses what is already unpacked.
if [ ! -d node_modules ]; then
  log "installing frontend dependencies"
  npm install --no-audit --no-fund >/dev/null 2>&1 || {
    log "WARNING: npm install reported errors"
  }
fi

# ── MariaDB ──────────────────────────────────────────────────────────────────
mkdir -p /var/lib/mysql /var/run/mysqld
chown -R mysql:mysql /var/lib/mysql /var/run/mysqld 2>/dev/null || true
if [ ! -d /var/lib/mysql/mysql ]; then
  log "initialising the database data directory"
  mariadb-install-db --user=mysql --datadir=/var/lib/mysql >/dev/null 2>&1
fi

if ! mysqladmin ping >/dev/null 2>&1; then
  log "starting mariadb"
  nohup mariadbd-safe --user=mysql >/tmp/mariadb-session-start.log 2>&1 &
  for _ in $(seq 1 60); do
    mysqladmin ping >/dev/null 2>&1 && break
    sleep 1
  done
fi

if ! mysqladmin ping >/dev/null 2>&1; then
  log "ERROR: mariadb did not come up; DB-backed tests will ERROR, not fail"
  log "       see /tmp/mariadb-session-start.log"
  exit 0
fi

# utf8mb4_unicode_ci matches docker-compose's --collation-server. Migrations
# create some tables with an explicit unicode_ci collation and a foreign key
# across two collations fails with MySQL error 3780.
mysql -u root <<SQL >/dev/null 2>&1 || true
CREATE DATABASE IF NOT EXISTS $DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER DATABASE $DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'%' IDENTIFIED BY '$DB_PASSWORD';
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON *.* TO '$DB_USER'@'%' WITH GRANT OPTION;
GRANT ALL PRIVILEGES ON *.* TO '$DB_USER'@'localhost' WITH GRANT OPTION;
FLUSH PRIVILEGES;
SQL

# ── Redis ────────────────────────────────────────────────────────────────────
if ! redis-cli ping >/dev/null 2>&1; then
  log "starting redis"
  redis-server --daemonize yes --save '' --appendonly no >/dev/null 2>&1 || true
fi

# ── Schema ───────────────────────────────────────────────────────────────────
# Both steps, in this order, because neither alone is the schema: 39 of the 254
# tables are never created by a migration and only exist after create_all —
# which is what repair_schema.py performs, mirroring main.py's startup.
log "building the schema (alembic upgrade head, then repair_schema)"
(
  cd backend
  python3 -m alembic upgrade head >/tmp/session-alembic.log 2>&1 || {
    log "WARNING: alembic upgrade failed; see /tmp/session-alembic.log"
  }
  python3 scripts/repair_schema.py >/tmp/session-repair.log 2>&1 || {
    log "WARNING: repair_schema failed; see /tmp/session-repair.log"
  }
)

log "ready — backend tests can reach MariaDB and Redis"
