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

# NOTE on error handling: run_backup is invoked as `run_backup || ...`, and
# POSIX errexit is IGNORED inside any function called in a || list — so `set -e`
# provides no protection here. Without the explicit per-step guards below, a
# failed mysqldump would still gzip/tar/checksum an EMPTY dump, publish it as a
# good backup, and then prune older (genuinely good) archives. Every step must
# therefore abort the run itself, and prune must only ever run after a
# successful publish.
run_backup() {
    local timestamp name workroot work archive
    timestamp="$(date +%Y%m%d_%H%M%S)"
    name="logbook_backup_${timestamp}"
    if ! workroot="$(mktemp -d)"; then
        echo "[backup] ERROR: mktemp failed — aborting run" >&2
        return 1
    fi
    work="$workroot/$name"
    if ! mkdir -p "$work" "$BACKUP_DIR"; then
        echo "[backup] ERROR: could not create $work / $BACKUP_DIR — aborting run" >&2
        rm -rf "$workroot"
        return 1
    fi

    echo "[backup] $(date -Is) starting $name"
    # MYSQL_PWD keeps the password out of the process list;
    # --no-tablespaces avoids needing the PROCESS privilege (app user).
    if ! MYSQL_PWD="$DB_PASSWORD" mysqldump \
        -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" \
        "$DB_NAME" \
        --single-transaction --quick --lock-tables=false \
        --routines --triggers --no-tablespaces \
        > "$work/database.sql"; then
        echo "[backup] ERROR: mysqldump failed — nothing published, nothing pruned" >&2
        rm -rf "$workroot"
        return 1
    fi
    if [[ ! -s "$work/database.sql" ]]; then
        echo "[backup] ERROR: mysqldump produced an empty dump — nothing published, nothing pruned" >&2
        rm -rf "$workroot"
        return 1
    fi
    if ! gzip "$work/database.sql"; then
        echo "[backup] ERROR: gzip of database dump failed — aborting run" >&2
        rm -rf "$workroot"
        return 1
    fi

    if [[ -d /uploads ]]; then
        if ! tar -czf "$work/uploads.tar.gz" -C / uploads; then
            echo "[backup] ERROR: archiving /uploads failed — aborting run" >&2
            rm -rf "$workroot"
            return 1
        fi
    fi
    if [[ -d /audit_archives ]]; then
        if ! tar -czf "$work/audit_archives.tar.gz" -C / audit_archives; then
            echo "[backup] ERROR: archiving /audit_archives failed — aborting run" >&2
            rm -rf "$workroot"
            return 1
        fi
    fi

    archive="$BACKUP_DIR/$name.tar.gz"
    if ! tar -czf "$archive" -C "$workroot" "$name"; then
        echo "[backup] ERROR: writing $archive failed — removing partial archive" >&2
        rm -f "$archive"
        rm -rf "$workroot"
        return 1
    fi
    if ! (cd "$BACKUP_DIR" && sha256sum "$name.tar.gz" > "$name.tar.gz.sha256"); then
        echo "[backup] ERROR: checksumming $archive failed — removing archive" >&2
        rm -f "$archive" "$archive.sha256"
        rm -rf "$workroot"
        return 1
    fi
    rm -rf "$workroot"
    echo "[backup] wrote $archive ($(du -h "$archive" | cut -f1))"

    # Prune ONLY after a verified-successful publish: pruning on a failed run
    # would delete good backups while adding a broken one.
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
