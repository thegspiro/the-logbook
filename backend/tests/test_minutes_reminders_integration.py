"""Action item reminder emails, against the real schema.

The service decides who is emailed what and records that it did. The mail
itself is replaced with a recorder, so what is asserted is the decision: which
members, which items, whether the item is marked reminded, and that a refused
or failed send leaves it to be tried again.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.minute import ActionItem, MeetingMinutes
from app.models.user import Organization
from app.services.minutes_reminder_service import MinutesReminderService
from tests.minutes_support import (
    _approve,
    _client,
    _create,
    _user,
    _World,
    build_world,
)

pytestmark = [pytest.mark.integration]


def _today() -> date:
    # Read per call, not frozen at import: collection can finish before
    # midnight UTC and the test run after it, and the service under test
    # reads the clock when it runs.
    return datetime.now(timezone.utc).date()


def _midnight(day: date) -> str:
    return datetime(day.year, day.month, day.day, tzinfo=timezone.utc).isoformat()


@pytest.fixture(autouse=True)
def _one_calendar_day(monkeypatch):
    """Give the test and the service the same "today".

    The service asks for the department's date when it runs; the fixtures
    below build due dates from ``_today()``. Computed separately, they agree only
    until a run crosses midnight UTC: a suite that starts at 23:50 and takes a
    quarter of an hour sees the fixtures built for one day and the service
    deciding for the next, and a reminder due "tomorrow" is suddenly due today.
    """
    day = _today()
    monkeypatch.setitem(globals(), "_today", lambda: day)
    monkeypatch.setattr(
        "app.services.minutes_reminder_service.org_today", lambda organization: day
    )


@pytest.fixture
async def world(db_session: AsyncSession) -> _World:
    return await build_world(db_session)


@pytest.fixture
def mail():
    """Replace the mail service; ``mail.send`` records every email."""
    send = AsyncMock(return_value=(1, []))
    service = MagicMock()
    service.send_email = send
    with patch(
        "app.services.minutes_reminder_service.EmailService", return_value=service
    ):
        yield send


async def _org(world: _World) -> Organization:
    org = await world.db.get(Organization, world.org_id)
    assert org is not None
    return org


async def _approved(world: _World, items: list[dict[str, Any]]) -> dict[str, Any]:
    minutes = await _create(world, items=items)
    return await _approve(world, minutes["id"])


def _item(description: str, assignee, days_from_today: int | None) -> dict[str, Any]:
    item: dict[str, Any] = {
        "description": description,
        "assignee_id": str(assignee.id),
    }
    if days_from_today is not None:
        item["due_date"] = _midnight(_today() + timedelta(days=days_from_today))
    return item


async def _reminded(world: _World, description: str):
    world.db.expire_all()
    row = (
        await world.db.execute(
            select(ActionItem.last_reminded_at).where(
                ActionItem.description == description
            )
        )
    ).scalar_one()
    return row


async def _run(world: _World) -> int:
    return await MinutesReminderService(world.db).send_assignee_reminders(
        await _org(world)
    )


def _sent_to(mail) -> list[str]:
    return [call.kwargs["to_emails"][0] for call in mail.await_args_list]


class TestAssigneeReminders:
    async def test_an_item_due_soon_is_emailed_once(self, world, mail):
        await _approved(world, [_item("Order hose", world.assignee, 2)])

        assert await _run(world) == 1
        assert _sent_to(mail) == [world.assignee.email]
        assert await _reminded(world, "Order hose") is not None

        assert await _run(world) == 0
        assert mail.await_count == 1

    async def test_an_item_outside_the_window_is_left_alone(self, world, mail):
        await _approved(world, [_item("Later", world.assignee, 10)])

        assert await _run(world) == 0
        mail.assert_not_awaited()
        assert await _reminded(world, "Later") is None

    async def test_an_overdue_item_is_emailed_and_then_repeated_after_the_gap(
        self, world, mail
    ):
        await _approved(world, [_item("Late one", world.assignee, -2)])

        assert await _run(world) == 1
        assert await _run(world) == 0

        await world.db.execute(
            update(ActionItem)
            .where(ActionItem.description == "Late one")
            .values(last_reminded_at=datetime.now(timezone.utc) - timedelta(days=8))
        )
        assert await _run(world) == 1
        assert mail.await_count == 2

    async def test_one_email_lists_all_of_a_members_items(self, world, mail):
        await _approved(
            world,
            [
                _item("Order hose", world.assignee, 1),
                _item("Paint the bay", world.assignee, -3),
            ],
        )

        assert await _run(world) == 1
        mail.assert_awaited_once()
        body = mail.await_args.kwargs["html_body"]
        assert "Order hose" in body
        assert "Paint the bay" in body
        assert "Overdue (1)" in body
        assert "Due soon (1)" in body
        assert "overdue" in mail.await_args.kwargs["subject"]

    async def test_each_assignee_gets_their_own_email(self, world, mail):
        await _approved(
            world,
            [
                _item("Order hose", world.assignee, 1),
                _item("Fix the siren", world.member, 1),
            ],
        )

        assert await _run(world) == 2
        assert sorted(_sent_to(mail)) == sorted(
            [world.assignee.email, world.member.email]
        )

    async def test_draft_minutes_are_not_a_commitment_yet(self, world, mail):
        await _create(world, items=[_item("Draft item", world.assignee, 1)])

        assert await _run(world) == 0
        mail.assert_not_awaited()

    @pytest.mark.parametrize("status", ["completed", "cancelled"])
    async def test_finished_items_are_not_chased(self, world, mail, status):
        await _approved(world, [_item("Done", world.assignee, 1)])
        await world.db.execute(
            update(ActionItem)
            .where(ActionItem.description == "Done")
            .values(status=status)
        )

        assert await _run(world) == 0

    async def test_carried_forward_items_are_reminded_about_in_the_later_minutes(
        self, world, mail
    ):
        await _approved(world, [_item("Moved on", world.assignee, 1)])
        await world.db.execute(
            update(ActionItem)
            .where(ActionItem.description == "Moved on")
            .values(carried_forward_at=datetime.now(timezone.utc))
        )

        assert await _run(world) == 0

    async def test_an_item_with_no_due_date_is_not_reminded(self, world, mail):
        await _approved(world, [_item("Whenever", world.assignee, None)])

        assert await _run(world) == 0

    async def test_items_long_past_due_are_left_to_the_weekly_list(self, world, mail):
        await _approved(world, [_item("Ancient", world.assignee, -200)])

        assert await _run(world) == 0

    async def test_another_departments_items_are_never_touched(self, world, mail):
        await _approved(world, [_item("Ours", world.assignee, 1)])
        other = await world.db.get(Organization, world.other_org_id)
        assert other is not None

        assert (
            await MinutesReminderService(world.db).send_assignee_reminders(other)
        ) == 0
        mail.assert_not_awaited()
        assert await _reminded(world, "Ours") is None


class TestSettings:
    async def _set(self, world: _World, section: dict[str, Any]) -> None:
        org = await _org(world)
        org.settings = {**(org.settings or {}), "minutes": section}
        await world.db.flush()

    async def test_switched_off_sends_nothing(self, world, mail):
        await self._set(world, {"action_item_reminders": False})
        await _approved(world, [_item("Order hose", world.assignee, 1)])

        assert await _run(world) == 0
        mail.assert_not_awaited()

    async def test_the_lead_time_is_the_departments_choice(self, world, mail):
        await _approved(world, [_item("In a week", world.assignee, 7)])
        assert await _run(world) == 0

        await self._set(world, {"reminder_days_before_due": 10})
        assert await _run(world) == 1

    async def test_a_zero_lead_time_waits_for_the_due_date(self, world, mail):
        await self._set(world, {"reminder_days_before_due": 0})
        await _approved(
            world,
            [
                _item("Tomorrow", world.assignee, 1),
                _item("Today", world.member, 0),
            ],
        )

        assert await _run(world) == 1
        assert _sent_to(mail) == [world.member.email]


class TestOptOutAndFailure:
    async def test_a_member_who_opted_out_is_not_emailed_or_marked(self, world, mail):
        opted_out = await _user(
            world.db,
            world.org_id,
            "Quiet",
            ["minutes.view"],
            preferences='{"email_kinds": {"minutes_action_items": false}}',
        )
        await _approved(world, [_item("Quiet task", opted_out, 1)])

        assert await _run(world) == 0
        mail.assert_not_awaited()
        assert await _reminded(world, "Quiet task") is None

    async def test_a_refused_send_leaves_the_item_for_the_next_run(self, world, mail):
        mail.return_value = (0, [world.assignee.email])
        await _approved(world, [_item("Order hose", world.assignee, 1)])

        assert await _run(world) == 0
        assert await _reminded(world, "Order hose") is None

        mail.return_value = (1, [])
        assert await _run(world) == 1

    async def test_a_send_that_raises_does_not_stop_the_other_members(
        self, world, mail
    ):
        mail.side_effect = [RuntimeError("smtp down"), (1, [])]
        await _approved(
            world,
            [
                _item("First", world.assignee, 1),
                _item("Second", world.member, 1),
            ],
        )

        assert await _run(world) == 1
        marked = [
            await _reminded(world, "First"),
            await _reminded(world, "Second"),
        ]
        assert sum(m is not None for m in marked) == 1


class TestOpenItemsDigest:
    async def _digest(self, world: _World) -> int:
        return await MinutesReminderService(world.db).send_open_items_digest(
            await _org(world)
        )

    async def test_minutes_managers_get_the_list_and_members_do_not(self, world, mail):
        await _approved(
            world,
            [
                _item("Order hose", world.assignee, -2),
                _item("Paint the bay", world.member, 5),
                {"description": "Find a vendor", "assignee_name": "Pat"},
            ],
        )

        assert await self._digest(world) == 2
        assert sorted(_sent_to(mail)) == sorted(
            [world.secretary.email, world.approver.email]
        )
        body = mail.await_args.kwargs["html_body"]
        for text in ("Order hose", "Paint the bay", "Find a vendor", "(overdue)"):
            assert text in body
        assert "3 action item(s)" in body

    async def test_it_goes_out_at_most_weekly(self, world, mail):
        await _approved(world, [_item("Order hose", world.assignee, 5)])

        assert await self._digest(world) == 2
        assert await self._digest(world) == 0

        org = await _org(world)
        stored = dict(org.settings["minutes"])
        stored["last_open_items_digest_on"] = (_today() - timedelta(days=7)).isoformat()
        org.settings = {**org.settings, "minutes": stored}
        await world.db.flush()
        assert await self._digest(world) == 2

    async def test_it_records_the_day_without_losing_the_departments_settings(
        self, world, mail
    ):
        org = await _org(world)
        org.settings = {"minutes": {"overdue_repeat_days": 14}}
        await world.db.flush()
        await _approved(world, [_item("Order hose", world.assignee, 5)])

        await self._digest(world)

        world.db.expire_all()
        saved = (await _org(world)).settings["minutes"]
        assert saved["overdue_repeat_days"] == 14
        assert saved["last_open_items_digest_on"] == _today().isoformat()

    async def test_nothing_is_sent_when_nothing_is_open(self, world, mail):
        await _approved(world, [])

        assert await self._digest(world) == 0
        mail.assert_not_awaited()

    async def test_it_can_be_switched_off(self, world, mail):
        org = await _org(world)
        org.settings = {"minutes": {"open_items_digest": False}}
        await world.db.flush()
        await _approved(world, [_item("Order hose", world.assignee, 5)])

        assert await self._digest(world) == 0

    async def test_a_manager_who_opted_out_is_left_out(self, world, mail):
        quiet = await _user(
            world.db,
            world.org_id,
            "QuietChief",
            ["minutes.manage"],
            preferences='{"email_kinds": {"minutes_duties": false}}',
        )
        await _approved(world, [_item("Order hose", world.assignee, 5)])

        await self._digest(world)

        assert quiet.email not in _sent_to(mail)

    async def test_a_failed_send_does_not_start_the_week(self, world, mail):
        mail.return_value = (0, [])
        await _approved(world, [_item("Order hose", world.assignee, 5)])

        assert await self._digest(world) == 0
        mail.return_value = (1, [])
        assert await self._digest(world) == 2


async def test_unadopted_minutes_stay_out_of_the_list(world, mail):
    await _create(world, items=[_item("Draft", world.assignee, 1)])
    minutes = (await world.db.execute(select(MeetingMinutes))).scalars().all()
    assert minutes
    assert (
        await MinutesReminderService(world.db).send_open_items_digest(await _org(world))
    ) == 0


def _drop_publishing(body):
    """Publishing and attendance have their own tests; this file checks reminders."""
    for key in [
        k
        for k in body
        if k.startswith(("executive_", "public_")) or k == "attendance_listing"
    ]:
        body.pop(key)


class TestSettingsEndpoint:
    async def test_it_reports_the_defaults_when_nothing_is_set(self, world):
        async with _client(world.db, world.secretary) as c:
            resp = await c.get("/minutes/settings")

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body.pop("signature_slots")
        _drop_publishing(body)
        assert body == {
            "action_item_reminders": True,
            "reminder_days_before_due": 3,
            "overdue_repeat_days": 7,
            "open_items_digest": True,
        }

    async def test_it_reports_what_the_department_chose(self, world):
        org = await _org(world)
        org.settings = {
            "minutes": {
                "action_item_reminders": False,
                "reminder_days_before_due": 0,
                "overdue_repeat_days": 14,
                "open_items_digest": False,
            }
        }
        await world.db.flush()

        async with _client(world.db, world.secretary) as c:
            body = (await c.get("/minutes/settings")).json()

        body.pop("signature_slots")
        _drop_publishing(body)
        assert body == {
            "action_item_reminders": False,
            "reminder_days_before_due": 0,
            "overdue_repeat_days": 14,
            "open_items_digest": False,
        }

    async def test_a_member_who_does_not_manage_minutes_is_refused(self, world):
        async with _client(world.db, world.member) as c:
            resp = await c.get("/minutes/settings")

        assert resp.status_code == 403

    async def test_it_is_not_confused_with_a_minutes_id(self, world):
        async with _client(world.db, world.secretary) as c:
            resp = await c.get("/minutes/settings")

        assert resp.status_code == 200
        assert "title" not in resp.json()


async def test_the_scheduled_task_runs_both_emails_for_every_department(world, mail):
    from app.services.scheduled_tasks import run_minutes_action_item_reminders

    await _approved(world, [_item("Order hose", world.assignee, 1)])

    result = await run_minutes_action_item_reminders(world.db)

    assert result["errors"] == []
    recipients = _sent_to(mail)
    assert world.assignee.email in recipients
    assert world.secretary.email in recipients
