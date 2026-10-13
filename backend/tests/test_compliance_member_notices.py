"""
Compliance reminders and non-compliance notices to members (CMP2-1).

The Compliance configuration screen's Notifications panel stored a "notify
non-compliant members" switch and a "reminder days before deadline" list that
nothing read. The owner chose to build the daily email task so both work as
configured, email-first.
"""

import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.services import compliance_member_notices as notices
from app.services.compliance_member_notices import (
    due_offset,
    reminder_offsets,
    requirement_deadline,
)
from app.services.training_compliance import MemberCompliance, RequirementEvaluation

TODAY = date(2026, 10, 11)


def _ev(status="not_started", window_end=None, catch_up=None, **progress):
    return RequirementEvaluation(
        status=status,
        window_end=window_end.isoformat() if window_end else None,
        catch_up_deadline=catch_up.isoformat() if catch_up else None,
        **progress,
    )


@pytest.mark.unit
class TestPureRules:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ([30, 14, 7], [7, 14, 30]),
            ([7, 7, "14", -1, 400, 2.5, True, None], [7]),
            (None, []),
            ("30,14", []),
        ],
    )
    def test_offsets_are_read_defensively(self, raw, expected):
        assert reminder_offsets(raw) == expected

    def test_the_most_urgent_begun_window_is_due(self):
        deadline = TODAY + timedelta(days=10)
        assert due_offset(deadline, TODAY, [7, 14, 30]) == 14
        assert due_offset(TODAY + timedelta(days=7), TODAY, [7, 14, 30]) == 7
        assert due_offset(TODAY + timedelta(days=31), TODAY, [7, 14, 30]) is None
        assert due_offset(TODAY - timedelta(days=1), TODAY, [7, 14, 30]) is None

    def test_deadlines(self):
        end = date(2026, 12, 31)
        assert requirement_deadline(_ev("not_started", end), TODAY) == end
        assert requirement_deadline(_ev("in_progress", end), TODAY) == end
        assert requirement_deadline(_ev("completed", end), TODAY) is None
        # Lapsed already: nothing left to remind about.
        assert requirement_deadline(_ev("expired", end), TODAY) is None
        assert requirement_deadline(_ev("not_started", date(2026, 1, 1)), TODAY) is None
        catch_up = date(2026, 11, 1)
        assert (
            requirement_deadline(_ev("catch_up", catch_up=catch_up), TODAY) == catch_up
        )


# ---------------------------------------------------------------------------
# The task against the database, with the grading itself stubbed: who is
# unmet and when is the shared evaluator's job, tested on its own.
# ---------------------------------------------------------------------------


class _Mailer:
    def __init__(self):
        self.sends: list[dict] = []

    def factory(self, organization=None):
        mailer = self

        class _Service:
            async def send_email(self, to_emails, subject, html_body, **kwargs):
                mailer.sends.append(
                    {
                        "to": list(to_emails),
                        "subject": subject,
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


async def _department(db_session, *, notify=True, days=(30, 14, 7), prefs=None):
    from app.models.compliance_config import ComplianceConfig
    from app.models.user import Organization, User, UserStatus

    org = Organization(
        id=str(uuid.uuid4()),
        name="Notices Department",
        slug=f"notices-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    handle = uuid.uuid4().hex[:8]
    member = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"m-{handle}",
        email=f"{handle}@notices.test",
        first_name="Dana",
        last_name="Reyes",
        password_hash="x",
        status=UserStatus.ACTIVE,
        notification_preferences=prefs,
    )
    db_session.add(member)
    db_session.add(
        ComplianceConfig(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            notify_non_compliant_members=notify,
            notify_days_before_deadline=list(days) if days is not None else None,
        )
    )
    await db_session.flush()
    return org, member


def _stub_grading(monkeypatch, member, standing, evaluations):
    async def grade(db, org_id, today, config=None):
        return [MemberCompliance(member, standing, 0.0, tuple(evaluations))]

    monkeypatch.setattr(notices, "grade_org_members", grade)
    monkeypatch.setattr(notices, "org_today", lambda _org: TODAY)


def _req(name="Annual Live Fire"):
    return SimpleNamespace(id=str(uuid.uuid4()), name=name)


@pytest.mark.integration
class TestTheTask:
    async def test_a_reminder_on_the_configured_day_and_only_once(
        self, db_session, mailer, monkeypatch
    ):
        org, member = await _department(db_session, notify=False)
        req = _req()
        _stub_grading(
            monkeypatch,
            member,
            "at_risk",
            [
                (
                    req,
                    _ev(
                        "in_progress",
                        TODAY + timedelta(days=14),
                        progress_current=9.0,
                        progress_required=12.0,
                        progress_unit="hours",
                    ),
                )
            ],
        )

        assert await notices.send_member_compliance_notices(db_session, org) == 1
        assert await notices.send_member_compliance_notices(db_session, org) == 0

        assert len(mailer.sends) == 1
        send = mailer.sends[0]
        assert send["to"] == [member.email]
        assert send["subject"] == ("Reminder: Annual Live Fire is due October 25, 2026")
        assert "9 of 12 hours so far" in send["text"]

    async def test_the_next_offset_is_a_new_reminder(
        self, db_session, mailer, monkeypatch
    ):
        org, member = await _department(db_session, notify=False)
        req = _req()
        deadline = TODAY + timedelta(days=14)
        _stub_grading(
            monkeypatch, member, "at_risk", [(req, _ev("not_started", deadline))]
        )
        await notices.send_member_compliance_notices(db_session, org)

        # A week later the 7-day window has begun.
        monkeypatch.setattr(
            notices, "org_today", lambda _org: TODAY + timedelta(days=7)
        )
        assert await notices.send_member_compliance_notices(db_session, org) == 1
        assert len(mailer.sends) == 2

    async def test_a_non_compliance_notice_once_per_unmet_set(
        self, db_session, mailer, monkeypatch
    ):
        org, member = await _department(db_session, days=None)
        first, second = _req("Live Fire"), _req("HazMat Refresher")
        end = date(2026, 12, 31)
        _stub_grading(
            monkeypatch, member, "non_compliant", [(first, _ev("not_started", end))]
        )
        assert await notices.send_member_compliance_notices(db_session, org) == 1
        assert await notices.send_member_compliance_notices(db_session, org) == 0
        assert "Live Fire" in mailer.sends[0]["text"]

        # Falling short of a further requirement is news.
        _stub_grading(
            monkeypatch,
            member,
            "non_compliant",
            [(first, _ev("not_started", end)), (second, _ev("expired", end))],
        )
        assert await notices.send_member_compliance_notices(db_session, org) == 1
        assert "HazMat Refresher" in mailer.sends[1]["text"]

    async def test_at_risk_members_get_no_non_compliance_notice(
        self, db_session, mailer, monkeypatch
    ):
        org, member = await _department(db_session, days=None)
        _stub_grading(
            monkeypatch, member, "at_risk", [(_req(), _ev("not_started", TODAY))]
        )
        assert await notices.send_member_compliance_notices(db_session, org) == 0
        assert mailer.sends == []

    async def test_switched_off_settings_send_nothing(
        self, db_session, mailer, monkeypatch
    ):
        org, member = await _department(db_session, notify=False, days=None)
        _stub_grading(
            monkeypatch,
            member,
            "non_compliant",
            [(_req(), _ev("not_started", TODAY + timedelta(days=7)))],
        )
        assert await notices.send_member_compliance_notices(db_session, org) == 0
        assert mailer.sends == []

    async def test_a_member_who_turned_training_reminders_off_is_skipped(
        self, db_session, mailer, monkeypatch
    ):
        org, member = await _department(db_session, prefs={"training_reminders": False})
        _stub_grading(
            monkeypatch,
            member,
            "non_compliant",
            [(_req(), _ev("not_started", TODAY + timedelta(days=7)))],
        )
        assert await notices.send_member_compliance_notices(db_session, org) == 0
        assert mailer.sends == []

    async def test_a_department_with_no_configuration_sends_nothing(
        self, db_session, mailer
    ):
        from app.models.user import Organization

        org = Organization(
            id=str(uuid.uuid4()),
            name="Unconfigured",
            slug=f"unconf-{uuid.uuid4().hex[:8]}",
            timezone="UTC",
        )
        db_session.add(org)
        await db_session.flush()
        assert await notices.send_member_compliance_notices(db_session, org) == 0


@pytest.mark.integration
async def test_end_to_end_with_the_shared_evaluator(db_session, mailer):
    """No stubs: a real annual hours requirement nobody has started grades the
    member non-compliant through the same evaluator the dashboard uses, and
    the notice names it with its year-end deadline."""
    from app.models.training import (
        DueDateType,
        RequirementFrequency,
        RequirementType,
        TrainingRequirement,
    )
    from app.services.training_compliance import grade_org_members
    from app.utils.org_timezone import org_today

    org, member = await _department(db_session, days=None)
    db_session.add(
        TrainingRequirement(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name="Annual Hours",
            requirement_type=RequirementType.HOURS,
            required_hours=8.0,
            frequency=RequirementFrequency.ANNUAL,
            due_date_type=DueDateType.CALENDAR_PERIOD,
            applies_to_all=True,
            active=True,
        )
    )
    await db_session.flush()

    graded = await grade_org_members(db_session, org.id, org_today(org))
    assert [g.standing for g in graded] == ["non_compliant"]
    assert await notices.send_member_compliance_notices(db_session, org) == 1
    assert mailer.sends[0]["to"] == [member.email]
    assert "Annual Hours" in mailer.sends[0]["text"]


@pytest.mark.unit
def test_the_task_is_registered_daily():
    from app.services.scheduled_tasks import (
        SCHEDULE,
        TASK_INTERVALS_SECONDS,
        TASK_RUNNERS,
    )

    assert "compliance_member_notices" in TASK_RUNNERS
    assert TASK_INTERVALS_SECONDS["compliance_member_notices"] == 86400
    assert SCHEDULE["compliance_member_notices"]["frequency"] == "daily"
