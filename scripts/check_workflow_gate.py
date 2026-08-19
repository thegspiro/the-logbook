#!/usr/bin/env python3
"""Fail when the CI aggregate gate stops covering every job in the workflow.

`ci-success` is the single check branch protection requires, and it enforces
that by listing every other job in its `needs:`. That list is maintained by
hand, so a job added without touching it is simply not covered — it can fail,
or be skipped because its own dependency died, and the gate still reports
success. That is precisely the hole the gate was added to close (four matrix
legs reported `skipped` on 2026-08-19 and nothing was red), reintroduced
silently and with no symptom until the day it matters.

Also asserts the gate runs under `if: always()`. Without it the gate is itself
skipped whenever an upstream job fails, and a required check that never reports
leaves the pull request pending forever rather than failing it.

Deliberately stdlib-only, like the other checks in this directory: it must not
be possible for a missing dependency to stop the guard running. The parser
understands only the two constructs it needs and treats anything it cannot
recognise as an error, so it fails loudly rather than passing vacuously.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CI_WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"

GATE_JOB = "ci-success"

# A job key is the only thing indented exactly two spaces under `jobs:`.
JOB_KEY = re.compile(r"^  ([A-Za-z0-9_-]+):\s*$")
NEEDS_KEY = re.compile(r"^    needs:\s*(.*)$")
NEEDS_ITEM = re.compile(r"^      - ([A-Za-z0-9_-]+)\s*$")
ALWAYS_IF = re.compile(r"^    if:\s*always\(\)\s*$")

# A parse that finds implausibly little is a broken parser, not a healthy
# workflow. The real file has 13 jobs; this floor only has to be high enough
# that silent breakage cannot masquerade as success.
MINIMUM_PLAUSIBLE_JOBS = 5


def _job_blocks(lines: list[str]) -> dict[str, list[str]]:
    """Return each job's name mapped to the lines belonging to it."""
    blocks: dict[str, list[str]] = {}
    current: str | None = None
    in_jobs = False

    for line in lines:
        if not line.strip() or line.lstrip().startswith("#"):
            if current is not None:
                blocks[current].append(line)
            continue

        # Any other column-0 key ends the jobs mapping.
        if not line.startswith(" "):
            in_jobs = line.startswith("jobs:")
            current = None
            continue

        if not in_jobs:
            continue

        match = JOB_KEY.match(line)
        if match:
            current = match.group(1)
            blocks[current] = []
        elif current is not None:
            blocks[current].append(line)

    return blocks


def _declared_needs(block: list[str]) -> list[str] | None:
    """Return the job names in a block's `needs:`, or None if it has none."""
    for index, line in enumerate(block):
        match = NEEDS_KEY.match(line)
        if not match:
            continue

        inline = match.group(1).strip()
        if inline:
            # `needs: [a, b]` or `needs: a` — supported so the check reports a
            # real answer rather than a parse error if the style ever changes.
            return [
                name.strip()
                for name in inline.strip("[]").split(",")
                if name.strip()
            ]

        names = []
        for following in block[index + 1:]:
            item = NEEDS_ITEM.match(following)
            if item:
                names.append(item.group(1))
            elif following.strip() and not following.lstrip().startswith("#"):
                break
        return names
    return None


def gate_errors(ci_content: str) -> list[str]:
    """Return coverage problems with the workflow's aggregate gate."""
    errors: list[str] = []
    blocks = _job_blocks(ci_content.splitlines())

    if len(blocks) < MINIMUM_PLAUSIBLE_JOBS:
        return [
            f"parsed only {len(blocks)} job(s) from {CI_WORKFLOW.name}; the "
            "parser is broken or the workflow layout changed. Refusing to "
            "report success on a reading this thin."
        ]

    if GATE_JOB not in blocks:
        return [
            f"no `{GATE_JOB}` job in {CI_WORKFLOW.name}. It is the check branch "
            "protection requires; without it a failing job blocks nothing."
        ]

    gate = blocks[GATE_JOB]
    if not any(ALWAYS_IF.match(line) for line in gate):
        errors.append(
            f"`{GATE_JOB}` must set `if: always()`, or it is skipped whenever an "
            "upstream job fails and the required check never reports at all."
        )

    declared = _declared_needs(gate)
    if not declared:
        errors.append(f"`{GATE_JOB}` declares no `needs:`, so it gates nothing")
        return errors

    expected = set(blocks) - {GATE_JOB}
    missing = sorted(expected - set(declared))
    if missing:
        errors.append(
            f"`{GATE_JOB}` does not cover: {', '.join(missing)}. "
            f"Add each to its `needs:` or the gate reports success while they "
            "fail or skip."
        )

    unknown = sorted(set(declared) - expected)
    if unknown:
        errors.append(
            f"`{GATE_JOB}` needs job(s) that do not exist: {', '.join(unknown)}"
        )

    return errors


def main() -> int:
    errors = gate_errors(CI_WORKFLOW.read_text())
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    covered = len(_job_blocks(CI_WORKFLOW.read_text().splitlines())) - 1
    print(f"CI aggregate gate covers all {covered} job(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
