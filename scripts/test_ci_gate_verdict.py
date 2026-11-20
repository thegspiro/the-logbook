"""Regression tests for the `ci-success` verdict.

Each case is a run that tested less than it should have. The gate is the one
check branch protection requires, so a skip it accepts by mistake is a pull
request that merges with a suite never run.

Run:  python -m unittest discover -s scripts -p 'test_*.py'
"""

import unittest

from ci_gate_verdict import area_flag, verdict

JOBS = {
    "changes": {},
    "backend-lint": {},
    "backend-test": {},
    "backend-test-integration": {
        "needs": "changes",
        "if": "needs.changes.outputs.backend == 'true'",
    },
    "frontend-e2e": {
        "needs": "changes",
        "if": "needs.changes.outputs.frontend == 'true'",
    },
}


def needs(backend="true", frontend="true", changes="success", **results):
    outcome = {
        "changes": {
            "result": changes,
            "outputs": {"backend": backend, "frontend": frontend},
        },
    }
    for job in JOBS:
        if job != "changes":
            outcome[job] = {"result": "success", "outputs": {}}
    for job, result in results.items():
        outcome[job.replace("_", "-")] = {"result": result, "outputs": {}}
    return outcome


class Verdict(unittest.TestCase):
    def test_everything_succeeding_passes(self):
        assert verdict(needs(), JOBS) == {}

    def test_a_job_skipped_for_an_untouched_area_passes(self):
        result = needs(frontend="false", frontend_e2e="skipped")
        assert verdict(result, JOBS) == {}

    def test_a_job_skipped_while_its_area_changed_fails(self):
        result = needs(frontend="true", frontend_e2e="skipped")
        assert list(verdict(result, JOBS)) == ["frontend-e2e"]

    def test_a_skip_excused_by_another_area_fails(self):
        # The backend flag being false says nothing about a frontend job.
        result = needs(backend="false", frontend_e2e="skipped")
        assert list(verdict(result, JOBS)) == ["frontend-e2e"]

    def test_an_ungated_job_may_never_skip(self):
        result = needs(backend="false", frontend="false", backend_test="skipped")
        assert list(verdict(result, JOBS)) == ["backend-test"]

    def test_a_failed_or_cancelled_job_fails_whatever_its_area(self):
        for outcome in ("failure", "cancelled"):
            with self.subTest(outcome=outcome):
                result = needs(frontend="false", frontend_e2e=outcome)
                assert verdict(result, JOBS) == {"frontend-e2e": outcome}

    def test_a_failed_changes_job_excuses_no_skip(self):
        # Its outputs are then empty or stale; every dependent job skips, and
        # none of those skips means "untouched".
        result = needs(
            frontend="false",
            changes="failure",
            frontend_e2e="skipped",
            backend_test_integration="skipped",
        )
        assert sorted(verdict(result, JOBS)) == [
            "backend-test-integration",
            "changes",
            "frontend-e2e",
        ]

    def test_a_missing_output_excuses_no_skip(self):
        result = needs(frontend_e2e="skipped")
        del result["changes"]["outputs"]["frontend"]
        assert list(verdict(result, JOBS)) == ["frontend-e2e"]

    def test_an_output_that_is_not_exactly_false_excuses_no_skip(self):
        for value in ("", "False", "0", "no"):
            with self.subTest(value=value):
                result = needs(frontend=value, frontend_e2e="skipped")
                assert list(verdict(result, JOBS)) == ["frontend-e2e"]

    def test_a_condition_the_gate_cannot_read_excuses_no_skip(self):
        jobs = dict(JOBS)
        jobs["frontend-e2e"] = {
            "if": "needs.changes.outputs.frontend == 'true' || github.actor == 'x'"
        }
        result = needs(frontend="false", frontend_e2e="skipped")
        assert list(verdict(result, jobs)) == ["frontend-e2e"]

    def test_a_job_the_workflow_does_not_define_may_never_skip(self):
        result = needs(frontend="false")
        result["renamed-job"] = {"result": "skipped", "outputs": {}}
        assert list(verdict(result, JOBS)) == ["renamed-job"]


class AreaFlag(unittest.TestCase):
    def test_reads_the_flag(self):
        assert area_flag({"if": "needs.changes.outputs.docker == 'true'"}) == "docker"

    def test_whitespace_is_normalized(self):
        job = {"if": "needs.changes.outputs.backend   ==\n 'true'"}
        assert area_flag(job) == "backend"

    def test_no_condition_means_always(self):
        assert area_flag({}) is None

    def test_a_negated_or_compound_condition_is_not_a_flag(self):
        for condition in (
            "needs.changes.outputs.backend != 'true'",
            "needs.changes.outputs.backend == 'false'",
            "always() && needs.changes.outputs.backend == 'true'",
            "${{ needs.changes.outputs.backend == 'true' }}",
        ):
            with self.subTest(condition=condition):
                assert area_flag({"if": condition}) is None


if __name__ == "__main__":
    unittest.main()
