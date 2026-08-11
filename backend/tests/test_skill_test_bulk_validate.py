"""Accepting several submissions in one action.

Validation is not a bulk write: each one credits a pipeline requirement, spends
an attempt against its cap, and notifies a candidate. The endpoint therefore
delegates to ``validate_test`` per id rather than reimplementing any of it, and
these tests pin that delegation — a second implementation of the rules would
drift, and the thing it would drift on is who gets credited for what.

Partial success is the normal outcome, not an error: a colleague may act on one
of the selection between the officer loading the queue and pressing the button.

DB is mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import skills_testing as endpoint
from app.schemas.skills_testing import SkillTestBulkValidateRequest

ORG = uuid4()


def _officer():
    return SimpleNamespace(id=uuid4(), organization_id=ORG, username="chief")


@pytest.fixture
def audit(monkeypatch):
    spy = AsyncMock()
    monkeypatch.setattr(endpoint, "log_audit_event", spy)
    return spy


async def _run(ids, validate_impl, monkeypatch, audit):
    monkeypatch.setattr(endpoint, "validate_test", validate_impl)
    return await endpoint.bulk_validate_tests(
        payload=SkillTestBulkValidateRequest(test_ids=ids),
        db=SimpleNamespace(),
        current_user=_officer(),
    )


class TestDelegation:
    async def test_validates_every_id_through_the_single_test_path(
        self, monkeypatch, audit
    ):
        """The rules live in validate_test — SoD, the attempt cap, the pipeline
        apply, the notification. Bulk must go through all of them."""
        ids = [uuid4() for _ in range(3)]
        seen = []

        async def fake(test_id, db, current_user):
            seen.append(test_id)
            return SimpleNamespace()

        result = await _run(ids, fake, monkeypatch, audit)

        assert seen == ids
        assert result.validated == ids
        assert result.skipped == []

    async def test_passes_the_acting_officer_through(self, monkeypatch, audit):
        """Separation of duties is decided against the caller, so the officer
        must reach validate_test unchanged — a bulk action must not become a
        way to sign off your own result."""
        captured = {}

        async def fake(test_id, db, current_user):
            captured["user"] = current_user
            return SimpleNamespace()

        await _run([uuid4()], fake, monkeypatch, audit)

        assert captured["user"].organization_id == ORG


class TestPartialSuccess:
    async def test_a_refusal_does_not_take_the_batch_down_with_it(
        self, monkeypatch, audit
    ):
        good_a, bad, good_b = uuid4(), uuid4(), uuid4()

        async def fake(test_id, db, current_user):
            if test_id == bad:
                raise HTTPException(status_code=400, detail="No attempts remaining")
            return SimpleNamespace()

        result = await _run([good_a, bad, good_b], fake, monkeypatch, audit)

        assert result.validated == [good_a, good_b]
        assert result.skipped == [
            {"test_id": str(bad), "reason": "No attempts remaining"}
        ]

    async def test_reports_why_each_one_was_skipped(self, monkeypatch, audit):
        """An officer who selected ten and got eight needs to know which two and
        why, or the queue silently keeps two rows they think they cleared."""
        already, voided = uuid4(), uuid4()

        async def fake(test_id, db, current_user):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Only a completed test has a result to validate"
                    if test_id == voided
                    else "You cannot validate your own evaluation"
                ),
            )

        result = await _run([already, voided], fake, monkeypatch, audit)

        assert result.validated == []
        reasons = {s["test_id"]: s["reason"] for s in result.skipped}
        assert reasons[str(voided)].startswith("Only a completed test")
        assert reasons[str(already)].startswith("You cannot validate")

    async def test_every_id_failing_is_still_a_success_response(
        self, monkeypatch, audit
    ):
        """Nothing went wrong with the *request* — the officer just picked rows
        somebody else had already dealt with. A 4xx here would discard the
        per-test reasons that explain it."""
        ids = [uuid4(), uuid4()]

        async def fake(test_id, db, current_user):
            raise HTTPException(status_code=400, detail="Already voided")

        result = await _run(ids, fake, monkeypatch, audit)

        assert result.validated == []
        assert len(result.skipped) == 2


class TestAudit:
    async def test_records_the_action_itself(self, monkeypatch, audit):
        """Beside the per-test entries validate_test writes. A reader asking why
        nine results changed at once should find one deliberate act."""
        ids = [uuid4() for _ in range(2)]

        async def fake(test_id, db, current_user):
            return SimpleNamespace()

        await _run(ids, fake, monkeypatch, audit)

        assert audit.await_count == 1
        data = audit.await_args.kwargs["event_data"]
        assert audit.await_args.kwargs["event_type"] == "skill_tests_bulk_validated"
        assert data["requested"] == 2
        assert data["validated"] == 2
        assert data["skipped"] == []

    async def test_the_audit_entry_names_what_was_skipped(self, monkeypatch, audit):
        bad = uuid4()

        async def fake(test_id, db, current_user):
            raise HTTPException(status_code=400, detail="Already validated")

        await _run([bad], fake, monkeypatch, audit)

        data = audit.await_args.kwargs["event_data"]
        assert data["validated"] == 0
        assert data["skipped"][0]["reason"] == "Already validated"


class TestRequestShape:
    def test_an_empty_selection_is_rejected(self):
        with pytest.raises(Exception):
            SkillTestBulkValidateRequest(test_ids=[])

    def test_the_batch_is_capped(self):
        """Each id is a burst of side effects, so one click's worth of
        consequences stays reviewable."""
        with pytest.raises(Exception):
            SkillTestBulkValidateRequest(test_ids=[uuid4() for _ in range(51)])

    def test_a_full_batch_is_accepted(self):
        req = SkillTestBulkValidateRequest(test_ids=[uuid4() for _ in range(50)])
        assert len(req.test_ids) == 50
