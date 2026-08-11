"""Sending a submitted result back to its examiner.

The third exit from a pending submission, beside validate and void. Voiding is
right for a result that was *wrong* — the record survives with its reason,
which is what a candidate who sat the evaluation is owed — and wrong for one
that was simply not finished properly. "The captain mis-scored step 4, have him
redo it" should not cost a permanent, candidate-visible withdrawal.

The rules that matter here are about what a return must *not* do: it must not
touch a result that already stands, must not claim anything about the
candidate, and must not throw away the marks the examiner already recorded.

DB is mocked; no MySQL.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import skills_testing as endpoint
from app.models.skills_testing import SkillTestResult, SkillTestStatus
from app.schemas.skills_testing import SkillTestReturnRequest

ORG = uuid4()
TEST_ID = uuid4()


def _scalar(value):
    r = MagicMock()
    r.scalar_one_or_none.return_value = value
    return r


class QueuedSession:
    """AsyncSession stand-in handing back queued results in call order."""

    def __init__(self, results):
        self._results = list(results)
        self.committed = False

    async def execute(self, *_args, **_kwargs):
        return self._results.pop(0) if self._results else _scalar(None)

    async def commit(self):
        self.committed = True

    async def refresh(self, _obj):
        return None


def _test(**overrides):
    base = {
        "id": str(TEST_ID),
        "organization_id": ORG,
        "template_id": str(uuid4()),
        "candidate_id": str(uuid4()),
        "examiner_id": str(uuid4()),
        "requirement_id": None,
        "is_practice": False,
        "status": SkillTestStatus.COMPLETED.value,
        "result": SkillTestResult.PASS.value,
        "validated_at": None,
        "validated_by": None,
        "released_at": None,
        "released_by": None,
        "voided_at": None,
        "voided_by": None,
        "void_reason": None,
        "returned_at": None,
        "returned_by": None,
        "return_reason": None,
        "return_count": 0,
        "resume_count": 0,
        "version": 3,
        "section_results": [{"section_id": "section-0", "criteria_results": []}],
        "overall_score": 88.0,
        "elapsed_seconds": 300,
        "notes": None,
        "started_at": datetime(2026, 8, 8, 10, 0, tzinfo=timezone.utc),
        "completed_at": datetime(2026, 8, 8, 10, 30, tzinfo=timezone.utc),
        "created_at": datetime(2026, 8, 8, 10, 0, tzinfo=timezone.utc),
        "updated_at": datetime(2026, 8, 8, 10, 30, tzinfo=timezone.utc),
        "template_snapshot": None,
        "result_disclosure": None,
        "result_release": None,
        "result_viewer_positions": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _officer():
    return SimpleNamespace(
        id=uuid4(),
        organization_id=ORG,
        username="chief",
        first_name="Dana",
        last_name="Ruiz",
    )


def _template():
    return SimpleNamespace(
        id=str(uuid4()),
        name="SCBA Donning",
        sections=[
            {"name": "Donning", "criteria": [{"label": "Dons", "type": "pass_fail"}]}
        ],
        passing_percentage=None,
        require_all_critical=True,
        score_pass_fail_criteria=False,
        time_limit_seconds=None,
        result_disclosure=None,
        result_release=None,
        result_viewer_positions=None,
    )


REASON = SkillTestReturnRequest(reason="Step 4 marked pass but the note says it leaked")


async def _call(test, monkeypatch, session=None):
    """Drive the endpoint with everything after the guards mocked out."""
    user = _officer()
    tmpl = _template()
    person = SimpleNamespace(first_name="Nadia", last_name="Belhaj", username="nbelhaj")
    session = session or QueuedSession(
        [_scalar(test), _scalar(tmpl), _scalar(person), _scalar(person)]
    )
    monkeypatch.setattr(endpoint, "log_audit_event", AsyncMock())
    monkeypatch.setattr(endpoint, "_org_training_config", AsyncMock(return_value=None))
    response = await endpoint.return_test_for_correction(
        test_id=TEST_ID, return_data=REASON, db=session, current_user=user
    )
    return response, session, user


class TestGuards:
    async def test_a_missing_test_is_a_404(self, monkeypatch):
        session = QueuedSession([_scalar(None)])
        monkeypatch.setattr(endpoint, "log_audit_event", AsyncMock())
        with pytest.raises(HTTPException) as exc:
            await endpoint.return_test_for_correction(
                test_id=TEST_ID,
                return_data=REASON,
                db=session,
                current_user=_officer(),
            )
        assert exc.value.status_code == 404

    async def test_a_practice_attempt_has_nothing_to_send_back(self, monkeypatch):
        """Practice attempts are never reviewed, so no officer ever holds one."""
        with pytest.raises(HTTPException) as exc:
            await _call(_test(is_practice=True), monkeypatch)
        assert exc.value.status_code == 400
        assert "practice" in exc.value.detail.lower()

    @pytest.mark.parametrize(
        "status",
        [
            SkillTestStatus.IN_PROGRESS.value,
            SkillTestStatus.DRAFT.value,
            SkillTestStatus.CANCELLED.value,
            SkillTestStatus.VOIDED.value,
        ],
    )
    async def test_only_a_completed_test_can_be_returned(self, status, monkeypatch):
        with pytest.raises(HTTPException) as exc:
            await _call(_test(status=status), monkeypatch)
        assert exc.value.status_code == 400
        assert "completed" in exc.value.detail.lower()

    async def test_a_validated_result_must_be_voided_instead(self, monkeypatch):
        """The rule that keeps this from becoming a silent undo.

        Once validated, a result has credited its requirement, spent an attempt
        and become visible to the candidate. Reopening it would strip all three
        without saying so — voiding is the transition that releases them.
        """
        validated = _test(validated_at=datetime(2026, 8, 8, 11, 0, tzinfo=timezone.utc))
        with pytest.raises(HTTPException) as exc:
            await _call(validated, monkeypatch)
        assert exc.value.status_code == 400
        assert "void" in exc.value.detail.lower()


class TestTransition:
    async def test_reopens_the_test_to_its_examiner(self, monkeypatch):
        test = _test()
        await _call(test, monkeypatch)

        assert test.status == SkillTestStatus.IN_PROGRESS.value
        assert test.completed_at is None

    async def test_clears_the_verdict_with_the_status(self, monkeypatch):
        """A stale pass on a reopened test would report an outcome nobody has
        accepted; complete_test recomputes it from the marks anyway."""
        test = _test(result=SkillTestResult.PASS.value)
        await _call(test, monkeypatch)

        assert test.result == SkillTestResult.INCOMPLETE.value

    async def test_keeps_every_mark_the_examiner_recorded(self, monkeypatch):
        """The point of a return over a void: they correct a step rather than
        re-run the evolution."""
        test = _test()
        original = test.section_results
        await _call(test, monkeypatch)

        assert test.section_results == original

    async def test_records_who_returned_it_and_why(self, monkeypatch):
        test = _test()
        _resp, _session, user = await _call(test, monkeypatch)

        assert test.returned_by == str(user.id)
        assert test.return_reason == REASON.reason
        assert test.returned_at is not None

    async def test_counts_the_returns(self, monkeypatch):
        """One return is a slip; a third is a training conversation, and the
        officer should see the difference without reading the audit log."""
        test = _test(return_count=2)
        await _call(test, monkeypatch)

        assert test.return_count == 3

    async def test_bumps_the_version_so_a_stale_client_write_is_refused(
        self, monkeypatch
    ):
        test = _test(version=3)
        await _call(test, monkeypatch)

        assert test.version == 4

    async def test_touches_nothing_the_candidate_has_been_promised(self, monkeypatch):
        """Nothing has been claimed about them: no validation, no release, no
        void, and the requirement link is untouched."""
        requirement = str(uuid4())
        test = _test(requirement_id=requirement)
        await _call(test, monkeypatch)

        assert test.validated_at is None
        assert test.released_at is None
        assert test.voided_at is None
        # The link survives: a returned test still means to credit the same
        # requirement once it is finished and accepted.
        assert test.requirement_id == requirement

    async def test_persists_the_change(self, monkeypatch):
        test = _test()
        _resp, session, _user = await _call(test, monkeypatch)
        assert session.committed is True

    async def test_audits_the_return(self, monkeypatch):
        audit = AsyncMock()
        monkeypatch.setattr(endpoint, "log_audit_event", audit)
        monkeypatch.setattr(
            endpoint, "_org_training_config", AsyncMock(return_value=None)
        )
        test = _test()
        tmpl = _template()
        person = SimpleNamespace(first_name="N", last_name="B", username="nb")
        await endpoint.return_test_for_correction(
            test_id=TEST_ID,
            return_data=REASON,
            db=QueuedSession(
                [_scalar(test), _scalar(tmpl), _scalar(person), _scalar(person)]
            ),
            current_user=_officer(),
        )

        assert audit.await_count == 1
        payload = audit.await_args.kwargs
        assert payload["event_type"] == "skill_test_returned"
        assert payload["event_data"]["reason"] == REASON.reason
        assert payload["event_data"]["return_count"] == 1

    async def test_the_response_carries_the_return_trail(self, monkeypatch):
        response, _session, user = await _call(_test(), monkeypatch)

        assert response.return_reason == REASON.reason
        assert response.return_count == 1
        assert response.returned_by_name == "Dana Ruiz"
        # Reopened, so it is no longer awaiting anyone's sign-off.
        assert response.pending_validation is False
        assert response.status == SkillTestStatus.IN_PROGRESS.value


class TestReasonRequirement:
    """The reason tells the examiner what to fix. 'Please correct' teaches
    nothing, so the floor matches the void reason's."""

    @pytest.mark.parametrize("bad", ["", "   ", "too short", "fix it"])
    def test_a_trivial_reason_is_rejected(self, bad):
        with pytest.raises(Exception):
            SkillTestReturnRequest(reason=bad)

    def test_a_real_reason_is_accepted(self):
        req = SkillTestReturnRequest(reason="Step 4 contradicts your note — recheck")
        assert req.reason.startswith("Step 4")
