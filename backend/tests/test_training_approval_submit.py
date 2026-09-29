"""Submitting a training approval: the roster it may touch and what it stores.

Three defects in the officer approval path, which had no working page until
now and so no caller to surface them:

* ``attendee_data`` was stored from a python-mode dump, carrying UUID and
  datetime objects into a JSON column with no custom serializer, so every real
  submission failed at flush with a TypeError.
* The request named attendees by user id and nothing checked them against the
  roster the approval was issued for, so an approver could write a completed
  record and an attendance override for any member of the organization (XC-1).
* Overrides were applied on truthiness, so an approved 0 minutes fell through
  to the member's measured time instead of meaning "no credit".
"""

import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.models.training import ApprovalStatus
from app.schemas.training_session import AttendeeApprovalData
from app.services.training_session_service import TrainingSessionService

pytestmark = pytest.mark.unit

START = datetime(2026, 9, 20, 13, 0, tzinfo=timezone.utc)
MEMBER = uuid4()
OUTSIDER = uuid4()


def _one(value):
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    return result


def _approval():
    return SimpleNamespace(
        id="approval-1",
        organization_id="org-1",
        training_session_id="session-1",
        event_id="event-1",
        status=ApprovalStatus.PENDING,
        token_expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        approved_by=None,
        approved_at=None,
        approval_notes=None,
        attendee_data=[
            {
                "user_id": str(MEMBER),
                "user_name": "Pat Member",
                "user_email": "pat@example.org",
                "checked_in_at": START.isoformat(),
                "checked_out_at": (START + timedelta(hours=4)).isoformat(),
                "calculated_duration_minutes": 240,
            }
        ],
    )


def _rsvp():
    return SimpleNamespace(
        override_check_in_at=None,
        override_check_out_at=None,
        override_duration_minutes=None,
        overridden_by=None,
        overridden_at=None,
    )


def _attendee(user_id=MEMBER, **overrides):
    fields = {
        "user_id": user_id,
        "user_name": "Pat Member",
        "user_email": "pat@example.org",
        "checked_in_at": START,
        "checked_out_at": START + timedelta(hours=4),
        "calculated_duration_minutes": 240,
        "approved": True,
    }
    fields.update(overrides)
    return AttendeeApprovalData(**fields)


def _service(*results):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=list(results))
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    svc = TrainingSessionService(db)
    svc._finalize_training_records = AsyncMock(return_value=[])
    svc._apply_pipeline_updates = AsyncMock()
    svc._resync_admin_hours = AsyncMock()
    return svc, db


async def _submit(svc, attendees):
    return await svc.submit_training_approval(
        token="tok",
        attendees=attendees,
        approval_notes=None,
        approved_by=uuid4(),
        organization_id="org-1",
    )


class TestRoster:
    async def test_an_attendee_outside_the_approval_is_refused(self):
        approval = _approval()
        svc, db = _service(_one(approval))

        ok, error = await _submit(svc, [_attendee(), _attendee(user_id=OUTSIDER)])

        assert ok is False
        assert error == "Attendee is not part of this approval"
        assert approval.status == ApprovalStatus.PENDING
        svc._finalize_training_records.assert_not_awaited()
        db.commit.assert_not_awaited()

    async def test_negative_minutes_are_refused(self):
        approval = _approval()
        svc, db = _service(_one(approval))

        ok, error = await _submit(svc, [_attendee(override_duration_minutes=-5)])

        assert ok is False
        assert "negative" in error
        db.commit.assert_not_awaited()


class TestStoredRoster:
    async def test_attendee_data_is_json_serializable(self):
        approval = _approval()
        svc, _db = _service(_one(approval), _one(_rsvp()))

        ok, error = await _submit(svc, [_attendee(override_duration_minutes=200)])

        assert (ok, error) == (True, None)
        # The engine serializes JSON columns with the stdlib encoder.
        stored = json.loads(json.dumps(approval.attendee_data))
        assert stored[0]["user_id"] == str(MEMBER)
        assert stored[0]["override_duration_minutes"] == 200
        assert approval.status == ApprovalStatus.APPROVED


class TestOverrides:
    async def test_zero_minutes_is_applied_not_skipped(self):
        rsvp = _rsvp()
        svc, _db = _service(_one(_approval()), _one(rsvp))

        ok, _ = await _submit(svc, [_attendee(override_duration_minutes=0)])

        assert ok is True
        assert rsvp.override_duration_minutes == 0

    async def test_override_times_without_minutes_set_the_duration(self):
        rsvp = _rsvp()
        svc, _db = _service(_one(_approval()), _one(rsvp))

        ok, _ = await _submit(
            svc,
            [
                _attendee(
                    override_check_in_at=START,
                    override_check_out_at=START + timedelta(hours=3, minutes=30),
                )
            ],
        )

        assert ok is True
        assert rsvp.override_duration_minutes == 210

    async def test_rsvp_lookup_is_org_scoped(self):
        svc, db = _service(_one(_approval()), _one(_rsvp()))

        await _submit(svc, [_attendee()])

        rsvp_query = db.execute.await_args_list[1].args[0]
        compiled = str(rsvp_query.compile(compile_kwargs={"literal_binds": True}))
        assert "event_rsvps.organization_id = 'org-1'" in compiled
        assert f"event_rsvps.user_id = '{MEMBER}'" in compiled
