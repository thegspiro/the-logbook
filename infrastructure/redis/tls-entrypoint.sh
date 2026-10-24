#!/bin/sh
# Wraps the Redis image's entrypoint so Redis also listens for TLS on port 6380
# when certificates have been mounted, and starts exactly as it always did when
# they have not. Create the certificates with scripts/tls-setup.sh.
#
#   entrypoint: ["sh", "/tls-entrypoint.sh"]
#   volumes:    ./tls/redis:/etc/redis/tls:ro
#
# The plaintext port (6379) is left open: this step only makes encrypted,
# verified connections possible, and client certificates are optional. Closing
# the plaintext port and requiring a client certificate are a separate switch.
#
# The key is checked as the redis user (root in the hardened container has no
# DAC_OVERRIDE). If it is not readable Redis starts WITHOUT TLS and says so.

TLS_DIR="${REDIS_TLS_DIR:-/etc/redis/tls}"
TLS_PORT="${REDIS_TLS_PORT:-6380}"

readable_by_server() {
    if [ "$(id -u)" = "0" ] && command -v su-exec >/dev/null 2>&1; then
        su-exec redis test -r "$1"
    else
        test -r "$1"
    fi
}

if [ -f "$TLS_DIR/server.pem" ] || [ -f "$TLS_DIR/server.key" ] || [ -f "$TLS_DIR/ca.pem" ]; then
    missing=""
    for f in ca.pem server.pem server.key; do
        if [ ! -f "$TLS_DIR/$f" ]; then
            missing="$missing $f(missing)"
        elif ! readable_by_server "$TLS_DIR/$f"; then
            missing="$missing $f(not readable by the redis user; chown 999)"
        fi
    done
    if [ -z "$missing" ]; then
        echo "[tls] certificates found in $TLS_DIR: also listening for TLS on port $TLS_PORT" >&2
        if [ "$1" = "redis-server" ]; then
            set -- "$@" \
                --tls-port "$TLS_PORT" \
                --tls-cert-file "$TLS_DIR/server.pem" \
                --tls-key-file "$TLS_DIR/server.key" \
                --tls-ca-cert-file "$TLS_DIR/ca.pem" \
                --tls-auth-clients optional \
                --tls-protocols "TLSv1.2 TLSv1.3"
        else
            echo "[tls] WARNING: command is not redis-server ($1); TLS flags not added" >&2
        fi
    else
        echo "[tls] WARNING: $TLS_DIR is incomplete or unreadable:$missing. Starting WITHOUT TLS." >&2
    fi
fi

exec docker-entrypoint.sh "$@"
