"""
Tests for officer validation of skills tests.

Examining is open to any member — departments routinely have a senior member
hold the clipboard — so the officer's authority sits at a second step:
validating the result against the candidate's account. Until that happens an
official test is a submission, not a record. It credits no requirement, spends
no attempt against the requirement's cap, does not move the department's pass
rate, and the candidate is told it is under review rather than how it went.

Pure functions and mocked sessions; no MySQL.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.api.v1.endpoints.skills_testing import (
    _can_manage_tests,
    _user_has_officer_role,
)
from app.models.skills_testing import ResultDisclosure, ResultRelease, SkillTestStatus
from app.services.skills_testing_service import (
    RESULT_VIEW_PENDING,
    assert_attempts_remaining,
    is_pending_validation,
    redact_test_for_view,
    resolve_result_view,
)

CANDIDATE = "user-candidate"
EXAMINER = "user-examiner"

VALIDATED = datetime(2026, 8, 8, 12, 0, tzinfo=timezone.utc)


def _test(**overrides):
    base = {
        "candidate_id": CANDIDATE,
        "examiner_id": EXAMINER,
        "is_practice": False,
        "status": SkillTestStatus.COMPLETED.value,
        "validated_at": None,
        "released_at": None,
        "result_disclosure": None,
        "result_release": None,
        "result_viewer_positions": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _view(test, *, user_id=CANDIDATE, is_officer=False, **kwargs):
    return resolve_result_view(
        test,
        None,
        None,
        is_officer=is_officer,
        user_id=user_id,
        **kwargs,
    )


class TestIsPendingValidation:
    def test_completed_official_test_without_signoff_is_pending(self):
        assert is_pending_validation(_test()) is True

    def test_validated_test_is_not_pending(self):
        assert is_pending_validation(_test(validated_at=VALIDATED)) is False

    def test_practice_is_never_pending(self):
        """There is nothing to credit, so there is nothing to sign off."""
        assert is_pending_validation(_test(is_practice=True)) is False

    def test_in_progress_test_is_not_pending(self):
        """A test still being run is not waiting on an officer."""
        assert (
            is_pending_validation(_test(status=SkillTestStatus.IN_PROGRESS.value))
            is False
        )

    def test_voided_test_is_not_pending(self):
        """Voiding is the rejection path — a refused submission is resolved."""
        assert (
            is_pending_validation(_test(status=SkillTestStatus.VOIDED.value)) is False
        )

    def test_cancelled_test_is_not_pending(self):
        assert (
            is_pending_validation(_test(status=SkillTestStatus.CANCELLED.value))
            is False
        )


class TestPendingResultView:
    def test_candidate_sees_pending_not_the_score(self):
        assert _view(_test()) == RESULT_VIEW_PENDING

    def test_candidate_sees_the_result_once_validated(self):
        assert _view(_test(validated_at=VALIDATED)) == ResultDisclosure.FULL.value

    def test_examiner_still_sees_what_they_recorded(self):
        """The peer who ran the test wrote the marks; withholding them from the
        author would be pointless."""
        assert _view(_test(), user_id=EXAMINER) == ResultDisclosure.FULL.value

    def test_officer_sees_everything(self):
        """The officer is the one being asked to judge it."""
        assert _view(_test(), user_id="officer", is_officer=True) == (
            ResultDisclosure.FULL.value
        )

    def test_stranger_still_sees_nothing(self):
        """Pending is a state of a test the reader could otherwise see, not a
        new grant of access."""
        assert _view(_test(), user_id="user-stranger") == ResultDisclosure.NONE.value

    def test_practice_attempt_is_never_pending(self):
        assert _view(_test(is_practice=True)) == ResultDisclosure.FULL.value

    def test_disclosure_none_wins_over_pending(self):
        """A department that never shows results to the candidate does not start
        showing them a pending row."""
        test = _test(result_disclosure=ResultDisclosure.NONE.value)
        assert _view(test) == ResultDisclosure.NONE.value

    def test_unreleased_result_stays_hidden_rather_than_pending(self):
        """Otherwise the row would appear as pending and then vanish again the
        moment it was validated but not yet released."""
        test = _test(result_release=ResultRelease.ON_RELEASE.value)
        assert _view(test) == ResultDisclosure.NONE.value

    def test_scores_only_policy_still_pends_first(self):
        test = _test(result_disclosure=ResultDisclosure.SCORES.value)
        assert _view(test) == RESULT_VIEW_PENDING
        validated = _test(
            result_disclosure=ResultDisclosure.SCORES.value, validated_at=VALIDATED
        )
        assert _view(validated) == ResultDisclosure.SCORES.value


class TestPendingRedaction:
    @staticmethod
    def _payload():
        return {
            "result": "pass",
            "overall_score": 92.5,
            "notes": "Hesitant on the second evolution",
            "section_results": [
                {
                    "section_id": "section-0",
                    "criteria_results": [
                        {"criterion_id": "criterion-0-0", "passed": True}
                    ],
                }
            ],
        }

    def test_outcome_is_withheld(self):
        redacted = redact_test_for_view(self._payload(), RESULT_VIEW_PENDING)

        assert redacted["overall_score"] is None
        assert redacted["section_results"] == []
        assert redacted["notes"] is None

    def test_result_reads_as_incomplete_not_pass(self):
        """Nobody has decided the pass stands, so it must not be shown as one."""
        redacted = redact_test_for_view(self._payload(), RESULT_VIEW_PENDING)

        assert redacted["result"] == "incomplete"

    def test_original_payload_is_untouched(self):
        payload = self._payload()
        redact_test_for_view(payload, RESULT_VIEW_PENDING)

        assert payload["overall_score"] == 92.5
        assert payload["result"] == "pass"


class TestAttemptsSpentOnValidation:
    """The cap counts validated tests, so a rejected submission costs nothing."""

    @staticmethod
    def _db(requirement, satisfied_count, spent_count):
        db = MagicMock()
        results = [
            _scalar(requirement),
            _scalar(satisfied_count),
            _scalar(spent_count),
        ]

        async def execute(*_args, **_kwargs):
            return results.pop(0)

        db.execute = execute
        return db

    async def test_pending_tests_do_not_count_toward_the_cap(self):
        """Two attempts allowed, two submissions pending, none validated: the
        candidate may still be tested."""
        db = self._db(SimpleNamespace(max_attempts=2), 0, 0)

        await assert_attempts_remaining(
            db=db,
            candidate_id=CANDIDATE,
            requirement_id="req-1",
            organization_id="org-1",
        )

    async def test_query_filters_on_validated_at(self):
        """The count is the thing that enforces the rule, so assert its shape."""
        captured = []

        db = MagicMock()
        results = [_scalar(SimpleNamespace(max_attempts=2)), _scalar(0), _scalar(0)]

        async def execute(stmt, *_args, **_kwargs):
            captured.append(stmt)
            return results.pop(0)

        db.execute = execute

        await assert_attempts_remaining(
            db=db,
            candidate_id=CANDIDATE,
            requirement_id="req-1",
            organization_id="org-1",
        )

        assert "validated_at IS NOT NULL" in str(captured[-1])


def _scalar(value):
    r = MagicMock()
    r.scalar.return_value = value
    r.scalar_one_or_none.return_value = value
    return r


class TestOfficerRecognition:
    """Read visibility and write authority must agree on who an officer is.

    ``_user_has_officer_role`` gates what an officer may *see* — the org-wide
    test list, including the validation queue — while ``_can_manage_tests``
    gates what they may *do*. They answered differently for the ordinary case:
    a training officer holding ``training.manage`` through a **position**.

    The read-side check only recognised a legacy ``user.role`` string or a
    literal ``user.permissions`` list, neither of which a position sets. So
    ``GET /summary`` counted results awaiting validation while
    ``GET /tests?pending_validation=true`` filtered every one of them away as
    somebody else's test, and the review queue was permanently empty for the
    officers it exists for.
    """

    @staticmethod
    def _user_with_position_permission(permission):
        """A user whose only grant comes from a position, as in a real org."""
        return SimpleNamespace(
            id="user-officer",
            role=None,
            permissions=None,
            rank=None,
            positions=[SimpleNamespace(permissions=[permission])],
        )

    def test_position_granted_officer_is_recognized(self):
        officer = self._user_with_position_permission("training.manage")

        assert _user_has_officer_role(officer) is True
        assert _can_manage_tests(officer) is True

    def test_position_granted_wildcard_admin_is_recognized(self):
        admin = self._user_with_position_permission("*")

        assert _user_has_officer_role(admin) is True
        assert _can_manage_tests(admin) is True

    def test_plain_member_is_not_an_officer(self):
        """The check must not have been widened into "any authenticated user"."""
        member = self._user_with_position_permission("training.view")

        assert _user_has_officer_role(member) is False
        assert _can_manage_tests(member) is False

    def test_the_two_checks_agree(self):
        """Whatever else is true, these may not disagree — that was the bug."""
        for permission in ("training.manage", "*", "training.view", "events.manage"):
            user = self._user_with_position_permission(permission)

            assert _user_has_officer_role(user) == _can_manage_tests(
                user
            ), f"read and write authority disagree for {permission!r}"

    def test_legacy_role_name_still_recognized(self):
        """The older heuristics stay: this widened the check, it did not swap it."""
        legacy = SimpleNamespace(
            id="user-legacy",
            role="training_officer",
            permissions=None,
            rank=None,
            positions=[],
        )

        assert _user_has_officer_role(legacy) is True
