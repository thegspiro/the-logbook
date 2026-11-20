#!/usr/bin/env python3
"""Decide whether the `ci-success` gate passes, given every job's result.

A job that was skipped is acceptable only when the `changes` job said its
area is untouched. Every other skip is a failure, as it was before jobs were
gated by area: a skipped job otherwise means an upstream `needs:` dependency
died, and a gate that waved those through would pass a run in which nothing
was tested.

The expectation is read from ci.yml rather than restated here, so a job's
`if:` and the gate's idea of when it may be skipped cannot drift apart.
scripts/check_ci_gate.py holds every `if:` to the one form this file parses.

Usage:  NEEDS_JSON='${{ toJSON(needs) }}' python3 scripts/ci_gate_verdict.py
Exits 0 when CI passed, 1 with the list of jobs that did not.
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

import yaml

CHANGES = "changes"

AREA_CONDITION = re.compile(r"needs\.changes\.outputs\.([a-z_]+) == 'true'")


def area_flag(job):
    """The `changes` output a job is gated on, or None when it always runs."""
    condition = " ".join(str(job.get("if", "")).split())
    match = AREA_CONDITION.fullmatch(condition)
    return match.group(1) if match else None


def verdict(needs, jobs):
    """Return {job: explanation} for every job that blocks the gate."""
    bad = {}

    changes = needs.get(CHANGES, {})
    if changes.get("result") != "success":
        bad[CHANGES] = (
            f"{changes.get('result')} (without it nothing says which jobs "
            f"were allowed to skip)"
        )
    outputs = changes.get("outputs") or {}

    for name, meta in sorted(needs.items()):
        if name == CHANGES:
            continue
        result = meta.get("result")
        flag = area_flag(jobs.get(name, {}))
        # Anything but an explicit "false" means the job had to run, so a
        # missing or malformed output cannot excuse a skip.
        may_skip = flag is not None and outputs.get(flag) == "false"
        if result == "success":
            continue
        if result == "skipped" and may_skip and CHANGES not in bad:
            continue
        if result == "skipped":
            bad[name] = "skipped (never ran: an upstream dependency failed)"
        else:
            bad[name] = str(result)
    return bad


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--workflow",
        default=Path(__file__).resolve().parent.parent
        / ".github"
        / "workflows"
        / "ci.yml",
        help="Path to the CI workflow file.",
    )
    args = parser.parse_args()

    needs = json.loads(os.environ["NEEDS_JSON"])
    jobs = yaml.safe_load(Path(args.workflow).read_text())["jobs"]
    bad = verdict(needs, jobs)

    for name, meta in sorted(needs.items()):
        print(f"{meta.get('result'):>10}  {name}")

    if not bad:
        print("\nEvery job that had to run succeeded.")
        return 0

    print("\nCI failed. Jobs that did not succeed:")
    for name, explanation in bad.items():
        print(f"  - {name}: {explanation}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
