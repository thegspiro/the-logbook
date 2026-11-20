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

CONCURRENCY IS PER JOB FOR PULL REQUESTS, PER RUN FOR MAIN
----------------------------------------------------------
It also asserts how runs replace one another.

Every job carries its own `concurrency:` block, so a pull request's new push
cancels each job of the run it replaces without waiting for that run to end.
A workflow-level group did wait: `ci-success`, being `always()`, outlives the
cancellation and then queues for a runner, and on 2026-11-17 that held
#4375's new run at "pending" for five and a half hours. The gate's condition
cannot be relaxed to avoid it, because a gate a cancel could skip would report
"skipped", which branch protection counts as a pass.

Main is the one ref that shares a workflow-level group. One main run executes
at a time and is never cancelled, so it always finishes; of the merges that
land meanwhile GitHub keeps only the newest waiting. Until 2026-11-19 every
main commit had a group of its own and ran in full, and eleven merges inside
three minutes queued about 240 jobs ahead of every open pull request. The
owner chose to give up a complete record for each intermediate commit of a
merge train in exchange. Cancelling the running main run instead would let a
steady stream of merges restart it forever without one ever completing.

JOBS MAY BE SKIPPED ONLY BY AREA
--------------------------------
A job's `if:` may only be the one form scripts/ci_gate_verdict.py parses,
naming an output scripts/ci_changed_areas.py writes, and the job must then
depend on `changes`. Any other condition would produce a skip the gate
cannot tell from a dependency that died.

Usage:  python3 scripts/check_ci_gate.py [--workflow PATH]
Exits 0 when the gate is complete, 1 with an explanation otherwise.
"""

import argparse
import sys
from pathlib import Path

import yaml

from ci_changed_areas import FLAGS
from ci_gate_verdict import CHANGES, area_flag

GATE = "ci-success"

# The only two spellings that make the gate unconditional. Anything else —
# `always() && needs.backend-test.result == 'success'`, or `!always()` — still
# contains the substring "always()" while leaving the job skippable, so a
# substring test would accept exactly the regression this check exists to catch.
UNCONDITIONAL = {"always()", "${{ always() }}"}


# Every job's group, written out with its own id because `github.job` is not
# available to a job's `concurrency:` key. `strategy.job-index` keeps a matrix
# job's legs apart.
CONCURRENCY_GROUP = (
    "${{{{ github.workflow }}}}-{job}-${{{{ strategy.job-index }}}}-"
    "${{{{ github.ref }}}}"
)
CANCEL_IN_PROGRESS = "${{ github.ref != 'refs/heads/main' }}"

# Main shares one group; every other ref gets a group no other run can join,
# which leaves its runs to the per-job groups above.
WORKFLOW_GROUP = "${{ github.ref == 'refs/heads/main' && 'ci-main' || github.run_id }}"
WORKFLOW_CANCEL_IN_PROGRESS = "False"


def load_workflow(workflow_path):
    return yaml.safe_load(Path(workflow_path).read_text())


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


def _normalized(value):
    return " ".join(str(value).split())


def concurrency_problems(workflow):
    """Return a list of problems with how the workflow's runs replace each other."""
    problems = []

    top = workflow.get("concurrency")
    if not isinstance(top, dict):
        problems.append(
            "The workflow has no top-level `concurrency:` block, so every "
            "merge to main starts a full run alongside the ones before it. "
            f"Give it group {WORKFLOW_GROUP!r} and cancel-in-progress false."
        )
    else:
        group = _normalized(top.get("group", ""))
        if group != WORKFLOW_GROUP:
            problems.append(
                f"The workflow's concurrency group is {group!r}; expected "
                f"{WORKFLOW_GROUP!r}. A group that pull request runs share "
                f"makes a new run wait until every job of the run it "
                f"replaced has finished, `{GATE}` included."
            )
        cancel = _normalized(top.get("cancel-in-progress", False))
        if cancel != WORKFLOW_CANCEL_IN_PROGRESS:
            problems.append(
                f"The workflow's cancel-in-progress is {cancel!r}; expected "
                f"false. Cancelling the running main run lets a steady "
                f"stream of merges restart it without one ever completing."
            )

    for job_id, job in workflow.get("jobs", {}).items():
        concurrency = job.get("concurrency")
        expected = CONCURRENCY_GROUP.format(job=job_id)
        if not isinstance(concurrency, dict):
            problems.append(
                f"`{job_id}` has no `concurrency:` block, so a superseded run "
                f"of it is never cancelled. Give it group {expected!r} and "
                f"cancel-in-progress {CANCEL_IN_PROGRESS!r}."
            )
            continue
        group = _normalized(concurrency.get("group", ""))
        if group != expected:
            problems.append(
                f"`{job_id}`'s concurrency group is {group!r}; expected "
                f"{expected!r}. Another job's id would make the two jobs cancel "
                f"each other, and a group without the matrix index makes the "
                f"legs of one job do the same."
            )
        cancel = _normalized(concurrency.get("cancel-in-progress", ""))
        if cancel != CANCEL_IN_PROGRESS:
            problems.append(
                f"`{job_id}`'s cancel-in-progress is {cancel!r}; expected "
                f"{CANCEL_IN_PROGRESS!r}, which cancels a superseded pull "
                f"request run and never a main one."
            )

    return problems


def area_problems(jobs):
    """Return a list of problems with how jobs are skipped by changed area."""
    problems = []

    if CHANGES not in jobs:
        return [
            f"`{CHANGES}` is missing. It decides which jobs a change may "
            f"skip, and the gate fails every skip it did not sanction."
        ]
    if "if" in jobs[CHANGES]:
        problems.append(
            f"`{CHANGES}` must be unconditional: if it is skipped, nothing "
            f"says which other jobs were allowed to skip."
        )

    for job_id, job in jobs.items():
        if job_id in (GATE, CHANGES) or "if" not in job:
            continue
        flag = area_flag(job)
        if flag not in FLAGS:
            problems.append(
                f"`{job_id}`'s `if:` is {_normalized(job['if'])!r}. The only "
                f"condition the gate can account for is "
                f"\"needs.changes.outputs.<area> == 'true'\" with an area "
                f"from {sorted(FLAGS)}; a job skipped for any other reason "
                f"fails `{GATE}`."
            )
            continue
        needs = job.get("needs") or []
        if isinstance(needs, str):
            needs = [needs]
        if CHANGES not in needs:
            problems.append(
                f"`{job_id}` is gated on `{CHANGES}` without `needs: "
                f"{CHANGES}`, so the output it reads is always empty and the "
                f"job never runs."
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

    workflow = load_workflow(args.workflow)
    problems = (
        gate_problems(workflow["jobs"])
        + concurrency_problems(workflow)
        + area_problems(workflow["jobs"])
    )
    if not problems:
        print(
            f"CI gate OK: `{GATE}` requires every other job and is "
            f"unconditional, every job sets its own concurrency, and jobs "
            f"are skipped only by changed area."
        )
        return 0

    for problem in problems:
        print(f"::error file=.github/workflows/ci.yml::{problem}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
