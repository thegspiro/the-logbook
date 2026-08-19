#!/usr/bin/env bash
#
# Install the shared libraries the backend needs at import time (currently
# libmagic, required by python-magic in backend/requirements.txt, which
# app/api/v1/endpoints/{documents,users,storefront,...}.py import for upload
# content-type sniffing).
#
# This exists because the bare form it replaces —
#
#     sudo apt-get update && sudo apt-get install -y libmagic1
#
# is an unbounded network operation with no timeout and no retry, run in six
# separate CI job instances. On 2026-08-19 it stalled for 19m26s on a single
# `noble-security InRelease` fetch and consumed the entire 20-minute budget of
# both `Backend Unit Tests` and `Backend Security Scan`. Because the
# integration and contract matrices sit behind `needs: backend-test`, they were
# then reported *skipped* rather than failed — so that merge reached main with
# no backend test having run and nothing red to react to. The same stall took
# out `Frontend E2E` via `playwright install --with-deps`, which shells out to
# the same apt machinery.
#
# Two defences, in order of preference:
#
#   1. Do nothing when the library is already loadable. The ubuntu-latest image
#      ships libmagic.so.1 (via `file` / `libmagic1t64`), so the apt call was
#      pure risk for no benefit.
#   2. When a library genuinely is missing, retry apt under ONE overall
#      deadline covering every attempt. A stalled mirror then costs four
#      minutes and either recovers or fails loudly, instead of costing the job
#      and silently skipping every job downstream of it.
#
# The presence check is on the SONAME, not the package name, and that is
# load-bearing. Ubuntu 24.04 (noble) renamed the package to `libmagic1t64` in
# the 64-bit-time_t transition, so `dpkg -s libmagic1` reports "not installed"
# on a runner that has the library — a package-name check would take the apt
# path every single time and defeat defence #1 entirely. python-magic resolves
# the library through ctypes.util.find_library("magic"), i.e. by soname, so the
# soname is also the thing that actually has to be true.

set -euo pipefail

# soname:candidate-packages. The soname is what gets checked; the packages are
# candidate names tried in order, and only when the soname is missing.
#
# Two names because noble's 64-bit-time_t transition renamed the package.
# `apt-get install libmagic1` does still succeed there — libmagic1 survives as a
# virtual package with exactly one provider, and apt resolves a single-provider
# virtual fine — but that is a coincidence of there being one provider, not a
# guarantee. Naming the real package first means the fallback does not rest on
# it. The classic name stays as the second candidate for non-noble images.
DEPENDENCIES=(
    "libmagic.so.1:libmagic1t64 libmagic1"
)

ldconfig_bin=$(command -v ldconfig || echo /sbin/ldconfig)

# `ldconfig -p` prints one tab-indented entry per line:
#     \tlibmagic.so.1 (libc6,x86-64) => /lib/x86_64-linux-gnu/libmagic.so.1
# Compare the first whitespace-delimited field exactly rather than substring-
# matching the line: the soname contains dots (regex wildcards), and the path
# on the right-hand side would also match a substring search, so a loose match
# is both over- and under-eager depending on the pattern used.
soname_present() {
    "$ldconfig_bin" -p 2>/dev/null | awk -v soname="$1" '$1 == soname { found = 1 } END { exit !found }'
}

# Pick the first candidate this release actually has a real version for.
# apt-cache reads the local package lists, so this costs nothing and needs no
# network. If none has a candidate (stale lists), fall back to the last name and
# let apt report a precise error rather than guessing here.
# Matched against the captured string rather than piped into `grep -q`. Under
# `set -o pipefail` that pipeline reports failure even on a match: grep exits at
# the first hit, apt-cache is killed by SIGPIPE, and the non-zero producer sets
# the pipeline's status — so every candidate looked unavailable and this always
# fell through to the last one.
resolve_package() {
    local candidate policy
    for candidate in "$@"; do
        policy=$(apt-cache policy "$candidate" 2>/dev/null || true)
        if [[ "$policy" == *"Candidate: "* && "$policy" != *"Candidate: (none)"* ]]; then
            echo "$candidate"
            return 0
        fi
    done
    echo "${@: -1}"
}

missing_packages=()
for dep in "${DEPENDENCIES[@]}"; do
    soname="${dep%%:*}"
    read -r -a candidates <<< "${dep#*:}"
    if soname_present "$soname"; then
        echo "Found ${soname} (provided by the runner image); no install needed."
    else
        package=$(resolve_package "${candidates[@]}")
        echo "Missing ${soname}; will install ${package}."
        missing_packages+=("$package")
    fi
done

if [ "${#missing_packages[@]}" -eq 0 ]; then
    echo "All required libraries already present. Skipping apt entirely."
    exit 0
fi

# The ENTIRE fallback is bounded by one deadline, not by a per-command timeout.
# Three attempts at 180s-per-command plus backoff totals ~18.75 minutes, which
# against a 20-minute job budget recreates precisely the exhaustion this script
# exists to prevent — the fallback would become the outage. One shared budget
# means the worst case is bounded no matter how the failures are distributed:
# either the library is installed within it or the job fails fast with a clear
# reason, which is the better outcome of the two.
total_budget=240
max_attempts=3
deadline=$(( $(date +%s) + total_budget ))

remaining_budget() {
    echo $(( deadline - $(date +%s) ))
}

# timeout(1) treats a duration of 0 as "no timeout at all", so a budget that has
# already run out must never be handed to it — that would restore the unbounded
# hang this whole script is about.
run_bounded() {
    local budget
    budget=$(remaining_budget)
    if [ "$budget" -le 0 ]; then
        echo "apt budget of ${total_budget}s is exhausted; not starting: $*"
        return 1
    fi
    timeout "$budget" "$@"
}

for attempt in $(seq 1 "$max_attempts"); do
    if run_bounded sudo apt-get update -o Acquire::Retries=3 \
        && run_bounded sudo apt-get install -y --no-install-recommends "${missing_packages[@]}"; then
        echo "Installed: ${missing_packages[*]}"
        exit 0
    fi

    backoff=$(( attempt * 10 ))
    budget=$(remaining_budget)
    if [ "$attempt" -ge "$max_attempts" ] || [ "$budget" -le "$backoff" ]; then
        break
    fi
    echo "apt attempt ${attempt}/${max_attempts} failed; ${budget}s of budget left," \
         "retrying in ${backoff}s."
    sleep "$backoff"
done

echo "::error::Failed to install system packages within ${total_budget}s: ${missing_packages[*]}"
exit 1
