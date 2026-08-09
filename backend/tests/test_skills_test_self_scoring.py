"""
CS-10 (pass 2): the candidate must never score or complete their OWN official
skills test — even an officer who holds training.manage. create_test blocks
examiner==candidate; _authorize_test_write (the guard on PUT /tests/{id} and
POST /tests/{id}/complete) must close the same self-credit hole on the scoring
path. Practice attempts are exempt. Pure guard function — no DB.
"""

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.skills_testing import _authorize_test_write


def _test(candidate_id, is_practice=False, examiner_id="examiner"):
    return SimpleNamespace(
        candidate_id=candidate_id,
        is_practice=is_practice,
        examiner_id=examiner_id,
    )


def _user(uid):
    return SimpleNamespace(id=uid)


class TestSelfScoringGuard:
    def test_officer_candidate_cannot_score_own_official_test(self):
        # Even with training.manage, the candidate is blocked before the officer
        # short-circuit is reached.
        with patch(
            "app.api.v1.endpoints.skills_testing._can_manage_tests",
            return_value=True,
        ):
            with pytest.raises(HTTPException) as exc:
                _authorize_test_write(_test(candidate_id="u1"), _user("u1"))
        assert exc.value.status_code == 403
        assert "your own evaluation" in exc.value.detail

    def test_officer_can_score_another_members_official_test(self):
        with patch(
            "app.api.v1.endpoints.skills_testing._can_manage_tests",
            return_value=True,
        ):
            # candidate != actor -> allowed, no raise.
            _authorize_test_write(_test(candidate_id="u2"), _user("u1"))

    def test_candidate_may_drive_own_practice_attempt(self):
        # Practice is uncredited; an officer running their own practice drill is
        # exempt from the self-scoring block.
        with patch(
            "app.api.v1.endpoints.skills_testing._can_manage_tests",
            return_value=True,
        ):
            _authorize_test_write(
                _test(candidate_id="u1", is_practice=True), _user("u1")
            )


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
