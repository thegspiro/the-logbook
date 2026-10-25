#!/bin/sh
# Wraps the MySQL / MariaDB image's entrypoint so the server offers TLS when
# certificates have been mounted, and starts exactly as it always did when they
# have not. Create the certificates with scripts/tls-setup.sh.
#
#   entrypoint: ["sh", "/tls-entrypoint.sh"]
#   volumes:    ./tls/mysql:/etc/mysql/tls:ro
#
# Plaintext connections are accepted unless DB_REQUIRE_TLS=true, which adds
# --require-secure-transport=ON: every TCP connection must then be encrypted.
# Connections over the container's own unix socket (the health check, and
# `docker exec ... mysqldump` in scripts/backup.sh) are exempt by the server's
# definition, so they keep working. Switch it on with scripts/tls-enforce.sh,
# which first lists any client still connecting without TLS.
#
# The server key must be readable by the database user. That is checked as that
# user, because root inside the container has no DAC_OVERRIDE in the hardened
# compose files. If it is not readable the server starts WITHOUT TLS and says so,
# rather than crash-looping the database over a file permission. The exception
# is DB_REQUIRE_TLS=true: a server that was told to refuse plaintext and cannot
# offer TLS would be an outage either way, so it refuses to start and says why
# instead of silently dropping the requirement.

TLS_DIR="${DB_TLS_DIR:-/etc/mysql/tls}"

case "${DB_REQUIRE_TLS:-false}" in
    true|TRUE|True|1|yes|on) REQUIRE_TLS=1 ;;
    *) REQUIRE_TLS=0 ;;
esac

tls_unavailable() {
    if [ "$REQUIRE_TLS" = "1" ]; then
        echo "[tls] ERROR: DB_REQUIRE_TLS=true but TLS cannot be offered: $1" >&2
        echo "[tls] Refusing to start. Fix the certificates (scripts/tls-setup.sh) or set DB_REQUIRE_TLS=false." >&2
        exit 1
    fi
}

readable_by_server() {
    if [ "$(id -u)" = "0" ] && command -v gosu >/dev/null 2>&1; then
        gosu mysql test -r "$1"
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
            missing="$missing $f(not readable by the database user; chown 999)"
        fi
    done
    if [ -z "$missing" ]; then
        echo "[tls] certificates found in $TLS_DIR: starting with TLS 1.2/1.3 enabled" >&2
        set -- "$@" \
            "--ssl-ca=$TLS_DIR/ca.pem" \
            "--ssl-cert=$TLS_DIR/server.pem" \
            "--ssl-key=$TLS_DIR/server.key" \
            "--tls-version=TLSv1.2,TLSv1.3"
        if [ "$REQUIRE_TLS" = "1" ]; then
            echo "[tls] DB_REQUIRE_TLS=true: refusing unencrypted TCP connections" >&2
            set -- "$@" "--require-secure-transport=ON"
        fi
    else
        tls_unavailable "$TLS_DIR is incomplete or unreadable:$missing"
        echo "[tls] WARNING: $TLS_DIR is incomplete or unreadable:$missing. Starting WITHOUT TLS." >&2
    fi
else
    tls_unavailable "no certificates in $TLS_DIR"
fi

exec docker-entrypoint.sh "$@"
