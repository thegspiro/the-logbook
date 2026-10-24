#!/bin/sh
# Wraps the MySQL / MariaDB image's entrypoint so the server offers TLS when
# certificates have been mounted, and starts exactly as it always did when they
# have not. Create the certificates with scripts/tls-setup.sh.
#
#   entrypoint: ["sh", "/tls-entrypoint.sh"]
#   volumes:    ./tls/mysql:/etc/mysql/tls:ro
#
# Plaintext connections are still accepted: this step only makes encrypted,
# verified connections possible. Refusing plaintext is a separate switch.
#
# The server key must be readable by the database user. That is checked as that
# user, because root inside the container has no DAC_OVERRIDE in the hardened
# compose files. If it is not readable the server starts WITHOUT TLS and says so,
# rather than crash-looping the database over a file permission.

TLS_DIR="${DB_TLS_DIR:-/etc/mysql/tls}"

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
    else
        echo "[tls] WARNING: $TLS_DIR is incomplete or unreadable:$missing. Starting WITHOUT TLS." >&2
    fi
fi

exec docker-entrypoint.sh "$@"
