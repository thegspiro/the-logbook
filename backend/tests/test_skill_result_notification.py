"""
Tests for the candidate notification sent when a skills-test result lands.

The notification is gated on the same resolver the read endpoints use, not on
the officer's action, because the two diverge: validating under the
``on_release`` mode makes a result count without making it readable, and
releasing one that is still awaiting validation reveals nothing. A notification
pointing at a result the member cannot open is both useless and a disclosure —
"your evaluation is ready" tells them one exists even when the policy says they
may not know how it went.

The notification write itself is stubbed; what is under test is which of these
transitions produce one at all, and what the message says.
"""

from types import SimpleNamespace

import pytest

from app.models.skills_testing import ResultDisclosure, ResultRelease, SkillTestStatus
from app.services import skills_testing_service
from app.services.skills_testing_service import (
    candidate_result_view,
    notify_candidate_result_available,
    notify_candidate_result_voided,
)

CANDIDATE = "user-candidate"
EXAMINER = "user-examiner"
ORG = "org-1"


def _test(**overrides):
    base = {
        "id": "test-1",
        "candidate_id": CANDIDATE,
        "examiner_id": EXAMINER,
        "is_practice": False,
        "status": SkillTestStatus.COMPLETED.value,
        "result": "pass",
        "overall_score": 86.4,
        "validated_at": "2026-08-08T12:00:00Z",
        "released_at": None,
        "voided_at": None,
        "void_reason": None,
        "result_disclosure": None,
        "result_release": None,
        "result_viewer_positions": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _template(**overrides):
    base = {
        "name": "Power Lift and Cot",
        "result_disclosure": None,
        "result_release": None,
        "result_viewer_positions": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


@pytest.fixture
def sent(monkeypatch):
    """Capture notification writes instead of hitting the database."""
    captured: list[dict] = []

    async def _capture(db, **kwargs):
        captured.append(kwargs)
        return True

    monkeypatch.setattr(skills_testing_service, "_log_candidate_notification", _capture)
    return captured


class TestResultAvailable:
    async def test_validated_result_notifies_candidate(self, sent):
        assert await notify_candidate_result_available(
            None,
            test=_test(),
            template=_template(),
            org_config=None,
            organization_id=ORG,
        )
        assert len(sent) == 1
        assert sent[0]["candidate_id"] == CANDIDATE
        assert "Power Lift and Cot" in sent[0]["subject"]
        assert "Passed (86%)" in sent[0]["message"]
        assert sent[0]["test_id"] == "test-1"

    async def test_pending_validation_stays_silent(self, sent):
        """A member-run submission nobody has accepted yet is not a result."""
        assert not await notify_candidate_result_available(
            None,
            test=_test(validated_at=None),
            template=_template(),
            org_config=None,
            organization_id=ORG,
        )
        assert sent == []

    async def test_unreleased_result_stays_silent(self, sent):
        """Under on_release, validation makes the result count but not visible —
        the notification waits for the release that actually shows it."""
        assert not await notify_candidate_result_available(
            None,
            test=_test(),
            template=_template(result_release=ResultRelease.ON_RELEASE.value),
            org_config=None,
            organization_id=ORG,
        )
        assert sent == []

    async def test_release_notifies(self, sent):
        assert await notify_candidate_result_available(
            None,
            test=_test(released_at="2026-08-08T13:00:00Z"),
            template=_template(result_release=ResultRelease.ON_RELEASE.value),
            org_config=None,
            organization_id=ORG,
        )
        assert len(sent) == 1

    async def test_withheld_results_never_notify(self, sent):
        """Disclosure "none" means the test does not appear in their history at
        all; a notification would announce the evaluation the setting hides."""
        assert not await notify_candidate_result_available(
            None,
            test=_test(),
            template=_template(result_disclosure=ResultDisclosure.NONE.value),
            org_config=None,
            organization_id=ORG,
        )
        assert sent == []

    async def test_practice_attempts_never_notify(self, sent):
        assert not await notify_candidate_result_available(
            None,
            test=_test(is_practice=True),
            template=_template(),
            org_config=None,
            organization_id=ORG,
        )
        assert sent == []

    async def test_scores_tier_does_not_promise_notes(self, sent):
        """At the scores tier every note is stripped before the member sees the
        scorecard, so the message must not send them looking for one."""
        await notify_candidate_result_available(
            None,
            test=_test(),
            template=_template(result_disclosure=ResultDisclosure.SCORES.value),
            org_config=None,
            organization_id=ORG,
        )
        message = sent[0]["message"]
        assert "examiner notes are not" in message.lower()

    async def test_full_tier_mentions_notes(self, sent):
        await notify_candidate_result_available(
            None,
            test=_test(),
            template=_template(),
            org_config=None,
            organization_id=ORG,
        )
        assert "examiner's notes" in sent[0]["message"]

    async def test_org_default_governs_when_template_is_silent(self, sent):
        assert not await notify_candidate_result_available(
            None,
            test=_test(),
            template=_template(),
            org_config=SimpleNamespace(
                skills_result_disclosure=None,
                skills_result_release=ResultRelease.ON_RELEASE.value,
            ),
            organization_id=ORG,
        )
        assert sent == []

    async def test_failing_result_reads_as_failed(self, sent):
        await notify_candidate_result_available(
            None,
            test=_test(result="fail", overall_score=71.0),
            template=_template(),
            org_config=None,
            organization_id=ORG,
        )
        assert "Failed (71%)" in sent[0]["message"]


class TestResultVoided:
    async def test_void_notifies_with_reason(self, sent):
        assert await notify_candidate_result_voided(
            None,
            test=_test(
                status=SkillTestStatus.VOIDED.value,
                void_reason="Scored against the wrong candidate",
            ),
            template=_template(),
            org_config=None,
            organization_id=ORG,
        )
        assert "withdrawn" in sent[0]["subject"]
        assert "Scored against the wrong candidate" in sent[0]["message"]

    async def test_void_of_withheld_result_stays_silent(self, sent):
        """Telling a member their result was voided discloses, by implication,
        the evaluation the disclosure setting withheld."""
        assert not await notify_candidate_result_voided(
            None,
            test=_test(status=SkillTestStatus.VOIDED.value),
            template=_template(result_disclosure=ResultDisclosure.NONE.value),
            org_config=None,
            organization_id=ORG,
        )
        assert sent == []

    async def test_void_of_unreleased_result_stays_silent(self, sent):
        assert not await notify_candidate_result_voided(
            None,
            test=_test(status=SkillTestStatus.VOIDED.value),
            template=_template(result_release=ResultRelease.ON_RELEASE.value),
            org_config=None,
            organization_id=ORG,
        )
        assert sent == []

    async def test_void_without_reason_omits_the_clause(self, sent):
        await notify_candidate_result_voided(
            None,
            test=_test(status=SkillTestStatus.VOIDED.value, void_reason="   "),
            template=_template(),
            org_config=None,
            organization_id=ORG,
        )
        assert "Reason:" not in sent[0]["message"]


class TestCandidateResultView:
    """The helper the officer UI uses to say what the member will end up seeing."""

    def test_reports_the_tier_the_candidate_gets_not_the_officers(self):
        assert (
            candidate_result_view(
                _test(),
                _template(result_disclosure=ResultDisclosure.SCORES.value),
                None,
            )
            == ResultDisclosure.SCORES.value
        )

    def test_reports_pending_before_validation(self):
        assert candidate_result_view(_test(validated_at=None), _template(), None) == (
            skills_testing_service.RESULT_VIEW_PENDING
        )

    def test_reports_none_while_unreleased(self):
        assert (
            candidate_result_view(
                _test(),
                _template(result_release=ResultRelease.ON_RELEASE.value),
                None,
            )
            == ResultDisclosure.NONE.value
        )
