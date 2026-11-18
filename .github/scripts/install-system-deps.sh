#!/usr/bin/env bash
#
# Install the shared libraries the backend needs at import time (currently
# libmagic, required by python-magic in backend/requirements.txt, which
# app/api/v1/endpoints/{documents,users,storefront,...}.py import for upload
# content-type sniffing), and the commands it runs (ffmpeg and ffprobe, which
# strip History audio and video; backend/Dockerfile installs the same).
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

# Two later additions, both from 2026-11-18, when ubuntu-latest began handing
# jobs to ubuntu-26.04 runners. That image ships libmagic but not ffmpeg, so
# defence #1 no longer covers ffmpeg there, and every backend job that lands on
# 26.04 downloads ~66 MB (81 packages) through the runner's regional mirror. On
# #4424 that mirror (us-east-2.ec2.archive.ubuntu.com) delivered 14 of them in
# about three minutes, and the first `apt-get install` held the whole budget
# while it crawled, so the retries below never ran and Backend Unit Tests
# failed before a test started.
#
#   3. A job that never runs ffmpeg says so with INSTALL_MEDIA_TOOLS=false, and
#      the media tools are not installed there at all. Type Check and Security
#      Scan are such jobs; the unit, integration and contract tests are not
#      (tests/test_history_media*.py run the real ffmpeg).
#   4. The first attempt gets at most half the budget, and every retry points
#      apt at archive.ubuntu.com instead of the regional mirror, as
#      install-webkit-deps.sh does for the Azure one. The packages the first
#      attempt finished downloading stay in apt's archive cache, so the retry
#      fetches only the rest.
#
# Overridable through the environment, so scripts/test_install_system_deps.py
# can run this against stubs with no network and no root:
#   INSTALL_MEDIA_TOOLS  "false" to skip ffmpeg/ffprobe     (default: true)
#   APT_GET              the apt-get command                (default: sudo apt-get)
#   AS_ROOT              prefix for editing apt's sources   (default: sudo)
#   APT_ETC              apt's configuration root           (default: /etc/apt)
#   APT_BUDGET           seconds for every attempt together (default: 240)
#   LDCONFIG             the ldconfig binary                (default: found on PATH)

set -euo pipefail

install_media_tools="${INSTALL_MEDIA_TOOLS:-true}"
read -r -a apt_get <<< "${APT_GET:-sudo apt-get}"
read -r -a as_root <<< "${AS_ROOT-sudo}"
apt_etc="${APT_ETC:-/etc/apt}"
fallback_host="archive.ubuntu.com"

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

# command:package. Checked with `command -v`, the same lookup the backend's
# shutil.which makes. The ubuntu-24.04 image ships ffmpeg and ubuntu-26.04 does
# not; this installs it only on an image that does not, and only for a job
# that runs it (see INSTALL_MEDIA_TOOLS above).
COMMAND_DEPENDENCIES=(
    "ffmpeg:ffmpeg"
    "ffprobe:ffmpeg"
)

ldconfig_bin="${LDCONFIG:-$(command -v ldconfig || echo /sbin/ldconfig)}"

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

for dep in "${COMMAND_DEPENDENCIES[@]}"; do
    command_name="${dep%%:*}"
    package="${dep#*:}"
    if [ "$install_media_tools" = "false" ]; then
        echo "Not checking ${command_name}: this job does not run it (INSTALL_MEDIA_TOOLS=false)."
    elif command -v "$command_name" >/dev/null 2>&1; then
        echo "Found ${command_name} (provided by the runner image); no install needed."
    elif [[ " ${missing_packages[*]} " != *" ${package} "* ]]; then
        echo "Missing ${command_name}; will install ${package}."
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
total_budget="${APT_BUDGET:-240}"
max_attempts=3
deadline=$(( $(date +%s) + total_budget ))
# The first attempt's own deadline: half the budget, so a crawling mirror
# leaves the other half for the retries on archive.ubuntu.com.
attempt_deadline=$(( $(date +%s) + total_budget / 2 ))

remaining_budget() {
    local until=$deadline
    if [ "$attempt_deadline" -lt "$until" ]; then
        until=$attempt_deadline
    fi
    echo $(( until - $(date +%s) ))
}

# timeout(1) treats a duration of 0 as "no timeout at all", so a budget that has
# already run out must never be handed to it — that would restore the unbounded
# hang this whole script is about.
run_bounded() {
    local budget
    budget=$(remaining_budget)
    if [ "$budget" -le 0 ]; then
        echo "apt budget for this attempt is exhausted; not starting: $*"
        return 1
    fi
    timeout "$budget" "$@"
}

# Regional mirrors are subdomains of archive.ubuntu.com (azure., us-east-2.ec2.,
# ...). Rewriting the host in every apt source and the runner's mirror list
# sends the next `apt-get update` to the main archive instead. Done once.
mirror_switched=no
switch_mirror() {
    local files=() f
    mirror_switched=yes
    for f in "$apt_etc/sources.list" "$apt_etc/apt-mirrors.txt" \
             "$apt_etc"/sources.list.d/*.list "$apt_etc"/sources.list.d/*.sources; do
        [ -f "$f" ] && grep -qE '[a-z0-9-]+\.archive\.ubuntu\.com' "$f" && files+=("$f")
    done
    if [ "${#files[@]}" -eq 0 ]; then
        echo "No apt source names a regional mirror; retrying with the sources unchanged."
        return 0
    fi
    echo "Pointing apt at ${fallback_host} instead of the regional mirror in: ${files[*]}"
    "${as_root[@]}" sed -i -E "s/([a-z0-9-]+\.)+archive\.ubuntu\.com/${fallback_host}/g" "${files[@]}"
}

for attempt in $(seq 1 "$max_attempts"); do
    if [ "$attempt" -gt 1 ]; then
        attempt_deadline=$deadline
        if [ "$mirror_switched" = "no" ]; then
            switch_mirror
        fi
    fi
    if run_bounded "${apt_get[@]}" update -o Acquire::Retries=3 \
        && run_bounded "${apt_get[@]}" install -y --no-install-recommends "${missing_packages[@]}"; then
        echo "Installed: ${missing_packages[*]}"
        exit 0
    fi

    # No wait before the second attempt: it goes to a different mirror, so a
    # pause buys nothing, and after a first attempt stopped at half the budget
    # a backoff check could otherwise end the loop before the switch is tried.
    backoff=$(( (attempt - 1) * 10 ))
    budget=$(( deadline - $(date +%s) ))
    if [ "$attempt" -ge "$max_attempts" ] || [ "$budget" -le "$backoff" ]; then
        break
    fi
    echo "apt attempt ${attempt}/${max_attempts} failed; ${budget}s of budget left," \
         "retrying in ${backoff}s."
    sleep "$backoff"
done

echo "::error::Failed to install system packages within ${total_budget}s: ${missing_packages[*]}"
exit 1
