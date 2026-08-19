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
#   2. When a library genuinely is missing, bound every apt invocation with
#      `timeout` and retry it. A stalled mirror then costs three minutes and
#      recovers, instead of costing the job and silently skipping every job
#      downstream of it.
#
# The presence check is on the SONAME, not the package name, and that is
# load-bearing. Ubuntu 24.04 (noble) renamed the package to `libmagic1t64` in
# the 64-bit-time_t transition, so `dpkg -s libmagic1` reports "not installed"
# on a runner that has the library — a package-name check would take the apt
# path every single time and defeat defence #1 entirely. python-magic resolves
# the library through ctypes.util.find_library("magic"), i.e. by soname, so the
# soname is also the thing that actually has to be true.

set -euo pipefail

# soname:apt-package pairs. The soname is what gets checked; the package is
# only used when it is missing.
DEPENDENCIES=(
    "libmagic.so.1:libmagic1"
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

missing_packages=()
for dep in "${DEPENDENCIES[@]}"; do
    soname="${dep%%:*}"
    package="${dep##*:}"
    if soname_present "$soname"; then
        echo "Found ${soname} (provided by the runner image); no install needed."
    else
        echo "Missing ${soname}; will install ${package}."
        missing_packages+=("$package")
    fi
done

if [ "${#missing_packages[@]}" -eq 0 ]; then
    echo "All required libraries already present. Skipping apt entirely."
    exit 0
fi

# 180s is ~30x a healthy `apt-get update` on a GitHub runner, so a slow-but-
# working mirror is never killed; only a genuine stall reaches it.
apt_timeout=180
max_attempts=3

for attempt in $(seq 1 "$max_attempts"); do
    if timeout "$apt_timeout" sudo apt-get update -o Acquire::Retries=3 \
        && timeout "$apt_timeout" sudo apt-get install -y --no-install-recommends \
            "${missing_packages[@]}"; then
        echo "Installed: ${missing_packages[*]}"
        exit 0
    fi

    if [ "$attempt" -lt "$max_attempts" ]; then
        backoff=$((attempt * 15))
        echo "apt attempt ${attempt}/${max_attempts} failed or timed out after ${apt_timeout}s;" \
             "retrying in ${backoff}s."
        sleep "$backoff"
    fi
done

echo "::error::Failed to install system packages after ${max_attempts} attempts: ${missing_packages[*]}"
exit 1
