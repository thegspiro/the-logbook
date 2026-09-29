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
import re
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


def _rsvp(user_id=MEMBER):
    return SimpleNamespace(
        user_id=str(user_id),
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


def _ids(approval):
    result = MagicMock()
    result.one_or_none.return_value = (
        approval.event_id,
        approval.training_session_id,
    )
    return result


def _all(items):
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    return result


def _event(**overrides):
    fields = {"id": "event-1", "event_type": "training", "is_cancelled": False}
    fields.update(overrides)
    return SimpleNamespace(**fields)


def _session(**overrides):
    fields = {"id": "session-1", "is_finalized": True}
    fields.update(overrides)
    return SimpleNamespace(**fields)


def _service(approval, rsvps=None, event=None, session=None):
    """Reads in submit's order: the token's ids, then event, session and
    approval locked in the order every writer takes them, then the RSVPs."""
    db = MagicMock()
    results = [
        _ids(approval),
        _one(event or _event()),
        _one(session or _session()),
        _one(approval),
    ]
    if rsvps is not None:
        results.append(_all(rsvps))
    db.execute = AsyncMock(side_effect=results)
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
        svc, db = _service(approval)

        ok, error = await _submit(svc, [_attendee(), _attendee(user_id=OUTSIDER)])

        assert ok is False
        assert error == "Attendee is not part of this approval"
        assert approval.status == ApprovalStatus.PENDING
        svc._finalize_training_records.assert_not_awaited()
        db.commit.assert_not_awaited()

    async def test_negative_minutes_are_refused(self):
        approval = _approval()
        svc, db = _service(approval)

        ok, error = await _submit(svc, [_attendee(override_duration_minutes=-5)])

        assert ok is False
        assert "negative" in error
        db.commit.assert_not_awaited()

    @pytest.mark.parametrize(
        ("submitted", "message"),
        [
            ([], "Every attendee on this approval must be included"),
            ("twice", "An attendee is listed more than once"),
        ],
    )
    async def test_the_whole_roster_exactly_once(self, submitted, message):
        """A partial approval left the members it omitted with in-progress
        records nothing pending would ever complete; a duplicate let the last
        of two conflicting figures win silently."""
        approval = _approval()
        svc, db = _service(approval)
        attendees = (
            [_attendee(override_duration_minutes=60), _attendee()]
            if submitted == "twice"
            else submitted
        )

        ok, error = await _submit(svc, attendees)

        assert ok is False
        assert error.startswith(message)
        assert approval.status == ApprovalStatus.PENDING
        db.commit.assert_not_awaited()

    async def test_a_member_no_longer_on_the_attendance_is_refused(self):
        approval = _approval()
        svc, db = _service(approval, rsvps=[])

        ok, error = await _submit(svc, [_attendee()])

        assert ok is False
        assert "no longer on the event's attendance" in error
        assert approval.status == ApprovalStatus.PENDING
        db.commit.assert_not_awaited()


class TestWhatTheApprovalStillStandsFor:
    """Each of these moved on after the link was sent; the event lock the
    submit now takes first is what makes it see that."""

    @pytest.mark.parametrize(
        "event",
        [_event(is_cancelled=True), _event(event_type="business_meeting")],
        ids=["cancelled", "retyped"],
    )
    async def test_a_cancelled_or_retyped_event_is_refused(self, event):
        approval = _approval()
        svc, db = _service(approval, event=event)

        ok, error = await _submit(svc, [_attendee()])

        assert ok is False
        assert error == "This event was cancelled or is no longer a Training event"
        db.commit.assert_not_awaited()

    async def test_a_reopened_session_is_refused_whatever_the_clock_says(self):
        approval = _approval()
        svc, db = _service(approval, session=_session(is_finalized=False))

        ok, error = await _submit(svc, [_attendee()])

        assert (ok, error) == (False, "This approval link has expired")
        db.commit.assert_not_awaited()

    async def test_locks_follow_the_writers_order(self):
        approval = _approval()
        svc, db = _service(approval, rsvps=[_rsvp()])

        await _submit(svc, [_attendee()])

        statements = [c.args[0] for c in db.execute.await_args_list]
        locked = [
            re.search(
                r"FROM (\w+)", str(s.compile(compile_kwargs={"literal_binds": True}))
            ).group(1)
            for s in statements[1:4]
        ]
        assert locked == ["events", "training_sessions", "training_approvals"]
        assert all(s._for_update_arg is not None for s in statements[1:4])
        for s in statements[1:4]:
            compiled = str(s.compile(compile_kwargs={"literal_binds": True}))
            assert "organization_id = 'org-1'" in compiled


class TestStoredRoster:
    async def test_attendee_data_is_json_serializable(self):
        approval = _approval()
        svc, _db = _service(approval, rsvps=[_rsvp()])

        ok, error = await _submit(svc, [_attendee(override_duration_minutes=200)])

        assert (ok, error) == (True, None)
        # The engine serializes JSON columns with the stdlib encoder.
        stored = json.loads(json.dumps(approval.attendee_data))
        assert stored[0]["user_id"] == str(MEMBER)
        assert stored[0]["override_duration_minutes"] == 200
        assert approval.status == ApprovalStatus.APPROVED

    async def test_the_client_cannot_rewrite_who_attended(self):
        """Only the officer's own fields come from the request; the name, the
        email and the credited times stay as finalize recorded them."""
        approval = _approval()
        svc, _db = _service(approval, rsvps=[_rsvp()])

        await _submit(
            svc,
            [
                _attendee(
                    user_name="Somebody Else",
                    user_email="else@example.org",
                    calculated_duration_minutes=999,
                    notes="Stayed for the whole drill",
                )
            ],
        )

        (stored,) = approval.attendee_data
        assert stored["user_name"] == "Pat Member"
        assert stored["user_email"] == "pat@example.org"
        assert stored["calculated_duration_minutes"] == 240
        assert stored["notes"] == "Stayed for the whole drill"


class TestOverrides:
    async def test_zero_minutes_is_applied_not_skipped(self):
        rsvp = _rsvp()
        svc, _db = _service(_approval(), rsvps=[rsvp])

        ok, _ = await _submit(svc, [_attendee(override_duration_minutes=0)])

        assert ok is True
        assert rsvp.override_duration_minutes == 0

    async def test_override_times_without_minutes_set_the_duration(self):
        rsvp = _rsvp()
        svc, _db = _service(_approval(), rsvps=[rsvp])

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
        svc, db = _service(_approval(), rsvps=[_rsvp()])

        await _submit(svc, [_attendee()])

        rsvp_query = db.execute.await_args_list[4].args[0]
        compiled = str(rsvp_query.compile(compile_kwargs={"literal_binds": True}))
        assert "event_rsvps.organization_id = 'org-1'" in compiled
        assert f"event_rsvps.user_id IN ('{MEMBER}')" in compiled


class TestApprovalSummary:
    """The event page's view of an approval: the token is the link's secret."""

    def _svc(self, approvals):
        db = MagicMock()
        result = MagicMock()
        result.scalars.return_value.all.return_value = approvals
        db.execute = AsyncMock(return_value=result)
        svc = TrainingSessionService(db)
        svc.get_session_by_event = AsyncMock(return_value=SimpleNamespace(id="s-1"))
        return svc

    def _approval(self, status, expires_in_days, created_offset=0):
        now = datetime.now(timezone.utc)
        return SimpleNamespace(
            id=f"a-{status.value}-{created_offset}",
            status=status,
            token_expires_at=now + timedelta(days=expires_in_days),
            approval_deadline=now + timedelta(days=7),
            approved_at=None,
            attendee_data=[{"user_id": "u-1"}, {"user_id": "u-2"}],
            approval_token="secret-token",
        )

    async def test_token_only_for_an_approver_while_pending(self):
        pending = self._approval(ApprovalStatus.PENDING, 5)

        summary = await self._svc([pending]).get_approval_summary_for_event(
            "event-1", "org-1", include_token=True
        )
        assert summary["token"] == "secret-token"
        assert summary["attendee_count"] == 2
        assert summary["expired"] is False

        summary = await self._svc([pending]).get_approval_summary_for_event(
            "event-1", "org-1", include_token=False
        )
        assert summary["token"] is None

    async def test_no_token_once_approved_or_expired(self):
        approved = self._approval(ApprovalStatus.APPROVED, 5)
        summary = await self._svc([approved]).get_approval_summary_for_event(
            "event-1", "org-1", include_token=True
        )
        assert summary["token"] is None
        assert summary["status"] == "approved"

        expired = self._approval(ApprovalStatus.PENDING, -1)
        summary = await self._svc([expired]).get_approval_summary_for_event(
            "event-1", "org-1", include_token=True
        )
        assert summary["token"] is None
        assert summary["expired"] is True

    async def test_a_live_pending_approval_wins_over_a_newer_one(self):
        """Newest first by creation, but the one an officer can act on is
        what the page must show."""
        newer_approved = self._approval(ApprovalStatus.APPROVED, 5, 1)
        live = self._approval(ApprovalStatus.PENDING, 5, 2)
        summary = await self._svc(
            [newer_approved, live]
        ).get_approval_summary_for_event("event-1", "org-1", include_token=True)
        assert summary["approval_id"] == live.id

    async def test_none_without_a_session(self):
        svc = self._svc([])
        svc.get_session_by_event = AsyncMock(return_value=None)
        assert (
            await svc.get_approval_summary_for_event("e", "o", include_token=True)
            is None
        )


class TestSupersede:
    def test_a_superseded_link_is_dead_even_after_mysql_rounds_it(self):
        """MySQL DATETIME(0) rounds a fraction: a raw now of x.6 s is stored as
        x+1 s, leaving the link good for another 0.4 s — long enough for a
        submit queued behind the reopen's lock to approve the old roster."""
        now = datetime(2026, 9, 20, 13, 0, 0, 600000, tzinfo=timezone.utc)
        approval = SimpleNamespace(token_expires_at=now + timedelta(days=30))

        TrainingSessionService._supersede([approval], now)

        stored = approval.token_expires_at
        assert stored.microsecond == 0
        # Rounding a whole second changes nothing, and it is already past for
        # a submit that arrives 50 ms later.
        assert stored < now + timedelta(milliseconds=50)
        assert stored <= now - timedelta(seconds=1)


class TestSummaryAfterAnEmptyFinalize:
    async def test_nobody_credited_reports_nothing(self):
        """The newest finalize credited nobody and left an empty approval; an
        older one would describe credit that has since been taken back."""
        now = datetime.now(timezone.utc)
        empty = SimpleNamespace(
            id="a-new",
            status=ApprovalStatus.APPROVED,
            token_expires_at=now + timedelta(days=30),
            approval_deadline=now,
            approved_at=now,
            attendee_data=[],
            approval_token="t-new",
        )
        older = SimpleNamespace(
            id="a-old",
            status=ApprovalStatus.APPROVED,
            token_expires_at=now + timedelta(days=29),
            approval_deadline=now,
            approved_at=now - timedelta(days=1),
            attendee_data=[{"user_id": "u-1"}],
            approval_token="t-old",
        )
        db = MagicMock()
        result = MagicMock()
        result.scalars.return_value.all.return_value = [empty, older]
        db.execute = AsyncMock(return_value=result)
        svc = TrainingSessionService(db)
        svc.get_session_by_event = AsyncMock(return_value=SimpleNamespace(id="s-1"))

        assert (
            await svc.get_approval_summary_for_event("e", "o", include_token=True)
            is None
        )
