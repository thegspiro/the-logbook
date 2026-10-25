#!/bin/bash
# ============================================
# THE LOGBOOK - DATABASE CLIENT TLS ARGUMENTS
# ============================================
# Sourced by backup-sidecar.sh, verify_backup.sh and backup.sh. Fills the array
# DB_TLS_ARGS with the options that make mysql / mysqldump connect over verified
# TLS with a client certificate, from the files scripts/tls-setup.sh writes:
#
#   $DB_TLS_DIR/ca.pem  client.pem  client.key
#
# - DB_TLS_DIR unset, or the directory absent or empty: no arguments, and the
#   connection is made as it always was.
# - All three files present: --ssl-mode=VERIFY_IDENTITY, so the server's
#   certificate must chain to ca.pem AND name the host being connected to.
# - Some but not all present: an error. A half-installed TLS directory most
#   likely means a failed copy, and quietly connecting without TLS would hide
#   it, so callers must abort.
#
# Returns 0 on success (array may be empty), 1 on a partial directory.
# ============================================

db_tls_args() {
    DB_TLS_ARGS=()
    local dir="${DB_TLS_DIR:-}" present=0 f
    [[ -n "$dir" && -d "$dir" ]] || return 0
    for f in ca.pem client.pem client.key; do
        [[ -s "$dir/$f" ]] && present=$((present + 1))
    done
    [[ "$present" -eq 0 ]] && return 0
    if [[ "$present" -ne 3 ]]; then
        echo "[tls] ERROR: $dir must hold ca.pem, client.pem and client.key (found $present of 3); refusing to connect without TLS" >&2
        return 1
    fi
    DB_TLS_ARGS=(
        --ssl-mode=VERIFY_IDENTITY
        "--ssl-ca=$dir/ca.pem"
        "--ssl-cert=$dir/client.pem"
        "--ssl-key=$dir/client.key"
    )
}
