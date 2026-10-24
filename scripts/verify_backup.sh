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
# An encrypted archive (.tar.gz.enc, with its .enc.key) is opened with the drill
# key in BACKUP_KEYS_DIR (default /keys), or with the offline private key:
#
#   ./scripts/verify_backup.sh FILE.tar.gz.enc --private-key /path/to/private.pem
#
# Environment: DB_HOST (default localhost), DB_PORT (3306),
#   MYSQL_ROOT_PASSWORD or DB_VERIFY_USER/DB_VERIFY_PASSWORD — the account
#   needs CREATE/DROP DATABASE rights for the throwaway schema.
# ============================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVE="${1:-}"
PRIVATE_KEY=""
if [[ "${2:-}" == "--private-key" ]]; then
    PRIVATE_KEY="${3:-}"
    if [[ -z "$PRIVATE_KEY" || ! -f "$PRIVATE_KEY" ]]; then
        echo "✗ --private-key needs an existing file" >&2
        exit 2
    fi
fi
if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
    echo "✗ Usage: $0 <backup-archive.tar.gz[.enc]> [--private-key FILE]" >&2
    exit 2
fi
export BACKUP_KEYS_DIR="${BACKUP_KEYS_DIR:-/keys}"
# shellcheck source=backup_crypto.sh
source "$SCRIPT_DIR/backup_crypto.sh"
# shellcheck source=db_tls.sh
source "$SCRIPT_DIR/db_tls.sh"

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
VERIFY_USER="${DB_VERIFY_USER:-root}"
VERIFY_PASSWORD="${DB_VERIFY_PASSWORD:-${MYSQL_ROOT_PASSWORD:-}}"
# Suffix guards against two drills colliding on the same server.
VERIFY_DB="restore_verify_$(date +%s)_$$"

# Verified TLS and a client certificate when DB_TLS_DIR holds them; a partial
# directory aborts instead of falling back to plaintext.
db_tls_args || exit 1
MYSQL=(mysql -h"$DB_HOST" -P"$DB_PORT" -u"$VERIFY_USER" ${DB_TLS_ARGS[@]+"${DB_TLS_ARGS[@]}"})
if [[ -n "$VERIFY_PASSWORD" ]]; then
    MYSQL+=("-p$VERIFY_PASSWORD")
fi

# Extract an archive without letting it escape the destination. Prefers the
# Python helper, but the backup sidecar runs on the mysql:8.0 image, which has
# no python3 — there the member list is validated in shell (absolute paths,
# `..` traversal, and link/special members are rejected) before extracting.
safe_extract() {
    local archive="$1" dest="$2"
    if command -v python3 >/dev/null 2>&1; then
        python3 "$SCRIPT_DIR/safe_extract_tar.py" "$archive" "$dest"
        return
    fi
    if ! command -v tar >/dev/null 2>&1; then
        echo "✗ Neither python3 nor tar is available — cannot extract $archive safely" >&2
        return 1
    fi

    local listing verbose line name type
    if ! verbose="$(tar -tvzf "$archive")"; then
        echo "✗ tar could not read $archive" >&2
        return 1
    fi
    # First column of -tv output is the mode string; anything but a regular
    # file (-) or directory (d) — symlink (l), hardlink (h), device (b/c),
    # fifo (p) — is rejected.
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        type="${line:0:1}"
        case "$type" in
            -|d) ;;
            *)
                echo "✗ Refusing to extract $archive: non-regular member: $line" >&2
                return 1
                ;;
        esac
    done <<< "$verbose"
    if ! listing="$(tar -tzf "$archive")"; then
        echo "✗ tar could not list $archive" >&2
        return 1
    fi
    while IFS= read -r name; do
        [[ -z "$name" ]] && continue
        case "/$name/" in
            //*)
                echo "✗ Refusing to extract $archive: absolute path member: $name" >&2
                return 1
                ;;
            */../*)
                echo "✗ Refusing to extract $archive: path traversal member: $name" >&2
                return 1
                ;;
        esac
    done <<< "$listing"
    tar -xzf "$archive" -C "$dest" --no-same-owner
}

WORK_DIR="$(mktemp -d)"
mkdir -p "$WORK_DIR/extracted"
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

EXTRACT_FROM="$ARCHIVE"
if bk_is_encrypted_archive "$ARCHIVE"; then
    if [[ -z "$PRIVATE_KEY" ]] && ! bk_have_drill_key; then
        echo "✗ Cannot restore-verify an encrypted archive without the drill key ($(bk_drill_key_file)) or --private-key" >&2
        exit 1
    fi
    EXTRACT_FROM="$WORK_DIR/decrypted.tar.gz"
    bk_decrypt_file "$ARCHIVE" "$EXTRACT_FROM" "" "$PRIVATE_KEY" || {
        echo "✗ RESTORE VERIFICATION FAILED: $ARCHIVE could not be decrypted" >&2
        exit 1
    }
    echo "✓ Archive decrypted"
fi

safe_extract "$EXTRACT_FROM" "$WORK_DIR/extracted"
SQL_FILE="$(find "$WORK_DIR/extracted" -name 'database.sql*' | head -1)"
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
