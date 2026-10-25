#!/bin/sh
# Redis health check. Uses the password from the container's environment, so no
# secret appears in the compose file or on a command line another user can read
# (REDISCLI_AUTH is read by redis-cli instead of -a).
#
# With REDIS_REQUIRE_TLS=true the plaintext port is closed and every TLS client
# needs a certificate, so the check goes through the unix socket that
# tls-entrypoint.sh opens for exactly this purpose. The socket belongs to the
# redis user and root has no DAC_OVERRIDE in the hardened container, so the
# check runs as that user.

if [ -n "${REDIS_PASSWORD:-}" ]; then
    REDISCLI_AUTH="$REDIS_PASSWORD"
    export REDISCLI_AUTH
fi

case "${REDIS_REQUIRE_TLS:-false}" in
    true|TRUE|True|1|yes|on)
        socket="${REDIS_HEALTH_SOCKET:-/tmp/redis-health.sock}"
        if [ "$(id -u)" = "0" ] && command -v su-exec >/dev/null 2>&1; then
            reply="$(su-exec redis redis-cli -s "$socket" ping 2>/dev/null)"
        else
            reply="$(redis-cli -s "$socket" ping 2>/dev/null)"
        fi
        ;;
    *)
        reply="$(redis-cli ping 2>/dev/null)"
        ;;
esac

[ "$reply" = "PONG" ]
