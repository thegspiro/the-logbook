"""A second run of the compliance auto-report task must not duplicate a report.

The task is daily and can also be triggered by hand, retried or run by a second
worker. Each run used to store and email another copy of the same period's
report; the check below is what makes the second run a no-op.
"""

import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import func, select

from app.models.compliance_config import ComplianceConfig, ComplianceReport
from app.models.user import Organization, User, UserStatus
from app.services import scheduled_tasks as st
from app.services.compliance_config_service import ComplianceReportService

pytestmark = pytest.mark.integration


async def _org_with_config(db_session) -> str:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Auto Report Department",
        slug=f"auto-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    db_session.add(
        ComplianceConfig(
            organization_id=org.id,
            auto_report_frequency="monthly",
            report_day_of_month=15,
        )
    )
    await db_session.commit()
    return str(org.id)


async def _report(db_session, org_id, **overrides) -> ComplianceReport:
    values = dict(
        organization_id=org_id,
        report_type="monthly",
        period_label="February 2026",
        period_year=2026,
        period_month=2,
        status="completed",
        generated_by=None,
    )
    values.update(overrides)
    report = ComplianceReport(**values)
    db_session.add(report)
    await db_session.commit()
    return report


async def _count(db_session, org_id) -> int:
    return (
        await db_session.execute(
            select(func.count())
            .select_from(ComplianceReport)
            .where(ComplianceReport.organization_id == org_id)
        )
    ).scalar_one()


@pytest.fixture
def generated(monkeypatch):
    """Replaces generation with a recorder that stores a completed report."""
    calls: list[dict] = []

    async def fake_today(_db, _org_id):
        return date(2026, 3, 15)

    async def generate(self, *, organization_id, report_type, year, month=None, **_):
        calls.append({"org": organization_id, "type": report_type, "year": year})
        self.db.add(
            ComplianceReport(
                organization_id=organization_id,
                report_type=report_type,
                period_label=str(year),
                period_year=year,
                period_month=month,
                status="completed",
            )
        )
        await self.db.flush()

    monkeypatch.setattr("app.utils.org_timezone.resolve_org_today", fake_today)
    monkeypatch.setattr(ComplianceReportService, "generate_report", generate)
    return calls


async def test_a_second_run_the_same_day_adds_nothing(db_session, generated):
    org_id = await _org_with_config(db_session)

    first = await st.run_compliance_auto_reports(db_session)
    second = await st.run_compliance_auto_reports(db_session)

    ours = [c for c in generated if c["org"] == org_id]
    assert len(ours) == 1
    assert await _count(db_session, org_id) == 1
    assert first["total_generated"] >= 1
    assert not [d for d in second["details"] if d.get("org_id") == org_id]


async def test_a_manual_report_for_the_period_does_not_suppress_the_scheduled_one(
    db_session, generated
):
    org_id = await _org_with_config(db_session)
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        username=f"u-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@autoreport.org",
        first_name="Mina",
        last_name="Officer",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db_session.add(user)
    await db_session.commit()
    await _report(db_session, org_id, generated_by=user.id)

    await st.run_compliance_auto_reports(db_session)

    assert len([c for c in generated if c["org"] == org_id]) == 1


class TestAutoReportExists:
    async def test_a_completed_scheduled_report_counts(self, db_session):
        org_id = await _org_with_config(db_session)
        await _report(db_session, org_id)
        service = ComplianceReportService(db_session)

        assert await service.auto_report_exists(org_id, "monthly", 2026, 2)
        assert not await service.auto_report_exists(org_id, "monthly", 2026, 3)
        assert not await service.auto_report_exists(org_id, "monthly", 2025, 2)
        assert not await service.auto_report_exists(org_id, "yearly", 2026)

    async def test_a_failed_attempt_does_not_count(self, db_session):
        org_id = await _org_with_config(db_session)
        await _report(db_session, org_id, status="failed")

        assert not await ComplianceReportService(db_session).auto_report_exists(
            org_id, "monthly", 2026, 2
        )

    async def test_another_organizations_report_does_not_count(self, db_session):
        mine = await _org_with_config(db_session)
        theirs = await _org_with_config(db_session)
        await _report(db_session, theirs)

        assert not await ComplianceReportService(db_session).auto_report_exists(
            mine, "monthly", 2026, 2
        )


class _Mailer:
    """Stands in for EmailService inside the compliance service."""

    def __init__(self):
        self.calls: list[dict] = []
        self.result = (1, 0)

    def factory(self, organization=None):
        mailer = self

        class _Service:
            async def send_email(self, to_emails, subject, html_body, **kwargs):
                mailer.calls.append(
                    {"to": list(to_emails), "subject": subject, **kwargs}
                )
                return mailer.result

        return _Service()


@pytest.fixture
def mailer(monkeypatch):
    recorder = _Mailer()
    monkeypatch.setattr(
        "app.services.compliance_config_service.EmailService", recorder.factory
    )
    return recorder


async def _completed_report(db_session, org_id) -> ComplianceReport:
    return await _report(
        db_session,
        org_id,
        summary={"overall_compliance_pct": 91.5, "total_members": 4},
    )


class TestTheEmail:
    async def test_it_is_logged_to_message_history(self, db_session, mailer):
        org_id = await _org_with_config(db_session)
        report = await _completed_report(db_session, org_id)

        outcome = await ComplianceReportService(db_session)._email_report(
            report, org_id, ["chief@dept.org"], sent_by="user-1"
        )

        assert outcome == "sent"
        call = mailer.calls[0]
        assert call["db"] is db_session
        assert call["template_type"] == "compliance_report"
        assert call["sent_by"] == "user-1"

    async def test_addresses_differing_only_in_case_get_one_copy_in_order(
        self, db_session, mailer
    ):
        org_id = await _org_with_config(db_session)
        report = await _completed_report(db_session, org_id)

        await ComplianceReportService(db_session)._email_report(
            report,
            org_id,
            ["Chief@dept.org", "zed@dept.org", "chief@DEPT.org", " ", "amy@dept.org"],
        )

        assert mailer.calls[0]["to"] == [
            "Chief@dept.org",
            "zed@dept.org",
            "amy@dept.org",
        ]
        assert report.emailed_to == mailer.calls[0]["to"]

    async def test_nobody_reached_is_reported_as_failed(self, db_session, mailer):
        org_id = await _org_with_config(db_session)
        report = await _completed_report(db_session, org_id)
        mailer.result = (0, 1)
        service = ComplianceReportService(db_session)

        assert await service._email_report(report, org_id, ["a@dept.org"]) == "failed"
        assert service.last_email_outcome == "failed"
        assert report.emailed_at is None

    async def test_no_configured_recipient_is_not_a_failure(self, db_session, mailer):
        org_id = await _org_with_config(db_session)
        report = await _completed_report(db_session, org_id)
        service = ComplianceReportService(db_session)

        assert await service._email_report(report, org_id, None) == "no_recipients"
        assert mailer.calls == []

    async def test_a_manual_send_that_reaches_nobody_is_an_error(
        self, db_session, mailer
    ):
        org_id = await _org_with_config(db_session)
        report = await _completed_report(db_session, org_id)
        mailer.result = (0, 1)

        with pytest.raises(ValueError, match="could not be emailed"):
            await ComplianceReportService(db_session).email_existing_report(
                report.id, org_id, ["a@dept.org"]
            )

    async def test_a_manual_send_with_nobody_to_send_to_is_an_error(
        self, db_session, mailer
    ):
        org_id = await _org_with_config(db_session)
        report = await _completed_report(db_session, org_id)

        with pytest.raises(ValueError, match="no recipient"):
            await ComplianceReportService(db_session).email_existing_report(
                report.id, org_id, []
            )


class TestTheScheduledRunAfterAFailure:
    @pytest.fixture
    def logged(self, monkeypatch):
        entries: list[tuple[str, str]] = []

        async def persist(org_id, task_name, exc, extra_context=None):
            entries.append((task_name, str(exc)))
            return True

        monkeypatch.setattr(st, "persist_task_error_log", persist)
        return entries

    async def test_a_stored_report_that_could_not_be_emailed_is_reported(
        self, db_session, monkeypatch, logged
    ):
        org_id = await _org_with_config(db_session)

        async def fake_today(_db, _org_id):
            return date(2026, 3, 15)

        async def generate(
            self, *, organization_id, report_type, year, month=None, **_
        ):
            self.db.add(
                ComplianceReport(
                    organization_id=organization_id,
                    report_type=report_type,
                    period_label=str(year),
                    period_year=year,
                    period_month=month,
                    status="completed",
                )
            )
            await self.db.flush()
            self.last_email_outcome = "failed"

        monkeypatch.setattr("app.utils.org_timezone.resolve_org_today", fake_today)
        monkeypatch.setattr(ComplianceReportService, "generate_report", generate)

        result = await st.run_compliance_auto_reports(db_session)

        entry = next(d for d in result["details"] if d.get("org_id") == org_id)
        assert entry["email"] == "failed"
        assert any(
            name == "Compliance auto-report email" and "2026-02" in message
            for name, message in logged
        )

    async def test_a_rerun_sends_the_report_that_was_stored_but_not_emailed(
        self, db_session, monkeypatch, logged
    ):
        org_id = await _org_with_config(db_session)
        stored = await _report(db_session, org_id, emailed_at=None)

        async def fake_today(_db, _org_id):
            return date(2026, 3, 15)

        resent: list[str] = []

        async def email(self, report, organization_id, *args, **kwargs):
            resent.append(report.id)
            report.emailed_at = datetime.now(timezone.utc)
            self.last_email_outcome = "sent"
            return "sent"

        async def never_generate(self, **_):
            raise AssertionError("a stored report must not be generated again")

        monkeypatch.setattr("app.utils.org_timezone.resolve_org_today", fake_today)
        monkeypatch.setattr(ComplianceReportService, "_email_report", email)
        monkeypatch.setattr(ComplianceReportService, "generate_report", never_generate)

        result = await st.run_compliance_auto_reports(db_session)

        assert resent == [stored.id]
        entry = next(d for d in result["details"] if d.get("org_id") == org_id)
        assert entry["resent"] is True
        assert result["total_generated"] == 0

    async def test_a_generation_that_raises_leaves_a_failed_row_and_retries(
        self, db_session, monkeypatch, logged
    ):
        org_id = await _org_with_config(db_session)

        async def fake_today(_db, _org_id):
            return date(2026, 3, 15)

        async def explode(self, **_):
            raise RuntimeError("could not read the training records")

        monkeypatch.setattr("app.utils.org_timezone.resolve_org_today", fake_today)
        monkeypatch.setattr(ComplianceReportService, "generate_report", explode)

        await st.run_compliance_auto_reports(db_session)

        rows = (
            (
                await db_session.execute(
                    select(ComplianceReport).where(
                        ComplianceReport.organization_id == org_id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert [(r.status, r.period_year, r.period_month) for r in rows] == [
            ("failed", 2026, 2)
        ]
        assert rows[0].generated_by is None
        # The raw exception text is not stored where staff read it.
        assert "training records" not in (rows[0].error_message or "")
        # A failed row does not count as the period's report.
        assert not await ComplianceReportService(db_session).auto_report_exists(
            org_id, "monthly", 2026, 2
        )
