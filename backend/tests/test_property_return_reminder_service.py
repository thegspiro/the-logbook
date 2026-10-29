"""
Tests for the property return reminder service
(app/services/property_return_reminder_service.py).

Covers the timezone helper, outstanding-item gathering (count + value from
assignments and checkouts), and the reminder orchestration: threshold
firing (30/90 day), per-type dedup, the no-items skip, and the overdue
listing. The email/send machinery is patched out. DB mocked; no MySQL.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from zoneinfo import ZoneInfo

import pytest

from app.models.user import MemberServicePeriod, Organization, User, UserStatus
from app.services.property_return_reminder_service import (
    PropertyReturnReminderService,
    dropped_at,
    latest_due_threshold,
)


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    db.add = MagicMock()
    db.commit = AsyncMock()
    return db


def _member(days_ago=95, status=UserStatus.DROPPED_VOLUNTARY):
    return SimpleNamespace(
        id="u1",
        full_name="Jane Smith",
        display_name="Jane Smith",
        email="jane@x.org",
        status=status,
        status_changed_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
    )


def _org():
    return SimpleNamespace(id="org-1", name="FCFD", timezone="America/New_York")


def _recorded_drops(svc, monkeypatch, overrides=None):
    """Stand in for the stint lookup: each drop took effect when it was
    recorded, unless ``overrides`` gives a member another effective moment."""

    async def effective(_org_id, members, _org):
        drops = {str(m.id): dropped_at(m) for m in members}
        drops.update(overrides or {})
        return drops

    monkeypatch.setattr(svc, "_effective_drops", AsyncMock(side_effect=effective))


def _item(name="Helmet", value=100.0):
    return SimpleNamespace(
        name=name,
        serial_number="SN1",
        asset_tag="AT1",
        current_value=value,
        purchase_price=None,
    )


class TestToLocal:
    def test_naive_treated_as_utc(self):
        dt = datetime(2026, 6, 1, 12, 0, 0)  # naive
        out = PropertyReturnReminderService._to_local(dt, "America/New_York")
        assert out.tzinfo == ZoneInfo("America/New_York")
        # noon UTC -> 08:00 EDT in June
        assert out.hour == 8

    def test_aware_converted(self):
        dt = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        out = PropertyReturnReminderService._to_local(dt, "America/New_York")
        assert out.hour == 7  # EST in January


class TestOutstandingItems:
    async def test_counts_and_sums_assignments_and_checkouts(self):
        assignment = SimpleNamespace(item=_item("Helmet", 100.0))
        checkout = SimpleNamespace(item=_item("Radio", 250.0))
        db = _db([_scalars([assignment]), _scalars([checkout])])
        out = await PropertyReturnReminderService(db)._get_outstanding_items(
            "u1", "org-1"
        )
        assert out["count"] == 2
        assert out["total_value"] == 350.0
        assert {i["type"] for i in out["items"]} == {"assigned", "checked_out"}

    async def test_empty_when_nothing_outstanding(self):
        db = _db([_scalars([]), _scalars([])])
        out = await PropertyReturnReminderService(db)._get_outstanding_items(
            "u1", "org-1"
        )
        assert out == {"count": 0, "total_value": 0.0, "items": []}


class TestProcessReminders:
    def _svc(self, db, monkeypatch, items_count=2, send=None):
        svc = PropertyReturnReminderService(db)
        monkeypatch.setattr(
            svc,
            "_get_outstanding_items",
            AsyncMock(
                return_value={
                    "count": items_count,
                    "total_value": 350.0,
                    "items": [],
                }
            ),
        )
        monkeypatch.setattr(
            svc,
            "_send_reminder",
            AsyncMock(return_value=(send or {"reminder_type": "x"})),
        )
        _recorded_drops(svc, monkeypatch)
        return svc

    async def test_old_drop_gets_only_the_latest_threshold(self, monkeypatch):
        # 95 days out, neither reminder sent -> the 90-day one only. The 30-day
        # reminder is superseded: this runs daily, and the backlog present when
        # the schedule was switched on must not get two emails in one morning.
        db = _db(
            [
                _scalars([_member(days_ago=95)]),
                _one(_org()),
                _one(None),  # existing 90-day -> none
            ]
        )
        svc = self._svc(db, monkeypatch)
        out = await svc.process_reminders("org-1")
        assert out["reminders_sent"] == 1
        assert svc._send_reminder.await_count == 1
        sent = svc._send_reminder.await_args.kwargs["threshold"]
        assert sent["type"] == "90_day"

    async def test_first_threshold_goes_out_when_it_is_the_latest(self, monkeypatch):
        db = _db(
            [
                _scalars([_member(days_ago=45)]),
                _one(_org()),
                _one(None),  # existing 30-day -> none
            ]
        )
        svc = self._svc(db, monkeypatch)
        out = await svc.process_reminders("org-1")
        assert out["reminders_sent"] == 1
        sent = svc._send_reminder.await_args.kwargs["threshold"]
        assert sent["type"] == "30_day"

    async def test_superseded_threshold_is_never_sent_late(self, monkeypatch):
        # 120 days out, 90-day already sent, 30-day never sent: nothing goes out,
        # and the 30-day reminder is not even looked up.
        db = _db(
            [
                _scalars([_member(days_ago=120)]),
                _one(_org()),
                _one(SimpleNamespace(id="r90")),  # existing 90-day -> sent
            ]
        )
        svc = self._svc(db, monkeypatch)
        out = await svc.process_reminders("org-1")
        assert out["reminders_sent"] == 0
        svc._send_reminder.assert_not_awaited()
        assert db.execute.await_count == 3

    async def test_skips_when_below_threshold(self, monkeypatch):
        db = _db([_scalars([_member(days_ago=10)]), _one(_org())])
        svc = self._svc(db, monkeypatch)
        out = await svc.process_reminders("org-1")
        assert out["reminders_sent"] == 0
        svc._send_reminder.assert_not_awaited()

    async def test_skips_already_sent(self, monkeypatch):
        # 45 days out: 30-day already sent, 90 not yet due.
        db = _db(
            [
                _scalars([_member(days_ago=45)]),
                _one(_org()),
                _one(SimpleNamespace(id="r1")),  # existing 30-day -> sent
            ]
        )
        svc = self._svc(db, monkeypatch)
        out = await svc.process_reminders("org-1")
        assert out["reminders_sent"] == 0

    async def test_skips_when_no_items(self, monkeypatch):
        db = _db(
            [
                _scalars([_member(days_ago=45)]),
                _one(_org()),
                _one(None),  # existing 30-day -> none
            ]
        )
        svc = self._svc(db, monkeypatch, items_count=0)
        out = await svc.process_reminders("org-1")
        assert out["reminders_sent"] == 0
        svc._send_reminder.assert_not_awaited()

    async def test_counts_from_the_effective_date_not_the_recording(self, monkeypatch):
        # Recorded 10 days ago, back-dated to 35 days ago: the 30-day reminder
        # is due now, and the email is dated from the effective drop.
        member = _member(days_ago=10)
        effective = datetime.now(timezone.utc) - timedelta(days=35)
        db = _db(
            [
                _scalars([member]),
                _one(_org()),
                _one(None),  # existing 30-day -> none
            ]
        )
        svc = self._svc(db, monkeypatch)
        _recorded_drops(svc, monkeypatch, {"u1": effective})

        out = await svc.process_reminders("org-1")

        assert out["reminders_sent"] == 1
        kwargs = svc._send_reminder.await_args.kwargs
        assert kwargs["threshold"]["type"] == "30_day"
        assert kwargs["days_since_drop"] == 35
        assert kwargs["dropped_on"] == effective


class TestLatestDueThreshold:
    def test_none_before_the_first_threshold(self):
        assert latest_due_threshold(0) is None
        assert latest_due_threshold(29) is None

    def test_thresholds_start_on_their_day(self):
        assert latest_due_threshold(30)["type"] == "30_day"
        assert latest_due_threshold(89)["type"] == "30_day"
        assert latest_due_threshold(90)["type"] == "90_day"
        assert latest_due_threshold(4000)["type"] == "90_day"


class TestDroppedAt:
    def test_naive_value_is_read_as_utc(self):
        member = SimpleNamespace(id="m-1", status_changed_at=datetime(2026, 1, 2, 3))
        assert dropped_at(member) == datetime(2026, 1, 2, 3, tzinfo=timezone.utc)

    def test_aware_value_is_kept(self):
        eastern = datetime(2026, 1, 2, 3, tzinfo=ZoneInfo("America/New_York"))
        member = SimpleNamespace(id="m-1", status_changed_at=eastern)
        assert dropped_at(member) is eastern

    def test_missing_drop_date_fails_loudly(self):
        member = SimpleNamespace(id="m-1", status_changed_at=None)
        with pytest.raises(ValueError, match="m-1"):
            dropped_at(member)


class TestOverdueReturns:
    async def test_lists_members_with_items(self, monkeypatch):
        member = _member(days_ago=40)
        db = _db(
            [
                _one(_org()),  # org/timezone
                _scalars([member]),  # dropped members
                _scalars([SimpleNamespace(reminder_type="30_day")]),  # sent reminders
            ]
        )
        svc = PropertyReturnReminderService(db)
        _recorded_drops(svc, monkeypatch)
        monkeypatch.setattr(
            svc,
            "_get_outstanding_items",
            AsyncMock(
                return_value={
                    "count": 1,
                    "total_value": 100.0,
                    "items": [{"name": "X"}],
                }
            ),
        )
        out = await svc.get_overdue_returns("org-1")
        assert len(out) == 1
        row = out[0]
        assert row["items_outstanding"] == 1
        assert row["days_since_drop"] == 40
        assert row["reminders_sent"] == ["30_day"]

    async def test_skips_members_without_items(self, monkeypatch):
        db = _db([_one(_org()), _scalars([_member(days_ago=40)])])
        svc = PropertyReturnReminderService(db)
        _recorded_drops(svc, monkeypatch)
        monkeypatch.setattr(
            svc,
            "_get_outstanding_items",
            AsyncMock(return_value={"count": 0, "total_value": 0.0, "items": []}),
        )
        assert await svc.get_overdue_returns("org-1") == []

    async def test_lists_by_effective_drop_and_dates_it_from_there(self, monkeypatch):
        # Recorded first, but back-dated less far than the one recorded later.
        early = SimpleNamespace(**{**vars(_member(days_ago=20)), "id": "early"})
        late = SimpleNamespace(**{**vars(_member(days_ago=5)), "id": "late"})
        late_effective = datetime(2026, 1, 10, 15, tzinfo=timezone.utc)
        db = _db(
            [
                _one(_org()),
                _scalars([early, late]),  # recording order
                _scalars([]),  # reminders sent: late
                _scalars([]),  # reminders sent: early
            ]
        )
        svc = PropertyReturnReminderService(db)
        _recorded_drops(svc, monkeypatch, {"late": late_effective})
        monkeypatch.setattr(
            svc,
            "_get_outstanding_items",
            AsyncMock(return_value={"count": 1, "total_value": 1.0, "items": []}),
        )

        out = await svc.get_overdue_returns("org-1")

        assert [row["user_id"] for row in out] == ["late", "early"]
        # 15:00 UTC on Jan 10 is still Jan 10 in New York.
        assert out[0]["dropped_date"] == "2026-01-10"
        assert (
            out[0]["days_since_drop"]
            == (datetime.now(timezone.utc) - late_effective).days
        )


@pytest.mark.integration
class TestEffectiveDropsAgainstTheDatabase:
    """The one batched stint read behind every reminder's start date."""

    async def test_back_dated_and_recorded_drops_side_by_side(self, db_session):
        org = Organization(
            id=str(uuid.uuid4()),
            name="Reminder Effective Drops",
            slug=f"remind-{uuid.uuid4().hex[:8]}",
            timezone="UTC",
        )
        db_session.add(org)
        await db_session.flush()
        recorded = datetime.now(timezone.utc).replace(microsecond=0)

        def member(handle):
            return User(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                username=f"u-{handle}-{uuid.uuid4().hex[:6]}",
                email=f"{handle}-{uuid.uuid4().hex[:6]}@remind.test",
                first_name="Sam",
                last_name=handle,
                password_hash="x",
                status=UserStatus.DROPPED_VOLUNTARY,
                status_changed_at=recorded,
                hire_date=date(2018, 1, 1),
            )

        back_dated, on_time, no_history = (
            member("back"),
            member("on"),
            member("none"),
        )
        db_session.add_all([back_dated, on_time, no_history])
        await db_session.flush()
        for who, end in (
            (back_dated, recorded.date() - timedelta(days=40)),
            (on_time, recorded.date()),
        ):
            db_session.add(
                MemberServicePeriod(
                    id=str(uuid.uuid4()),
                    organization_id=org.id,
                    user_id=who.id,
                    start_date=None,
                    end_date=end,
                    separation_status=UserStatus.DROPPED_VOLUNTARY.value,
                    counts_toward_service=True,
                )
            )
        await db_session.flush()

        drops = await PropertyReturnReminderService(db_session)._effective_drops(
            org.id, [back_dated, on_time, no_history], org
        )

        assert drops[back_dated.id] == recorded - timedelta(days=40)
        assert drops[on_time.id] == recorded
        assert drops[no_history.id] == recorded


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))


@pytest.mark.unit
async def test_send_reminder_requires_a_drop_date():
    svc = PropertyReturnReminderService(_db([]))
    member = SimpleNamespace(id="member-1", status_changed_at=None)

    with pytest.raises(ValueError, match="no status_changed_at"):
        await svc._send_reminder(
            member=member,
            org=None,
            org_name="Org",
            org_tz="UTC",
            organization_id="org-1",
            threshold={"label": "30-day", "type": "30_day"},
            days_since_drop=30,
            items_info={},
        )


@pytest.mark.unit
@pytest.mark.parametrize("switched_off", [False, True])
async def test_a_switched_off_template_stops_only_the_members_email(switched_off):
    """The member's reminder is the template; the quartermaster's summary is
    not, so it still goes out and says whether the member was emailed."""
    from unittest.mock import patch

    from app.services.email_service import EmailService
    from app.services.email_template_service import EmailTemplateService

    admin_rows = MagicMock()
    admin_rows.scalars.return_value.all.return_value = [
        SimpleNamespace(
            id="qm-1",
            email="qm@x.org",
            roles=[SimpleNamespace(slug="quartermaster")],
            notification_preferences=None,
        )
    ]
    svc = PropertyReturnReminderService(_db([admin_rows]))
    send = AsyncMock(return_value=(1, 0))

    with (
        patch.object(EmailService, "send_email", send),
        patch.object(
            EmailTemplateService, "get_template", AsyncMock(return_value=None)
        ),
        patch.object(
            EmailTemplateService,
            "is_switched_off",
            AsyncMock(return_value=switched_off),
        ),
    ):
        result = await svc._send_reminder(
            member=_member(),
            org=None,
            org_name="Org",
            org_tz="UTC",
            organization_id="org-1",
            threshold={"label": "30-day", "type": "30_day"},
            days_since_drop=30,
            items_info={"count": 1, "total_value": 10.0, "items": []},
            dropped_on=datetime.now(timezone.utc) - timedelta(days=30),
        )

    recipients = [call.kwargs["to_emails"] for call in send.await_args_list]
    if switched_off:
        assert recipients == [["qm@x.org"]]
        assert "Member email sent: No" in send.await_args.kwargs["html_body"]
    else:
        assert recipients == [["jane@x.org"], ["qm@x.org"]]
    assert result["member_email_sent"] is (not switched_off)
