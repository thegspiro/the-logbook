#!/bin/sh
# Wraps the Redis image's entrypoint so Redis also listens for TLS on port 6380
# when certificates have been mounted, and starts exactly as it always did when
# they have not. Create the certificates with scripts/tls-setup.sh.
#
#   entrypoint: ["sh", "/tls-entrypoint.sh"]
#   volumes:    ./tls/redis:/etc/redis/tls:ro
#
# The plaintext port (6379) is left open and client certificates are optional
# unless REDIS_REQUIRE_TLS=true, which closes the plaintext port (port 0) and
# requires every TLS client to present a certificate from the CA. Redis then
# also listens on a unix socket inside the container, which only the health
# check uses (infrastructure/redis/healthcheck.sh): it has no certificate to
# present. Switch it on with scripts/tls-enforce.sh, which first lists any
# client still connecting without TLS.
#
# The key is checked as the redis user (root in the hardened container has no
# DAC_OVERRIDE). If it is not readable Redis starts WITHOUT TLS and says so,
# except under REDIS_REQUIRE_TLS=true, where it refuses to start instead: with
# the plaintext port closed and no TLS there would be nothing to connect to.

TLS_DIR="${REDIS_TLS_DIR:-/etc/redis/tls}"
TLS_PORT="${REDIS_TLS_PORT:-6380}"
SOCKET="${REDIS_HEALTH_SOCKET:-/tmp/redis-health.sock}"

case "${REDIS_REQUIRE_TLS:-false}" in
    true|TRUE|True|1|yes|on) REQUIRE_TLS=1; AUTH_CLIENTS=yes ;;
    *) REQUIRE_TLS=0; AUTH_CLIENTS=optional ;;
esac

tls_unavailable() {
    if [ "$REQUIRE_TLS" = "1" ]; then
        echo "[tls] ERROR: REDIS_REQUIRE_TLS=true but TLS cannot be offered: $1" >&2
        echo "[tls] Refusing to start. Fix the certificates (scripts/tls-setup.sh) or set REDIS_REQUIRE_TLS=false." >&2
        exit 1
    fi
}

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
                --tls-auth-clients "$AUTH_CLIENTS" \
                --tls-protocols "TLSv1.2 TLSv1.3"
            if [ "$REQUIRE_TLS" = "1" ]; then
                echo "[tls] REDIS_REQUIRE_TLS=true: plaintext port closed, client certificates required" >&2
                set -- "$@" \
                    --port 0 \
                    --unixsocket "$SOCKET" \
                    --unixsocketperm 700
            fi
        else
            tls_unavailable "command is not redis-server ($1)"
            echo "[tls] WARNING: command is not redis-server ($1); TLS flags not added" >&2
        fi
    else
        tls_unavailable "$TLS_DIR is incomplete or unreadable:$missing"
        echo "[tls] WARNING: $TLS_DIR is incomplete or unreadable:$missing. Starting WITHOUT TLS." >&2
    fi
else
    tls_unavailable "no certificates in $TLS_DIR"
fi

exec docker-entrypoint.sh "$@"
