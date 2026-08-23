"""Guards the `ci-success` aggregate gate against silently dropping a job.

`ci-success` is the single check branch protection requires. It only gates a
job that is named in its `needs:` list, so a job added to ci.yml without a
matching `needs:` entry runs, reports its own status, and is not required to
pass for anything. Nothing about the workflow file looks wrong when that
happens — the drift is invisible until someone merges on a red job.

ci.yml's own comment on the gate names this failure mode ("adding a third
engine or renaming one silently drops a required check with nothing to notice
it"). This is the check that sees it. It was added on 2026-08-23 alongside a
change that renamed one job and removed two, which is exactly the kind of
change that introduces the drift.

Parsed as YAML rather than pattern-matched, so an `if:` on a job, a comment, or
a reordering cannot fool it.

Run:  python -m unittest discover -s scripts -p 'test_*.py'
"""

import unittest
from pathlib import Path

import yaml

WORKFLOW = Path(__file__).resolve().parent.parent / ".github" / "workflows" / "ci.yml"
GATE = "ci-success"


class CiGateCompleteness(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = yaml.safe_load(WORKFLOW.read_text())
        cls.jobs = cls.workflow["jobs"]

    def test_gate_job_exists(self):
        assert (
            GATE in self.jobs
        ), f"{GATE} is the check branch protection requires; it must exist."

    def test_gate_requires_every_other_job(self):
        expected = set(self.jobs) - {GATE}
        declared = set(self.jobs[GATE].get("needs") or [])

        ungated = sorted(expected - declared)
        assert not ungated, (
            f"These jobs are not in {GATE}'s `needs:`, so a failure in them "
            f"would not block a merge: {ungated}. Add them to the `needs:` "
            f"list in .github/workflows/ci.yml."
        )

    def test_gate_does_not_name_a_missing_job(self):
        declared = set(self.jobs[GATE].get("needs") or [])
        missing = sorted(declared - set(self.jobs))
        assert not missing, (
            f"{GATE} declares `needs:` on jobs that no longer exist: "
            f"{missing}. A renamed job leaves the gate pointing at nothing."
        )

    def test_gate_runs_even_when_an_upstream_job_fails(self):
        # Without `if: always()` the gate is itself skipped when any dependency
        # fails, and the required check sits pending forever instead of red.
        condition = str(self.jobs[GATE].get("if", "")).strip()
        assert "always()" in condition, (
            f"{GATE} must be `if: always()` so it still reports when an "
            f"upstream job fails; otherwise the required check never resolves."
        )


if __name__ == "__main__":
    unittest.main()
