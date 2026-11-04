#!/bin/sh
# Starts the API (uvicorn) and the web server (nginx) in one container and
# keeps the container alive only while both are.
#
# If either process exits, for any reason and with any status, the other is
# stopped and the container exits non-zero, so Docker's restart policy (or
# Unraid's) brings the pair back together. A container left running with only
# one half would answer health checks on one port and fail every request on
# the other, which is harder to notice than a restart.
#
# `docker stop` (SIGTERM) is forwarded to both and is the one path that exits 0.
#
# Database migrations are not run here. They run in the backend's own startup
# (main.py's lifespan), exactly as in the backend image, because uvicorn is
# started with the same application and the same arguments.

set -u

log() {
    printf '%s\n' "logbook-entrypoint: $*" >&2
}

API_HOST=127.0.0.1
API_PORT=3001
# Same default as the backend image's CMD. WEB_CONCURRENCY is the variable
# uvicorn itself documents for the worker count.
WORKERS="${WEB_CONCURRENCY:-4}"

# Whose X-Forwarded-For uvicorn believes. nginx in this container always is.
# A reverse proxy in front of the container (SWAG, Nginx Proxy Manager, a load
# balancer) is named the same way the backend image names it, in
# TRUSTED_PROXY_IPS; without it, the client address the API records is the
# proxy's. Never "*": that lets any client choose its own address and walk
# around rate limits and IP blocks.
FORWARDED_ALLOW="127.0.0.1"
if [ -n "${TRUSTED_PROXY_IPS:-}" ]; then
    case "$TRUSTED_PROXY_IPS" in
        *'*'*)
            log "TRUSTED_PROXY_IPS must list addresses or ranges, not '*'"
            exit 1
            ;;
    esac
    FORWARDED_ALLOW="127.0.0.1,${TRUSTED_PROXY_IPS}"
fi

# A bind mount Docker had to create itself is owned by root, and the backend
# runs as uid 1000, so the first upload would fail long after startup with an
# error that does not name the directory. Refuse to start instead.
for dir in /app/uploads /app/logs; do
    if [ -d "$dir" ] && [ ! -w "$dir" ]; then
        log "$dir is not writable by uid $(id -u). On the host, run:"
        log "  chown -R $(id -u):$(id -g) <the folder mapped to $dir>"
        exit 1
    fi
done

# nginx's pid file and temp directories. Recreated in case /tmp is a fresh
# tmpfs (a read-only root filesystem with --tmpfs /tmp).
mkdir -p /tmp/nginx || exit 1

cd /app || exit 1

api_pid=
web_pid=
stopping=0
stop_both() {
    [ -n "$api_pid" ] && kill -TERM "$api_pid" 2>/dev/null
    # QUIT is nginx's graceful shutdown; TERM drops open connections.
    [ -n "$web_pid" ] && kill -QUIT "$web_pid" 2>/dev/null
    return 0
}
# Installed before either process starts: as PID 1 the shell ignores a
# SIGTERM it has no handler for, and `docker stop` would wait out its timeout.
trap 'stopping=1; stop_both' TERM INT

uvicorn main:app \
    --host "$API_HOST" \
    --port "$API_PORT" \
    --workers "$WORKERS" \
    --proxy-headers \
    --forwarded-allow-ips "$FORWARDED_ALLOW" &
api_pid=$!

nginx -g 'daemon off;' &
web_pid=$!

# A stop that arrived while the two were being started.
[ "$stopping" -eq 1 ] && stop_both

# POSIX `wait` cannot wait for "whichever exits first", so poll. Sleeping in
# the background and waiting on it lets a trapped signal interrupt the wait
# at once instead of after the sleep.
while kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
    sleep 1 &
    wait $! 2>/dev/null
done

if [ "$stopping" -eq 0 ]; then
    if kill -0 "$api_pid" 2>/dev/null; then
        log "nginx exited; stopping the API"
    else
        log "the API exited; stopping nginx"
    fi
    stop_both
fi

wait "$api_pid" 2>/dev/null
api_status=$?
wait "$web_pid" 2>/dev/null
web_status=$?

if [ "$stopping" -eq 1 ]; then
    exit 0
fi

log "exit status: api=$api_status web=$web_status"
# Neither process is meant to exit on its own, so even a clean 0 from one of
# them is a failure of the container.
if [ "$api_status" -ne 0 ]; then
    exit "$api_status"
fi
if [ "$web_status" -ne 0 ]; then
    exit "$web_status"
fi
exit 1
