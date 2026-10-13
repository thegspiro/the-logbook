"""W19-1: a member promoted off an event's waitlist is emailed, not only told
in the app, and the email has its own switch among their email preferences.

Email is the channel of record (CLAUDE.md pitfall 18); the switch has a reader
(pitfall 19) — ``_email_waitlist_promotion`` consults it through
``member_receives_email`` before sending. DB mocked; no MySQL.
"""

from datetime import datetime, timedelta
from datetime import timezone as tz
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.email_template import EmailTemplateType
from app.models.event import RSVPStatus
from app.services.email_policy import EMAIL_POLICIES, EmailKind
from app.services.email_service import EmailService
from app.services.event_service import EventService

pytestmark = pytest.mark.unit

_SEND = "app.services.email_service.EmailService.send_waitlist_promotion_email"


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


def _event(**kw):
    return SimpleNamespace(
        id="e1",
        title="Hose Advancement Drill",
        organization_id="org-1",
        start_datetime=datetime(2026, 11, 3, 23, 0, tzinfo=tz.utc),
        end_datetime=datetime.now(tz.utc) + timedelta(days=1),
        location=kw.get("location", "Training Bay"),
        location_id=kw.get("location_id"),
        max_attendees=kw.get("max_attendees", 5),
        is_cancelled=False,
        attendance_finalized_at=None,
    )


def _member(prefs=None, email="jdoe@example.org"):
    return SimpleNamespace(
        id="u9",
        email=email,
        display_name="John Doe",
        notification_preferences=prefs,
    )


def _org(settings=None):
    return SimpleNamespace(id="org-1", settings=settings or {}, timezone="UTC")


class TestTheSwitch:
    def test_it_is_an_optional_member_email_on_by_default(self):
        policy = EMAIL_POLICIES[EmailKind.EVENT_WAITLIST]
        assert policy.required is False
        assert policy.default_on is True
        assert policy.audience.value == "members"

    def test_it_is_not_folded_into_event_reminders(self):
        """Its own switch, as the owner chose: muting reminders must not
        silence the news that a seat is now held."""
        assert EmailKind.EVENT_WAITLIST is not EmailKind.EVENT_REMINDERS
        assert EMAIL_POLICIES[EmailKind.EVENT_WAITLIST].legacy_preference is None


class TestEmailWaitlistPromotion:
    async def test_emails_a_member_who_has_not_chosen(self):
        db = _db([_one(_member()), _one(_org())])
        with patch(_SEND, new=AsyncMock(return_value=True)) as send:
            sent = await EventService(db)._email_waitlist_promotion(
                _event(), "u9", "org-1"
            )
        assert sent is True
        kwargs = send.await_args.kwargs
        assert kwargs["to_email"] == "jdoe@example.org"
        assert kwargs["recipient_name"] == "John Doe"
        assert kwargs["event_title"] == "Hose Advancement Drill"
        assert kwargs["location_name"] == "Training Bay"
        assert kwargs["event_url"].endswith("/events/e1")

    async def test_member_who_turned_it_off_is_not_emailed(self):
        prefs = {"email_kinds": {"event_waitlist": False}}
        db = _db([_one(_member(prefs)), _one(_org())])
        with patch(_SEND, new=AsyncMock(return_value=True)) as send:
            sent = await EventService(db)._email_waitlist_promotion(
                _event(), "u9", "org-1"
            )
        assert sent is False
        send.assert_not_awaited()

    async def test_turning_off_event_reminders_does_not_turn_this_off(self):
        prefs = {"event_reminders": False, "email_kinds": {"event_reminders": False}}
        db = _db([_one(_member(prefs)), _one(_org())])
        with patch(_SEND, new=AsyncMock(return_value=True)) as send:
            await EventService(db)._email_waitlist_promotion(_event(), "u9", "org-1")
        send.assert_awaited_once()

    async def test_department_can_require_it(self):
        prefs = {"email_kinds": {"event_waitlist": False}}
        org = _org({"email_policy": {"required_kinds": ["event_waitlist"]}})
        db = _db([_one(_member(prefs)), _one(org)])
        with patch(_SEND, new=AsyncMock(return_value=True)) as send:
            await EventService(db)._email_waitlist_promotion(_event(), "u9", "org-1")
        send.assert_awaited_once()

    async def test_member_without_an_address_is_skipped(self):
        db = _db([_one(_member(email=None))])
        with patch(_SEND, new=AsyncMock(return_value=True)) as send:
            sent = await EventService(db)._email_waitlist_promotion(
                _event(), "u9", "org-1"
            )
        assert sent is False
        send.assert_not_awaited()

    async def test_a_named_room_is_used_for_the_location(self):
        db = _db(
            [
                _one(_member()),
                _one(_org()),
                _one("Station 2 Classroom"),
            ]
        )
        with patch(_SEND, new=AsyncMock(return_value=True)) as send:
            await EventService(db)._email_waitlist_promotion(
                _event(location=None, location_id="loc-1"), "u9", "org-1"
            )
        assert send.await_args.kwargs["location_name"] == "Station 2 Classroom"


class TestPromotionSendsTheEmail:
    def _promotable(self):
        waitlisted = SimpleNamespace(
            id="r1",
            user_id="u9",
            status=RSVPStatus.WAITLISTED,
            updated_at=None,
            guest_count=0,
        )
        occupied = MagicMock(scalar=MagicMock(return_value=1))
        return waitlisted, _db([_one(_event()), _one(waitlisted), occupied])

    async def test_promotion_emails_the_promoted_member(self):
        waitlisted, db = self._promotable()
        with patch.object(
            EventService, "_email_waitlist_promotion", new=AsyncMock()
        ) as email:
            out = await EventService(db).promote_from_waitlist("e1", "org-1")
        assert out is waitlisted
        email.assert_awaited_once()
        assert email.await_args.args[1:] == ("u9", "org-1")

    async def test_a_failed_email_does_not_undo_the_promotion(self):
        waitlisted, db = self._promotable()
        with patch.object(
            EventService,
            "_email_waitlist_promotion",
            new=AsyncMock(side_effect=RuntimeError("smtp down")),
        ):
            out = await EventService(db).promote_from_waitlist("e1", "org-1")
        assert out is waitlisted
        assert waitlisted.status == RSVPStatus.GOING


class TestTheEmailItself:
    async def test_default_render_names_the_event_and_confirms_the_seat(self):
        svc = EmailService()
        with patch.object(
            EmailService, "send_email", new=AsyncMock(return_value=(1, 0))
        ) as send:
            ok = await svc.send_waitlist_promotion_email(
                to_email="jdoe@example.org",
                recipient_name="John Doe",
                event_title="Hose Advancement Drill",
                event_start=datetime(2026, 11, 3, 23, 0, tzinfo=tz.utc),
                location_name=None,
                event_url="https://example.org/events/e1",
            )
        assert ok is True
        kwargs = send.await_args.kwargs
        assert kwargs["subject"] == "You're off the waitlist: Hose Advancement Drill"
        assert "confirmed as going" in kwargs["text_body"]
        assert "See the event page" in kwargs["text_body"]
        assert "https://example.org/events/e1" in kwargs["html_body"]
        assert (
            kwargs["template_type"] == EmailTemplateType.EVENT_WAITLIST_PROMOTION.value
        )
