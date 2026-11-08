"""Medical screening expiry reminders (W71b-4, owner decision 2026-11-06).

The member gets one email at the most urgent tier (90/60/30/7 days) a
screening has reached, once per tier per screening and due date, however many
times the daily task runs (pitfall #36). The department's switches are the
Medical Screening module and the ``medical_screening_expiry`` notification
rule; the member's is "Training and certification reminders". The email
names the requirement and the due date and nothing else.
"""

import json
import uuid
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select, text

from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningReminderSend,
    ScreeningRequirement,
    ScreeningStatus,
    ScreeningType,
)
from app.models.notification import NotificationRule, NotificationTrigger
from app.services.scheduled_tasks import TASK_INTERVALS_SECONDS, TASK_RUNNERS
from app.services.screening_reminder_service import (
    SUBJECT,
    ScreeningReminderService,
)

pytestmark = [pytest.mark.integration]

# Fixed so every count below is exact; the org's timezone is UTC.
TODAY = date(2026, 11, 8)


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def mailer(monkeypatch):
    send_email = AsyncMock(return_value=(1, 0))
    monkeypatch.setattr(
        "app.services.screening_reminder_service.EmailService",
        lambda org: SimpleNamespace(send_email=send_email),
    )
    monkeypatch.setattr(
        "app.services.screening_reminder_service.org_today", lambda org: TODAY
    )
    monkeypatch.setattr(
        "app.services.medical_screening_service.resolve_org_today",
        AsyncMock(return_value=TODAY),
    )
    return send_email


async def _org(db, modules_on: bool = True) -> str:
    org_id = _uid()
    settings = {"modules": {"medical_screening": modules_on, "_user_configured": True}}
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC', :settings)"
        ),
        {"id": org_id, "slug": f"sr-{org_id[:8]}", "settings": json.dumps(settings)},
    )
    return org_id


async def _member(db, org_id, status="active", prefs=None) -> str:
    member_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, notification_preferences) "
            "VALUES (:id, :org, :un, 'Jordan', 'Avery', :em, 'x', :status, :prefs)"
        ),
        {
            "id": member_id,
            "org": org_id,
            "un": f"m-{member_id[:8]}",
            "em": f"m-{member_id[:8]}@test.com",
            "status": status,
            "prefs": json.dumps(prefs) if prefs is not None else None,
        },
    )
    return member_id


async def _screening(db, org_id, member_id, due: date, **record_kwargs):
    req = ScreeningRequirement(
        id=_uid(),
        organization_id=org_id,
        name="Annual Physical",
        screening_type=ScreeningType.PHYSICAL_EXAM,
        frequency_months=12,
    )
    db.add(req)
    await db.flush()
    record = ScreeningRecord(
        id=_uid(),
        organization_id=org_id,
        requirement_id=req.id,
        user_id=member_id,
        screening_type=ScreeningType.PHYSICAL_EXAM,
        status=ScreeningStatus.PASSED,
        completed_date=due - timedelta(days=365),
        expiration_date=due,
        result_summary="BP 150/95, follow-up advised",
        **record_kwargs,
    )
    db.add(record)
    await db.flush()
    return record.id


async def _sends(db, record_id):
    rows = await db.execute(
        select(ScreeningReminderSend.tier_days).where(
            ScreeningReminderSend.screening_record_id == record_id
        )
    )
    return sorted(t for (t,) in rows.all())


async def _scene(db, days_until: int, **member_kwargs):
    org_id = await _org(db)
    member_id = await _member(db, org_id, **member_kwargs)
    record_id = await _screening(
        db, org_id, member_id, TODAY + timedelta(days=days_until)
    )
    # Committed (a savepoint release under the test fixture) so a reminder's
    # own rollback cannot take the setup with it.
    await db.commit()
    return SimpleNamespace(org_id=org_id, member_id=member_id, record_id=record_id)


class TestTiers:
    async def test_the_most_urgent_tier_reached_is_sent_once(self, db_session, mailer):
        scene = await _scene(db_session, days_until=20)

        result = await ScreeningReminderService(db_session).process_reminders(
            scene.org_id
        )

        assert result["reminders_sent"] == 1
        mailer.assert_awaited_once()
        # 30 fired; 90 and 60 were skipped and are spent, so they never fire
        # backwards on a later run.
        assert await _sends(db_session, scene.record_id) == [30, 60, 90]

    async def test_nothing_before_ninety_days(self, db_session, mailer):
        scene = await _scene(db_session, days_until=91)

        await ScreeningReminderService(db_session).process_reminders(scene.org_id)

        mailer.assert_not_awaited()
        assert await _sends(db_session, scene.record_id) == []

    async def test_the_next_tier_fires_when_it_is_reached(
        self, db_session, mailer, monkeypatch
    ):
        scene = await _scene(db_session, days_until=60)
        service = ScreeningReminderService(db_session)
        await service.process_reminders(scene.org_id)

        later = TODAY + timedelta(days=53)  # 7 days before the due date
        monkeypatch.setattr(
            "app.services.screening_reminder_service.org_today", lambda org: later
        )
        monkeypatch.setattr(
            "app.services.medical_screening_service.resolve_org_today",
            AsyncMock(return_value=later),
        )
        await ScreeningReminderService(db_session).process_reminders(scene.org_id)

        assert mailer.await_count == 2
        assert await _sends(db_session, scene.record_id) == [7, 30, 60, 90]

    async def test_a_past_due_screening_is_not_reminded(self, db_session, mailer):
        scene = await _scene(db_session, days_until=-1)

        await ScreeningReminderService(db_session).process_reminders(scene.org_id)

        mailer.assert_not_awaited()


class TestRunTwice:
    async def test_a_second_run_sends_nothing(self, db_session, mailer):
        scene = await _scene(db_session, days_until=5)
        service = ScreeningReminderService(db_session)

        first = await service.process_reminders(scene.org_id)
        second = await ScreeningReminderService(db_session).process_reminders(
            scene.org_id
        )

        assert first["reminders_sent"] == 1
        assert second["reminders_sent"] == 0
        mailer.assert_awaited_once()

    async def test_the_unique_key_refuses_a_racing_claim(self, db_session, mailer):
        """Two runs both read "not sent" before either commits: the second
        one's insert collides with the first's row and it skips."""
        scene = await _scene(db_session, days_until=5)
        db_session.add(
            ScreeningReminderSend(
                organization_id=scene.org_id,
                screening_record_id=scene.record_id,
                tier_days=7,
                due_date=TODAY + timedelta(days=5),
            )
        )
        await db_session.commit()
        service = ScreeningReminderService(db_session)
        # The other run's row is invisible to this run's read of what was sent.
        service._sent_keys = AsyncMock(return_value=set())

        result = await service.process_reminders(scene.org_id)

        assert result["reminders_sent"] == 0
        mailer.assert_not_awaited()

    async def test_a_corrected_due_date_rearms_the_reminders(self, db_session, mailer):
        scene = await _scene(db_session, days_until=5)
        await ScreeningReminderService(db_session).process_reminders(scene.org_id)
        record = await db_session.get(ScreeningRecord, scene.record_id)
        record.expiration_date = TODAY + timedelta(days=6)
        await db_session.commit()

        await ScreeningReminderService(db_session).process_reminders(scene.org_id)

        assert mailer.await_count == 2

    async def test_a_failed_send_is_retried_next_run(self, db_session, mailer):
        scene = await _scene(db_session, days_until=5)
        mailer.return_value = (0, 1)
        first = await ScreeningReminderService(db_session).process_reminders(
            scene.org_id
        )
        assert first["errors"] == 1
        assert await _sends(db_session, scene.record_id) == []

        mailer.return_value = (1, 0)
        second = await ScreeningReminderService(db_session).process_reminders(
            scene.org_id
        )

        assert second["reminders_sent"] == 1


class TestWhoIsReminded:
    async def test_a_member_who_muted_training_reminders_is_not_emailed(
        self, db_session, mailer
    ):
        scene = await _scene(
            db_session,
            days_until=5,
            prefs={"email_kinds": {"training_reminders": False}},
        )

        result = await ScreeningReminderService(db_session).process_reminders(
            scene.org_id
        )

        mailer.assert_not_awaited()
        assert result["skipped_opted_out"] == 1
        # Spent, so the opt-out is not re-asked every day.
        assert await _sends(db_session, scene.record_id) == [7, 30, 60, 90]

    async def test_a_former_member_is_not_emailed(self, db_session, mailer):
        scene = await _scene(db_session, days_until=5, status="retired")

        await ScreeningReminderService(db_session).process_reminders(scene.org_id)

        mailer.assert_not_awaited()

    async def test_off_when_the_module_is_off(self, db_session, mailer):
        org_id = await _org(db_session, modules_on=False)
        member_id = await _member(db_session, org_id)
        await _screening(db_session, org_id, member_id, TODAY + timedelta(days=5))
        await db_session.commit()

        await ScreeningReminderService(db_session).process_reminders(org_id)

        mailer.assert_not_awaited()

    async def test_off_when_the_department_disables_the_rule(self, db_session, mailer):
        scene = await _scene(db_session, days_until=5)
        db_session.add(
            NotificationRule(
                organization_id=scene.org_id,
                name="Screening reminders",
                trigger=NotificationTrigger.MEDICAL_SCREENING_EXPIRY,
                enabled=False,
            )
        )
        await db_session.commit()

        await ScreeningReminderService(db_session).process_reminders(scene.org_id)

        mailer.assert_not_awaited()


class TestTheEmail:
    async def test_names_the_requirement_and_date_and_nothing_clinical(
        self, db_session, mailer
    ):
        scene = await _scene(db_session, days_until=5)

        await ScreeningReminderService(db_session).process_reminders(scene.org_id)

        kwargs = mailer.await_args.kwargs
        assert kwargs["subject"] == SUBJECT
        assert "Physical" not in kwargs["subject"]
        body = kwargs["text_body"]
        assert "Annual Physical" in body
        assert "November 13, 2026" in body and "in 5 days" in body
        for leaked in ("BP 150/95", "passed", "physical_exam"):
            assert leaked not in body
            assert leaked not in kwargs["html_body"]
        assert "db" not in kwargs


def test_the_task_is_registered_and_runs_daily():
    assert "medical_screening_expiry_reminders" in TASK_RUNNERS
    assert TASK_INTERVALS_SECONDS["medical_screening_expiry_reminders"] == 86400


def test_the_trigger_is_enforced():
    from app.models.notification import is_enforced

    assert is_enforced(NotificationTrigger.MEDICAL_SCREENING_EXPIRY)
