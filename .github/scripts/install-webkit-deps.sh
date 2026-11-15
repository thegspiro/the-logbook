#!/usr/bin/env bash
#
# Install the system libraries Playwright's WebKit links against, falling back
# from the runner's Azure Ubuntu mirror to archive.ubuntu.com when that mirror
# stops serving packages.
#
# Why: on 2026-11-11, from about 13:30 to 16:53 UTC, azure.archive.ubuntu.com
# answered the package list but not the packages. `playwright install-deps
# webkit` fetches ~180 .debs, and every fetch logged
#
#     Ign:N http://azure.archive.ubuntu.com/ubuntu noble/... <package>
#
# about 20 seconds apart, so the step's 20-minute timeout expired before apt
# reached the end of the list. Every Mobile Safari shard on every open pull
# request failed that way, before a single test ran, for three and a half
# hours. The apt cache in ci.yml cannot help on a miss, and re-running the job
# only repeats the stall.
#
# What this does instead:
#
#   1. Run the install as ci.yml always has, and watch its output. A healthy
#      install logs no `Ign:` lines for package fetches. STALL_THRESHOLD of
#      them naming the Azure mirror is the outage's signature, and the attempt
#      is stopped there rather than left to drain the budget.
#   2. Point apt at archive.ubuntu.com, by rewriting the Azure hostname in the
#      runner's apt sources, and run the install once more. Playwright's
#      install runs `apt-get update` before `apt-get install`, so the retry
#      reads the new source.
#
# A failure of attempt 1 for any other reason also takes the fallback: it costs
# one retry, and a mirror fault that presents differently next time is still
# covered.
#
# Both attempts share ONE deadline (TOTAL_BUDGET), set under the step's own
# `timeout-minutes`, for the reason install-system-deps.sh gives: a budget per
# attempt would let the retries together outlast the step, and the step would
# then die with no message saying why. This way the job fails with a line that
# names the cause.
#
# The install runs in its own process group, and a stopped attempt is killed
# by group, through sudo. Playwright runs apt-get as root under sudo, so
# killing only the `npx` process would leave a root apt-get holding the apt
# locks, and the retry would then fail on the lock instead of on the mirror.
#
# Overridable through the environment, so scripts/test_install_webkit_deps.py
# can run this against a stub installer and a scratch apt directory:
#   INSTALL_CMD      the install command      (default: npx playwright install-deps webkit)
#   APT_ETC          apt's configuration root (default: /etc/apt)
#   TOTAL_BUDGET     seconds for both attempts (default: 1080)
#   STALL_THRESHOLD  Azure `Ign:` lines that mean the mirror has stalled (default: 3)
#   POLL_SECONDS     how often the output is checked (default: 5)

set -euo pipefail

read -r -a install_cmd <<< "${INSTALL_CMD:-npx playwright install-deps webkit}"
apt_etc="${APT_ETC:-/etc/apt}"
total_budget="${TOTAL_BUDGET:-1080}"
stall_threshold="${STALL_THRESHOLD:-3}"
poll_seconds="${POLL_SECONDS:-5}"

azure_host="azure.archive.ubuntu.com"
fallback_host="archive.ubuntu.com"
stall_pattern="^Ign:.*${azure_host//./\\.}"

deadline=$(( $(date +%s) + total_budget ))
log=$(mktemp)
trap 'rm -f "$log"' EXIT

remaining_budget() {
    echo $(( deadline - $(date +%s) ))
}

# Copy whatever the attempt has written since the last call to stdout, so the
# job log shows apt's progress as it happens rather than all at once.
printed=0
flush_log() {
    local size
    size=$(stat -c %s "$log")
    if [ "$size" -gt "$printed" ]; then
        tail -c +"$(( printed + 1 ))" "$log" | head -c "$(( size - printed ))"
        printed=$size
    fi
}

stop_group() {
    local pgid=$1
    sudo kill -TERM -- "-${pgid}" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        sudo kill -0 -- "-${pgid}" 2>/dev/null || return 0
        sleep 1
    done
    sudo kill -KILL -- "-${pgid}" 2>/dev/null || true
}

# Run the install until it exits, stalls on the Azure mirror (when
# watch_for_stall is "yes"), or runs out of budget.
# Returns 0 on success, 2 on a stall, 1 on any other failure.
run_attempt() {
    local watch_for_stall=$1 pid status stalls
    : > "$log"
    printed=0
    # setsid gives the install its own process group, whose id is its pid:
    # a background job of a non-interactive shell is not a group leader, so
    # setsid execs in place rather than forking.
    setsid "${install_cmd[@]}" > "$log" 2>&1 &
    pid=$!
    while kill -0 "$pid" 2>/dev/null; do
        sleep "$poll_seconds"
        flush_log
        if [ "$watch_for_stall" = "yes" ]; then
            stalls=$(grep -c -E "$stall_pattern" "$log" || true)
            if [ "$stalls" -ge "$stall_threshold" ]; then
                echo "::warning::${stalls} package fetches from ${azure_host} were ignored; stopping this attempt."
                stop_group "$pid"
                wait "$pid" 2>/dev/null || true
                return 2
            fi
        fi
        if [ "$(remaining_budget)" -le 0 ]; then
            echo "::error::Install budget of ${total_budget}s ran out mid-install."
            stop_group "$pid"
            wait "$pid" 2>/dev/null || true
            return 1
        fi
    done
    status=0
    wait "$pid" || status=$?
    flush_log
    [ "$status" -eq 0 ] && return 0
    return 1
}

switch_mirror() {
    local files=() f
    for f in "$apt_etc/sources.list" "$apt_etc/apt-mirrors.txt" \
             "$apt_etc"/sources.list.d/*.list "$apt_etc"/sources.list.d/*.sources; do
        [ -f "$f" ] && grep -q "$azure_host" "$f" && files+=("$f")
    done
    if [ "${#files[@]}" -eq 0 ]; then
        echo "No apt source names ${azure_host}; retrying with the sources unchanged."
        return 0
    fi
    echo "Pointing apt at ${fallback_host} instead of ${azure_host} in: ${files[*]}"
    sudo sed -i "s/${azure_host//./\\.}/${fallback_host}/g" "${files[@]}"
}

attempt1=0
run_attempt yes || attempt1=$?
if [ "$attempt1" -eq 0 ]; then
    echo "WebKit system libraries installed."
    exit 0
fi

if [ "$(remaining_budget)" -le 0 ]; then
    echo "::error::No budget left to retry on ${fallback_host}."
    exit 1
fi
if [ "$attempt1" -eq 2 ]; then
    echo "The ${azure_host} mirror has stalled; retrying on ${fallback_host}."
else
    echo "The install failed; retrying on ${fallback_host} in case the mirror was the cause."
fi
switch_mirror

attempt2=0
run_attempt no || attempt2=$?
if [ "$attempt2" -eq 0 ]; then
    echo "WebKit system libraries installed from ${fallback_host}."
    exit 0
fi
echo "::error::Failed to install the WebKit system libraries from either mirror within ${total_budget}s."
exit 1
