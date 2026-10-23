#!/bin/bash

# ============================================
# THE LOGBOOK - BACKUP SCRIPT
# ============================================
# Creates comprehensive backups of database, files, and configuration
# Supports local storage, S3, Azure Blob, and Google Cloud Storage
#
# Usage:
#   ./backup.sh                  # Create backup with default settings
#   ./backup.sh --destination s3 # Backup to S3
#   ./backup.sh --restore FILE   # Restore from backup
#   ./backup.sh --list           # List available backups
#   ./backup.sh --encrypt-existing  # Encrypt plaintext archives (needs a key)
#
# Encryption: with a certificate and/or drill key in BACKUP_KEYS_DIR
# (default ./backup-keys, created by scripts/backup-keygen.sh) every archive is
# written as FILE.tar.gz.enc + FILE.tar.gz.enc.key. See docs/BACKUP.md.
#
# Automated Backups:
#   Add to crontab: 0 2 * * * /path/to/backup.sh
# ============================================

set -euo pipefail

# Load the variables this script needs from .env WITHOUT sourcing it.
# Sourcing executes the file: an unquoted value containing a space (the
# template's own `APP_NAME=The Logbook`) runs its second word as a command,
# and under `set -e` that kills every backup and restore.
ENV_FILE="$(dirname "$0")/../.env"

# Print the last value assigned to key $1 in $ENV_FILE, stripping an optional
# `export ` prefix, a trailing CR, and one level of surrounding quotes. The
# file is only ever read, never executed.
env_file_get() {
    local key="$1" line
    line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE" 2>/dev/null | tail -n1)"
    [[ -n "$line" ]] || return 0
    line="${line#*=}"
    line="${line%$'\r'}"
    if [[ ${#line} -ge 2 && "$line" == \"*\" && "$line" == *\" ]]; then
        line="${line#\"}"
        line="${line%\"}"
    elif [[ ${#line} -ge 2 && "$line" == \'*\' && "$line" == *\' ]]; then
        line="${line#\'}"
        line="${line%\'}"
    fi
    printf '%s' "$line"
}

if [[ -f "$ENV_FILE" ]]; then
    for _key in DB_HOST DB_USER DB_PASSWORD DB_NAME DB_CONTAINER BACKEND_CONTAINER \
        BACKUP_LOCATION BACKUP_RETENTION_DAYS BACKUP_KEYS_DIR \
        BACKUP_ENCRYPT_EXISTING VERSION ENVIRONMENT \
        AWS_S3_BUCKET AZURE_STORAGE_ACCOUNT AZURE_STORAGE_CONTAINER \
        GCS_BUCKET; do
        _val="$(env_file_get "$_key")"
        if [[ -n "$_val" ]]; then
            export "$_key=$_val"
        fi
    done
    unset _key _val
fi

# Defaults so `set -u` cannot trip on keys absent from .env (the Unraid .env
# legitimately omits DB_HOST — the compose hardcodes it per container).
DB_HOST="${DB_HOST:-}"
DB_USER="${DB_USER:-}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_NAME="${DB_NAME:-}"
DB_CONTAINER="${DB_CONTAINER:-}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-}"
AWS_S3_BUCKET="${AWS_S3_BUCKET:-}"
AZURE_STORAGE_ACCOUNT="${AZURE_STORAGE_ACCOUNT:-}"
AZURE_STORAGE_CONTAINER="${AZURE_STORAGE_CONTAINER:-}"
GCS_BUCKET="${GCS_BUCKET:-}"

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_LOCATION:-$PROJECT_DIR/backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="logbook_backup_${TIMESTAMP}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
export BACKUP_KEYS_DIR="${BACKUP_KEYS_DIR:-$PROJECT_DIR/backup-keys}"
# Set by compress_backup: the file that was published, and whether it is encrypted.
ARCHIVE_PATH=""
ARCHIVE_ENCRYPTED=false

# shellcheck source=backup_crypto.sh
source "$SCRIPT_DIR/backup_crypto.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ============================================
# Helper Functions
# ============================================

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠ $1${NC}"; }
print_info() { echo -e "${BLUE}ℹ $1${NC}"; }

# ============================================
# Database Target Resolution
# ============================================
# The compose stacks run MySQL in a container named logbook-db (intranet-mysql
# is the pre-rename legacy name) WITHOUT publishing its port to the host, so
# `docker exec` into that container is the only way in — including for the
# documented Unraid manual backup, where .env leaves DB_HOST unset. Conversely,
# a genuinely remote DB_HOST must never be shadowed by a coincidentally-running
# local container, or a restore would land in the wrong database.

detect_db_container() {
    docker ps --format '{{.Names}}' 2>/dev/null \
        | grep -m1 -E '^(logbook-db|intranet-mysql)$' || true
}

# Sets MYSQL_CONTAINER to the container mysqldump/mysql should run in, or to
# the empty string for a direct host connection to DB_HOST.
resolve_db_target() {
    # An explicit DB_CONTAINER is an operator decision — it always wins.
    if [[ -n "$DB_CONTAINER" ]]; then
        MYSQL_CONTAINER="$DB_CONTAINER"
        return
    fi
    case "$DB_HOST" in
        ""|localhost|127.0.0.1|::1|mysql|db)
            # Unset/loopback, or a compose-internal service name (mysql/db)
            # that is not resolvable from the host: prefer the container when
            # one is running, since the host has no direct MySQL access.
            MYSQL_CONTAINER="$(detect_db_container)"
            ;;
        *)
            # A configured remote host: talk to it directly. Auto-selecting a
            # local container here would back up / RESTORE INTO the wrong
            # database.
            MYSQL_CONTAINER=""
            ;;
    esac
}

# ============================================
# Backup Functions
# ============================================

create_backup_dir() {
    mkdir -p "$BACKUP_DIR"
    mkdir -p "/tmp/$BACKUP_NAME"
    print_success "Backup directory created"
}

backup_database() {
    print_info "Backing up MySQL database..."

    # The password travels via MYSQL_PWD so it never appears on a command
    # line (visible in ps).
    resolve_db_target
    if [[ -n "$MYSQL_CONTAINER" ]]; then
        print_info "Using MySQL container: $MYSQL_CONTAINER"
        docker exec -e MYSQL_PWD="${DB_PASSWORD}" "$MYSQL_CONTAINER" mysqldump \
            -u"${DB_USER}" \
            "${DB_NAME}" \
            --single-transaction \
            --quick \
            --lock-tables=false \
            > "/tmp/$BACKUP_NAME/database.sql"
    else
        MYSQL_PWD="${DB_PASSWORD}" mysqldump \
            -h"${DB_HOST:-localhost}" \
            -u"${DB_USER}" \
            "${DB_NAME}" \
            --single-transaction \
            --quick \
            --lock-tables=false \
            > "/tmp/$BACKUP_NAME/database.sql"
    fi

    # Compress database backup
    gzip "/tmp/$BACKUP_NAME/database.sql"

    print_success "Database backup completed ($(du -h "/tmp/$BACKUP_NAME/database.sql.gz" | cut -f1))"
}

# ============================================
# Uploads Location Resolution
# ============================================
# Every upload writer uses a fixed path under /app/uploads inside the backend
# container. The main compose stack keeps that in the named volume `uploads`
# and the Unraid stacks bind it from /mnt/user/appdata/the-logbook/uploads;
# neither puts anything at $PROJECT_DIR/uploads, so on a Docker install the
# files are only reachable through the backend container. The traditional
# (non-Docker) layout keeps them at $PROJECT_DIR/uploads.

UPLOADS_CONTAINER_PATH="/app/uploads"

detect_backend_container() {
    docker ps --format '{{.Names}}' 2>/dev/null \
        | grep -m1 -E '^(logbook-backend|intranet-backend)$' || true
}

# Sets UPLOADS_SOURCE to "container" (UPLOADS_CONTAINER names it), "host"
# ($PROJECT_DIR/uploads), or "" when neither holds the uploads.
resolve_uploads_source() {
    UPLOADS_SOURCE=""
    UPLOADS_CONTAINER="${BACKEND_CONTAINER:-}"
    if [[ -z "$UPLOADS_CONTAINER" ]] && command -v docker >/dev/null 2>&1; then
        UPLOADS_CONTAINER="$(detect_backend_container)"
    fi
    if [[ -n "$UPLOADS_CONTAINER" ]]; then
        UPLOADS_SOURCE="container"
    elif [[ -d "$PROJECT_DIR/uploads" ]]; then
        UPLOADS_SOURCE="host"
    fi
}

backup_uploads() {
    print_info "Backing up uploaded files..."

    local archive="/tmp/$BACKUP_NAME/uploads.tar.gz"
    resolve_uploads_source
    case "$UPLOADS_SOURCE" in
        container)
            if ! docker exec "$UPLOADS_CONTAINER" test -d "$UPLOADS_CONTAINER_PATH"; then
                print_warning "Uploaded files were NOT backed up: $UPLOADS_CONTAINER_PATH does not exist in container $UPLOADS_CONTAINER"
                return 0
            fi
            print_info "Archiving $UPLOADS_CONTAINER_PATH from container: $UPLOADS_CONTAINER"
            # The archive keeps a top-level uploads/ directory, the layout
            # restore_backup and the backup sidecar both use.
            if ! docker exec "$UPLOADS_CONTAINER" \
                tar -czf - -C "$(dirname "$UPLOADS_CONTAINER_PATH")" "$(basename "$UPLOADS_CONTAINER_PATH")" \
                > "$archive"; then
                rm -f "$archive"
                print_error "Archiving uploads from container $UPLOADS_CONTAINER failed"
                return 1
            fi
            ;;
        host)
            tar -czf "$archive" -C "$PROJECT_DIR" uploads
            ;;
        *)
            print_warning "Uploaded files were NOT backed up: no running backend container (logbook-backend or intranet-backend — start the stack, or set BACKEND_CONTAINER for another name) and no $PROJECT_DIR/uploads directory"
            return 0
            ;;
    esac
    print_success "Uploads backup completed ($(du -h "$archive" | cut -f1))"
    report_bucket_files
}

# A department that keeps its files in its own remote store (an S3 bucket, a
# Google Shared Drive) has them there, not
# on the uploads volume, so this archive does not contain them. Say which,
# so nobody takes the archive for every file; a bucket is backed up with its
# provider's own tooling (docs/BACKUP.md). Best effort: the check needs the
# backend and its database, and a failed check never fails the backup.
BACKEND_SCRIPTS_PATH="/app/scripts"

report_bucket_files() {
    [[ "$UPLOADS_SOURCE" == "container" ]] || return 0
    local inventory summary
    if ! inventory="$(docker exec "$UPLOADS_CONTAINER" \
        python "$BACKEND_SCRIPTS_PATH/migrate_uploads_to_s3.py" --buckets 2>/dev/null)"; then
        print_info "Could not check for files kept in departments' own storage (S3 buckets, Shared Drives); see docs/BACKUP.md"
        return 0
    fi
    if ! summary="$(printf '%s' "$inventory" | python3 -c '
import json, sys
rows = json.load(sys.stdin)
for row in rows:
    where = "%s %s" % (row.get("platform", "s3"), row["bucket"])
    print("  %s: %s file(s) of organization %s" % (where, row["files"], row["organization_id"]))
' 2>/dev/null)"; then
        print_info "Could not read the remote storage check; see docs/BACKUP.md"
        return 0
    fi
    if [[ -n "$summary" ]]; then
        print_warning "These files are in departments' own storage (S3 buckets, Google Shared Drives) and are NOT in this backup. Back them up with the provider's tooling (docs/BACKUP.md):"
        printf '%s\n' "$summary"
    fi
}

backup_config() {
    print_info "Backing up configuration..."

    # Create config backup directory
    mkdir -p "/tmp/$BACKUP_NAME/config"

    # Copy important config files (excluding sensitive .env)
    [[ -f "$PROJECT_DIR/.env.example" ]] && cp "$PROJECT_DIR/.env.example" "/tmp/$BACKUP_NAME/config/"
    [[ -f "$PROJECT_DIR/docker-compose.yml" ]] && cp "$PROJECT_DIR/docker-compose.yml" "/tmp/$BACKUP_NAME/config/"

    # Create a sanitized .env template with values removed
    if [[ -f "$PROJECT_DIR/.env" ]]; then
        sed 's/=.*/=/' "$PROJECT_DIR/.env" > "/tmp/$BACKUP_NAME/config/.env.template"
    fi

    print_success "Configuration backup completed"
}

create_backup_metadata() {
    print_info "Creating backup metadata..."

    cat > "/tmp/$BACKUP_NAME/backup_info.txt" <<EOF
Backup Date: $(date)
Backup Name: $BACKUP_NAME
Application: The Logbook
Version: ${VERSION:-Unknown}
Environment: ${ENVIRONMENT:-Unknown}

Database: ${DB_NAME}
Database Size: $(du -h "/tmp/$BACKUP_NAME/database.sql.gz" 2>/dev/null | cut -f1 || echo "N/A")
$(if [[ -f "/tmp/$BACKUP_NAME/uploads.tar.gz" ]]; then
    echo "Uploads Size: $(du -h "/tmp/$BACKUP_NAME/uploads.tar.gz" | cut -f1)"
fi)

Backup Created By: $(whoami)@$(hostname)
EOF

    print_success "Metadata created"
}

compress_backup() {
    print_info "Compressing backup archive..."

    # Built outside $BACKUP_DIR so that, once a key exists, the plaintext
    # archive never lands on the backups share.
    local plain="/tmp/$BACKUP_NAME.tar.gz"
    (cd /tmp && tar -czf "$plain" "$BACKUP_NAME")

    if bk_encryption_configured; then
        ARCHIVE_PATH="$BACKUP_DIR/$BACKUP_NAME.tar.gz.enc"
        if ! bk_encrypt_file "$plain" "$ARCHIVE_PATH"; then
            rm -f "$plain" "$ARCHIVE_PATH" "$ARCHIVE_PATH.key"
            print_error "Encrypting the backup failed; nothing was published"
            return 1
        fi
        ARCHIVE_ENCRYPTED=true
        rm -f "$plain"
    else
        print_warning "No backup key in $BACKUP_KEYS_DIR: this backup is NOT encrypted. Run scripts/backup-keygen.sh (docs/BACKUP.md)"
        ARCHIVE_PATH="$BACKUP_DIR/$BACKUP_NAME.tar.gz"
        mv "$plain" "$ARCHIVE_PATH"
    fi

    # Calculate checksum
    (cd "$BACKUP_DIR" && sha256sum "$(basename "$ARCHIVE_PATH")" > "$(basename "$ARCHIVE_PATH").sha256")

    print_success "Backup compressed: $ARCHIVE_PATH"
    print_success "Size: $(du -h "$ARCHIVE_PATH" | cut -f1)"
}

cleanup_temp() {
    print_info "Cleaning up temporary files..."
    rm -rf "/tmp/$BACKUP_NAME"
    print_success "Cleanup completed"
}

cleanup_old_backups() {
    print_info "Cleaning up old backups (older than $RETENTION_DAYS days)..."

    find "$BACKUP_DIR" -name "logbook_backup_*.tar.gz*" -type f -mtime +"$RETENTION_DAYS" -delete

    print_success "Old backups removed"
}

# Offsite copies carry ciphertext only. A plaintext archive holds every
# member's records, so it is never sent anywhere a provider could read it.
require_encrypted_for_offsite() {
    if [[ "$ARCHIVE_ENCRYPTED" != "true" ]]; then
        print_error "Refusing to upload an unencrypted backup. Create a key with scripts/backup-keygen.sh, then back up again"
        return 1
    fi
}

# The files that make up the published backup, one per line.
offsite_files() {
    printf '%s\n' "$ARCHIVE_PATH" "$ARCHIVE_PATH.key" "$ARCHIVE_PATH.sha256"
}

upload_to_s3() {
    if [[ -z "$AWS_S3_BUCKET" ]]; then
        print_error "AWS_S3_BUCKET not configured"
        return 1
    fi
    require_encrypted_for_offsite || return 1

    print_info "Uploading backup to S3..."

    local f
    while IFS= read -r f; do
        aws s3 cp "$f" "s3://$AWS_S3_BUCKET/backups/" --storage-class STANDARD_IA
    done < <(offsite_files)

    print_success "Backup uploaded to S3"
}

upload_to_azure() {
    if [[ -z "$AZURE_STORAGE_CONTAINER" ]]; then
        print_error "AZURE_STORAGE_CONTAINER not configured"
        return 1
    fi
    require_encrypted_for_offsite || return 1

    print_info "Uploading backup to Azure..."

    local f
    while IFS= read -r f; do
        az storage blob upload \
            --account-name "$AZURE_STORAGE_ACCOUNT" \
            --container-name "$AZURE_STORAGE_CONTAINER" \
            --name "backups/$(basename "$f")" \
            --file "$f"
    done < <(offsite_files)

    print_success "Backup uploaded to Azure"
}

upload_to_gcs() {
    if [[ -z "$GCS_BUCKET" ]]; then
        print_error "GCS_BUCKET not configured"
        return 1
    fi
    require_encrypted_for_offsite || return 1

    print_info "Uploading backup to Google Cloud Storage..."

    local f
    while IFS= read -r f; do
        gsutil cp "$f" "gs://$GCS_BUCKET/backups/"
    done < <(offsite_files)

    print_success "Backup uploaded to GCS"
}

# ============================================
# Restore Functions
# ============================================

restore_backup() {
    local backup_file="$1" drill_key_file="${2:-}" private_key_file="${3:-}"

    if [[ ! -f "$backup_file" ]]; then
        print_error "Backup file not found: $backup_file"
        exit 1
    fi

    print_warning "RESTORE OPERATION - This will overwrite existing data!"
    read -r -p "Are you sure you want to restore from $backup_file? (yes/no): " confirm

    if [[ "$confirm" != "yes" ]]; then
        print_info "Restore cancelled"
        exit 0
    fi

    print_info "Verifying backup integrity..."

    # Verify checksum if available
    if [[ -f "$backup_file.sha256" ]]; then
        if ! (cd "$(dirname "$backup_file")" && \
            sha256sum -c "$(basename "$backup_file").sha256"); then
            print_error "Backup file checksum verification failed"
            exit 1
        fi
        print_success "Checksum verified"
    fi

    # Extract backup
    print_info "Extracting backup..."
    RESTORE_DIR="/tmp/logbook_restore_$(date +%s)"
    mkdir -p "$RESTORE_DIR"
    local extract_from="$backup_file" decrypted_dir
    if bk_is_encrypted_archive "$backup_file"; then
        # Decrypted into its own directory so the extraction below still sees
        # exactly one top-level directory in RESTORE_DIR.
        decrypted_dir="$(mktemp -d "/tmp/logbook_decrypt_XXXXXX")"
        extract_from="$decrypted_dir/archive.tar.gz"
        print_info "Decrypting backup..."
        if ! bk_decrypt_file "$backup_file" "$extract_from" "$drill_key_file" "$private_key_file"; then
            rm -rf "$decrypted_dir" "$RESTORE_DIR"
            print_error "Could not decrypt the backup. Use --drill-key FILE (the key from $BACKUP_KEYS_DIR) or --private-key FILE (the offline key)"
            exit 1
        fi
        print_success "Backup decrypted"
    fi
    python3 "$SCRIPT_DIR/safe_extract_tar.py" "$extract_from" "$RESTORE_DIR"
    [[ -n "${decrypted_dir:-}" ]] && rm -rf "$decrypted_dir"

    # Find the backup directory (it will be the only directory in RESTORE_DIR)
    mapfile -t extracted_dirs < <(find "$RESTORE_DIR" -mindepth 1 -maxdepth 1 -type d)
    if [[ "${#extracted_dirs[@]}" -ne 1 ]]; then
        print_error "Backup must contain exactly one top-level directory"
        exit 1
    fi
    BACKUP_EXTRACT_DIR="${extracted_dirs[0]}"

    # Restore database. In the compose stacks MySQL's port is not published
    # to the host, so restore through the container when DB_HOST points at the
    # bundled database; a configured remote DB_HOST is restored to directly —
    # never hijacked by a coincidentally-running local container.
    if [[ -f "$BACKUP_EXTRACT_DIR/database.sql.gz" ]]; then
        print_info "Restoring database..."
        resolve_db_target
        if [[ -n "$MYSQL_CONTAINER" ]]; then
            print_info "Restoring through MySQL container: $MYSQL_CONTAINER"
            gunzip -c "$BACKUP_EXTRACT_DIR/database.sql.gz" | docker exec -i -e MYSQL_PWD="${DB_PASSWORD}" "$MYSQL_CONTAINER" mysql \
                -u"${DB_USER}" \
                "${DB_NAME}"
        else
            gunzip -c "$BACKUP_EXTRACT_DIR/database.sql.gz" | MYSQL_PWD="${DB_PASSWORD}" mysql \
                -h"${DB_HOST:-localhost}" \
                -u"${DB_USER}" \
                "${DB_NAME}"
        fi
        print_success "Database restored"
    fi

    # Restore uploads
    if [[ -f "$BACKUP_EXTRACT_DIR/uploads.tar.gz" ]]; then
        restore_uploads "$BACKUP_EXTRACT_DIR/uploads.tar.gz" "$RESTORE_DIR"
    fi

    # Cleanup
    rm -rf "$RESTORE_DIR"

    print_success "Restore completed successfully!"
}

# Restores uploads.tar.gz (top-level uploads/ directory) to wherever
# backup_uploads would have read it from.
restore_uploads() {
    local archive="$1" work_dir="$2"

    print_info "Restoring uploads..."
    resolve_uploads_source
    if [[ "$UPLOADS_SOURCE" == "container" ]]; then
        # Validate on the host first: safe_extract_tar.py rejects traversal,
        # links and special files, and tar inside the container has no such
        # guard. Only the vetted tree is streamed in.
        local staged="$work_dir/uploads_staged"
        python3 "$SCRIPT_DIR/safe_extract_tar.py" "$archive" "$staged"
        if [[ ! -d "$staged/uploads" ]]; then
            print_error "uploads.tar.gz has no top-level uploads/ directory"
            return 1
        fi
        print_info "Restoring into $UPLOADS_CONTAINER_PATH in container: $UPLOADS_CONTAINER"
        # --no-overwrite-dir leaves the mount point's own owner and mode alone;
        # the app user cannot change them, and trying fails the extraction.
        tar -cf - -C "$staged/uploads" . \
            | docker exec -i "$UPLOADS_CONTAINER" tar -xf - --no-overwrite-dir -C "$UPLOADS_CONTAINER_PATH"
    else
        python3 "$SCRIPT_DIR/safe_extract_tar.py" "$archive" "$PROJECT_DIR"
    fi
    print_success "Uploads restored"
}

list_backups() {
    print_info "Available backups in $BACKUP_DIR:"
    echo ""

    if [[ ! -d "$BACKUP_DIR" ]] || [[ -z "$(ls -A "$BACKUP_DIR"/*.tar.gz "$BACKUP_DIR"/*.tar.gz.enc 2>/dev/null)" ]]; then
        print_warning "No backups found"
        return
    fi

    local f
    for f in "$BACKUP_DIR"/*.tar.gz "$BACKUP_DIR"/*.tar.gz.enc; do
        [[ -f "$f" ]] || continue
        printf '%-56s %10s %s %s\n' "$f" "$(du -h "$f" | cut -f1)" \
            "$(date -r "$f" '+%Y-%m-%d %H:%M')" \
            "$(bk_is_encrypted_archive "$f" && echo encrypted || echo PLAINTEXT)"
    done
}

# ============================================
# Main Function
# ============================================

run_backup() {
    print_info "Starting backup process..."

    create_backup_dir
    backup_database
    backup_uploads
    backup_config
    create_backup_metadata
    compress_backup
    cleanup_temp
    bk_encrypt_existing "$BACKUP_DIR" || print_warning "Some existing archives could not be encrypted"
    cleanup_old_backups

    # Upload to cloud if specified
    case "${DESTINATION:-local}" in
        s3)
            upload_to_s3
            ;;
        azure)
            upload_to_azure
            ;;
        gcs)
            upload_to_gcs
            ;;
        local)
            print_info "Backup stored locally"
            ;;
        *)
            print_warning "Unknown destination: $DESTINATION, keeping backup local"
            ;;
    esac

    bk_write_status "$BACKUP_DIR" true "$ARCHIVE_ENCRYPTED" || true
    print_success "Backup completed successfully!"
    print_info "Backup location: $ARCHIVE_PATH"
}

main() {
    local backup_to_restore=""
    case "${1:-}" in
        --restore)
            if [[ -z "${2:-}" ]]; then
                print_error "Backup file required"
                echo "Usage: $0 --restore /path/to/backup.tar.gz[.enc] [--drill-key FILE | --private-key FILE]"
                exit 1
            fi
            backup_to_restore="$2"
            shift 2
            local drill_key_file="" private_key_file=""
            while [[ $# -gt 0 ]]; do
                case "$1" in
                    --drill-key) drill_key_file="${2:-}"; shift 2 ;;
                    --private-key) private_key_file="${2:-}"; shift 2 ;;
                    *) print_error "Unknown restore option: $1"; exit 1 ;;
                esac
            done
            restore_backup "$backup_to_restore" "$drill_key_file" "$private_key_file"
            ;;
        --encrypt-existing)
            if ! bk_encryption_configured; then
                print_error "No backup key in $BACKUP_KEYS_DIR; run scripts/backup-keygen.sh first"
                exit 1
            fi
            rm -f "$BACKUP_DIR/.encrypted_existing_done"
            bk_encrypt_existing "$BACKUP_DIR"
            ;;
        --list)
            list_backups
            ;;
        --destination)
            DESTINATION="${2:-local}"
            run_backup
            ;;
        --help|-h)
            cat <<EOF
The Logbook Backup Script

Usage:
    $0 [OPTIONS]

Options:
    --destination DEST   Backup destination: local, s3, azure, gcs (default: local)
    --restore FILE       Restore from backup file (an .enc archive also needs
                         --drill-key FILE or --private-key FILE, unless the
                         drill key is already in the keys directory)
    --encrypt-existing   Encrypt plaintext archives in the backups directory
    --list               List available backups
    --help               Show this help

Examples:
    $0                           # Create local backup
    $0 --destination s3          # Create backup and upload to S3
    $0 --restore backup.tar.gz   # Restore from backup
    $0 --list                    # List all backups

Automated Backups:
    Add to crontab for daily backups at 2 AM:
    0 2 * * * /path/to/backup.sh

For more information, see docs/BACKUP.md
EOF
            exit 0
            ;;
        *)
            run_backup
            ;;
    esac
}

# Run only when executed, so the tests can load the functions without a backup.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
