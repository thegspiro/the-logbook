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

from check_ci_gate import gate_problems


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


if __name__ == "__main__":
    unittest.main()
