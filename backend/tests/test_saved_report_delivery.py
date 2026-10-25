"""
Scheduled delivery of saved reports, with the PII gate (RPT2-29-2).

``SavedReport`` scheduling fields were accepted and listed as scheduled while
nothing ever generated or sent a report (CLAUDE.md pitfall #19). The owner
chose to build the sender and a saved-reports screen with the PII gate:
PII-bearing report types may only be scheduled by, and emailed to, members
holding the permission that guards the same data at its source, and the
email itself carries counts, never member rows.
"""

import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.services import saved_report_schedule as schedule
from app.services.saved_report_schedule import (
    _numeric_summary,
    next_run_on_or_after,
    resolve_period,
    validate_schedule,
)

TODAY = date(2026, 10, 11)  # a Sunday


@pytest.mark.unit
class TestScheduleRules:
    def test_daily_is_the_day_itself(self):
        assert next_run_on_or_after("daily", None, TODAY) == TODAY

    def test_weekly_is_the_next_matching_weekday(self):
        assert next_run_on_or_after("weekly", 1, TODAY) == date(2026, 10, 12)
        assert next_run_on_or_after("weekly", 7, TODAY) == TODAY

    def test_monthly_clamps_to_a_short_month(self):
        assert next_run_on_or_after("monthly", 31, date(2027, 2, 2)) == date(
            2027, 2, 28
        )
        assert next_run_on_or_after("monthly", 5, TODAY) == date(2026, 11, 5)

    def test_quarterly_runs_on_quarter_months(self):
        assert next_run_on_or_after("quarterly", 1, TODAY) == date(2027, 1, 1)
        assert next_run_on_or_after("quarterly", 15, date(2026, 10, 1)) == date(
            2026, 10, 15
        )

    @pytest.mark.parametrize(
        ("period", "expected"),
        [
            ("previous_month", (date(2026, 9, 1), date(2026, 9, 30))),
            ("previous_quarter", (date(2026, 7, 1), date(2026, 9, 30))),
            ("year_to_date", (date(2026, 1, 1), TODAY)),
            ("previous_year", (date(2025, 1, 1), date(2025, 12, 31))),
            ("last_30_days", (TODAY - timedelta(days=30), TODAY)),
            (None, (None, None)),
        ],
    )
    def test_periods(self, period, expected):
        assert resolve_period(period, TODAY) == expected

    @pytest.mark.parametrize(
        ("args", "message"),
        [
            ((True, None, None, ["a@x.org"]), "needs a frequency"),
            ((True, "weekly", 9, ["a@x.org"]), "1 \\(Monday\\) to 7"),
            ((True, "monthly", 32, ["a@x.org"]), "1 to 31"),
            ((True, "daily", None, []), "at least one email recipient"),
            ((True, "daily", None, [f"{n}@x.org" for n in range(26)]), "at most 25"),
        ],
    )
    def test_a_schedule_that_could_not_send_is_refused(self, args, message):
        with pytest.raises(ValueError, match=message):
            validate_schedule(*args)

    def test_an_unscheduled_report_needs_nothing(self):
        validate_schedule(False, None, None, None)

    def test_the_summary_is_counts_only(self):
        summary = _numeric_summary(
            {
                "total_members": 12,
                "completion_rate": 87.5,
                "is_partial": True,
                "generated_at": "2026-10-11",
                "entries": [{"member_name": "Dana Reyes"}],
            }
        )
        assert summary == [
            ("Total members", "12"),
            ("Completion rate", "87.5"),
            ("Rows in the report", "1"),
        ]


# ---------------------------------------------------------------------------
# Against the database
# ---------------------------------------------------------------------------


class _Mailer:
    def __init__(self):
        self.sends: list[dict] = []
        self.enabled = True
        self.accepting = True

    def factory(self, organization=None):
        mailer = self

        class _Service:
            @property
            def can_send(self):
                return mailer.enabled

            async def send_email(self, to_emails, subject, html_body, **kwargs):
                if not mailer.accepting:
                    return 0, len(to_emails)
                mailer.sends.append(
                    {
                        "to": list(to_emails),
                        "subject": subject,
                        "html": html_body,
                        "text": kwargs.get("text_body") or "",
                    }
                )
                return len(to_emails), 0

        return _Service()


@pytest.fixture
def mailer(monkeypatch):
    recorder = _Mailer()
    monkeypatch.setattr("app.services.email_service.EmailService", recorder.factory)
    return recorder


@pytest.fixture
def fake_report(monkeypatch):
    calls = []

    async def generate(self, organization_id, report_type, **kwargs):
        calls.append({"report_type": report_type, **kwargs})
        return {
            "report_type": report_type,
            "total_members": 2,
            "entries": [{"member_name": "Dana Reyes", "email": "dana@x.org"}],
        }

    monkeypatch.setattr(
        "app.services.reports_service.ReportsService.generate_report", generate
    )
    return calls


async def _dept(db_session):
    from app.models.user import Organization, Position, User, UserStatus

    org = Organization(
        id=str(uuid.uuid4()),
        name="Saved Reports Department",
        slug=f"saved-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()

    async def position(name, permissions):
        handle = uuid.uuid4().hex[:8]
        p = Position(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name=f"{name} {handle}",
            slug=f"{name.lower()}-{handle}",
            permissions=permissions,
        )
        db_session.add(p)
        await db_session.flush()
        return p

    officer = await position(
        "Training Officer", ["reports.view", "reports.manage", "training.manage"]
    )
    viewer = await position("Viewer", ["reports.view"])

    async def member(name, positions):
        handle = uuid.uuid4().hex[:8]
        u = User(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            username=f"{name}-{handle}",
            email=f"{name}-{handle}@savedreports.org",
            first_name=name.title(),
            last_name="Member",
            password_hash="x",
            status=UserStatus.ACTIVE,
        )
        u.positions = positions
        db_session.add(u)
        await db_session.flush()
        return u

    return SimpleNamespace(
        org=org,
        owner=await member("owner", [officer]),
        colleague=await member("colleague", [officer]),
        viewer=await member("viewer", [viewer]),
        officer_position=officer,
    )


async def _saved(db_session, dept, **overrides):
    from app.models.analytics import SavedReport

    values = dict(
        id=str(uuid.uuid4()),
        organization_id=dept.org.id,
        name="Weekly program progress",
        report_type="compliance_status",
        filters={},
        is_scheduled=True,
        schedule_frequency="daily",
        schedule_day=None,
        email_recipients=[dept.colleague.email],
        next_run_date=TODAY,
        created_by=dept.owner.id,
        is_active=True,
    )
    values.update(overrides)
    saved = SavedReport(**values)
    db_session.add(saved)
    await db_session.flush()
    return saved


@pytest.fixture
def today(monkeypatch):
    monkeypatch.setattr("app.utils.org_timezone.org_today", lambda _org: TODAY)
    return TODAY


@pytest.mark.integration
class TestTheSender:
    async def test_a_due_report_is_summarised_once(
        self, db_session, mailer, fake_report, today
    ):
        dept = await _dept(db_session)
        saved = await _saved(db_session, dept)

        assert await schedule.send_due_saved_reports(db_session, dept.org) == 1
        assert await schedule.send_due_saved_reports(db_session, dept.org) == 0

        assert len(mailer.sends) == 1
        send = mailer.sends[0]
        assert send["to"] == [dept.colleague.email]
        assert send["subject"] == "Scheduled report: Weekly program progress"
        assert "Total members: 2" in send["text"]
        # Counts only: no member row reaches the email.
        assert "Dana Reyes" not in send["text"] + send["html"]
        assert "dana@x.org" not in send["text"] + send["html"]
        assert saved.next_run_date == TODAY + timedelta(days=1)
        assert saved.last_run_at is not None

    async def test_a_relative_period_is_resolved_on_the_run_day(
        self, db_session, mailer, fake_report, today
    ):
        dept = await _dept(db_session)
        await _saved(db_session, dept, filters={"period": "previous_month"})

        await schedule.send_due_saved_reports(db_session, dept.org)

        assert fake_report[0]["start_date"] == date(2026, 9, 1)
        assert fake_report[0]["end_date"] == date(2026, 9, 30)

    async def test_a_schedule_from_before_the_sender_waits_for_its_next_date(
        self, db_session, mailer, fake_report, today
    ):
        dept = await _dept(db_session)
        saved = await _saved(
            db_session,
            dept,
            next_run_date=None,
            schedule_frequency="weekly",
            schedule_day=7,
        )

        assert await schedule.send_due_saved_reports(db_session, dept.org) == 0
        assert mailer.sends == []
        # Today is a Sunday, but upgrading must not send at once.
        assert saved.next_run_date == TODAY + timedelta(days=7)

    async def test_an_owner_who_lost_the_permission_stops_the_send(
        self, db_session, mailer, fake_report, today
    ):
        dept = await _dept(db_session)
        saved = await _saved(db_session, dept)
        dept.owner.positions = []
        await db_session.flush()

        assert await schedule.send_due_saved_reports(db_session, dept.org) == 0
        assert mailer.sends == []
        assert saved.next_run_date == TODAY + timedelta(days=1)

    async def test_recipients_without_the_permission_are_dropped(
        self, db_session, mailer, fake_report, today
    ):
        dept = await _dept(db_session)
        await _saved(
            db_session,
            dept,
            email_recipients=[
                dept.colleague.email,
                dept.viewer.email,
                "outside@example.org",
            ],
        )

        assert await schedule.send_due_saved_reports(db_session, dept.org) == 1
        assert mailer.sends[0]["to"] == [dept.colleague.email]

    async def test_a_non_pii_report_may_go_outside_the_department(
        self, db_session, mailer, fake_report, today
    ):
        dept = await _dept(db_session)
        await _saved(
            db_session,
            dept,
            report_type="apparatus_status",
            email_recipients=["county@example.org"],
        )

        assert await schedule.send_due_saved_reports(db_session, dept.org) == 1
        assert mailer.sends[0]["to"] == ["county@example.org"]


@pytest.mark.integration
class TestARunThatFails:
    async def test_a_send_the_provider_refuses_is_tried_again_next_run(
        self, db_session, mailer, fake_report, today
    ):
        dept = await _dept(db_session)
        saved = await _saved(db_session, dept)

        mailer.accepting = False
        assert await schedule.send_due_saved_reports(db_session, dept.org) == 0
        assert saved.next_run_date == TODAY
        assert saved.last_run_at is None

        mailer.accepting = True
        assert await schedule.send_due_saved_reports(db_session, dept.org) == 1
        assert saved.next_run_date == TODAY + timedelta(days=1)
        assert saved.last_run_at is not None

    async def test_disabled_email_does_not_generate_or_advance(
        self, db_session, mailer, fake_report, today
    ):
        dept = await _dept(db_session)
        saved = await _saved(db_session, dept)
        mailer.enabled = False

        assert await schedule.send_due_saved_reports(db_session, dept.org) == 0
        assert fake_report == []
        assert saved.next_run_date == TODAY

    async def test_a_generator_that_raises_does_not_block_the_rest(
        self, db_session, mailer, monkeypatch
    ):
        dept = await _dept(db_session)
        broken = await _saved(db_session, dept, name="Broken", report_type="apparatus")
        sound = await _saved(
            db_session, dept, name="Sound", report_type="apparatus_status"
        )
        broken_id, sound_id = broken.id, sound.id
        # Committed, as it is in production: the failure path rolls back.
        await db_session.commit()
        logged: list[str] = []

        async def generate(self, organization_id, report_type, **kwargs):
            if report_type == "apparatus":
                raise RuntimeError("generator blew up")
            return {"report_type": report_type, "total_members": 2}

        async def persist(org_id, task_name, exc, extra_context=None):
            logged.append((extra_context or {}).get("saved_report_id"))
            return True

        monkeypatch.setattr(
            "app.services.reports_service.ReportsService.generate_report", generate
        )
        monkeypatch.setattr("app.core.error_reporting.persist_task_error_log", persist)
        monkeypatch.setattr("app.utils.org_timezone.org_today", lambda _org: TODAY)

        assert await schedule.send_due_saved_reports(db_session, dept.org) == 1

        from app.models.analytics import SavedReport

        rows = {
            r.id: r
            for r in (
                await db_session.execute(
                    select(SavedReport).where(
                        SavedReport.organization_id == dept.org.id
                    )
                )
            )
            .scalars()
            .all()
        }
        assert [m["subject"] for m in mailer.sends] == ["Scheduled report: Sound"]
        assert logged == [broken_id]
        assert rows[broken_id].next_run_date == TODAY
        assert rows[sound_id].next_run_date == TODAY + timedelta(days=1)

    async def test_an_unknown_report_type_is_settled_not_retried(
        self, db_session, mailer, today, monkeypatch
    ):
        dept = await _dept(db_session)
        saved = await _saved(db_session, dept, report_type="apparatus_status")

        async def refuse(self, *args, **kwargs):
            return {"error": "Unknown report type: apparatus_status"}

        monkeypatch.setattr(
            "app.services.reports_service.ReportsService.generate_report", refuse
        )

        assert await schedule.send_due_saved_reports(db_session, dept.org) == 0
        assert saved.next_run_date == TODAY + timedelta(days=1)


@pytest.mark.integration
class TestTheSaveEndpoints:
    async def test_scheduling_a_pii_report_to_an_outsider_is_refused(self, db_session):
        from app.api.v1.endpoints import reports as endpoint
        from app.schemas.reports import SavedReportCreate

        dept = await _dept(db_session)
        with pytest.raises(HTTPException) as exc:
            await endpoint.create_saved_report(
                SavedReportCreate(
                    name="Roster to the county",
                    report_type="compliance_status",
                    is_scheduled=True,
                    schedule_frequency="weekly",
                    schedule_day=1,
                    email_recipients=["county@example.org", dept.viewer.email],
                ),
                db=db_session,
                current_user=dept.owner,
            )
        assert exc.value.status_code == 400
        assert "county@example.org" in exc.value.detail
        assert dept.viewer.email in exc.value.detail

    async def test_a_valid_schedule_is_live_with_its_next_date(self, db_session):
        from app.api.v1.endpoints import reports as endpoint
        from app.schemas.reports import SavedReportCreate

        dept = await _dept(db_session)
        out = await endpoint.create_saved_report(
            SavedReportCreate(
                name="Program progress",
                report_type="compliance_status",
                filters={"period": "previous_month"},
                is_scheduled=True,
                schedule_frequency="monthly",
                schedule_day=1,
                email_recipients=[dept.colleague.email],
            ),
            db=db_session,
            current_user=dept.owner,
        )
        assert out.enforced is True
        assert out.next_run_at is not None
        assert date.fromisoformat(out.next_run_at).day == 1

    async def test_saving_a_pii_report_needs_its_permission(self, db_session):
        from app.api.v1.endpoints import reports as endpoint
        from app.schemas.reports import SavedReportCreate

        dept = await _dept(db_session)
        with pytest.raises(HTTPException) as exc:
            await endpoint.create_saved_report(
                SavedReportCreate(name="Roster", report_type="member_roster"),
                db=db_session,
                current_user=dept.owner,  # holds training.manage, not members.view
            )
        assert exc.value.status_code == 403

    async def test_an_unknown_period_is_refused(self, db_session):
        from app.api.v1.endpoints import reports as endpoint
        from app.schemas.reports import SavedReportCreate

        dept = await _dept(db_session)
        with pytest.raises(HTTPException) as exc:
            await endpoint.create_saved_report(
                SavedReportCreate(
                    name="Odd",
                    report_type="call_volume",
                    filters={"period": "fortnight"},
                ),
                db=db_session,
                current_user=dept.owner,
            )
        assert exc.value.status_code == 400


@pytest.mark.unit
def test_the_task_is_registered_daily():
    from app.services.scheduled_tasks import (
        SCHEDULE,
        TASK_INTERVALS_SECONDS,
        TASK_RUNNERS,
    )

    assert "saved_report_delivery" in TASK_RUNNERS
    assert TASK_INTERVALS_SECONDS["saved_report_delivery"] == 86400
    assert SCHEDULE["saved_report_delivery"]["frequency"] == "daily"
