"""
Tests for event reminder recipient selection
(app/services/event_service.py :: send_event_reminders).

Covers the event guards (missing / cancelled) and the two audiences:
"all" active members, and "non_respondents" (active members minus anyone
who already has an RSVP). DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.services.event_service import EventService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _rows(rows):
    return MagicMock(all=MagicMock(return_value=rows))


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    return db


def _event(cancelled=False):
    return SimpleNamespace(is_cancelled=cancelled)


class TestSendEventReminders:
    async def test_event_not_found(self):
        ids, err = await EventService(_db([_one(None)])).send_event_reminders(
            "e1", "org-1"
        )
        assert ids == []
        assert err == "Event not found"

    async def test_cancelled_event(self):
        ids, err = await EventService(
            _db([_one(_event(cancelled=True))])
        ).send_event_reminders("e1", "org-1")
        assert ids == []
        assert "cancelled" in err

    async def test_all_members(self):
        db = _db([_one(_event()), _rows([("u1",), ("u2",), ("u3",)])])
        ids, err = await EventService(db).send_event_reminders(
            "e1", "org-1", reminder_type="all"
        )
        assert err is None
        assert ids == ["u1", "u2", "u3"]

    async def test_non_respondents_excludes_rsvped(self):
        db = _db(
            [
                _one(_event()),
                _rows([("u1",), ("u2",), ("u3",)]),  # all active members
                _rows([("u2",)]),  # u2 already RSVP'd
            ]
        )
        ids, err = await EventService(db).send_event_reminders(
            "e1", "org-1", reminder_type="non_respondents"
        )
        assert err is None
        assert ids == ["u1", "u3"]

    async def test_non_respondents_default_type(self):
        # Default reminder_type is "non_respondents".
        db = _db([_one(_event()), _rows([("u1",), ("u2",)]), _rows([("u1",)])])
        ids, _ = await EventService(db).send_event_reminders("e1", "org-1")
        assert ids == ["u2"]

    async def test_non_respondents_all_responded(self):
        db = _db([_one(_event()), _rows([("u1",)]), _rows([("u1",)])])
        ids, err = await EventService(db).send_event_reminders("e1", "org-1")
        assert ids == []
        assert err is None


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
