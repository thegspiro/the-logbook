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
# Each service is checked and installed on its own. A cached image that ships
# MariaDB but not Redis is a real shape, and testing only for the database left
# redis-server missing while `|| true` on the start swallowed the evidence —
# the hook then announced both were ready.
needed=""
if ! command -v mariadbd >/dev/null 2>&1 && ! command -v mysqld >/dev/null 2>&1; then
  needed="$needed mariadb-server"
fi
if ! command -v redis-server >/dev/null 2>&1; then
  needed="$needed redis-server"
fi
if [ -n "$needed" ]; then
  log "installing:$needed"
  apt-get update -qq >/dev/null 2>&1 || true
  # shellcheck disable=SC2086
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q $needed >/dev/null 2>&1
fi

# ── Python dependencies ──────────────────────────────────────────────────────
# --ignore-installed: several packages are also present as Debian system
# packages with no RECORD file, and pip refuses to uninstall those.
#
# pywebpush/http-ece are dropped: http-ece has no wheel for this Python and its
# sdist build fails. Web push is an optional feature and tests/test_push_
# service.py skips itself when py_vapid is missing, so the cost is one skip.
#
# The skip is keyed to a marker naming the requirements file's own checksum,
# not to one importable package. A general-purpose image can ship FastAPI and
# still be missing alembic, aiomysql or a pytest plugin, and `import fastapi`
# called that environment complete — after which the schema build failed as a
# warning and collection failed for reasons that read as unrelated. Keying the
# marker to the checksum also reinstalls when requirements.txt changes.
reqs_sum="$(sha1sum backend/requirements.txt | cut -d' ' -f1)"
deps_marker="/var/tmp/.logbook-deps-$reqs_sum"
if [ ! -f "$deps_marker" ]; then
  log "installing backend dependencies"
  grep -v '^pywebpush\|^http-ece' backend/requirements.txt > /tmp/session-reqs.txt
  if pip install -q --ignore-installed -r /tmp/session-reqs.txt >/dev/null 2>&1; then
    touch "$deps_marker"
  else
    log "WARNING: backend dependency install reported errors"
  fi
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
# across two collations fails with MySQL error 3780 (errno 150 on MariaDB).
#
# ALTER DATABASE only changes the default for tables created *after* it, so a
# database that already holds general_ci tables cannot be repaired that way. A
# resumed session inherits whatever the previous one left behind, and anything
# that recreated this database without an explicit COLLATE — a scratch script,
# a hand-run CREATE DATABASE — leaves exactly that. The upgrade then dies on
# 20260120_0013's locations FK, which reads as "the migration chain is broken"
# when the truth is "this sandbox's database is stale". Drop it and start over:
# it holds nothing but the last session's test rows.
existing_collation="$(mysql -u root -N -B -e \
  "SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA \
   WHERE SCHEMA_NAME='$DB_NAME';" 2>/dev/null || true)"
if [ -n "$existing_collation" ] && [ "$existing_collation" != "utf8mb4_unicode_ci" ]; then
  log "rebuilding $DB_NAME: collation is $existing_collation, not utf8mb4_unicode_ci"
  mysql -u root -e "DROP DATABASE $DB_NAME;" >/dev/null 2>&1 || true
fi

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
  for _ in $(seq 1 15); do
    redis-cli ping >/dev/null 2>&1 && break
    sleep 1
  done
fi
if ! redis-cli ping >/dev/null 2>&1; then
  log "ERROR: redis is not answering; anything cache- or session-backed will fail"
  exit 0
fi

# ── Schema ───────────────────────────────────────────────────────────────────
# Both steps, in this order, because neither alone is the schema: 39 of the 254
# tables are never created by a migration and only exist after create_all —
# which is what repair_schema.py performs, mirroring main.py's startup.
log "building the schema (alembic upgrade head, then repair_schema)"
(
  cd backend
  # A failed upgrade is fatal to the point of this hook, so it stops here
  # rather than falling through to repair_schema. CI stops at the same place;
  # repair_schema builds the models' tables directly and would create enough
  # schema for the local suite to pass green against a migration chain that
  # is already broken — the exact false reassurance this hook exists to
  # prevent. Report it and leave the database as CI would find it.
  if ! python3 -m alembic upgrade head >/tmp/session-alembic.log 2>&1; then
    log "ERROR: alembic upgrade head failed."
    log "       CI migrates an empty database, so this reproduces there ONLY if"
    log "       $DB_NAME was empty. If a previous session left tables behind,"
    log "       drop the database and re-run this hook before believing it:"
    log "         mysql -u root -e 'DROP DATABASE $DB_NAME'"
    log "       Not running repair_schema: it would build the models' tables"
    log "       directly and hide a real failure behind a green local suite."
    tail -n 15 /tmp/session-alembic.log | sed 's/^/       | /'
    exit 1
  fi
  if ! python3 scripts/repair_schema.py >/tmp/session-repair.log 2>&1; then
    log "ERROR: repair_schema failed; the schema is incomplete."
    tail -n 15 /tmp/session-repair.log | sed 's/^/       | /'
    exit 1
  fi
) || {
  log "NOT ready — the schema did not build. DB-backed tests will not be"
  log "            trustworthy until the error above is resolved."
  exit 0
}

log "ready — backend tests can reach MariaDB and Redis"
