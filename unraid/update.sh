#!/usr/bin/env bash
#
# ============================================
# THE LOGBOOK - SAFE UPDATE SCRIPT (Unraid, build-from-source)
# ============================================
# Pulls the latest code, rebuilds the images, and recreates the containers
# WITHOUT putting the database at risk. Designed for the build-from-source
# Unraid deployment (docker-compose-build-from-source.yml).
#
# What it does, in order:
#   1. Pre-flight checks (git repo, compose available, clean tree)
#   2. Takes a CONSISTENT database dump via mysqldump and verifies it
#   3. Fast-forwards the git checkout to the latest code
#   4. Rebuilds images and recreates containers (never with `-v`)
#   5. Waits for the backend to report healthy (migrations run on startup)
#
# On any failure after the backup is taken, it prints exact rollback
# instructions (restore the dump + check out the previous commit).
#
# Usage:
#   ./unraid/update.sh                 # normal safe update from main
#   ./unraid/update.sh --branch main   # explicit branch
#   ./unraid/update.sh --no-cache      # force a clean rebuild
#   ./unraid/update.sh -y              # skip the confirmation prompt
#   ./unraid/update.sh --skip-backup   # NOT recommended; skips the dump
# ============================================

set -euo pipefail

# ---- Configuration -------------------------------------------------------

# INSTALL_DIR is the repo root: this script lives in <root>/unraid/.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(dirname "$SCRIPT_DIR")"

# Where pre-update dumps are written. Matches the backups bind-mount used by
# the compose file so dumps land on the array, not inside the container.
BACKUP_DIR="/mnt/user/backups/the-logbook"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

BRANCH="main"
NO_CACHE=""
ASSUME_YES=""
SKIP_BACKUP=""

# ---- Output helpers ------------------------------------------------------

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}ℹ${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC} $1"; }
err()     { echo -e "${RED}✗${NC} $1" >&2; }

# ---- Argument parsing ----------------------------------------------------

while [ $# -gt 0 ]; do
    case "$1" in
        --branch)      BRANCH="${2:?--branch needs a value}"; shift 2 ;;
        --no-cache)    NO_CACHE="--no-cache"; shift ;;
        -y|--yes)      ASSUME_YES="1"; shift ;;
        --skip-backup) SKIP_BACKUP="1"; shift ;;
        -h|--help)
            sed -n '2,34p' "$0"; exit 0 ;;
        *)
            err "Unknown option: $1"; exit 2 ;;
    esac
done

# ---- Detect the compose command -----------------------------------------
# Unraid's Compose Manager plugin provides Docker Compose v2 as the
# `docker compose` subcommand. Older installs used the standalone
# `docker-compose` binary. Support whichever is present.

if docker compose version >/dev/null 2>&1; then
    COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE="docker-compose"
else
    err "Neither 'docker compose' nor 'docker-compose' is available."
    err "Install the Docker Compose Manager plugin from Unraid Community Applications."
    exit 1
fi

cd "$INSTALL_DIR"

# ---- Pre-flight checks ---------------------------------------------------

info "Install directory: $INSTALL_DIR"
info "Compose command:   $COMPOSE"
info "Update branch:     $BRANCH"

if [ ! -d "$INSTALL_DIR/.git" ]; then
    err "$INSTALL_DIR is not a git checkout — cannot pull updates here."
    exit 1
fi

if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
    err "No docker-compose.yml in $INSTALL_DIR."
    err "Copy it first: cp unraid/docker-compose-build-from-source.yml docker-compose.yml"
    exit 1
fi

# A dirty working tree means local edits would be tangled with the pull.
# Refuse rather than risk a merge conflict or clobbering the user's changes.
if [ -n "$(git status --porcelain)" ]; then
    err "Working tree has uncommitted changes. Commit, stash, or revert them first:"
    git status --short >&2
    exit 1
fi

PREV_COMMIT="$(git rev-parse HEAD)"
info "Current commit:    ${PREV_COMMIT:0:12}"

# ---- Rollback guidance (printed by the error trap) -----------------------

BACKUP_FILE=""
print_rollback() {
    echo
    err "Update failed. Your data is intact. To roll back the code:"
    echo -e "    ${YELLOW}cd $INSTALL_DIR && git checkout $PREV_COMMIT${NC}" >&2
    echo -e "    ${YELLOW}$COMPOSE up -d --build${NC}" >&2
    if [ -n "$BACKUP_FILE" ] && [ -f "$BACKUP_FILE" ]; then
        echo >&2
        err "To restore the database from the pre-update dump:"
        echo -e "    ${YELLOW}gunzip -c '$BACKUP_FILE' | $COMPOSE exec -T db \\
      sh -c 'mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" \"\$MYSQL_DATABASE\"'${NC}" >&2
    fi
}
trap 'print_rollback' ERR

# ---- Confirmation --------------------------------------------------------

if [ -z "$ASSUME_YES" ]; then
    echo
    warn "This will back up the DB, pull '$BRANCH', rebuild, and recreate containers."
    printf "Proceed? [y/N] "
    read -r reply
    case "$reply" in
        [yY]|[yY][eE][sS]) ;;
        *) info "Aborted."; trap - ERR; exit 0 ;;
    esac
fi

# ---- Step 1: Consistent database backup ----------------------------------
# mysqldump --single-transaction takes a point-in-time consistent snapshot of
# InnoDB tables WITHOUT locking writes — unlike cp -r of a live data dir, which
# yields a torn, unrecoverable copy. Credentials are read from the db
# container's own environment so no secrets touch the host process list.

if [ -n "$SKIP_BACKUP" ]; then
    warn "Skipping database backup (--skip-backup). No rollback dump will exist."
else
    info "Backing up the database (consistent mysqldump)..."
    mkdir -p "$BACKUP_DIR"

    if ! $COMPOSE ps db 2>/dev/null | grep -q .; then
        err "The 'db' service isn't running — cannot take a backup."
        err "Start it first ($COMPOSE up -d db) or re-run with --skip-backup."
        exit 1
    fi

    BACKUP_FILE="$BACKUP_DIR/preupdate_$(date +%Y%m%d_%H%M%S).sql.gz"

    # Dump inside the container using its own MYSQL_* env vars, gzip on the host.
    # `set -o pipefail` (already on) makes a mysqldump failure fail the pipe.
    if $COMPOSE exec -T db sh -c \
        'exec mysqldump --single-transaction --routines --triggers --events \
            -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
        2>/dev/null | gzip > "$BACKUP_FILE"; then
        : # dump command succeeded
    else
        err "mysqldump failed. Aborting before any code changes."
        rm -f "$BACKUP_FILE"
        BACKUP_FILE=""
        exit 1
    fi

    # Verify the archive is non-trivial and not corrupt before trusting it.
    if [ ! -s "$BACKUP_FILE" ] || ! gzip -t "$BACKUP_FILE" 2>/dev/null; then
        err "Backup file is empty or corrupt: $BACKUP_FILE"
        rm -f "$BACKUP_FILE"
        BACKUP_FILE=""
        exit 1
    fi

    BACKUP_SIZE="$(du -h "$BACKUP_FILE" | cut -f1)"
    success "Database backed up: $BACKUP_FILE ($BACKUP_SIZE)"

    # Prune old pre-update dumps so /mnt/user/backups doesn't grow forever.
    find "$BACKUP_DIR" -name 'preupdate_*.sql.gz' -type f \
        -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
fi

# ---- Step 2: Pull the latest code (fast-forward only) --------------------
# --ff-only refuses to create a merge commit: if the branch has diverged the
# pull fails loudly instead of silently merging unexpected history.

info "Fetching origin/$BRANCH..."
git fetch origin "$BRANCH"

if git merge-base --is-ancestor "origin/$BRANCH" HEAD 2>/dev/null; then
    info "Already up to date with origin/$BRANCH."
    if [ -z "$NO_CACHE" ]; then
        info "Nothing new to build. Re-run with --no-cache to force a rebuild."
        trap - ERR
        exit 0
    fi
    warn "Rebuilding anyway (--no-cache requested)."
else
    git checkout "$BRANCH"
    git pull --ff-only origin "$BRANCH"
    success "Code updated to $(git rev-parse --short HEAD)."
fi

# ---- Step 3: Rebuild images ---------------------------------------------

info "Building images${NO_CACHE:+ (no cache)}... this can take 15-20 minutes."
# shellcheck disable=SC2086
$COMPOSE build $NO_CACHE

# ---- Step 4: Recreate containers (volumes preserved) --------------------
# Plain `up -d` recreates only what changed and NEVER touches the mysql/redis
# bind mounts. The destructive `-v` flag is intentionally absent.

info "Recreating containers..."
$COMPOSE up -d

# ---- Step 5: Wait for the backend to become healthy ----------------------
# The backend runs Alembic migrations on startup (normal path = incremental
# `alembic upgrade`, which never drops data). Poll its health endpoint.

BACKEND_PORT="7881"
if [ -f "$INSTALL_DIR/.env" ]; then
    _port_line="$(grep -E '^BACKEND_PORT=' "$INSTALL_DIR/.env" 2>/dev/null | tail -n1 || true)"
    [ -n "$_port_line" ] && BACKEND_PORT="${_port_line#BACKEND_PORT=}"
fi

info "Waiting for the backend to report healthy (http://localhost:$BACKEND_PORT/health)..."
HEALTHY=""
for _ in $(seq 1 60); do   # up to ~5 minutes (migrations can take a while)
    if curl -fsS "http://localhost:$BACKEND_PORT/health" >/dev/null 2>&1; then
        HEALTHY="1"
        break
    fi
    sleep 5
done

if [ -z "$HEALTHY" ]; then
    err "Backend did not become healthy in time. Check the logs:"
    echo -e "    ${YELLOW}$COMPOSE logs -f backend${NC}" >&2
    exit 1
fi

# Success — disable the rollback trap so a clean exit stays clean.
trap - ERR

echo
success "Update complete."
$COMPOSE ps
echo
info "Previous commit was ${PREV_COMMIT:0:12} (use it to roll back if needed)."
[ -n "$BACKUP_FILE" ] && info "Pre-update DB dump: $BACKUP_FILE"
