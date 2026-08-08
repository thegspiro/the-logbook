#!/usr/bin/env bash
#
# Verify (and optionally repair) the `build:` stanzas in a Compose file.
#
# WHY THIS EXISTS
# ---------------
# `docker compose config --quiet` validates YAML and interpolation only. It
# does NOT check that a service's build context actually contains the files its
# Dockerfile copies, so a Dockerfile whose context requirements change lands as
# a build failure on every deployment whose compose file was not updated in the
# same pull.
#
# That is not hypothetical: commit 2c93c7c moved the frontend context from
# ./frontend to the repository root (the npm workspace lockfile lives at the
# root and `npm ci` cannot run without it). Every self-hosted deployment
# carrying its own customized compose file — where copying the shipped template
# over it would destroy local volume paths and service names — broke on
# `"/frontend/nginx.conf": not found` until the context was corrected by hand.
#
# This script closes that gap: it reads each Dockerfile's COPY/ADD sources and
# confirms they resolve inside the declared context. With --fix it walks up the
# directory tree for a context that does satisfy them and rewrites the compose
# file in place (after a timestamped backup), which is what an unattended
# updater wants to run before it touches a running stack.
#
# USAGE
#   sync-compose-build-context.sh [--fix] [-f FILE]... [--project-directory DIR]
#
#     -f FILE   Compose file to inspect (repeatable). Default: docker-compose.yml
#     --fix     Rewrite context:/dockerfile: in place instead of only reporting.
#     --project-directory DIR
#               Base for relative contexts. Defaults, like Compose itself, to
#               the directory holding the compose file. Needed for the unraid
#               templates, which are written to be copied to the repository
#               root before use and so resolve against it, not ./unraid.
#
# EXIT STATUS
#   0  every build context satisfies its Dockerfile (or --fix repaired them)
#   1  drift found and not repaired, or a Dockerfile is missing
#   2  usage error
#
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[FAIL]${NC}  $*" >&2; }

FIX=""
PROJECT_DIR=""
FILES=()

while [ $# -gt 0 ]; do
    case "$1" in
        --fix) FIX=1; shift ;;
        -f) [ $# -ge 2 ] || { err "-f needs a file argument"; exit 2; }
            FILES+=("$2"); shift 2 ;;
        --project-directory) [ $# -ge 2 ] || { err "--project-directory needs a directory"; exit 2; }
            PROJECT_DIR="$2"; shift 2 ;;
        -h|--help) sed -n '3,41p' "$0"; exit 0 ;;
        *) err "Unknown argument: $1"; exit 2 ;;
    esac
done

[ ${#FILES[@]} -gt 0 ] || FILES=("docker-compose.yml")

# How far up the tree to look for a context that satisfies the Dockerfile.
# The repository root is one level above ./frontend and ./backend; 4 leaves
# room for deeper layouts without ever escaping to /.
MAX_ASCENT=4

# ---------------------------------------------------------------------------
# Parse the build stanzas out of a compose file.
#
# Emits one record per service that has a `build:` section, fields separated by
# ASCII US (0x1f) rather than TAB: TAB is IFS whitespace, so bash `read` would
# collapse the empty dockerfile field of a stanza that omits the key.
#
#   service US form US ctx_line US ctx US df_line US df US build_indent
#
# form is "long" (a build: mapping) or "short" (build: ./dir, which has nowhere
# to put a dockerfile path and so can be checked but not repaired). Line numbers
# are 1-indexed; df_line is 0 when the key is absent and Docker defaults it to
# "Dockerfile".
# ---------------------------------------------------------------------------
US=$'\037'

parse_build_blocks() {
    awk -v US="$US" '
        function indent_of(s,   n) { n = match(s, /[^ ]/); return (n == 0 ? -1 : n - 1) }
        function strip(v) {
            sub(/[ \t]*#.*$/, "", v)          # trailing comment
            gsub(/^[ \t]+|[ \t]+$/, "", v)
            gsub(/^["'"'"']|["'"'"']$/, "", v) # surrounding quotes
            return v
        }
        function flush() {
            if (svc != "" && ctx_line > 0)
                printf "%s%s%s%s%d%s%s%s%d%s%s%s%d\n", \
                    svc, US, form, US, ctx_line, US, ctx, US, df_line, US, df, US, bi
            svc = ""; ctx_line = 0; df_line = 0; ctx = ""; df = ""; form = "long"
        }
        BEGIN { form = "long" }
        /^[ \t]*(#|$)/ { next }
        {
            ind = indent_of($0)
            key = $0; sub(/^[ \t]*/, "", key); sub(/:.*$/, "", key)
            val = $0; sub(/^[^:]*:/, "", val); val = strip(val)

            if (ind == 0) { flush(); in_services = (key == "services"); si = -1; next }
            if (!in_services) next

            if (si < 0) si = ind
            if (ind == si) { flush(); svc = key; in_build = 0; bi = -1; next }
            if (svc == "") next

            if (in_build && ind <= bi) in_build = 0

            if (!in_build && key == "build") {
                bi = ind
                if (val != "") { form = "short"; ctx_line = NR; ctx = val; next }
                in_build = 1; next
            }
            if (in_build && key == "context")    { ctx_line = NR; ctx = val }
            if (in_build && key == "dockerfile") { df_line  = NR; df  = val }
        }
        END { flush() }
    ' "$1"
}

# COPY/ADD sources a Dockerfile reads from the build context. Sources pulled
# from an earlier stage (--from=) never touch the context, so they are skipped.
dockerfile_copy_sources() {
    awk '
        { line = $0; sub(/\r$/, "", line) }
        cont { buf = buf " " line; cont = 0 }
        !cont && buf == "" { buf = line }
        buf ~ /\\[ \t]*$/ { sub(/\\[ \t]*$/, "", buf); cont = 1; next }
        {
            gsub(/^[ \t]+|[ \t]+$/, "", buf)
            if (toupper(buf) ~ /^(COPY|ADD)[ \t]/ && buf !~ /--from=/ && buf !~ /\[/) {
                n = split(buf, a, /[ \t]+/)
                for (i = 2; i <= n - 1; i++) {
                    if (a[i] ~ /^--/) continue
                    print a[i]
                }
            }
            buf = ""
        }
    ' "$1"
}

# A source is satisfied if it resolves under the context. Leading "/" in a COPY
# source means the context root, not the host root, and globs are legal.
source_satisfied() {
    local ctx="$1" src="$2"
    src="${src#/}"
    src="${src#./}"
    src="${src%/}"   # a trailing slash marks a directory, it is not part of the name
    [ -n "$src" ] || return 0
    local target="$ctx/$src"
    [ -e "$target" ] && return 0
    # compgen -G reports success for any pattern ending in "/" whether or not it
    # matches, so it is only consulted for sources that really are globs.
    case "$src" in
        *[\*\?\[]*) compgen -G "$target" >/dev/null 2>&1 ;;
        *) return 1 ;;
    esac
}

context_satisfies() {
    local ctx="$1" dockerfile="$2" src
    [ -d "$ctx" ] || return 1
    while IFS= read -r src; do
        [ -n "$src" ] || continue
        source_satisfied "$ctx" "$src" || return 1
    done < <(dockerfile_copy_sources "$dockerfile")
    return 0
}

abspath() {
    local p="$1"
    case "$p" in
        /*) ;;
        *) p="$2/$p" ;;
    esac
    # Resolve without requiring the path to exist (Unraid has no realpath -m
    # on every install path, and cd -P is enough for directories that do).
    while [ "$p" != "${p//\/.\//\/}" ]; do p="${p//\/.\//\/}"; done
    if [ -d "$p" ]; then (cd "$p" && pwd -P); else echo "$p"; fi
}

relpath_under() {
    # Print $2 relative to $1, or nothing if it is not underneath.
    local base="$1" target="$2"
    case "$target" in
        "$base"/*) echo "${target#"$base"/}" ;;
        *) echo "" ;;
    esac
}

STATUS=0

for compose in "${FILES[@]}"; do
    if [ ! -f "$compose" ]; then
        err "$compose does not exist"
        STATUS=1
        continue
    fi

    if [ -n "$PROJECT_DIR" ]; then
        compose_dir="$(cd "$PROJECT_DIR" && pwd -P)"
    else
        compose_dir="$(cd "$(dirname "$compose")" && pwd -P)"
    fi
    echo "== $compose"

    # Pending rewrites as "line US text". Replacements are applied first, then
    # insertions in reverse line order, so adding a dockerfile key never shifts
    # a line number captured earlier.
    edits=()
    inserts=()

    while IFS="$US" read -r svc form ctx_line ctx df_line df bi; do
        [ -n "$svc" ] || continue

        ctx_abs="$(abspath "$ctx" "$compose_dir")"
        df_rel="${df:-Dockerfile}"
        df_abs="$(abspath "$df_rel" "$ctx_abs")"

        if [ ! -f "$df_abs" ]; then
            err "$svc: dockerfile not found at $df_abs"
            STATUS=1
            continue
        fi

        if context_satisfies "$ctx_abs" "$df_abs"; then
            info "$svc: context $ctx_abs satisfies $(basename "$df_abs")"
            continue
        fi

        # Multi-stage Dockerfiles repeat the same COPY in several stages, so
        # report each unsatisfied source once.
        missing="$(while IFS= read -r s; do
            [ -n "$s" ] || continue
            source_satisfied "$ctx_abs" "$s" || printf '%s\n' "$s"
        done < <(dockerfile_copy_sources "$df_abs") | awk '!seen[$0]++' | tr '\n' ' ')"

        err "$svc: context $ctx_abs is missing: ${missing% }"

        # Look for an ancestor that does satisfy the Dockerfile.
        candidate="$ctx_abs"
        fixed=""
        for ((up = 0; up < MAX_ASCENT; up++)); do
            candidate="$(dirname "$candidate")"
            [ "$candidate" != "/" ] || break
            if context_satisfies "$candidate" "$df_abs"; then
                fixed="$candidate"
                break
            fi
        done

        if [ -z "$fixed" ]; then
            err "$svc: no parent directory satisfies it — fix the compose file by hand"
            STATUS=1
            continue
        fi

        new_df="$(relpath_under "$fixed" "$df_abs")"
        if [ -z "$new_df" ]; then
            err "$svc: $df_abs is outside $fixed — fix the compose file by hand"
            STATUS=1
            continue
        fi

        if [ "$form" = "short" ]; then
            err "$svc: uses short-form \`build: $ctx\`, which cannot carry a dockerfile path."
            err "$svc: rewrite it by hand as context: $fixed / dockerfile: $new_df"
            STATUS=1
            continue
        fi

        if [ -z "$FIX" ]; then
            err "$svc: should be context: $fixed / dockerfile: $new_df (re-run with --fix)"
            STATUS=1
            continue
        fi

        ctx_indent="$(printf '%*s' "$((bi + 2))" '')"
        edits+=("$ctx_line$US${ctx_indent}context: $fixed")
        if [ "$df_line" -gt 0 ]; then
            edits+=("$df_line$US${ctx_indent}dockerfile: $new_df")
        else
            inserts+=("$ctx_line$US${ctx_indent}dockerfile: $new_df")
        fi
        warn "$svc: rewriting to context: $fixed / dockerfile: $new_df"
    done < <(parse_build_blocks "$compose")

    if [ ${#edits[@]} -eq 0 ] && [ ${#inserts[@]} -eq 0 ]; then
        continue
    fi

    backup="$compose.bak.$(date +%Y%m%d_%H%M%S)"
    cp "$compose" "$backup"
    info "backed up $compose -> $backup"

    for e in ${edits[@]+"${edits[@]}"}; do
        ln="${e%%"$US"*}"; text="${e#*"$US"}"
        awk -v n="$ln" -v t="$text" 'NR == n { print t; next } { print }' \
            "$compose" > "$compose.tmp" && mv "$compose.tmp" "$compose"
    done
    # Reverse order keeps earlier line numbers valid as lines are added.
    for ((i = ${#inserts[@]} - 1; i >= 0; i--)); do
        ln="${inserts[$i]%%"$US"*}"; text="${inserts[$i]#*"$US"}"
        awk -v n="$ln" -v t="$text" '{ print } NR == n { print t }' \
            "$compose" > "$compose.tmp" && mv "$compose.tmp" "$compose"
    done

    # Only roll back a rewrite that actually broke the file. A compose file can
    # fail validation for reasons this script never touched (an unset required
    # variable, a schema violation elsewhere); restoring in that case would undo
    # a correct fix and leave the deployment broken for the original reason.
    if command -v docker >/dev/null 2>&1; then
        if docker compose -f "$compose" config --quiet >/dev/null 2>&1; then
            info "$compose still parses after the rewrite"
        elif ! docker compose -f "$backup" config --quiet >/dev/null 2>&1; then
            warn "$compose does not validate — but neither did it before the rewrite."
            warn "Keeping the corrected build stanzas; fix the unrelated error separately."
        else
            err "$compose no longer parses — restoring $backup"
            cp "$backup" "$compose"
            STATUS=1
        fi
    fi
done

exit "$STATUS"
