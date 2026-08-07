"""Structural invariants for the scheduled-task runners.

These are source-level checks rather than behavioral ones: the failure modes
they guard are (a) invisible in a single-org dev database and (b) only
reproducible by making a task fail mid-run against a real MySQL session, which
the unit suite does not have. Asserting the shape is cheap and catches the
drift, which is what actually happened — eight tasks re-implemented the
``_for_each_org`` loop inline and each copy lost a guard the helper documents.
"""

import ast
import re
from pathlib import Path

SOURCE = (
    Path(__file__).resolve().parent.parent / "app" / "services" / "scheduled_tasks.py"
)
TEXT = SOURCE.read_text()
TREE = ast.parse(TEXT)


def _functions_iterating_orgs() -> dict[str, str]:
    """Map function name -> source, for every function that selects orgs."""
    out = {}
    for node in ast.walk(TREE):
        if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
            continue
        segment = ast.get_source_segment(TEXT, node) or ""
        if "select(Organization)" in segment:
            out[node.name] = segment
    return out


class TestScheduleRegistry:
    def test_every_scheduled_task_has_a_runner_and_vice_versa(self):
        """A SCHEDULE entry with no runner is advertised to operators but
        cannot be triggered; a runner with no SCHEDULE entry has no documented
        cadence and never appears in GET /scheduled/tasks."""
        sched = re.search(r"^SCHEDULE\s*=\s*\{(.*?)\n\}", TEXT, re.S | re.M).group(1)
        runners = re.search(
            r"^TASK_RUNNERS\s*=\s*\{(.*?)\n\}", TEXT, re.S | re.M
        ).group(1)
        sched_keys = set(re.findall(r'^\s{4}"([a-z_]+)":\s*\{', sched, re.M))
        runner_keys = set(re.findall(r'^\s{4}"([a-z_]+)":', runners, re.M))

        assert sched_keys, "no SCHEDULE entries parsed — regex drifted"
        assert runner_keys, "no TASK_RUNNERS entries parsed — regex drifted"
        assert sched_keys - runner_keys == set(), (
            "Scheduled tasks with no runner: " f"{sorted(sched_keys - runner_keys)}"
        )
        assert runner_keys - sched_keys == set(), (
            "Runners missing a SCHEDULE entry: " f"{sorted(runner_keys - sched_keys)}"
        )


class TestOrgIterationInvariants:
    def test_org_selects_skip_deactivated_organizations(self):
        """Every task fans mail/SMS/push out to members, so a deactivated
        department must not be picked up by the loop."""
        offenders = [
            name
            for name, src in _functions_iterating_orgs().items()
            if "Organization.active" not in src
        ]
        assert offenders == [], (
            "These task runners iterate organizations without filtering out "
            f"deactivated ones: {offenders}"
        )

    def test_org_loops_roll_back_on_failure(self):
        """All orgs in a run share one session. Without a rollback in the
        per-org handler, a failed flush leaves the session unusable and every
        *later* org in the same run fails too — so one bad org silently
        truncates the task for everyone after it."""
        offenders = [
            name
            for name, src in _functions_iterating_orgs().items()
            if "except Exception" in src and "db.rollback()" not in src
        ]
        assert offenders == [], (
            "These task runners catch a per-org exception but never roll the "
            f"session back: {offenders}"
        )
