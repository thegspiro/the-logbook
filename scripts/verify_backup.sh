#!/bin/bash
# ============================================
# THE LOGBOOK - BACKUP RESTORE VERIFICATION
# ============================================
# Proves a backup archive actually restores: verifies the checksum,
# extracts it, loads database.sql(.gz) into a THROWAWAY schema on the
# target MySQL server, asserts core tables came back with data, then
# drops the throwaway schema. Exit 0 = restorable, non-zero = not.
#
# A backup that has never been restored is a hope, not a recovery plan —
# the backup sidecar runs this automatically every VERIFY_EVERY_N_BACKUPS
# runs, and operators can run it by hand any time:
#
#   ./scripts/verify_backup.sh ./backups/logbook_backup_YYYYmmdd_HHMMSS.tar.gz
#
# Environment: DB_HOST (default localhost), DB_PORT (3306),
#   MYSQL_ROOT_PASSWORD or DB_VERIFY_USER/DB_VERIFY_PASSWORD — the account
#   needs CREATE/DROP DATABASE rights for the throwaway schema.
# ============================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVE="${1:-}"
if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
    echo "✗ Usage: $0 <backup-archive.tar.gz>" >&2
    exit 2
fi

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
VERIFY_USER="${DB_VERIFY_USER:-root}"
VERIFY_PASSWORD="${DB_VERIFY_PASSWORD:-${MYSQL_ROOT_PASSWORD:-}}"
# Suffix guards against two drills colliding on the same server.
VERIFY_DB="restore_verify_$(date +%s)_$$"

MYSQL=(mysql -h"$DB_HOST" -P"$DB_PORT" -u"$VERIFY_USER")
if [[ -n "$VERIFY_PASSWORD" ]]; then
    MYSQL+=("-p$VERIFY_PASSWORD")
fi

WORK_DIR="$(mktemp -d)"
cleanup() {
    rm -rf "$WORK_DIR"
    "${MYSQL[@]}" -e "DROP DATABASE IF EXISTS \`$VERIFY_DB\`;" 2>/dev/null || true
}
trap cleanup EXIT

echo "→ Verifying archive: $ARCHIVE"

if [[ -f "$ARCHIVE.sha256" ]]; then
    (cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$ARCHIVE").sha256" >/dev/null)
    echo "✓ Checksum OK"
else
    echo "⚠ No .sha256 file next to the archive — skipping checksum check"
fi

python3 "$SCRIPT_DIR/safe_extract_tar.py" "$ARCHIVE" "$WORK_DIR"
SQL_FILE="$(find "$WORK_DIR" -name 'database.sql*' | head -1)"
if [[ -z "$SQL_FILE" ]]; then
    echo "✗ Archive contains no database.sql(.gz)" >&2
    exit 1
fi
if [[ "$SQL_FILE" == *.gz ]]; then
    gunzip "$SQL_FILE"
    SQL_FILE="${SQL_FILE%.gz}"
fi
echo "✓ Archive extracted ($(du -h "$SQL_FILE" | cut -f1) of SQL)"

echo "→ Restoring into throwaway schema $VERIFY_DB on $DB_HOST"
"${MYSQL[@]}" -e "CREATE DATABASE \`$VERIFY_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
"${MYSQL[@]}" "$VERIFY_DB" < "$SQL_FILE"
echo "✓ SQL loaded without errors"

# Core tables that any real deployment must contain after a restore.
FAILED=0
for table in organizations users alembic_version; do
    count=$("${MYSQL[@]}" -N -B "$VERIFY_DB" \
        -e "SELECT COUNT(*) FROM \`$table\`;" 2>/dev/null) || {
        echo "✗ Table missing after restore: $table" >&2
        FAILED=1
        continue
    }
    echo "  $table: $count row(s)"
done

table_count=$("${MYSQL[@]}" -N -B -e \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$VERIFY_DB';")
echo "  total tables restored: $table_count"
if [[ "$table_count" -lt 50 ]]; then
    echo "✗ Suspiciously few tables ($table_count) — expected a full schema" >&2
    FAILED=1
fi

if [[ "$FAILED" -ne 0 ]]; then
    echo "✗ RESTORE VERIFICATION FAILED for $ARCHIVE" >&2
    exit 1
fi
echo "✓ RESTORE VERIFICATION PASSED for $ARCHIVE"
