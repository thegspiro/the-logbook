"""Regression tests for the CI aggregate-gate checker.

Each case is a way the gate can be silently defeated. The `if:` cases exist
because an earlier version of this checker tested for the *substring*
"always()", which accepts `always() && needs.backend-test.result == 'success'`
and `!always()` — both of which leave `ci-success` skippable, i.e. exactly the
regression the check is meant to block.

Operates on dicts rather than a workflow file so the logic is tested
independently of ci.yml's current contents; check_ci_gate.py's own CLI run
inside the `ci-success` job is what tests it against the real file.

Run:  python -m unittest discover -s scripts -p 'test_*.py'
"""

import unittest

from check_ci_gate import (
    CANCEL_IN_PROGRESS,
    CONCURRENCY_GROUP,
    concurrency_problems,
    gate_problems,
)


def workflow(gate_needs, gate_if="always()", extra_jobs=()):
    jobs = {"backend-lint": {}, "frontend-checks": {}}
    jobs.update({name: {} for name in extra_jobs})
    jobs["ci-success"] = {"needs": list(gate_needs), "if": gate_if}
    return jobs


class GateCompleteness(unittest.TestCase):
    def test_complete_gate_has_no_problems(self):
        assert gate_problems(workflow(["backend-lint", "frontend-checks"])) == []

    def test_job_missing_from_needs_is_reported(self):
        problems = gate_problems(workflow(["backend-lint"]))
        assert len(problems) == 1
        assert "frontend-checks" in problems[0]

    def test_newly_added_job_is_reported(self):
        problems = gate_problems(
            workflow(["backend-lint", "frontend-checks"], extra_jobs=["new-scan"])
        )
        assert len(problems) == 1
        assert "new-scan" in problems[0]

    def test_needs_naming_a_removed_job_is_reported(self):
        problems = gate_problems(
            workflow(["backend-lint", "frontend-checks", "frontend-build"])
        )
        assert len(problems) == 1
        assert "frontend-build" in problems[0]
        assert "no longer exist" in problems[0]

    def test_missing_gate_job_is_reported(self):
        problems = gate_problems({"backend-lint": {}})
        assert len(problems) == 1
        assert "missing" in problems[0]


class GateIsUnconditional(unittest.TestCase):
    def complete(self, gate_if):
        return gate_problems(
            workflow(["backend-lint", "frontend-checks"], gate_if=gate_if)
        )

    def test_bare_always_accepted(self):
        assert self.complete("always()") == []

    def test_wrapped_always_accepted(self):
        assert self.complete("${{ always() }}") == []

    def test_whitespace_is_normalized(self):
        assert self.complete("${{   always()   }}") == []

    def test_always_conjoined_with_a_result_check_is_rejected(self):
        # Skipped whenever backend-test fails — the required check would then
        # never resolve, which is the failure this whole gate exists to avoid.
        problems = self.complete("${{ always() && needs.backend-test.result == 'x' }}")
        assert len(problems) == 1
        assert "unconditional" in problems[0]

    def test_negated_always_is_rejected(self):
        problems = self.complete("${{ !always() }}")
        assert len(problems) == 1
        assert "unconditional" in problems[0]

    def test_success_only_condition_is_rejected(self):
        problems = self.complete("${{ success() }}")
        assert len(problems) == 1

    def test_absent_condition_is_rejected(self):
        problems = self.complete("")
        assert len(problems) == 1

    def test_not_cancelled_is_rejected(self):
        # Tempting, because a superseded run's gate would then end at once
        # instead of queueing for a runner. But a cancel would skip the gate,
        # and branch protection counts a skipped required check as a pass, so
        # cancelling a PR's current run would let it merge untested.
        problems = self.complete("${{ !cancelled() }}")
        assert len(problems) == 1
        assert "unconditional" in problems[0]


def job_concurrency(job_id):
    return {
        "group": CONCURRENCY_GROUP.format(job=job_id),
        "cancel-in-progress": CANCEL_IN_PROGRESS,
    }


def concurrent_workflow(job_ids=("backend-lint", "frontend-e2e-safari")):
    return {"jobs": {j: {"concurrency": job_concurrency(j)} for j in job_ids}}


class ConcurrencyIsPerJob(unittest.TestCase):
    def test_every_job_with_its_own_group_has_no_problems(self):
        assert concurrency_problems(concurrent_workflow()) == []

    def test_extra_spaces_inside_an_expression_are_normalized(self):
        wf = concurrent_workflow(["backend-lint"])
        conc = wf["jobs"]["backend-lint"]["concurrency"]
        conc["group"] = conc["group"].replace(
            "${{ github.ref }}", "${{   github.ref }}"
        )
        assert concurrency_problems(wf) == []

    def test_workflow_level_block_is_reported(self):
        # The arrangement that held #4375's new run behind its old run's gate.
        wf = concurrent_workflow()
        wf["concurrency"] = {"group": "ci-${{ github.ref }}"}
        problems = concurrency_problems(wf)
        assert len(problems) == 1
        assert "top-level" in problems[0]

    def test_job_without_a_block_is_reported(self):
        wf = concurrent_workflow()
        wf["jobs"]["new-scan"] = {}
        problems = concurrency_problems(wf)
        assert len(problems) == 1
        assert "`new-scan` has no `concurrency:` block" in problems[0]

    def test_group_naming_another_job_is_reported(self):
        # Two jobs in one group would cancel each other on every push.
        wf = concurrent_workflow()
        wf["jobs"]["frontend-e2e-safari"]["concurrency"] = job_concurrency(
            "backend-lint"
        )
        problems = concurrency_problems(wf)
        assert len(problems) == 1
        assert "frontend-e2e-safari" in problems[0]

    def test_group_without_the_matrix_index_is_reported(self):
        # The three Safari shards would cancel one another.
        wf = concurrent_workflow(["frontend-e2e-safari"])
        conc = wf["jobs"]["frontend-e2e-safari"]["concurrency"]
        conc["group"] = conc["group"].replace("-${{ strategy.job-index }}", "")
        assert len(concurrency_problems(wf)) == 1

    def test_group_without_the_main_sha_is_reported(self):
        # Overlapping main runs would evict one another, losing a commit's
        # CI record, as on 2026-08-23.
        wf = concurrent_workflow(["backend-lint"])
        conc = wf["jobs"]["backend-lint"]["concurrency"]
        conc["group"] = "${{ github.workflow }}-backend-lint-${{ github.ref }}"
        assert len(concurrency_problems(wf)) == 1

    def test_cancelling_main_runs_is_reported(self):
        wf = concurrent_workflow(["backend-lint"])
        wf["jobs"]["backend-lint"]["concurrency"]["cancel-in-progress"] = True
        problems = concurrency_problems(wf)
        assert len(problems) == 1
        assert "cancel-in-progress" in problems[0]


if __name__ == "__main__":
    unittest.main()
