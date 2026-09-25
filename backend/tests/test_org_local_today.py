"""
"Today" is the department's date, not the server's.

A container runs in UTC, so ``date.today()`` is already tomorrow for a US
department every evening, and the scheduled jobs that count days run early in
the UTC morning — still the previous evening in the west. These pin each
place that now asks the department's calendar instead.

The clock is frozen at 02:30 UTC on October 7, which is 10:30 PM on October 6
in New York.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.utils import org_timezone
from app.utils.org_timezone import local_day_start_utc, org_today, scheduling_timezone

pytestmark = pytest.mark.unit

FROZEN_UTC = datetime(2026, 10, 7, 2, 30, tzinfo=timezone.utc)
LOCAL_TODAY = date(2026, 10, 6)


class _Frozen(datetime):
    @classmethod
    def now(cls, tz=None):
        if tz is None:
            return FROZEN_UTC.replace(tzinfo=None)
        return FROZEN_UTC.astimezone(tz)


class _ServerDate(date):
    """``date.today()`` as a UTC container answers it at the frozen instant."""

    @classmethod
    def today(cls):
        return FROZEN_UTC.date()


@pytest.fixture(autouse=True)
def _frozen_clock(monkeypatch):
    from app.services import (
        cert_alert_service,
        evoc_level_service,
        inventory_service,
        qualification_service,
        reports_service,
        training_enhancement_service,
        training_program_service,
        training_service,
    )

    monkeypatch.setattr(org_timezone, "datetime", _Frozen)
    # The server's own date, so a regression to date.today() is caught at the
    # hour it differs from the department's rather than passing on the real
    # calendar.
    monkeypatch.setattr(cert_alert_service, "date", _ServerDate)
    monkeypatch.setattr(inventory_service, "date", _ServerDate)
    monkeypatch.setattr(training_enhancement_service, "date", _ServerDate)
    monkeypatch.setattr(training_program_service, "date", _ServerDate)
    monkeypatch.setattr(training_service, "date", _ServerDate)
    monkeypatch.setattr(reports_service, "date", _ServerDate)
    monkeypatch.setattr(qualification_service, "date", _ServerDate)
    monkeypatch.setattr(evoc_level_service, "date", _ServerDate)


def _org(tz="America/New_York", **extra):
    return SimpleNamespace(id="org-1", name="Oakville FD", timezone=tz, **extra)


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalars(items):
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    return result


class TestHelpers:
    def test_today_is_the_departments_date(self):
        assert org_today(_org()) == LOCAL_TODAY
        assert org_today(_org("UTC")) == date(2026, 10, 7)

    def test_an_unset_zone_uses_the_scheduling_default(self):
        assert org_today(_org(None)) == LOCAL_TODAY

    def test_a_day_starts_at_the_departments_midnight(self):
        tz = scheduling_timezone(_org())
        assert local_day_start_utc(LOCAL_TODAY, tz) == datetime(
            2026, 10, 6, 4, 0, tzinfo=timezone.utc
        )


class TestCertificationAlerts:
    async def test_the_tier_is_chosen_from_the_departments_date(self, monkeypatch):
        """61 days out locally is the 90-day tier; the UTC date (one day on)
        would have called it 60 days and fired the 60-day tier instead."""
        from app.services import cert_alert_service as module
        from app.services.cert_alert_service import CertAlertService

        monkeypatch.setattr(
            module,
            "NotificationsService",
            lambda db: SimpleNamespace(log_notification=AsyncMock()),
        )
        monkeypatch.setattr(module, "build_email_logo_html", lambda org: "")
        monkeypatch.setattr(
            module,
            "EmailService",
            lambda org: SimpleNamespace(send_email=AsyncMock(return_value=(1, None))),
        )
        org = _org(settings={"cert_alert_config": {"enabled": True}})
        record = SimpleNamespace(
            id="rec-1",
            user_id="u1",
            course_name="Firefighter I",
            certification_number=None,
            issuing_agency=None,
            expiration_date=LOCAL_TODAY + timedelta(days=61),
            alert_90_sent_at=None,
            alert_60_sent_at=None,
            alert_30_sent_at=None,
            alert_7_sent_at=None,
            escalation_sent_at=None,
        )
        member = SimpleNamespace(
            id="u1",
            first_name="Jane",
            full_name="Jane Smith",
            email="m@x.org",
            personal_email=None,
            notification_preferences={"email_notifications": False},
        )
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _one(org),
                _scalars([]),
                _one(org),
                _scalars([record]),
                _one(member),
                _scalars([]),
            ]
        )
        db.commit = AsyncMock()

        await CertAlertService(db).process_alerts("org-1")

        assert record.alert_90_sent_at is not None
        assert record.alert_60_sent_at is None


class TestNfpaRetirement:
    async def test_tomorrow_locally_is_not_past_due(self):
        from app.services.inventory_service import InventoryService

        record = SimpleNamespace(
            item_id="item-1", expected_retirement_date=date(2026, 10, 7)
        )
        item = SimpleNamespace(
            id="item-1",
            name="Turnout coat",
            serial_number="S1",
            asset_tag=None,
            active=True,
            assigned_to_user_id=None,
        )
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[_one(_org()), _scalars([record]), _one(item)]
        )

        due = await InventoryService(db).get_nfpa_retirement_due_items("org-1")

        # UTC's date would have made this 0 days: past due, a day early.
        assert due[0]["days_until_retirement"] == 1


class TestComplianceAutoReports:
    async def test_the_first_of_the_month_is_the_departments_first(self):
        """At 05:30 UTC on Oct 1 it is already Oct 1 in New York but still
        Sept 30 in Los Angeles: only the eastern department's report for a
        finished September goes out."""
        from app.services.scheduled_tasks import run_compliance_auto_reports

        frozen = datetime(2026, 10, 1, 5, 30, tzinfo=timezone.utc)

        class _FirstOfMonth(datetime):
            @classmethod
            def now(cls, tz=None):
                return frozen.astimezone(tz) if tz else frozen.replace(tzinfo=None)

        def _config(org_id):
            return SimpleNamespace(
                organization_id=org_id,
                auto_report_frequency="monthly",
                report_day_of_month=1,
            )

        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _scalars([_config("east"), _config("west")]),
                _one(_org("America/New_York")),
                _one(_org("America/Los_Angeles")),
            ]
        )
        db.commit = AsyncMock()
        generate = AsyncMock()

        with patch.object(org_timezone, "datetime", _FirstOfMonth), patch(
            "app.services.compliance_config_service.ComplianceReportService"
            ".generate_report",
            generate,
        ):
            await run_compliance_auto_reports(db)

        assert [c.kwargs["organization_id"] for c in generate.await_args_list] == [
            "east"
        ]
        assert generate.await_args.kwargs["month"] == 9


class TestEquipmentCheckReports:
    async def test_the_range_is_bounded_by_the_departments_midnights(self):
        from app.services.equipment_check_service import EquipmentCheckService

        db = MagicMock()
        db.execute = AsyncMock(return_value=_one(_org()))
        service = EquipmentCheckService(db)

        _tz, start, end = await service._report_window(
            "org-1", None, None, default_days=30
        )

        assert start == datetime(2026, 9, 6, 4, 0, tzinfo=timezone.utc)
        assert end == datetime(2026, 10, 7, 4, 0, tzinfo=timezone.utc) - timedelta(
            microseconds=1
        )

    async def test_an_evening_check_counts_toward_its_own_day(self):
        from app.services.equipment_check_service import EquipmentCheckService

        check = SimpleNamespace(
            id="c-1",
            shift_id=None,
            checked_at=FROZEN_UTC,
            checked_by=None,
        )
        item = SimpleNamespace(
            check_id="c-1",
            status="pass",
            item_name="SCBA",
            quantity_found=None,
            level_reading=None,
            serial_number=None,
            lot_number=None,
            is_expired=None,
            notes=None,
        )
        rows = MagicMock()
        rows.all.return_value = [(item, check)]
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_one(_org()), rows])
        service = EquipmentCheckService(db)
        service._get_user_name_map = AsyncMock(return_value={})

        out = await service.get_item_trends("org-1", "tpl-item-1", interval="daily")

        assert [t["period"] for t in out["trends"]] == ["2026-10-06"]


class TestTrainingCertificationCsv:
    async def test_a_cert_expiring_today_locally_is_not_expired(self):
        from app.services.training_enhancement_service import ReportExportService

        user = SimpleNamespace(
            id="u1", first_name="Jane", last_name="Smith", email="j@x.org"
        )
        record = SimpleNamespace(
            user_id="u1",
            course_name="EMT",
            certification_number="C-1",
            issuing_agency=None,
            completion_date=None,
            expiration_date=LOCAL_TODAY,
        )
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[_one(_org()), _scalars([user]), _scalars([record])]
        )

        csv_text = await ReportExportService(db).generate_certification_csv("org-1")

        # Valid through today on the department's calendar; the server's date
        # (tomorrow) would have printed it Expired at -1 days.
        assert csv_text.splitlines()[1].endswith(",Expiring Soon,0")


class TestTrainingStats:
    async def test_a_cert_expiring_tomorrow_locally_is_not_counted_expired(self):
        from app.services.training_service import TrainingService

        cert = SimpleNamespace(
            certification_number="C-1",
            # A cert counts as expired on its expiration date; this one is
            # tomorrow for the department, which is already "today" in UTC.
            expiration_date=LOCAL_TODAY + timedelta(days=1),
            hours_completed=8,
            completion_date=date(2026, 1, 10),
            training_type=None,
        )
        records = MagicMock()
        records.scalars.return_value.all.return_value = [cert]
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_one(_org()), records])

        stats = await TrainingService(db).get_user_training_stats(uuid.uuid4(), "org-1")

        assert stats.expired == 0
        assert stats.active_certifications == 1


class TestProgramRecencyWindow:
    async def test_the_window_is_measured_from_the_departments_date(self):
        """A 180-day window measured from Oct 6 still admits Apr 9; measured
        from the UTC date (Oct 7) it would reject it."""
        from app.services.training_program_service import TrainingProgramService

        requirement = SimpleNamespace(id="req-1", recency_days=180)
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                MagicMock(
                    scalar_one_or_none=MagicMock(
                        return_value=SimpleNamespace(id="enr-1")
                    )
                ),
                MagicMock(
                    first=MagicMock(
                        return_value=(SimpleNamespace(id="p1"), requirement)
                    )
                ),
                _one(_org()),
            ]
        )

        ok, error = await TrainingProgramService(db).validate_apply_target(
            user_id="u1",
            organization_id="org-1",
            program_id="prog-1",
            requirement_id="req-1",
            completed_on=LOCAL_TODAY - timedelta(days=180),
        )

        assert ok, error


class TestProgramDeadline:
    async def test_a_deadline_of_today_locally_is_not_expired(self, monkeypatch):
        """Oct 6 is still the member's last day in New York; the UTC date
        (Oct 7) would have expired the enrollment that evening."""
        from app.models.training import EnrollmentStatus
        from app.services import training_program_service as module
        from app.services.training_program_service import TrainingProgramService

        monkeypatch.setattr(module, "datetime", _Frozen)
        enrollment = SimpleNamespace(
            organization_id="org-1",
            status=EnrollmentStatus.ACTIVE,
            target_completion_date=LOCAL_TODAY,
        )
        db = MagicMock()
        db.execute = AsyncMock(return_value=_one(_org()))

        expired = await TrainingProgramService(db).auto_expire_if_overdue(enrollment)

        assert expired is False
        assert enrollment.status == EnrollmentStatus.ACTIVE


class TestInstructorQualification:
    async def test_a_qualification_expiring_today_locally_is_still_valid(self):
        """Good through its expiration date on the department's calendar; the
        UTC date (a day on) would have refused the instructor that evening."""
        from app.services.training_enhancement_service import (
            InstructorQualificationService,
        )

        qual = SimpleNamespace(expiration_date=LOCAL_TODAY)
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_one(qual), _one(_org())])

        ok = await InstructorQualificationService(db).validate_instructor_for_session(
            "u1", "course-1", "org-1"
        )

        assert ok is True


class TestRenewalTasks:
    async def test_the_renewal_window_is_bounded_by_the_departments_date(self):
        from app.services.training_enhancement_service import RecertificationService

        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_one(_org()), _scalars([])])
        db.flush = AsyncMock()
        service = RecertificationService(db)
        service.get_pathways = AsyncMock(
            return_value=[
                SimpleNamespace(source_requirement_id="req-1", renewal_window_days=0)
            ]
        )

        await service.generate_renewal_tasks("org-1")

        query = db.execute.await_args_list[1].args[0]
        bound = set(query.compile().params.values())
        assert LOCAL_TODAY in bound
        assert FROZEN_UTC.date() not in bound


class TestCertificationExpirationReport:
    async def test_a_cert_expiring_today_locally_is_not_reported_expired(self):
        from app.services.reports_service import ReportsService

        record = SimpleNamespace(
            user_id="u1",
            course_name="EMT",
            certification_number="C-1",
            issuing_agency=None,
            completion_date=None,
            expiration_date=LOCAL_TODAY,
        )
        user = SimpleNamespace(
            id="u1", first_name="Jane", last_name="Smith", username="js", rank=None
        )
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[_scalars([record]), _scalars([user]), _one(_org())]
        )
        service = ReportsService(db)
        service._get_rank_display_map = AsyncMock(return_value={})

        report = await service._generate_certification_expiration("org-1")

        # Valid through today on the department's calendar; the UTC date
        # (tomorrow) would have reported it expired at -1 days.
        entry = report["entries"][0]
        assert entry["expiry_status"] == "expiring_soon"
        assert entry["days_until_expiry"] == 0


class TestQualificationDefaults:
    async def test_current_qualifications_default_to_the_departments_date(self):
        from app.services.qualification_service import QualificationService

        rows = MagicMock()
        rows.all.return_value = []
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_one(_org()), rows])

        await QualificationService(db).get_member_codes("u1", "org-1")

        query = db.execute.await_args_list[1].args[0]
        bound = set(query.compile().params.values())
        assert LOCAL_TODAY in bound
        assert FROZEN_UTC.date() not in bound


class TestShiftEligibilityDate:
    def test_an_evening_shift_is_judged_on_its_own_day(self):
        """A shift starting 10:30 PM Eastern is stored as 02:30 UTC the next
        day; a qualification lapsing that next day must not be read as lapsed
        for this shift, nor one lapsing today as still good."""
        from app.services.shift_eligibility_service import ShiftEligibilityService

        shift = SimpleNamespace(shift_date=None, start_time=FROZEN_UTC)

        assert ShiftEligibilityService._shift_date(shift, _org()) == LOCAL_TODAY

    def test_no_shift_means_the_departments_today(self):
        from app.services.shift_eligibility_service import ShiftEligibilityService

        assert ShiftEligibilityService._shift_date(None, _org()) == LOCAL_TODAY


class TestOperatorCertificates:
    async def test_the_evoc_check_uses_the_departments_date(self):
        """A card good through today must still clear a driver this evening;
        the UTC date (a day on) would have filtered it out."""
        from app.services.evoc_level_service import EvocLevelService

        apparatus = SimpleNamespace(
            required_evoc_level_id="lvl-2",
            required_evoc_level=SimpleNamespace(
                id="lvl-2", level_number=2, name="EVOC II", is_cumulative=True
            ),
        )
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[_one(apparatus), _one(_org()), _scalars([])]
        )

        await EvocLevelService(db).check_driver_evoc_eligibility("u1", "ap1", "org-1")

        query = db.execute.await_args_list[2].args[0]
        bound = set(query.compile().params.values())
        assert LOCAL_TODAY in bound
        assert FROZEN_UTC.date() not in bound

    async def test_the_roster_uses_the_same_date(self):
        from app.services.shift_eligibility_service import ShiftEligibilityService

        rows = MagicMock()
        rows.all.return_value = []
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_one(_org()), rows])

        await ShiftEligibilityService(db)._get_operator_map("org-1")

        query = db.execute.await_args_list[1].args[0]
        bound = set(query.compile().params.values())
        assert LOCAL_TODAY in bound
        assert FROZEN_UTC.date() not in bound


class TestOperationsDashboardAge:
    def test_an_evening_row_is_aged_on_the_departments_calendar(self):
        """02:30 UTC on Oct 6 is 10:30 PM on Oct 5 in New York: a day old on
        Oct 6 locally, where its UTC date read it as brand new."""
        from zoneinfo import ZoneInfo

        from app.api.v1.endpoints.dashboard import _age_days

        created = datetime(2026, 10, 6, 2, 30)  # naive, as func.min returns it
        assert _age_days(created, LOCAL_TODAY, ZoneInfo("America/New_York")) == 1
