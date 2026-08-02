#!/bin/bash
# ============================================
# THE LOGBOOK - BACKUP SIDECAR
# ============================================
# Runs inside the `backup` service (docker-compose.prod.yml): a nightly
# mysqldump + uploads archive written to the backups volume, pruned after
# BACKUP_RETENTION_DAYS, with an automated restore-verification drill
# (verify_backup.sh) every VERIFY_EVERY_N_BACKUPS runs.
#
# Archive layout matches scripts/backup.sh (database.sql.gz [+ uploads.tar.gz]
# inside logbook_backup_TIMESTAMP.tar.gz + .sha256), so `backup.sh --restore`
# and verify_backup.sh work on sidecar archives interchangeably.
#
# The backups volume is LOCAL to the host: sync it offsite (see
# docs/BACKUP.md) — a backup on the host that died with the host is gone.
#
# Environment:
#   DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD   dump credentials
#   MYSQL_ROOT_PASSWORD                           verification (CREATE/DROP)
#   BACKUP_TIME          HH:MM, default 02:00 (container timezone, UTC)
#   BACKUP_RETENTION_DAYS default 30
#   VERIFY_EVERY_N_BACKUPS default 7 (0 disables the drill)
#   RUN_ONCE=1           single backup+verify cycle, then exit (testing)

set -euo pipefail

DB_HOST="${DB_HOST:-mysql}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:-intranet_db}"
DB_USER="${DB_USER:-intranet_user}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_TIME="${BACKUP_TIME:-02:00}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
VERIFY_EVERY="${VERIFY_EVERY_N_BACKUPS:-7}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_COUNTER_FILE="$BACKUP_DIR/.verify_counter"

run_backup() {
    local timestamp name work archive
    timestamp="$(date +%Y%m%d_%H%M%S)"
    name="logbook_backup_${timestamp}"
    work="$(mktemp -d)/$name"
    mkdir -p "$work" "$BACKUP_DIR"

    echo "[backup] $(date -Is) starting $name"
    # MYSQL_PWD keeps the password out of the process list;
    # --no-tablespaces avoids needing the PROCESS privilege (app user).
    MYSQL_PWD="$DB_PASSWORD" mysqldump \
        -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" \
        "$DB_NAME" \
        --single-transaction --quick --lock-tables=false \
        --routines --triggers --no-tablespaces \
        > "$work/database.sql"
    gzip "$work/database.sql"

    if [[ -d /uploads ]]; then
        tar -czf "$work/uploads.tar.gz" -C / uploads
    fi
    if [[ -d /audit_archives ]]; then
        tar -czf "$work/audit_archives.tar.gz" -C / audit_archives
    fi

    archive="$BACKUP_DIR/$name.tar.gz"
    tar -czf "$archive" -C "$(dirname "$work")" "$name"
    (cd "$BACKUP_DIR" && sha256sum "$name.tar.gz" > "$name.tar.gz.sha256")
    rm -rf "$(dirname "$work")"
    echo "[backup] wrote $archive ($(du -h "$archive" | cut -f1))"

    find "$BACKUP_DIR" -name 'logbook_backup_*.tar.gz*' \
        -mtime "+$RETENTION_DAYS" -delete
    echo "[backup] pruned archives older than $RETENTION_DAYS days"

    maybe_verify "$archive"
}

maybe_verify() {
    local archive="$1" counter=0
    [[ "$VERIFY_EVERY" -le 0 ]] && return 0
    [[ -f "$RUN_COUNTER_FILE" ]] && counter="$(cat "$RUN_COUNTER_FILE")"
    counter=$((counter + 1))
    if [[ "$counter" -ge "$VERIFY_EVERY" ]]; then
        echo "[backup] running restore-verification drill"
        if DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" \
            MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-}" \
            bash "$SCRIPT_DIR/verify_backup.sh" "$archive"; then
            counter=0
        else
            # Keep the counter maxed so every subsequent nightly run keeps
            # retrying (and keeps failing loudly in the logs) until fixed.
            echo "[backup] !!! RESTORE VERIFICATION FAILED — investigate now" >&2
        fi
    fi
    echo "$counter" > "$RUN_COUNTER_FILE"
}

seconds_until() {
    local target="$1" now target_epoch
    now="$(date +%s)"
    target_epoch="$(date -d "today $target" +%s)"
    if [[ "$target_epoch" -le "$now" ]]; then
        target_epoch="$(date -d "tomorrow $target" +%s)"
    fi
    echo $((target_epoch - now))
}

if [[ "${RUN_ONCE:-0}" == "1" ]]; then
    run_backup
    exit 0
fi

echo "[backup] sidecar started; daily at $BACKUP_TIME, retention ${RETENTION_DAYS}d, verify every $VERIFY_EVERY run(s)"
while true; do
    sleep "$(seconds_until "$BACKUP_TIME")"
    run_backup || echo "[backup] !!! BACKUP RUN FAILED — investigate now" >&2
done
