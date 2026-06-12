"""
Tests for event RSVP + waitlist logic (app/services/event_service.py).

Covers create_or_update_rsvp guards (event missing/cancelled, RSVP not
required, deadline passed, disallowed status), capacity-driven
auto-waitlisting, and promote_from_waitlist (no event, no capacity cap,
at-capacity no-op, no waitlisted member, and earliest-waitlisted promotion).
DB mocked; no MySQL.
"""

from datetime import datetime, timedelta
from datetime import timezone as tz
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.models.event import RSVPStatus
from app.schemas.event import RSVPCreate
from app.services.event_service import EventService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalar(value):
    return MagicMock(scalar=MagicMock(return_value=value))


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


def _event(**kw):
    return SimpleNamespace(
        id="e1",
        organization_id="org-1",
        is_cancelled=kw.get("is_cancelled", False),
        requires_rsvp=kw.get("requires_rsvp", True),
        rsvp_deadline=kw.get("rsvp_deadline"),
        allowed_rsvp_statuses=kw.get("allowed_rsvp_statuses", ["going", "not_going"]),
        max_attendees=kw.get("max_attendees"),
    )


class TestRsvpGuards:
    async def _run(self, db, status="going"):
        return await EventService(db).create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status=status), "org-1"
        )

    async def test_event_not_found(self):
        rsvp, err = await self._run(_db([_one(None)]))
        assert rsvp is None
        assert err == "Event not found"

    async def test_cancelled_event(self):
        rsvp, err = await self._run(_db([_one(_event(is_cancelled=True))]))
        assert err == "Cannot RSVP to cancelled event"

    async def test_rsvp_not_required(self):
        rsvp, err = await self._run(_db([_one(_event(requires_rsvp=False))]))
        assert err == "Event does not require RSVP"

    async def test_deadline_passed(self):
        past = datetime.now(tz.utc) - timedelta(hours=1)
        rsvp, err = await self._run(_db([_one(_event(rsvp_deadline=past))]))
        assert err == "RSVP deadline has passed"

    async def test_disallowed_status(self):
        ev = _event(allowed_rsvp_statuses=["going"])
        rsvp, err = await self._run(_db([_one(ev)]), status="not_going")
        assert "is not allowed" in err


class TestRsvpCapacity:
    async def test_new_going_under_capacity_stays_going(self):
        ev = _event(max_attendees=5)
        db = _db([_one(ev), _one(None), _scalar(2)])  # event, no existing, 2 going
        rsvp, err = await EventService(db).create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status="going"), "org-1"
        )
        assert err is None
        assert rsvp.status == "going"
        db.commit.assert_awaited()

    async def test_new_going_at_capacity_is_waitlisted(self):
        ev = _event(max_attendees=2)
        db = _db([_one(ev), _one(None), _scalar(2)])  # 2 going == cap
        rsvp, err = await EventService(db).create_or_update_rsvp(
            "e1", "u1", RSVPCreate(status="going"), "org-1"
        )
        assert err is None
        assert rsvp.status == RSVPStatus.WAITLISTED


class TestPromoteFromWaitlist:
    async def test_no_event(self):
        out = await EventService(_db([_one(None)])).promote_from_waitlist("e1", "org-1")
        assert out is None

    async def test_no_capacity_cap(self):
        out = await EventService(
            _db([_one(_event(max_attendees=None))])
        ).promote_from_waitlist("e1", "org-1")
        assert out is None

    async def test_at_capacity_no_promotion(self):
        ev = _event(max_attendees=2)
        db = _db([_one(ev), _scalar(2)])  # already full
        assert await EventService(db).promote_from_waitlist("e1", "org-1") is None

    async def test_capacity_but_no_waitlisted(self):
        ev = _event(max_attendees=5)
        db = _db([_one(ev), _scalar(3), _one(None)])  # room, but nobody waiting
        assert await EventService(db).promote_from_waitlist("e1", "org-1") is None

    async def test_promotes_earliest_waitlisted(self):
        ev = _event(max_attendees=5)
        waitlisted = SimpleNamespace(
            id="r1", status=RSVPStatus.WAITLISTED, updated_at=None
        )
        db = _db([_one(ev), _scalar(3), _one(waitlisted)])
        out = await EventService(db).promote_from_waitlist("e1", "org-1")
        assert out is waitlisted
        assert waitlisted.status == RSVPStatus.GOING
        assert waitlisted.updated_at is not None
        db.commit.assert_awaited()


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
