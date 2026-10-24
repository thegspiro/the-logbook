#!/bin/bash
# ============================================
# THE LOGBOOK - DATABASE AND CACHE TLS SETUP
# ============================================
# Creates a private certificate authority and the certificates that let MySQL
# (or MariaDB) and Redis offer TLS, and the backend and backup sidecar present
# a client certificate. Run once on the host, in the install directory:
#
#   ./scripts/tls-setup.sh                 # create everything
#   ./scripts/tls-setup.sh --print-env     # the .env lines that switch it on
#   ./scripts/tls-setup.sh --check         # list expiry dates; exit 1 if soon
#   ./scripts/tls-setup.sh --renew         # reissue server and client certs
#
# What it writes (default ./tls; Unraid: /mnt/user/appdata/the-logbook/tls):
#
#   mysql/   ca.pem server.pem server.key      mounted into the database
#   redis/   ca.pem server.pem server.key      mounted into Redis
#   backend/ ca.pem client.pem client.key      mounted into the backend, plus
#            mysql-server.pem redis-server.pem   public copies for expiry checks
#   backup/  ca.pem client.pem client.key      mounted into the backup sidecar
#
# The CA PRIVATE KEY goes to a separate directory (default: <tls-dir>-ca-private)
# that no container mounts. It is needed only to issue or renew certificates:
# keep it off this server's shared storage if you can. Losing it costs a
# re-issue of every certificate (run with --force), not your data.
#
# Server certificates cover the compose service names, the container names,
# localhost and 127.0.0.1; add more with --san NAME (for a remote DB_HOST).
#
# Options:
#   --tls-dir DIR       output directory (default: $TLS_DIR or ./tls)
#   --ca-key-dir DIR    where the CA private key is kept
#   --days N            server and client certificate lifetime (default 365)
#   --san NAME          extra DNS name or IP for the server certificates
#   --force             replace an existing CA and every certificate
#   --renew             reissue server and client certificates under the
#                       existing CA (needs the CA key)
#   --check             print each certificate's expiry; exit 1 if any expires
#                       within 30 days
#   --print-env         print the .env lines to switch TLS on, then exit
# ============================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TLS_DIR="${TLS_DIR:-$PROJECT_DIR/tls}"
CA_KEY_DIR=""
DAYS=365
CA_DAYS=3650
WARN_DAYS=30
FORCE=false
RENEW=false
CHECK=false
PRINT_ENV=false
EXTRA_SANS=()

# The container users that must read the keys: mysql/redis images use 999, the
# backend image's appuser is 1000. The backup sidecar runs as root.
MYSQL_UID=999
REDIS_UID=999
BACKEND_UID=1000

die() {
    echo "✗ $*" >&2
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --tls-dir) TLS_DIR="${2:?--tls-dir needs a directory}"; shift 2 ;;
        --ca-key-dir) CA_KEY_DIR="${2:?--ca-key-dir needs a directory}"; shift 2 ;;
        --days) DAYS="${2:?--days needs a number}"; shift 2 ;;
        --san) EXTRA_SANS+=("${2:?--san needs a name}"); shift 2 ;;
        --force) FORCE=true; shift ;;
        --renew) RENEW=true; shift ;;
        --check) CHECK=true; shift ;;
        --print-env) PRINT_ENV=true; shift ;;
        -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "Unknown option: $1" ;;
    esac
done

[[ "$DAYS" =~ ^[0-9]+$ && "$DAYS" -ge 1 ]] || die "--days must be a positive number"
CA_KEY_DIR="${CA_KEY_DIR:-${TLS_DIR%/}-ca-private}"
CA_CERT="$TLS_DIR/ca.pem"
CA_KEY="$CA_KEY_DIR/ca.key"

command -v openssl >/dev/null 2>&1 || die "openssl is required"

# ---------------------------------------------------------------- print-env
if [[ "$PRINT_ENV" == "true" ]]; then
    cat <<'EOF'
# Add to .env, then recreate the stack (docker compose up -d).
# Paths are inside the containers.
DB_SSL=true
DB_SSL_CA=/etc/ssl/logbook-tls/ca.pem
DB_SSL_CERT=/etc/ssl/logbook-tls/client.pem
DB_SSL_KEY=/etc/ssl/logbook-tls/client.key
REDIS_SSL=true
BACKEND_REDIS_PORT=6380
REDIS_SSL_CA=/etc/ssl/logbook-tls/ca.pem
REDIS_SSL_CERT=/etc/ssl/logbook-tls/client.pem
REDIS_SSL_KEY=/etc/ssl/logbook-tls/client.key
EOF
    exit 0
fi

# -------------------------------------------------------------------- check
cert_not_after_epoch() {
    local end
    end="$(openssl x509 -in "$1" -noout -enddate | cut -d= -f2)"
    date -d "$end" +%s
}

if [[ "$CHECK" == "true" ]]; then
    [[ -d "$TLS_DIR" ]] || die "$TLS_DIR does not exist; run this script without --check first"
    now="$(date +%s)"
    soon=$((now + WARN_DAYS * 86400))
    status=0
    for cert in "$CA_CERT" "$TLS_DIR"/mysql/server.pem "$TLS_DIR"/redis/server.pem \
        "$TLS_DIR"/backend/client.pem "$TLS_DIR"/backup/client.pem; do
        [[ -f "$cert" ]] || continue
        end="$(cert_not_after_epoch "$cert")"
        left=$(((end - now) / 86400))
        if [[ "$end" -le "$now" ]]; then
            echo "✗ EXPIRED   ${cert#"$TLS_DIR"/} (expired $((-left)) day(s) ago)"
            status=1
        elif [[ "$end" -le "$soon" ]]; then
            echo "⚠ EXPIRES   ${cert#"$TLS_DIR"/} in $left day(s)"
            status=1
        else
            echo "✓ ok        ${cert#"$TLS_DIR"/} ($left days left)"
        fi
    done
    exit "$status"
fi

# ------------------------------------------------------------------- guards
if [[ "$RENEW" == "true" ]]; then
    [[ -f "$CA_CERT" && -f "$CA_KEY" ]] || die "--renew needs the existing CA ($CA_CERT) and its key ($CA_KEY)"
elif [[ -e "$CA_CERT" || -e "$CA_KEY" ]] && [[ "$FORCE" != "true" ]]; then
    die "A CA already exists ($CA_CERT). Use --renew to reissue certificates under it, or --force to replace everything (every service must then be restarted)."
fi

umask 077
mkdir -p "$TLS_DIR" "$CA_KEY_DIR"
chmod 700 "$CA_KEY_DIR"

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

# ----------------------------------------------------------------------- CA
if [[ "$RENEW" != "true" ]]; then
    openssl req -x509 -newkey rsa:4096 -nodes -sha256 -days "$CA_DAYS" \
        -keyout "$CA_KEY" -out "$CA_CERT" \
        -subj "/CN=The Logbook internal CA" \
        -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
        -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
    chmod 600 "$CA_KEY"
    chmod 644 "$CA_CERT"
    echo "✓ CA created: $CA_CERT (private key: $CA_KEY)"
fi

# issue NAME DIR KIND SANS...
#   KIND server  -> server.pem/server.key with serverAuth
#   KIND client  -> client.pem/client.key with clientAuth
issue() {
    local cn="$1" dir="$2" kind="$3" owner="$4"
    shift 4
    local base="$kind" ext="$SCRATCH/$cn.ext" usage
    mkdir -p "$dir"
    [[ "$kind" == "server" ]] && usage="serverAuth" || usage="clientAuth"
    {
        echo "basicConstraints=critical,CA:FALSE"
        echo "keyUsage=critical,digitalSignature,keyEncipherment"
        echo "extendedKeyUsage=$usage"
        if [[ "$#" -gt 0 ]]; then
            local sans="" name
            for name in "$@"; do
                if [[ "$name" =~ ^[0-9.]+$ || "$name" == *:* ]]; then
                    sans+="IP:$name,"
                else
                    sans+="DNS:$name,"
                fi
            done
            echo "subjectAltName=${sans%,}"
        fi
    } > "$ext"
    openssl req -new -newkey rsa:2048 -nodes -sha256 \
        -keyout "$dir/$base.key" -out "$SCRATCH/$cn.csr" \
        -subj "/CN=$cn" 2>/dev/null
    openssl x509 -req -sha256 -days "$DAYS" -in "$SCRATCH/$cn.csr" \
        -CA "$CA_CERT" -CAkey "$CA_KEY" \
        -set_serial "0x$(openssl rand -hex 16)" -extfile "$ext" \
        -out "$dir/$base.pem" 2>/dev/null
    cp "$CA_CERT" "$dir/ca.pem"
    chmod 600 "$dir/$base.key"
    chmod 644 "$dir/$base.pem" "$dir/ca.pem"
    chmod 755 "$dir"
    # The key must be readable by the container user that loads it. As root
    # (Unraid) hand it over; otherwise say what is left to do rather than
    # leave a key a container cannot open.
    if [[ "$(id -u)" -eq 0 ]]; then
        chown "$owner:$owner" "$dir/$base.key"
    else
        echo "⚠ Not running as root: run  sudo chown $owner:$owner $dir/$base.key  so the container can read it" >&2
    fi
}

MYSQL_SANS=(mysql db intranet-mysql logbook-db localhost 127.0.0.1)
REDIS_SANS=(redis intranet-redis logbook-redis localhost 127.0.0.1)
if [[ ${#EXTRA_SANS[@]} -gt 0 ]]; then
    MYSQL_SANS+=("${EXTRA_SANS[@]}")
    REDIS_SANS+=("${EXTRA_SANS[@]}")
fi

issue "logbook-mysql" "$TLS_DIR/mysql" server "$MYSQL_UID" "${MYSQL_SANS[@]}"
issue "logbook-redis" "$TLS_DIR/redis" server "$REDIS_UID" "${REDIS_SANS[@]}"
issue "logbook-backend" "$TLS_DIR/backend" client "$BACKEND_UID"
issue "logbook-backup" "$TLS_DIR/backup" client 0

# Public copies of the server certificates, so the application can warn before
# they expire without ever seeing a server key.
cp "$TLS_DIR/mysql/server.pem" "$TLS_DIR/backend/mysql-server.pem"
cp "$TLS_DIR/redis/server.pem" "$TLS_DIR/backend/redis-server.pem"
chmod 644 "$TLS_DIR/backend/mysql-server.pem" "$TLS_DIR/backend/redis-server.pem"
for dir in mysql redis backend backup; do
    key="$TLS_DIR/$dir/server.key"
    [[ -f "$key" ]] || key="$TLS_DIR/$dir/client.key"
    cert="${key%.key}.pem"
    openssl verify -CAfile "$CA_CERT" "$cert" >/dev/null || die "$cert does not verify against the CA"
done

echo "✓ Server certificates: mysql, redis    ✓ Client certificates: backend, backup"
echo "✓ Valid for $DAYS days. Check expiry any time:  ./scripts/tls-setup.sh --check"
echo
echo "Next:"
echo "  1. Keep the CA private key ($CA_KEY) off this server's shared storage."
echo "  2. ./scripts/tls-setup.sh --print-env   (lines to add to .env)"
echo "  3. docker compose up -d                 (database and cache restart with TLS)"
