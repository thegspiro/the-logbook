#!/bin/bash
# ============================================
# THE LOGBOOK - IS IT SAFE TO REFUSE PLAINTEXT?
# ============================================
# Run before switching DB_REQUIRE_TLS / REDIS_REQUIRE_TLS on. It changes nothing:
# it asks the RUNNING database and Redis containers two questions and prints the
# .env lines for each service that passes.
#
#   ./scripts/tls-enforce.sh
#   ./scripts/tls-enforce.sh --db-container logbook-db --redis-container logbook-redis
#
# 1. Is the service actually serving the certificates from scripts/tls-setup.sh?
#    Refusing plaintext on a server that cannot do TLS would leave nothing to
#    connect to, and the wrapper refuses to start in that case.
# 2. Is anything still connected without TLS? Whatever it is (an old backup job,
#    a script, a second copy of the backend started before DB_SSL was set) stops
#    working at the switch, so it is listed by user and address.
#
# Connections over a container's own unix socket are not clients to worry about:
# the health checks and `docker exec ... mysqldump` use them, and the switch
# leaves them alone.
#
# Options:
#   --db-container NAME     default: intranet-mysql or logbook-db, whichever runs
#   --redis-container NAME  default: intranet-redis or logbook-redis
#   --skip-db / --skip-redis
#   --no-audit              do not require the plaintext-client list to be
#                           readable (MariaDB cannot show per-connection TLS);
#                           the certificate check still applies
#
# Exit status: 0 when every checked service is safe to switch, 1 otherwise.
# ============================================

set -uo pipefail

DB_CONTAINER=""
REDIS_CONTAINER=""
SKIP_DB=false
SKIP_REDIS=false
NO_AUDIT=false
TLS_PORT="${REDIS_TLS_PORT:-6380}"

die() {
    echo "✗ $*" >&2
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --db-container) DB_CONTAINER="${2:?--db-container needs a name}"; shift 2 ;;
        --redis-container) REDIS_CONTAINER="${2:?--redis-container needs a name}"; shift 2 ;;
        --skip-db) SKIP_DB=true; shift ;;
        --skip-redis) SKIP_REDIS=true; shift ;;
        --no-audit) NO_AUDIT=true; shift ;;
        -h|--help) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "Unknown option: $1" ;;
    esac
done

command -v docker >/dev/null 2>&1 || die "docker is required"

running=" $(docker ps --format '{{.Names}}' 2>/dev/null | tr '\n' ' ') "

pick() {
    local given="$1"
    shift
    if [[ -n "$given" ]]; then
        echo "$given"
        return
    fi
    local name
    for name in "$@"; do
        if [[ "$running" == *" $name "* ]]; then
            echo "$name"
            return
        fi
    done
}

status=0
env_lines=()

# ----------------------------------------------------------------- database
check_db() {
    local c
    c="$(pick "$DB_CONTAINER" intranet-mysql logbook-db)"
    if [[ -z "$c" ]]; then
        echo "✗ Database: no running container found (pass --db-container NAME)"
        return 1
    fi
    echo "Database ($c)"

    local sql_cert
    sql_cert="$(docker exec "$c" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -B -e "SELECT @@global.ssl_cert" 2>/dev/null; echo "${DB_TLS_DIR:-/etc/mysql/tls}/server.pem"' 2>/dev/null)"
    local served expected
    served="$(echo "$sql_cert" | sed -n 1p)"
    expected="$(echo "$sql_cert" | sed -n 2p)"
    if [[ -z "$expected" || "$served" != "$expected" ]]; then
        echo "  ✗ The server is not using the certificates from scripts/tls-setup.sh"
        echo "    (serving: ${served:-nothing readable}, expected: ${expected:-unknown})."
        echo "    Create them, mount them, recreate the container, then run this again."
        return 1
    fi
    echo "  ✓ Serving $served"

    local sql="SELECT p.user, p.host FROM performance_schema.threads t \
JOIN sys.session_ssl_status s ON s.thread_id = t.thread_id \
JOIN information_schema.processlist p ON p.id = t.processlist_id \
WHERE (s.ssl_version IS NULL OR s.ssl_version = '') AND p.host <> 'localhost'"
    local plain
    if ! plain="$(docker exec -e AUDIT_SQL="$sql" "$c" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -B -e "$AUDIT_SQL"' 2>/dev/null)"; then
        if [[ "$NO_AUDIT" == "true" ]]; then
            echo "  ! Cannot list connections without TLS on this server; continuing because of --no-audit."
            env_lines+=("DB_REQUIRE_TLS=true")
            return 0
        fi
        echo "  ✗ Cannot list connections without TLS (MariaDB does not expose it)."
        echo "    Check the backend, the backup job and any scripts by hand, then pass --no-audit."
        return 1
    fi
    if [[ -n "$plain" ]]; then
        echo "  ✗ Connected without TLS right now (these will be refused):"
        echo "$plain" | sed 's/^/      /'
        return 1
    fi
    echo "  ✓ No connection is using plaintext"
    env_lines+=("DB_REQUIRE_TLS=true")
}

# -------------------------------------------------------------------- redis
check_redis() {
    local c
    c="$(pick "$REDIS_CONTAINER" intranet-redis logbook-redis)"
    if [[ -z "$c" ]]; then
        echo "✗ Redis: no running container found (pass --redis-container NAME)"
        return 1
    fi
    echo "Redis ($c)"

    local out
    if ! out="$(docker exec "$c" sh -c 'printf "CLIENT ID\nCONFIG GET tls-port\nCLIENT LIST\n" | REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli' 2>/dev/null)" || [[ -z "$out" ]]; then
        echo "  ✗ Cannot query Redis on its plaintext port. If it is already enforcing TLS this"
        echo "    check is no longer needed; otherwise make sure the container is healthy."
        return 1
    fi
    local own port
    own="$(echo "$out" | sed -n 1p)"
    port="$(echo "$out" | sed -n 3p)"
    if [[ ! "$port" =~ ^[0-9]+$ || "$port" -eq 0 ]]; then
        echo "  ✗ Redis is not listening for TLS (tls-port: ${port:-unknown}). Mount the certificates,"
        echo "    recreate the container, then run this again."
        return 1
    fi
    echo "  ✓ Listening for TLS on $port"

    local plain
    plain="$(echo "$out" | tail -n +4 | awk -v own="$own" -v tls="$port" '
        {
            id = ""; laddr = ""; addr = ""; name = ""
            for (i = 1; i <= NF; i++) {
                split($i, kv, "=")
                if (kv[1] == "id") id = kv[2]
                else if (kv[1] == "laddr") laddr = kv[2]
                else if (kv[1] == "addr") addr = kv[2]
                else if (kv[1] == "name") name = kv[2]
            }
            if (id == "" || id == own || laddr == "" || substr(laddr, 1, 1) == "/") next
            n = split(laddr, p, ":")
            if (p[n] != tls) print "client " addr (name != "" ? " (" name ")" : "")
        }')"
    if [[ -n "$plain" ]]; then
        echo "  ✗ Connected without TLS right now (these will be refused):"
        echo "$plain" | sed 's/^/      /'
        return 1
    fi
    echo "  ✓ No connection is using plaintext"
    env_lines+=("REDIS_REQUIRE_TLS=true")
}

if [[ "$SKIP_DB" != "true" ]]; then
    check_db || status=1
    echo
fi
if [[ "$SKIP_REDIS" != "true" ]]; then
    check_redis || status=1
    echo
fi

if [[ ${#env_lines[@]} -gt 0 ]]; then
    echo "Safe to switch. Add to .env, then recreate the service(s) (docker compose up -d):"
    printf '  %s\n' "${env_lines[@]}"
    echo
    echo "Keep the CA key and a copy of tls/ safe: with enforcement on, an expired or"
    echo "missing certificate means the application cannot reach its database."
fi
if [[ "$status" -ne 0 ]]; then
    echo "Not everything is ready; nothing above marked ✗ has been switched."
fi
exit "$status"
