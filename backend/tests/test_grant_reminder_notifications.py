"""Daily email reminders for grant compliance tasks and pledges.

Pinned here:

* which reminder is due — a task's advance window follows its own
  ``reminder_days_before``, the due reminder covers the due date and a short
  catch-up after it; a pledge's 14- and 1-day windows;
* a compliance task reaches its assignee when they are an active member of
  the department who can open Grants & Fundraising, and otherwise the active
  ``fundraising.manage`` holders — nobody inactive or in another department;
* a pledge reaches the fundraising managers only, never the donor, and only
  while its reminder switch is on, it is still open and money is owed;
* not before the window, not twice, a moved due date starts afresh, a
  completed or waived task and a fulfilled or cancelled pledge are skipped;
* a member's opt-out is honoured, a department with the module off is sent
  nothing, and another department's items are never touched;
* the task is registered in all three scheduler tables.
"""

from datetime import timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.grant import (
    ComplianceTaskStatus,
    ComplianceTaskType,
    Donor,
    GrantApplication,
    GrantComplianceTask,
    Pledge,
    PledgeStatus,
)
from app.models.notification import NotificationChannel, NotificationLog
from app.models.user import Organization
from app.services import grant_reminder_notifications as reminders
from app.services import scheduled_tasks
from app.services.email_policy import EMAIL_POLICIES, EmailKind
from app.utils.org_timezone import org_today
from tests.test_finance_budget_owners import _org, _position, _user
from tests.test_finance_budget_request_notices import _Mailer

# ============================================
# Which reminder is due, no database
# ============================================


@pytest.mark.unit
class TestWhichReminder:
    @pytest.mark.parametrize(
        ("days_left", "advance", "expected"),
        [
            (15, 14, None),
            (14, 14, "advance"),
            (1, 14, "advance"),
            (20, 30, "advance"),
            (5, 0, None),
            (0, 14, "due"),
            (0, 0, "due"),
            (-7, 14, "due"),
            (-8, 14, None),
        ],
    )
    def test_task_stage(self, days_left, advance, expected):
        today = org_today(None)
        due = today + timedelta(days=days_left)
        assert reminders.task_stage(due, today, advance) == expected

    @pytest.mark.parametrize(
        ("days_left", "expected"),
        [(15, None), (14, 14), (2, 14), (1, 1), (0, 1), (-1, None)],
    )
    def test_pledge_offset(self, days_left, expected):
        today = org_today(None)
        due = today + timedelta(days=days_left)
        assert reminders.pledge_offset(due, today) == expected

    def test_the_kind_is_optional_and_on_by_default(self):
        policy = EMAIL_POLICIES[EmailKind.FUNDRAISING_DUTIES]
        assert policy.required is False
        assert policy.default_on is True


@pytest.mark.unit
class TestReminderTask:
    def test_it_is_registered_and_scheduled(self):
        name = "grant_reminders"
        assert scheduled_tasks.TASK_RUNNERS[name] is scheduled_tasks.run_grant_reminders
        assert name in scheduled_tasks.SCHEDULE
        assert scheduled_tasks.TASK_INTERVALS_SECONDS[name] == 86400


# ============================================
# Fixtures
# ============================================


@pytest.fixture
def mailer(monkeypatch):
    recorder = _Mailer()
    monkeypatch.setattr(
        "app.services.email_service.EmailService", recorder.factory, raising=True
    )
    return recorder


async def _grants_on(db: AsyncSession, org_id: str, on: bool = True) -> Organization:
    org = await db.get(Organization, org_id)
    org.settings = {"modules": {"grants": on, "_user_configured": True}}
    await db.flush()
    return org


@pytest.fixture
async def dept(db_session: AsyncSession):
    org_id = await _org(db_session, "grants")
    other_org = await _org(db_session, "elsewhere")
    await _grants_on(db_session, org_id)
    await _grants_on(db_session, other_org)

    manager_pos = await _position(
        db_session, org_id, "Grants Officer", ["fundraising.view", "fundraising.manage"]
    )
    viewer_pos = await _position(db_session, org_id, "Lieutenant", ["fundraising.view"])
    plain_pos = await _position(db_session, org_id, "Firefighter", [])
    their_manager_pos = await _position(
        db_session, other_org, "Their Grants Officer", ["fundraising.manage"]
    )

    people = {
        "manager": await _user(db_session, org_id, "manager", [manager_pos]),
        "co_manager": await _user(db_session, org_id, "comanager", [manager_pos]),
        "old_manager": await _user(
            db_session, org_id, "oldmanager", [manager_pos], status="inactive"
        ),
        "viewer": await _user(db_session, org_id, "viewer", [viewer_pos]),
        "old_viewer": await _user(
            db_session, org_id, "oldviewer", [viewer_pos], status="inactive"
        ),
        "plain": await _user(db_session, org_id, "plain", [plain_pos]),
        "their_manager": await _user(
            db_session, other_org, "theirmanager", [their_manager_pos]
        ),
    }
    application = GrantApplication(
        organization_id=org_id, grant_program_name="AFG Equipment"
    )
    their_application = GrantApplication(
        organization_id=other_org, grant_program_name="Their Grant"
    )
    db_session.add_all([application, their_application])
    await db_session.flush()
    return {
        "org_id": org_id,
        "other_org": other_org,
        "application": application.id,
        "their_application": their_application.id,
        **people,
    }


async def _org_row(db, org_id) -> Organization:
    return await db.get(Organization, org_id)


async def _task(db, dept, days, *, application="application", **kw):
    org = await _org_row(db, dept["org_id"])
    task = GrantComplianceTask(
        application_id=dept[application],
        task_type=ComplianceTaskType.PERFORMANCE_REPORT,
        title="Quarterly performance report",
        due_date=org_today(org) + timedelta(days=days),
        **kw,
    )
    db.add(task)
    await db.flush()
    return task


async def _pledge(db, dept, days, *, org_key="org_id", **kw):
    org = await _org_row(db, dept[org_key])
    values = {
        "pledged_amount": Decimal("500.00"),
        "fulfilled_amount": Decimal("0.00"),
        "status": PledgeStatus.PENDING,
        "reminder_enabled": True,
    }
    values.update(kw)
    pledge = Pledge(
        organization_id=dept[org_key],
        pledge_date=org_today(org) - timedelta(days=30),
        due_date=org_today(org) + timedelta(days=days),
        **values,
    )
    db.add(pledge)
    await db.flush()
    return pledge


async def _run(db, dept, org_key="org_id") -> int:
    org = await _org_row(db, dept[org_key])
    return await reminders.send_grant_reminders(db, org)


def _emails(dept, *names) -> set[str]:
    return {dept[name].email for name in names}


def _everyone(mailer) -> set[str]:
    return {address for send in mailer.sends for address in send["to"]}


# ============================================
# Compliance tasks
# ============================================


@pytest.mark.integration
class TestComplianceTaskReminder:
    async def test_the_assignee_is_reminded_inside_the_window(
        self, db_session, dept, mailer
    ):
        task = await _task(db_session, dept, 14, assigned_to=dept["viewer"].id)
        assert await _run(db_session, dept) == 1
        assert _everyone(mailer) == _emails(dept, "viewer")
        send = mailer.sends[0]
        assert send["subject"].startswith("Grant task due ")
        assert "Quarterly performance report" in send["subject"]
        assert "AFG Equipment" in send["text"]
        assert "is due in 14 days" in send["text"]
        assert f"/grants/applications/{dept['application']}" in send["text"]
        await db_session.refresh(task)
        assert task.last_reminder_sent is not None

    async def test_not_before_the_window(self, db_session, dept, mailer):
        await _task(db_session, dept, 15, assigned_to=dept["viewer"].id)
        assert await _run(db_session, dept) == 0
        assert mailer.sends == []

    async def test_the_tasks_own_lead_time_is_honoured(self, db_session, dept, mailer):
        await _task(
            db_session,
            dept,
            20,
            assigned_to=dept["viewer"].id,
            reminder_days_before=30,
        )
        assert await _run(db_session, dept) == 1
        mailer.sends.clear()
        # 0 turns the advance reminder off; the due-date one still comes.
        task = await _task(
            db_session, dept, 5, assigned_to=dept["viewer"].id, reminder_days_before=0
        )
        assert await _run(db_session, dept) == 0
        task.due_date = org_today(await _org_row(db_session, dept["org_id"]))
        await db_session.flush()
        assert await _run(db_session, dept) == 1
        assert "is due today" in mailer.sends[0]["text"]

    async def test_a_second_run_sends_nothing(self, db_session, dept, mailer):
        await _task(db_session, dept, 7, assigned_to=dept["viewer"].id)
        assert await _run(db_session, dept) == 1
        assert await _run(db_session, dept) == 0
        assert len(mailer.sends) == 1

    async def test_a_moved_due_date_starts_afresh(self, db_session, dept, mailer):
        task = await _task(db_session, dept, 10, assigned_to=dept["viewer"].id)
        assert await _run(db_session, dept) == 1
        task.due_date = task.due_date + timedelta(days=2)
        await db_session.flush()
        assert await _run(db_session, dept) == 1
        assert await _run(db_session, dept) == 0

    async def test_the_due_reminder_follows_the_advance_one(
        self, db_session, dept, mailer
    ):
        org = await _org_row(db_session, dept["org_id"])
        task = await _task(db_session, dept, 0, assigned_to=dept["viewer"].id)
        # Record an advance reminder for this same due date.
        db_session.add(
            NotificationLog(
                organization_id=dept["org_id"],
                recipient_id=dept["viewer"].id,
                recipient_email=dept["viewer"].email,
                channel=NotificationChannel.EMAIL,
                category=reminders.TASK_LOG_CATEGORY,
                notification_metadata={
                    "entity_id": task.id,
                    "due_date": task.due_date.isoformat(),
                    "reminder": "advance",
                },
            )
        )
        await db_session.flush()
        assert await _run(db_session, dept) == 1
        assert mailer.sends[0]["subject"].startswith("Grant task due today")
        logs = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.organization_id == dept["org_id"],
                        NotificationLog.category == reminders.TASK_LOG_CATEGORY,
                    )
                )
            )
            .scalars()
            .all()
        )
        stages = sorted(log.notification_metadata["reminder"] for log in logs)
        assert stages == ["advance", "due"]
        assert org_today(org) == task.due_date

    async def test_overdue_is_reminded_once_within_the_catch_up(
        self, db_session, dept, mailer
    ):
        await _task(db_session, dept, -3, assigned_to=dept["viewer"].id)
        await _task(db_session, dept, -8, assigned_to=dept["viewer"].id)
        assert await _run(db_session, dept) == 1
        assert mailer.sends[0]["subject"].startswith("Overdue grant task")
        assert "was due 3 days ago" in mailer.sends[0]["text"]
        assert await _run(db_session, dept) == 0

    async def test_completed_and_waived_tasks_are_skipped(
        self, db_session, dept, mailer
    ):
        await _task(
            db_session,
            dept,
            3,
            assigned_to=dept["viewer"].id,
            status=ComplianceTaskStatus.COMPLETED,
        )
        await _task(
            db_session,
            dept,
            3,
            assigned_to=dept["viewer"].id,
            status=ComplianceTaskStatus.WAIVED,
        )
        assert await _run(db_session, dept) == 0
        # An overdue-status task is still open.
        await _task(
            db_session,
            dept,
            3,
            assigned_to=dept["viewer"].id,
            status=ComplianceTaskStatus.OVERDUE,
        )
        assert await _run(db_session, dept) == 1

    @pytest.mark.parametrize("assignee", [None, "plain", "old_viewer", "their_manager"])
    async def test_without_an_able_assignee_the_managers_are_told(
        self, db_session, dept, mailer, assignee
    ):
        await _task(
            db_session,
            dept,
            7,
            assigned_to=dept[assignee].id if assignee else None,
        )
        assert await _run(db_session, dept) == 2
        assert _everyone(mailer) == _emails(dept, "manager", "co_manager")

    async def test_an_assignee_who_opted_out_is_not_emailed(
        self, db_session, dept, mailer
    ):
        dept["viewer"].notification_preferences = {
            "email_kinds": {"fundraising_duties": False}
        }
        await db_session.flush()
        await _task(db_session, dept, 7, assigned_to=dept["viewer"].id)
        assert await _run(db_session, dept) == 0
        assert mailer.sends == []

    async def test_another_departments_tasks_are_untouched(
        self, db_session, dept, mailer
    ):
        theirs = await _task(db_session, dept, 7, application="their_application")
        assert await _run(db_session, dept) == 0
        assert mailer.sends == []
        await db_session.refresh(theirs)
        assert theirs.last_reminder_sent is None
        assert await _run(db_session, dept, "other_org") == 1
        assert _everyone(mailer) == _emails(dept, "their_manager")

    async def test_a_department_with_the_module_off_is_sent_nothing(
        self, db_session, dept, mailer
    ):
        await _grants_on(db_session, dept["org_id"], on=False)
        await _task(db_session, dept, 7, assigned_to=dept["viewer"].id)
        await _pledge(db_session, dept, 1)
        assert await _run(db_session, dept) == 0
        assert mailer.sends == []


# ============================================
# Pledges
# ============================================


@pytest.mark.integration
class TestPledgeReminder:
    async def test_the_managers_are_reminded_never_the_donor(
        self, db_session, dept, mailer
    ):
        donor = Donor(
            organization_id=dept["org_id"],
            first_name="Pat",
            last_name="Giver",
            email="pat@donor.example",
        )
        db_session.add(donor)
        await db_session.flush()
        pledge = await _pledge(
            db_session,
            dept,
            14,
            donor_id=donor.id,
            fulfilled_amount=Decimal("200.00"),
            status=PledgeStatus.PARTIAL,
        )
        assert await _run(db_session, dept) == 2
        assert _everyone(mailer) == _emails(dept, "manager", "co_manager")
        assert "pat@donor.example" not in _everyone(mailer)
        send = mailer.sends[0]
        assert "Pat Giver" in send["subject"]
        assert "$300.00 outstanding" in send["subject"]
        assert "/grants/pledges" in send["text"]
        await db_session.refresh(pledge)
        assert pledge.last_reminder_sent is not None

    async def test_not_before_the_window_nor_after_the_due_date(
        self, db_session, dept, mailer
    ):
        await _pledge(db_session, dept, 15)
        await _pledge(db_session, dept, -1)
        assert await _run(db_session, dept) == 0
        assert mailer.sends == []

    async def test_once_per_reminder_and_the_next_still_goes_out(
        self, db_session, dept, mailer
    ):
        pledge = await _pledge(db_session, dept, 14)
        assert await _run(db_session, dept) == 2
        assert await _run(db_session, dept) == 0
        # Thirteen days later the 1-day reminder is a different key.
        org = await _org_row(db_session, dept["org_id"])
        pledge.due_date = org_today(org) + timedelta(days=1)
        await db_session.flush()
        assert await _run(db_session, dept) == 2

    async def test_a_moved_due_date_starts_afresh(self, db_session, dept, mailer):
        pledge = await _pledge(db_session, dept, 10)
        assert await _run(db_session, dept) == 2
        pledge.due_date = pledge.due_date + timedelta(days=3)
        await db_session.flush()
        assert await _run(db_session, dept) == 2

    async def test_switched_off_settled_or_cancelled_pledges_are_skipped(
        self, db_session, dept, mailer
    ):
        await _pledge(db_session, dept, 1, reminder_enabled=False)
        await _pledge(db_session, dept, 1, status=PledgeStatus.FULFILLED)
        await _pledge(db_session, dept, 1, status=PledgeStatus.CANCELLED)
        # Partial in name, but nothing left to receive.
        await _pledge(
            db_session,
            dept,
            1,
            status=PledgeStatus.PARTIAL,
            fulfilled_amount=Decimal("500.00"),
        )
        assert await _run(db_session, dept) == 0
        assert mailer.sends == []

    async def test_a_manager_who_opted_out_is_not_emailed(
        self, db_session, dept, mailer
    ):
        dept["manager"].notification_preferences = {
            "email_kinds": {"fundraising_duties": False}
        }
        await db_session.flush()
        await _pledge(db_session, dept, 1)
        assert await _run(db_session, dept) == 1
        assert _everyone(mailer) == _emails(dept, "co_manager")

    async def test_another_departments_pledges_are_untouched(
        self, db_session, dept, mailer
    ):
        theirs = await _pledge(db_session, dept, 1, org_key="other_org")
        assert await _run(db_session, dept) == 0
        await db_session.refresh(theirs)
        assert theirs.last_reminder_sent is None
        assert await _run(db_session, dept, "other_org") == 1
        assert _everyone(mailer) == _emails(dept, "their_manager")
