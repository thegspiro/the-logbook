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
#
# Automated Backups:
#   Add to crontab: 0 2 * * * /path/to/backup.sh
# ============================================

set -e

# Load environment variables
if [[ -f "$(dirname "$0")/../.env" ]]; then
    export $(grep -v '^#' "$(dirname "$0")/../.env" | xargs)
fi

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_LOCATION:-$PROJECT_DIR/backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="logbook_backup_${TIMESTAMP}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

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
# Backup Functions
# ============================================

create_backup_dir() {
    mkdir -p "$BACKUP_DIR"
    mkdir -p "/tmp/$BACKUP_NAME"
    print_success "Backup directory created"
}

backup_database() {
    print_info "Backing up MySQL database..."

    if [[ -n "$DB_HOST" && "$DB_HOST" != "localhost" ]]; then
        # Docker or remote database
        if command -v docker &> /dev/null && docker ps | grep -q mysql; then
            docker exec intranet-mysql mysqldump \
                -u"${DB_USER}" \
                -p"${DB_PASSWORD}" \
                "${DB_NAME}" \
                --single-transaction \
                --quick \
                --lock-tables=false \
                > "/tmp/$BACKUP_NAME/database.sql"
        else
            mysqldump \
                -h"${DB_HOST}" \
                -u"${DB_USER}" \
                -p"${DB_PASSWORD}" \
                "${DB_NAME}" \
                --single-transaction \
                --quick \
                --lock-tables=false \
                > "/tmp/$BACKUP_NAME/database.sql"
        fi
    else
        # Local database
        mysqldump \
            -u"${DB_USER}" \
            -p"${DB_PASSWORD}" \
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

backup_uploads() {
    print_info "Backing up uploaded files..."

    if [[ -d "$PROJECT_DIR/uploads" ]]; then
        tar -czf "/tmp/$BACKUP_NAME/uploads.tar.gz" -C "$PROJECT_DIR" uploads
        print_success "Uploads backup completed ($(du -h "/tmp/$BACKUP_NAME/uploads.tar.gz" | cut -f1))"
    else
        print_warning "Uploads directory not found, skipping"
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

    cd /tmp
    tar -czf "$BACKUP_DIR/$BACKUP_NAME.tar.gz" "$BACKUP_NAME"

    # Calculate checksum
    cd "$BACKUP_DIR"
    sha256sum "$BACKUP_NAME.tar.gz" > "$BACKUP_NAME.tar.gz.sha256"

    print_success "Backup compressed: $BACKUP_DIR/$BACKUP_NAME.tar.gz"
    print_success "Size: $(du -h "$BACKUP_DIR/$BACKUP_NAME.tar.gz" | cut -f1)"
}

cleanup_temp() {
    print_info "Cleaning up temporary files..."
    rm -rf "/tmp/$BACKUP_NAME"
    print_success "Cleanup completed"
}

cleanup_old_backups() {
    print_info "Cleaning up old backups (older than $RETENTION_DAYS days)..."

    find "$BACKUP_DIR" -name "logbook_backup_*.tar.gz" -type f -mtime +$RETENTION_DAYS -delete
    find "$BACKUP_DIR" -name "logbook_backup_*.tar.gz.sha256" -type f -mtime +$RETENTION_DAYS -delete

    print_success "Old backups removed"
}

upload_to_s3() {
    if [[ -z "$AWS_S3_BUCKET" ]]; then
        print_error "AWS_S3_BUCKET not configured"
        return 1
    fi

    print_info "Uploading backup to S3..."

    aws s3 cp \
        "$BACKUP_DIR/$BACKUP_NAME.tar.gz" \
        "s3://$AWS_S3_BUCKET/backups/" \
        --storage-class STANDARD_IA

    aws s3 cp \
        "$BACKUP_DIR/$BACKUP_NAME.tar.gz.sha256" \
        "s3://$AWS_S3_BUCKET/backups/"

    print_success "Backup uploaded to S3"
}

upload_to_azure() {
    if [[ -z "$AZURE_STORAGE_CONTAINER" ]]; then
        print_error "AZURE_STORAGE_CONTAINER not configured"
        return 1
    fi

    print_info "Uploading backup to Azure..."

    az storage blob upload \
        --account-name "$AZURE_STORAGE_ACCOUNT" \
        --container-name "$AZURE_STORAGE_CONTAINER" \
        --name "backups/$BACKUP_NAME.tar.gz" \
        --file "$BACKUP_DIR/$BACKUP_NAME.tar.gz"

    print_success "Backup uploaded to Azure"
}

upload_to_gcs() {
    if [[ -z "$GCS_BUCKET" ]]; then
        print_error "GCS_BUCKET not configured"
        return 1
    fi

    print_info "Uploading backup to Google Cloud Storage..."

    gsutil cp \
        "$BACKUP_DIR/$BACKUP_NAME.tar.gz" \
        "gs://$GCS_BUCKET/backups/"

    print_success "Backup uploaded to GCS"
}

# ============================================
# Restore Functions
# ============================================

restore_backup() {
    local backup_file="$1"

    if [[ ! -f "$backup_file" ]]; then
        print_error "Backup file not found: $backup_file"
        exit 1
    fi

    print_warning "RESTORE OPERATION - This will overwrite existing data!"
    read -p "Are you sure you want to restore from $backup_file? (yes/no): " confirm

    if [[ "$confirm" != "yes" ]]; then
        print_info "Restore cancelled"
        exit 0
    fi

    print_info "Verifying backup integrity..."

    # Verify checksum if available
    if [[ -f "$backup_file.sha256" ]]; then
        if ! sha256sum -c "$backup_file.sha256"; then
            print_error "Backup file checksum verification failed"
            exit 1
        fi
        print_success "Checksum verified"
    fi

    # Extract backup
    print_info "Extracting backup..."
    RESTORE_DIR="/tmp/logbook_restore_$(date +%s)"
    mkdir -p "$RESTORE_DIR"
    tar -xzf "$backup_file" -C "$RESTORE_DIR"

    # Find the backup directory (it will be the only directory in RESTORE_DIR)
    BACKUP_EXTRACT_DIR=$(find "$RESTORE_DIR" -mindepth 1 -maxdepth 1 -type d)

    # Restore database
    if [[ -f "$BACKUP_EXTRACT_DIR/database.sql.gz" ]]; then
        print_info "Restoring database..."
        gunzip -c "$BACKUP_EXTRACT_DIR/database.sql.gz" | mysql \
            -h"${DB_HOST:-localhost}" \
            -u"${DB_USER}" \
            -p"${DB_PASSWORD}" \
            "${DB_NAME}"
        print_success "Database restored"
    fi

    # Restore uploads
    if [[ -f "$BACKUP_EXTRACT_DIR/uploads.tar.gz" ]]; then
        print_info "Restoring uploads..."
        tar -xzf "$BACKUP_EXTRACT_DIR/uploads.tar.gz" -C "$PROJECT_DIR"
        print_success "Uploads restored"
    fi

    # Cleanup
    rm -rf "$RESTORE_DIR"

    print_success "Restore completed successfully!"
}

list_backups() {
    print_info "Available backups in $BACKUP_DIR:"
    echo ""

    if [[ ! -d "$BACKUP_DIR" ]] || [[ -z "$(ls -A "$BACKUP_DIR"/*.tar.gz 2>/dev/null)" ]]; then
        print_warning "No backups found"
        return
    fi

    ls -lh "$BACKUP_DIR"/*.tar.gz | awk '{printf "%-50s %10s %s %s %s\n", $9, $5, $6, $7, $8}'
}

# ============================================
# Main Function
# ============================================

main() {
    case "${1:-}" in
        --restore)
            if [[ -z "$2" ]]; then
                print_error "Backup file required"
                echo "Usage: $0 --restore /path/to/backup.tar.gz"
                exit 1
            fi
            restore_backup "$2"
            ;;
        --list)
            list_backups
            ;;
        --destination)
            DESTINATION="${2:-local}"
            ;;
        --help|-h)
            cat <<EOF
The Logbook Backup Script

Usage:
    $0 [OPTIONS]

Options:
    --destination DEST   Backup destination: local, s3, azure, gcs (default: local)
    --restore FILE       Restore from backup file
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
            # Create backup
            print_info "Starting backup process..."

            create_backup_dir
            backup_database
            backup_uploads
            backup_config
            create_backup_metadata
            compress_backup
            cleanup_temp
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

            print_success "Backup completed successfully!"
            print_info "Backup location: $BACKUP_DIR/$BACKUP_NAME.tar.gz"
            ;;
    esac
}

main "$@"
