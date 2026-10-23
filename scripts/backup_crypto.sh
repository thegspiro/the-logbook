#!/bin/bash
# ============================================
# THE LOGBOOK - BACKUP ENCRYPTION LIBRARY
# ============================================
# Sourced by backup.sh, backup-sidecar.sh and verify_backup.sh. Shell and
# openssl only: the sidecar runs on the mysql:8.0 image, which has no Python.
#
# FORMAT (version LBENC1). An encrypted backup is two files that travel together:
#
#   logbook_backup_T.tar.gz.enc      the archive, AES-256-CBC (openssl enc,
#                                    PBKDF2-SHA256), streamed so memory stays
#                                    flat however large the archive is
#   logbook_backup_T.tar.gz.enc.key  "LBENC1" and a base64 CMS envelope holding
#                                    the per-archive passphrase and the SHA-256
#                                    of the .enc file
#
# The envelope is encrypted to every recipient that is configured:
#   * a certificate (public half only) whose private key is kept OFFLINE; and
#   * a drill key held on the server, so the nightly restore drill can open
#     what it just wrote.
# Either one opens the envelope. A server breach exposes the drill key, so only
# the offline private key protects backups that were taken before the breach.
#
# Why not `openssl cms -encrypt` over the whole archive: it streams going in but
# buffers the entire payload coming out (about 2.8x its size in memory), so a
# multi-gigabyte restore would run out of memory on the day it is needed.
#
# Integrity: the SHA-256 inside the envelope is checked before any decryption,
# so a corrupted, truncated or swapped .enc is refused. It does not make the
# archive authentic against someone who can write to the backup store AND holds
# the (public) certificate; that would need a signature, which the drill-key
# model cannot offer.
#
# Secrets: the passphrase travels on a file descriptor, never a command line.
# The one exception is the drill key, which `openssl cms` accepts only as the
# argument -secretkey; it is visible to other local users for the few
# milliseconds the command runs, which on the sidecar container is nobody.
#
# Environment:
#   BACKUP_KEYS_DIR   directory holding backup-recipient.pem and/or
#                     backup-drill.key (default /keys; backup.sh points it at
#                     $PROJECT_DIR/backup-keys on a host install)
# ============================================

BK_FORMAT="LBENC1"
# KEKIdentifier for the drill key's recipient entry; the bytes spell LBENC1.
BK_KEK_ID="4C42454E4331"
BK_PBKDF2_ITER=100000

bk_keys_dir() { printf '%s' "${BACKUP_KEYS_DIR:-/keys}"; }
bk_cert_file() { printf '%s/backup-recipient.pem' "$(bk_keys_dir)"; }
bk_drill_key_file() { printf '%s/backup-drill.key' "$(bk_keys_dir)"; }

# Prints the drill key (64 hex characters) or returns 1 when there is none or
# the file is not a usable key. A malformed key fails loudly rather than being
# treated as absent: silently dropping to "no drill key" would write archives
# the nightly drill cannot open.
bk_read_drill_key() {
    local file key
    file="$(bk_drill_key_file)"
    [[ -s "$file" ]] || return 1
    key="$(tr -d '[:space:]' < "$file")"
    if [[ ! "$key" =~ ^[0-9a-fA-F]{64}$ ]]; then
        echo "[crypto] ERROR: $file is not 64 hexadecimal characters" >&2
        return 2
    fi
    printf '%s' "$key"
}

bk_have_cert() { [[ -s "$(bk_cert_file)" ]]; }
bk_have_drill_key() { [[ -s "$(bk_drill_key_file)" ]]; }

# True when at least one recipient is configured, i.e. backups must be encrypted.
bk_encryption_configured() { bk_have_cert || bk_have_drill_key; }

bk_sha256_of() {
    openssl dgst -sha256 -r "$1" | cut -d' ' -f1
}

# bk_encrypt_file PLAIN OUT
# Writes OUT and OUT.key. On any failure both are removed and 1 is returned, so
# the caller never publishes half an archive.
bk_encrypt_file() {
    local plain="$1" out="$2"
    local key_file="$out.key" tmp_out="$out.partial" tmp_key="$out.key.partial"
    local passphrase digest drill="" cms_b64 recipients=0
    local -a cms_args=(-encrypt -binary -aes-256-cbc -outform DER)

    if ! command -v openssl >/dev/null 2>&1; then
        echo "[crypto] ERROR: openssl is not installed" >&2
        return 1
    fi
    if bk_have_cert; then
        cms_args+=(-recip "$(bk_cert_file)")
        recipients=$((recipients + 1))
    fi
    if bk_have_drill_key; then
        if ! drill="$(bk_read_drill_key)"; then
            return 1
        fi
        cms_args+=(-secretkey "$drill" -secretkeyid "$BK_KEK_ID")
        recipients=$((recipients + 1))
    fi
    if [[ "$recipients" -eq 0 ]]; then
        echo "[crypto] ERROR: no certificate or drill key in $(bk_keys_dir)" >&2
        return 1
    fi

    rm -f "$tmp_out" "$tmp_key" "$out" "$key_file"
    passphrase="$(openssl rand -hex 32)" || return 1

    if ! openssl enc -aes-256-cbc -pbkdf2 -iter "$BK_PBKDF2_ITER" -md sha256 -salt \
        -pass fd:3 -in "$plain" -out "$tmp_out" 3<<<"$passphrase"; then
        echo "[crypto] ERROR: encrypting $plain failed" >&2
        rm -f "$tmp_out"
        return 1
    fi
    digest="$(bk_sha256_of "$tmp_out")" || { rm -f "$tmp_out"; return 1; }

    if ! cms_b64="$(printf 'pass=%s\nsha256=%s\n' "$passphrase" "$digest" \
        | openssl cms "${cms_args[@]}" | base64 | tr -d '\n')" \
        || [[ -z "$cms_b64" ]]; then
        echo "[crypto] ERROR: wrapping the archive key failed" >&2
        rm -f "$tmp_out"
        return 1
    fi
    printf '%s\ncms=%s\n' "$BK_FORMAT" "$cms_b64" > "$tmp_key"
    mv "$tmp_out" "$out" && mv "$tmp_key" "$key_file"
}

# bk_decrypt_file ENC OUT [DRILL_KEY_FILE] [PRIVATE_KEY_FILE]
# Opens the envelope with the drill key if given (or the configured one), else
# with the private key (and the configured certificate), checks the archive's
# SHA-256, then decrypts. Nothing is written to OUT unless every check passed.
bk_decrypt_file() {
    local enc="$1" out="$2" drill_file="${3:-}" private_key="${4:-}"
    local key_file="$enc.key" tmp_out="$out.partial"
    local cms_b64 material passphrase expected actual drill="" cert
    local -a cms_args=(-decrypt -binary -inform DER)

    if [[ ! -f "$enc" || ! -f "$key_file" ]]; then
        echo "[crypto] ERROR: need both $enc and $key_file" >&2
        return 1
    fi
    if [[ "$(head -n1 "$key_file")" != "$BK_FORMAT" ]]; then
        echo "[crypto] ERROR: $key_file is not a $BK_FORMAT key file" >&2
        return 1
    fi
    cms_b64="$(sed -n 's/^cms=//p' "$key_file" | head -n1)"
    if [[ -z "$cms_b64" ]]; then
        echo "[crypto] ERROR: $key_file has no envelope" >&2
        return 1
    fi

    if [[ -n "$drill_file" ]]; then
        drill="$(tr -d '[:space:]' < "$drill_file" 2>/dev/null || true)"
    elif [[ -z "$private_key" ]] && bk_have_drill_key; then
        drill="$(bk_read_drill_key)" || return 1
    fi

    if [[ -n "$drill" ]]; then
        if [[ ! "$drill" =~ ^[0-9a-fA-F]{64}$ ]]; then
            echo "[crypto] ERROR: the drill key is not 64 hexadecimal characters" >&2
            return 1
        fi
        cms_args+=(-secretkey "$drill" -secretkeyid "$BK_KEK_ID")
    elif [[ -n "$private_key" ]]; then
        cert="$(bk_cert_file)"
        if [[ ! -s "$cert" ]]; then
            echo "[crypto] ERROR: $cert is needed alongside the private key" >&2
            return 1
        fi
        cms_args+=(-inkey "$private_key" -recip "$cert")
    else
        echo "[crypto] ERROR: no drill key or private key to open $enc with" >&2
        return 1
    fi

    if ! material="$(printf '%s' "$cms_b64" | base64 -d \
        | openssl cms "${cms_args[@]}" 2>/dev/null)" || [[ -z "$material" ]]; then
        echo "[crypto] ERROR: could not open the key envelope of $enc (wrong key?)" >&2
        return 1
    fi
    passphrase="$(printf '%s\n' "$material" | sed -n 's/^pass=//p' | head -n1)"
    expected="$(printf '%s\n' "$material" | sed -n 's/^sha256=//p' | head -n1)"
    if [[ ! "$passphrase" =~ ^[0-9a-f]{64}$ || ! "$expected" =~ ^[0-9a-f]{64}$ ]]; then
        echo "[crypto] ERROR: the key envelope of $enc is malformed" >&2
        return 1
    fi

    actual="$(bk_sha256_of "$enc")" || return 1
    if [[ "$actual" != "$expected" ]]; then
        echo "[crypto] ERROR: $enc does not match its key file (corrupted, truncated or swapped)" >&2
        return 1
    fi

    rm -f "$tmp_out"
    if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter "$BK_PBKDF2_ITER" -md sha256 \
        -pass fd:3 -in "$enc" -out "$tmp_out" 3<<<"$passphrase" 2>/dev/null; then
        echo "[crypto] ERROR: decrypting $enc failed" >&2
        rm -f "$tmp_out"
        return 1
    fi
    mv "$tmp_out" "$out"
}

# True for a file this library wrote.
bk_is_encrypted_archive() { [[ "$1" == *.tar.gz.enc ]]; }

# bk_write_status DIR OK ENCRYPTED
# A small file the backend reads to tell administrators when backups are not
# encrypted. Written after every run, successful or not.
bk_write_status() {
    local dir="$1" ok="$2" encrypted="$3" tmp
    tmp="$dir/.backup_status.partial"
    printf '{"last_run":"%s","ok":%s,"encrypted":%s}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ok" "$encrypted" > "$tmp" \
        && mv "$tmp" "$dir/.backup_status"
}

# bk_encrypt_existing DIR
# One-time conversion of plaintext archives made before a key existed. Each is
# encrypted, decrypted again with the drill key and compared with the original,
# and only then are the plaintext and its checksum removed. Without a drill key
# nothing can be proven, so nothing is deleted. A marker file stops the pass
# from running again once every archive converted.
bk_encrypt_existing() {
    local dir="$1" marker="$1/.encrypted_existing_done" f enc check failed=0 converted=0
    [[ "${BACKUP_ENCRYPT_EXISTING:-true}" == "true" ]] || return 0
    [[ -f "$marker" ]] && return 0
    bk_encryption_configured || return 0
    if ! bk_have_drill_key; then
        echo "[crypto] existing plaintext archives left in place: encrypting them needs the drill key to prove the copy opens" >&2
        return 0
    fi

    shopt -s nullglob
    for f in "$dir"/logbook_backup_*.tar.gz; do
        enc="$f.enc"
        if ! bk_encrypt_file "$f" "$enc"; then
            failed=1
            continue
        fi
        check="$(mktemp "$dir/.verify.XXXXXX")"
        if bk_decrypt_file "$enc" "$check" \
            && [[ "$(bk_sha256_of "$check")" == "$(bk_sha256_of "$f")" ]]; then
            rm -f "$check" "$f" "$f.sha256"
            (cd "$dir" && sha256sum "$(basename "$enc")" > "$(basename "$enc").sha256")
            converted=$((converted + 1))
            echo "[crypto] encrypted existing archive $(basename "$f")"
        else
            rm -f "$check" "$enc" "$enc.key"
            echo "[crypto] ERROR: $(basename "$f") did not survive a round trip; plaintext kept" >&2
            failed=1
        fi
    done
    shopt -u nullglob
    if [[ "$failed" -eq 0 ]]; then
        : > "$marker"
        [[ "$converted" -gt 0 ]] && echo "[crypto] converted $converted existing archive(s)"
    fi
    return "$failed"
}
