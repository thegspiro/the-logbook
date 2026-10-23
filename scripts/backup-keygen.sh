#!/bin/bash
# ============================================
# THE LOGBOOK - BACKUP KEY SETUP
# ============================================
# Creates the keys that encrypt backups (see docs/BACKUP.md and
# scripts/backup_crypto.sh). Run once on the host, in the install directory:
#
#   ./scripts/backup-keygen.sh                 # drill key + new certificate
#   ./scripts/backup-keygen.sh --import-certificate my-backup-cert.pem
#   ./scripts/backup-keygen.sh --drill-key-only
#
# Two keys, two jobs:
#   backup-drill.key        lives on the server. Lets the nightly restore drill
#                           open the archive it just wrote. Anyone who controls
#                           the server can read backups with it.
#   backup-recipient.pem    the PUBLIC certificate, also on the server. Its
#                           private key is printed ONCE (or written where you
#                           say) and is never kept here: store it somewhere
#                           that does not share fate with this server. It is the
#                           only thing that protects backups taken before a
#                           server compromise, and the only way back if the
#                           drill key is lost.
#
# If both are lost, every encrypted backup is unrecoverable. That is the point.
#
# Options:
#   --keys-dir DIR            where to write the keys (default: BACKUP_KEYS_DIR,
#                             else ./backup-keys beside this script's parent)
#   --import-certificate F    use a certificate whose private key you hold
#                             elsewhere, instead of generating a pair
#   --drill-key-only          no certificate (backups are readable by anyone
#                             holding the server's drill key; not recommended)
#   --private-key-out FILE    write the generated private key here instead of
#                             printing it. Must be outside the keys directory.
#   --force                   replace existing keys. Backups made with the old
#                             keys stay readable only with the old keys.
#   --yes                     skip the "have you saved it" confirmation
# ============================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
KEYS_DIR="${BACKUP_KEYS_DIR:-$PROJECT_DIR/backup-keys}"
IMPORT_CERT=""
DRILL_ONLY=false
PRIVATE_KEY_OUT=""
FORCE=false
ASSUME_YES=false

die() {
    echo "✗ $*" >&2
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --keys-dir) KEYS_DIR="${2:?--keys-dir needs a directory}"; shift 2 ;;
        --import-certificate) IMPORT_CERT="${2:?--import-certificate needs a file}"; shift 2 ;;
        --drill-key-only) DRILL_ONLY=true; shift ;;
        --private-key-out) PRIVATE_KEY_OUT="${2:?--private-key-out needs a file}"; shift 2 ;;
        --force) FORCE=true; shift ;;
        --yes) ASSUME_YES=true; shift ;;
        -h|--help) sed -n '2,41p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "Unknown option: $1" ;;
    esac
done

command -v openssl >/dev/null 2>&1 || die "openssl is required"
[[ "$DRILL_ONLY" == "true" && -n "$IMPORT_CERT" ]] && die "--drill-key-only and --import-certificate are exclusive"

DRILL_FILE="$KEYS_DIR/backup-drill.key"
CERT_FILE="$KEYS_DIR/backup-recipient.pem"

if [[ "$FORCE" != "true" ]]; then
    for existing in "$DRILL_FILE" "$CERT_FILE"; do
        [[ -e "$existing" ]] && die "$existing already exists. Replacing keys makes backups made with them unreadable without them; pass --force if you mean it."
    done
fi

if [[ -n "$PRIVATE_KEY_OUT" ]]; then
    keys_abs="$(mkdir -p "$KEYS_DIR" && cd "$KEYS_DIR" && pwd)"
    out_dir="$(mkdir -p "$(dirname "$PRIVATE_KEY_OUT")" && cd "$(dirname "$PRIVATE_KEY_OUT")" && pwd)"
    case "$out_dir/" in
        "$keys_abs"/*) die "--private-key-out must be outside $keys_abs: a private key stored beside the backups protects nothing" ;;
    esac
    [[ -e "$PRIVATE_KEY_OUT" ]] && die "$PRIVATE_KEY_OUT already exists"
fi

if [[ -n "$IMPORT_CERT" ]]; then
    [[ -f "$IMPORT_CERT" ]] || die "$IMPORT_CERT not found"
    openssl x509 -in "$IMPORT_CERT" -noout 2>/dev/null || die "$IMPORT_CERT is not a PEM certificate"
    openssl x509 -in "$IMPORT_CERT" -noout -checkend 0 >/dev/null 2>&1 || die "$IMPORT_CERT has expired"
    if grep -q "PRIVATE KEY" "$IMPORT_CERT"; then
        die "$IMPORT_CERT contains a private key; give this script the certificate only"
    fi
fi

umask 077
mkdir -p "$KEYS_DIR"
chmod 700 "$KEYS_DIR"

NEW_PRIVATE_KEY=""
openssl rand -hex 32 > "$DRILL_FILE"
chmod 600 "$DRILL_FILE"

if [[ "$DRILL_ONLY" == "true" ]]; then
    rm -f "$CERT_FILE"
elif [[ -n "$IMPORT_CERT" ]]; then
    cp "$IMPORT_CERT" "$CERT_FILE"
    chmod 644 "$CERT_FILE"
else
    scratch="$(mktemp -d)"
    trap 'rm -rf "$scratch"' EXIT
    openssl req -x509 -newkey rsa:4096 -nodes -sha256 -days 3650 \
        -keyout "$scratch/private.pem" -out "$CERT_FILE" \
        -subj "/CN=The Logbook backup recipient" 2>/dev/null
    chmod 644 "$CERT_FILE"
    NEW_PRIVATE_KEY="$(cat "$scratch/private.pem")"
fi

fingerprint() { openssl dgst -sha256 -r "$1" | cut -c1-16; }

echo
echo "✓ Drill key written to $DRILL_FILE (fingerprint $(fingerprint "$DRILL_FILE"))"
if [[ "$DRILL_ONLY" != "true" ]]; then
    echo "✓ Certificate written to $CERT_FILE (SHA-256 $(openssl x509 -in "$CERT_FILE" -noout -fingerprint -sha256 | cut -d= -f2))"
fi

if [[ -n "$NEW_PRIVATE_KEY" ]]; then
    if [[ -n "$PRIVATE_KEY_OUT" ]]; then
        printf '%s\n' "$NEW_PRIVATE_KEY" > "$PRIVATE_KEY_OUT"
        chmod 600 "$PRIVATE_KEY_OUT"
        echo "✓ Private key written to $PRIVATE_KEY_OUT. Move it OFF this server now."
    else
        echo
        echo "================ PRIVATE KEY: SHOWN ONCE, NOT KEPT ================"
        printf '%s\n' "$NEW_PRIVATE_KEY"
        echo "==================================================================="
        echo "Copy everything between the lines into your password manager or safe."
    fi
fi

echo
echo "Also store a copy of $DRILL_FILE somewhere other than this server."
echo "Keep ENCRYPTION_KEY and ENCRYPTION_SALT stored separately too: a restored"
echo "database cannot decrypt its encrypted fields without them."

if [[ "$ASSUME_YES" != "true" ]]; then
    echo
    read -r -p "Type SAVED once the private key and drill key are stored safely: " answer
    if [[ "$answer" != "SAVED" ]]; then
        rm -f "$DRILL_FILE" "$CERT_FILE"
        [[ -n "$PRIVATE_KEY_OUT" ]] && rm -f "$PRIVATE_KEY_OUT"
        die "Not confirmed: the new keys were removed. Run this again when you are ready."
    fi
fi

echo "✓ Done. Backups from the next run on are encrypted; plaintext archives already on disk are encrypted then."
