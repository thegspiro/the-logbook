"""Event cancellations, event changes and an organizer's Notify messages are
emailed, not only put in the bell.

Email is the channel of record (CLAUDE.md pitfall 18). Cancellations and
changes have their own optional switch, "Event changes and cancellations"
(``EmailKind.EVENT_CHANGES``), whose readers are ``_email_event_cancellation``
and ``email_event_change`` (pitfall 19). A Notify message is filed under the
kind ``NOTIFICATION_EMAIL_KINDS`` names. Every email goes after the bell entry
and a failed one never undoes the action. DB mocked; no MySQL.
"""

from datetime import datetime, timedelta
from datetime import timezone as tz
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.api.v1.endpoints import events as events_endpoint
from app.models.email_template import EmailTemplateType
from app.models.event import RSVPStatus
from app.models.notification import NotificationLog
from app.schemas.event import EventNotificationType, EventUpdate
from app.services.email_policy import EMAIL_POLICIES, EmailKind
from app.services.email_service import EmailService
from app.services.event_service import NOTIFICATION_EMAIL_KINDS, EventService

pytestmark = pytest.mark.unit

_CANCEL_SEND = "app.services.email_service.EmailService.send_event_cancellation_email"
_SEND = "app.services.email_service.EmailService.send_email"

# 23:00 UTC on 3 November 2026 is 18:00 the same day in New York.
_START = datetime(2026, 11, 3, 23, 0, tzinfo=tz.utc)


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _many(objs):
    result = MagicMock()
    result.scalars.return_value.all.return_value = list(objs)
    return result


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.rollback = AsyncMock()
    return db


def _event(**kw):
    return SimpleNamespace(
        id="e1",
        title=kw.get("title", "Hose Advancement Drill"),
        organization_id="org-1",
        start_datetime=_START,
        end_datetime=_START + timedelta(hours=2),
        location=kw.get("location", "Training Bay"),
        location_id=kw.get("location_id"),
        is_cancelled=kw.get("is_cancelled", False),
        attendance_finalized_at=None,
        rsvps=kw.get("rsvps", []),
    )


def _member(uid="u1", prefs=None, email="jdoe@example.org", name="John Doe"):
    return SimpleNamespace(
        id=uid,
        email=email,
        display_name=name,
        notification_preferences=prefs,
    )


def _org(settings=None):
    return SimpleNamespace(
        id="org-1", settings=settings or {}, timezone="America/New_York"
    )


_OFF = {"email_kinds": {"event_changes": False}}
_REQUIRED = {"email_policy": {"required_kinds": ["event_changes"]}}


class TestTheSwitch:
    def test_it_is_an_optional_member_email_on_by_default(self):
        policy = EMAIL_POLICIES[EmailKind.EVENT_CHANGES]
        assert policy.label == "Event changes and cancellations"
        assert policy.required is False
        assert policy.default_on is True
        assert policy.audience.value == "members"

    def test_muting_event_reminders_does_not_mute_it(self):
        assert EMAIL_POLICIES[EmailKind.EVENT_CHANGES].legacy_preference is None

    def test_every_notify_type_has_a_kind(self):
        assert set(NOTIFICATION_EMAIL_KINDS) == {t.value for t in EventNotificationType}

    def test_an_announcement_is_a_required_department_message(self):
        kind = NOTIFICATION_EMAIL_KINDS["announcement"]
        assert kind is EmailKind.DEPARTMENT_MESSAGES
        assert EMAIL_POLICIES[kind].required is True

    def test_a_reminder_is_an_event_reminder(self):
        assert NOTIFICATION_EMAIL_KINDS["reminder"] is EmailKind.EVENT_REMINDERS


class TestCancellationEmail:
    async def test_emails_every_member_who_has_not_chosen(self):
        members = [_member("u1"), _member("u2", email="b@example.org", name="B")]
        db = _db([_one(_org()), _many(members)])
        with patch(_CANCEL_SEND, new=AsyncMock(return_value=True)) as send:
            sent = await EventService(db)._email_event_cancellation(
                _event(), ["u1", "u2"], "org-1", "Apparatus out of service"
            )
        assert sent == 2
        first = send.await_args_list[0].kwargs
        assert first["to_email"] == "jdoe@example.org"
        assert first["recipient_name"] == "John Doe"
        assert first["event_title"] == "Hose Advancement Drill"
        assert first["reason"] == "Apparatus out of service"

    async def test_member_who_turned_it_off_is_not_emailed(self):
        db = _db([_one(_org()), _many([_member(prefs=_OFF)])])
        with patch(_CANCEL_SEND, new=AsyncMock(return_value=True)) as send:
            sent = await EventService(db)._email_event_cancellation(
                _event(), ["u1"], "org-1", "Weather"
            )
        assert sent == 0
        send.assert_not_awaited()

    async def test_email_notifications_off_stops_it(self):
        prefs = {"email_notifications": False}
        db = _db([_one(_org()), _many([_member(prefs=prefs)])])
        with patch(_CANCEL_SEND, new=AsyncMock(return_value=True)) as send:
            await EventService(db)._email_event_cancellation(
                _event(), ["u1"], "org-1", "Weather"
            )
        send.assert_not_awaited()

    async def test_department_can_require_it(self):
        db = _db([_one(_org(_REQUIRED)), _many([_member(prefs=_OFF)])])
        with patch(_CANCEL_SEND, new=AsyncMock(return_value=True)) as send:
            await EventService(db)._email_event_cancellation(
                _event(), ["u1"], "org-1", "Weather"
            )
        send.assert_awaited_once()

    async def test_member_without_an_address_is_skipped(self):
        db = _db([_one(_org()), _many([_member(email=None)])])
        with patch(_CANCEL_SEND, new=AsyncMock(return_value=True)) as send:
            sent = await EventService(db)._email_event_cancellation(
                _event(), ["u1"], "org-1", "Weather"
            )
        assert sent == 0
        send.assert_not_awaited()

    async def test_one_failed_send_does_not_stop_the_rest(self):
        members = [_member("u1"), _member("u2", email="b@example.org")]
        db = _db([_one(_org()), _many(members)])
        with patch(
            _CANCEL_SEND, new=AsyncMock(side_effect=[RuntimeError("smtp"), True])
        ) as send:
            sent = await EventService(db)._email_event_cancellation(
                _event(), ["u1", "u2"], "org-1", "Weather"
            )
        assert send.await_count == 2
        assert sent == 1

    async def test_no_one_to_tell_runs_no_query(self):
        db = _db([])
        sent = await EventService(db)._email_event_cancellation(
            _event(), [], "org-1", "Weather"
        )
        assert sent == 0
        db.execute.assert_not_awaited()


class TestCancelEventSendsIt:
    def _cancellable(self):
        rsvps = [
            SimpleNamespace(user_id="u1", status=RSVPStatus.GOING),
            SimpleNamespace(user_id="u2", status=RSVPStatus.MAYBE),
            SimpleNamespace(user_id="u3", status=RSVPStatus.NOT_GOING),
        ]
        event = _event(rsvps=rsvps)
        return event, _db([_one(event)])

    async def _cancel(self, db, email):
        svc = EventService(db)
        with (
            patch.object(
                EventService,
                "_revoke_event_attendance_credit",
                new=AsyncMock(return_value=[]),
            ),
            patch.object(
                EventService, "_reverse_pipeline_after_commit", new=AsyncMock()
            ),
            patch.object(EventService, "_email_event_cancellation", new=email),
        ):
            return await svc.cancel_event(
                "e1", "org-1", "Weather", send_notifications=True
            )

    async def test_going_and_maybe_are_emailed_after_the_bell(self):
        event, db = self._cancellable()
        email = AsyncMock(return_value=2)
        out = await self._cancel(db, email)
        assert out is event
        email.assert_awaited_once()
        assert email.await_args.args[1:] == (["u1", "u2"], "org-1", "Weather")

        added = [c.args[0] for c in db.add.call_args_list if c.args]
        bells = [n for n in added if isinstance(n, NotificationLog)]
        assert [b.recipient_id for b in bells] == ["u1", "u2"]
        assert {b.category for b in bells} == {"event_cancellation"}
        assert {b.action_url for b in bells} == {"/events/e1"}

    async def test_a_failed_email_does_not_undo_the_cancellation(self):
        event, db = self._cancellable()
        out = await self._cancel(db, AsyncMock(side_effect=RuntimeError("smtp")))
        assert out is event
        assert event.is_cancelled is True

    async def test_without_send_notifications_nothing_is_emailed(self):
        event, db = self._cancellable()
        email = AsyncMock()
        with (
            patch.object(
                EventService,
                "_revoke_event_attendance_credit",
                new=AsyncMock(return_value=[]),
            ),
            patch.object(
                EventService, "_reverse_pipeline_after_commit", new=AsyncMock()
            ),
            patch.object(EventService, "_email_event_cancellation", new=email),
        ):
            await EventService(db).cancel_event("e1", "org-1", "Weather")
        email.assert_not_awaited()


class TestTheCancellationEmailItself:
    async def test_default_render_names_the_event_in_the_department_timezone(self):
        # 03:30 UTC on 4 November is still 3 November in New York.
        svc = EmailService(organization=_org())
        with patch.object(
            EmailService, "send_email", new=AsyncMock(return_value=(1, 0))
        ) as send:
            ok = await svc.send_event_cancellation_email(
                to_email="jdoe@example.org",
                recipient_name="John Doe",
                event_title="Hose Advancement Drill",
                event_start=datetime(2026, 11, 4, 3, 30, tzinfo=tz.utc),
                reason="Apparatus out of service",
            )
        assert ok is True
        kwargs = send.await_args.kwargs
        assert kwargs["subject"].startswith("Event Cancelled: Hose Advancement Drill")
        assert "November 03, 2026" in kwargs["text_body"]
        assert "Apparatus out of service" in kwargs["text_body"]
        assert "John Doe" in kwargs["html_body"]
        assert kwargs["template_type"] == EmailTemplateType.EVENT_CANCELLATION.value


class TestChangeEmail:
    async def test_one_send_reaches_every_recipient_with_the_new_details(self):
        members = [_member("u1"), _member("u2", email="b@example.org")]
        db = _db([_one(_org()), _many(members)])
        with patch(_SEND, new=AsyncMock(return_value=(2, 0))) as send:
            sent = await EventService(db).email_event_change(
                _event(), ["u1", "u2"], "org-1", "start datetime, location"
            )
        assert sent == 2
        send.assert_awaited_once()
        kwargs = send.await_args.kwargs
        assert kwargs["to_emails"] == ["jdoe@example.org", "b@example.org"]
        assert kwargs["subject"] == "Event Updated: Hose Advancement Drill"
        text = kwargs["text_body"]
        assert "start datetime, location" in text
        # In the department's timezone, not UTC.
        assert "When: November 03, 2026 at 06:00 PM to 08:00 PM" in text
        assert "Where: Training Bay" in text
        assert text.rstrip().endswith("/events/e1")

    async def test_member_who_turned_it_off_is_not_emailed(self):
        db = _db([_one(_org()), _many([_member(prefs=_OFF)])])
        with patch(_SEND, new=AsyncMock(return_value=(1, 0))) as send:
            sent = await EventService(db).email_event_change(
                _event(), ["u1"], "org-1", "title"
            )
        assert sent == 0
        send.assert_not_awaited()

    async def test_department_can_require_it(self):
        db = _db([_one(_org(_REQUIRED)), _many([_member(prefs=_OFF)])])
        with patch(_SEND, new=AsyncMock(return_value=(1, 0))) as send:
            await EventService(db).email_event_change(
                _event(), ["u1"], "org-1", "title"
            )
        send.assert_awaited_once()

    async def test_member_without_an_address_is_skipped(self):
        db = _db([_one(_org()), _many([_member(email="")])])
        with patch(_SEND, new=AsyncMock(return_value=(1, 0))) as send:
            await EventService(db).email_event_change(
                _event(), ["u1"], "org-1", "title"
            )
        send.assert_not_awaited()

    async def test_title_is_escaped_in_the_html(self):
        db = _db([_one(_org()), _many([_member()])])
        with patch(_SEND, new=AsyncMock(return_value=(1, 0))) as send:
            await EventService(db).email_event_change(
                _event(title="<b>Drill</b>"), ["u1"], "org-1", "title"
            )
        assert "<b>Drill</b>" not in send.await_args.kwargs["html_body"]


def _officer():
    # An events manager: PATCH /events/{id} authorizes inside the handler now
    # (training managers are admitted per event), so a direct call no longer
    # skips the gate the way a signature dependency did.
    return SimpleNamespace(
        id="officer-1",
        organization_id="org-1",
        username="officer",
        positions=[SimpleNamespace(permissions=["events.manage"])],
        rank=None,
    )


class TestUpdateEndpointSendsIt:
    async def _patch(self, email):
        old = _event(
            rsvps=[
                SimpleNamespace(user_id="u1", status=RSVPStatus.GOING),
                SimpleNamespace(user_id="u2", status=RSVPStatus.MAYBE),
                SimpleNamespace(user_id="u3", status=RSVPStatus.NOT_GOING),
            ]
        )
        new = _event(location="Station 2")
        service = MagicMock()
        service.get_event = AsyncMock(return_value=(old, None))
        service.update_event = AsyncMock(return_value=new)
        service.email_event_change = email
        notifications = MagicMock()
        notifications.log_notification = AsyncMock(return_value=(object(), None))
        with (
            patch.object(events_endpoint, "EventService", return_value=service),
            patch.object(
                events_endpoint, "NotificationsService", return_value=notifications
            ),
            patch.object(events_endpoint, "log_audit_event", new=AsyncMock()),
            patch.object(
                events_endpoint, "_build_event_response", return_value="response"
            ),
        ):
            out = await events_endpoint.update_event(
                event_id=uuid4(),
                event_data=EventUpdate(location="Station 2"),
                db=MagicMock(),
                current_user=_officer(),
            )
        return out, new, notifications

    async def test_going_and_maybe_are_emailed_after_the_bell(self):
        email = AsyncMock(return_value=2)
        out, new, notifications = await self._patch(email)
        assert out == "response"
        assert notifications.log_notification.await_count == 2
        email.assert_awaited_once()
        assert email.await_args.args == (new, ["u1", "u2"], "org-1", "location")

    async def test_a_failed_email_does_not_fail_the_update(self):
        out, _, _ = await self._patch(AsyncMock(side_effect=RuntimeError("smtp")))
        assert out == "response"


class TestNotifyEmail:
    def _notify_db(self, recipients, org=None):
        event = _event()
        active = MagicMock()
        active.all.return_value = [(m.id,) for m in recipients]
        no_rsvps = MagicMock()
        no_rsvps.scalars.return_value.all.return_value = []
        return _db(
            [
                _one(event),
                active,
                no_rsvps,
                _one(org or _org()),
                _many(recipients),
            ]
        )

    async def _notify(self, db, notification_type, send_return=(1, 0)):
        with (
            patch(
                "app.services.notifications_service.NotificationsService"
                ".log_notification",
                new=AsyncMock(return_value=(object(), None)),
            ),
            patch(_SEND, new=AsyncMock(return_value=send_return)) as send,
        ):
            count, _ = await EventService(db).send_event_notification(
                uuid4(), "org-1", notification_type, target="all"
            )
        return count, send

    async def test_all_members_are_emailed_in_one_send(self):
        members = [_member(f"u{i}", email=f"m{i}@example.org") for i in range(5)]
        count, send = await self._notify(
            self._notify_db(members), "reminder", send_return=(5, 0)
        )
        assert count == 5
        send.assert_awaited_once()
        assert sorted(send.await_args.kwargs["to_emails"]) == sorted(
            m.email for m in members
        )
        assert send.await_args.kwargs["subject"] == "Reminder: Hose Advancement Drill"

    async def test_a_reminder_respects_the_event_reminders_switch(self):
        muted = _member("u1", prefs={"email_kinds": {"event_reminders": False}})
        _, send = await self._notify(self._notify_db([muted]), "reminder")
        send.assert_not_awaited()

    async def test_an_announcement_ignores_every_switch(self):
        muted = _member(
            "u1",
            prefs={
                "email_notifications": False,
                "email_kinds": {"event_reminders": False, "event_changes": False},
            },
        )
        _, send = await self._notify(self._notify_db([muted]), "announcement")
        send.assert_awaited_once()

    async def test_a_follow_up_is_an_event_change(self):
        muted = _member("u1", prefs=_OFF)
        _, send = await self._notify(self._notify_db([muted]), "follow_up")
        send.assert_not_awaited()

    async def test_department_required_overrides_a_reminder_opt_out(self):
        muted = _member("u1", prefs={"email_kinds": {"event_reminders": False}})
        org = _org({"email_policy": {"required_kinds": ["event_reminders"]}})
        _, send = await self._notify(self._notify_db([muted], org), "reminder")
        send.assert_awaited_once()

    async def test_member_without_an_address_is_skipped(self):
        _, send = await self._notify(
            self._notify_db([_member(email=None)]), "announcement"
        )
        send.assert_not_awaited()

    async def test_a_failed_email_does_not_fail_the_notice(self):
        db = self._notify_db([_member()])
        with (
            patch(
                "app.services.notifications_service.NotificationsService"
                ".log_notification",
                new=AsyncMock(return_value=(object(), None)),
            ),
            patch(_SEND, new=AsyncMock(side_effect=RuntimeError("smtp"))),
        ):
            count, summary = await EventService(db).send_event_notification(
                uuid4(), "org-1", "announcement", target="all"
            )
        assert count == 1
        assert "1 recipient" in summary
