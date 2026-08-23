#!/usr/bin/env python3
"""Verify the `ci-success` aggregate gate actually gates every CI job.

`ci-success` is the single check branch protection requires. It only gates a
job named in its `needs:` list, so a job added to ci.yml without a matching
`needs:` entry runs, reports its own status, and is required by nothing.
Neither half of that looks wrong on its own, which is why it survives review —
ci.yml's own comment on the gate names the failure mode ("adding a third engine
or renaming one silently drops a required check with nothing to notice it").

WHERE THIS RUNS, AND WHY IT MATTERS
-----------------------------------
This executes inside the `ci-success` job itself, not in a lint job. That
placement is the whole point. Run from any other job, the check can be detached
from the gate it validates: drop `backend-lint` from `ci-success.needs` and the
check fails inside `backend-lint` while `ci-success` — no longer waiting on
that job — goes green on its remaining dependencies. The one omission it exists
to block would merge with the checker red.

Run from inside `ci-success`, the gate cannot be green unless the check passed,
whatever the `needs:` list says.

Usage:  python3 scripts/check_ci_gate.py [--workflow PATH]
Exits 0 when the gate is complete, 1 with an explanation otherwise.
"""

import argparse
import sys
from pathlib import Path

import yaml

GATE = "ci-success"

# The only two spellings that make the gate unconditional. Anything else —
# `always() && needs.backend-test.result == 'success'`, or `!always()` — still
# contains the substring "always()" while leaving the job skippable, so a
# substring test would accept exactly the regression this check exists to catch.
UNCONDITIONAL = {"always()", "${{ always() }}"}


def load_jobs(workflow_path):
    return yaml.safe_load(Path(workflow_path).read_text())["jobs"]


def gate_problems(jobs):
    """Return a list of human-readable problems with the aggregate gate."""
    problems = []

    if GATE not in jobs:
        return [
            f"`{GATE}` is missing. It is the check branch protection "
            f"requires, so without it nothing enforces that CI passed."
        ]

    gate = jobs[GATE]
    declared = set(gate.get("needs") or [])
    expected = set(jobs) - {GATE}

    ungated = sorted(expected - declared)
    if ungated:
        problems.append(
            f"These jobs are not in `{GATE}`'s `needs:`, so a failure in them "
            f"would not block a merge: {ungated}. Add them to the `needs:` "
            f"list in .github/workflows/ci.yml."
        )

    missing = sorted(declared - set(jobs))
    if missing:
        problems.append(
            f"`{GATE}` declares `needs:` on jobs that no longer exist: "
            f"{missing}. A renamed job leaves the gate pointing at nothing."
        )

    condition = " ".join(str(gate.get("if", "")).split())
    if condition not in UNCONDITIONAL:
        problems.append(
            f"`{GATE}` must be unconditional so it still reports when an "
            f"upstream job fails; otherwise the required check never resolves "
            f"and the PR sits pending. Expected one of "
            f"{sorted(UNCONDITIONAL)}, found {condition!r}."
        )

    return problems


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

    problems = gate_problems(load_jobs(args.workflow))
    if not problems:
        print(f"CI gate OK: `{GATE}` requires every other job and is unconditional.")
        return 0

    for problem in problems:
        print(f"::error file=.github/workflows/ci.yml::{problem}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
