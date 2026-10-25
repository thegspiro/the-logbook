"""The weekly security and audit report emailed to the IT Manager."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select, text

from app.models.error_log import ErrorLog
from app.models.security_alert import AlertType, SecurityAlertRecord, ThreatLevel
from app.models.user import Organization, Position, user_roles
from app.services import security_weekly_report as report
from app.services.email_service import EmailService

NEW_YORK = ZoneInfo("America/New_York")


def _schedule(**overrides):
    values = {"enabled": True, "weekday": 0, "hour": 7, "last_sent_at": None}
    values.update(overrides)
    return report.ReportSchedule(**values)


def _org(settings=None, timezone_name="America/New_York"):
    return SimpleNamespace(settings=settings, timezone=timezone_name, name="Test FD")


@pytest.mark.unit
class TestReadSchedule:
    def test_an_organization_with_nothing_stored_gets_the_defaults(self):
        schedule = report.read_schedule(_org(None))
        assert schedule == _schedule()

    @pytest.mark.parametrize(
        "stored",
        [
            "nonsense",
            {"weekday": 9, "hour": 99, "enabled": "yes"},
            {"weekday": True, "hour": -1},
            {"last_sent_at": "not a date"},
            [],
        ],
    )
    def test_bad_values_degrade_to_the_defaults_instead_of_raising(self, stored):
        org = _org({"security": {"weekly_report": stored}})
        assert report.read_schedule(org) == _schedule()

    def test_a_stored_schedule_is_read_back(self):
        org = _org(
            {
                "security": {
                    "weekly_report": {
                        "enabled": False,
                        "weekday": 4,
                        "hour": 16,
                        "last_sent_at": "2026-10-12T11:00:00+00:00",
                    }
                }
            }
        )
        schedule = report.read_schedule(org)
        assert (schedule.enabled, schedule.weekday, schedule.hour) == (False, 4, 16)
        assert schedule.last_sent_at == datetime(
            2026, 10, 12, 11, 0, tzinfo=timezone.utc
        )

    def test_writing_keeps_the_last_sent_stamp_and_other_settings(self):
        org = _org(
            {
                "other": 1,
                "security": {
                    "mfa_required": True,
                    "weekly_report": {"last_sent_at": "2026-10-12T11:00:00+00:00"},
                },
            }
        )
        report.write_schedule(org, enabled=False, weekday=2, hour=9)
        assert org.settings["other"] == 1
        assert org.settings["security"]["mfa_required"] is True
        stored = org.settings["security"]["weekly_report"]
        assert stored == {
            "last_sent_at": "2026-10-12T11:00:00+00:00",
            "enabled": False,
            "weekday": 2,
            "hour": 9,
        }


@pytest.mark.unit
class TestIsDue:
    # 2026-10-12 is a Monday.
    def _at(self, day, hour, minute=0):
        return datetime(2026, 10, day, hour, minute, tzinfo=NEW_YORK)

    def test_the_latest_slot_is_this_weeks_when_it_has_passed(self):
        slot = report.latest_scheduled_time(self._at(14, 12), weekday=0, hour=7)
        assert slot == self._at(12, 7)

    def test_the_latest_slot_is_last_weeks_when_this_weeks_has_not_come(self):
        slot = report.latest_scheduled_time(self._at(12, 6, 59), weekday=0, hour=7)
        assert slot == self._at(5, 7)

    def test_a_disabled_report_is_never_due(self):
        assert not report.is_due(_schedule(enabled=False), self._at(12, 7))

    def test_a_first_report_waits_for_the_next_slot_rather_than_firing_at_deploy(self):
        assert report.is_due(_schedule(), self._at(12, 7, 30))
        assert not report.is_due(_schedule(), self._at(14, 12))

    def test_a_report_already_sent_for_this_slot_is_not_sent_again(self):
        sent = self._at(12, 7, 5).astimezone(timezone.utc)
        assert not report.is_due(_schedule(last_sent_at=sent), self._at(12, 20))

    def test_a_missed_slot_is_caught_up_whenever_the_task_next_runs(self):
        last_week = self._at(5, 7, 5).astimezone(timezone.utc)
        assert report.is_due(_schedule(last_sent_at=last_week), self._at(14, 12))

    def test_the_hour_is_the_departments_not_utc(self):
        # 07:00 Eastern is 11:00 UTC in October (EDT).
        in_utc = datetime(2026, 10, 12, 11, 0, tzinfo=timezone.utc)
        assert report.is_due(_schedule(), in_utc.astimezone(NEW_YORK))


@pytest.mark.unit
class TestBody:
    def _data(self, **overrides):
        values = {
            "period_start": datetime(2026, 10, 5, 11, tzinfo=timezone.utc),
            "period_end": datetime(2026, 10, 12, 11, tzinfo=timezone.utc),
            "audit_verified": True,
            "audit_rows_checked": 120,
            "audit_shipping_configured": True,
        }
        values.update(overrides)
        return report.ReportData(**values)

    def test_a_quiet_week_still_reports_the_all_clear(self):
        body = report.build_body(self._data(), NEW_YORK)
        assert "No security alerts were raised." in body
        assert "No application errors were recorded." in body
        assert "hash chain verified" in body
        assert not self._data().needs_attention

    def test_counts_are_reported_and_nothing_member_specific_is(self):
        data = self._data(
            alerts_total=3,
            alerts_by_level={"critical": 1, "low": 2},
            alerts_by_type={"brute_force": 3},
            unresolved_high_or_critical=1,
            errors_total=4,
            errors_by_type=[("NETWORK_ERROR", 4)],
        )
        body = report.build_body(data, NEW_YORK)
        assert "Brute force" in body
        assert "1 high or critical alert(s) are still unresolved" in body
        assert "<script" not in body
        assert data.needs_attention

    def test_a_broken_chain_is_called_out_as_an_incident(self):
        data = self._data(audit_verified=False, audit_integrity_errors=2)
        body = report.build_body(data, NEW_YORK)
        assert "failed verification" in body
        assert "incident response policy" in body
        assert data.needs_attention
        assert report.build_subject(data, _org()).startswith("Action needed")

    def test_unconfigured_off_host_shipping_is_flagged(self):
        body = report.build_body(self._data(audit_shipping_configured=False), NEW_YORK)
        assert "Off-host audit shipping is not configured" in body

    def test_dynamic_values_are_escaped(self):
        data = self._data(
            alerts_total=1,
            alerts_by_type={"<img src=x onerror=alert(1)>": 1},
        )
        body = report.build_body(data, NEW_YORK)
        assert "<img" not in body


@pytest.mark.unit
class TestScheduling:
    def test_the_task_is_registered_and_checked_hourly(self):
        from app.services.scheduled_tasks import (
            SCHEDULE,
            TASK_INTERVALS_SECONDS,
            TASK_RUNNERS,
        )

        assert "weekly_security_report" in SCHEDULE
        assert "weekly_security_report" in TASK_RUNNERS
        assert TASK_INTERVALS_SECONDS["weekly_security_report"] == 3600

    def test_the_report_is_a_required_officer_email(self):
        from app.services.email_policy import (
            EMAIL_POLICIES,
            EmailAudience,
            EmailKind,
        )

        policy = EMAIL_POLICIES[EmailKind.SECURITY_REPORT]
        assert policy.required is True
        assert policy.audience is EmailAudience.OFFICERS


async def _member(
    db_session, org, *, slug=None, permissions=(), status="active", position=None
):
    if position is None:
        position = Position(
            organization_id=org.id,
            name=f"Pos {uuid4().hex[:6]}",
            slug=slug or f"pos-{uuid4().hex[:8]}",
            permissions=list(permissions),
        )
        db_session.add(position)
        await db_session.flush()
    user_id = str(uuid4())
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Test', 'Member', :em, 'hashed', :status)"
        ),
        {
            "id": user_id,
            "org": str(org.id),
            "un": f"m-{user_id[:8]}",
            "em": f"m-{user_id[:8]}@example.org",
            "status": status,
        },
    )
    await db_session.execute(
        user_roles.insert().values(user_id=user_id, position_id=position.id)
    )
    await db_session.flush()
    return user_id


@pytest.fixture
async def org(db_session):
    org = Organization(
        name="Report FD",
        slug=f"rep-{uuid4().hex[:8]}",
        timezone="America/New_York",
        settings={},
    )
    db_session.add(org)
    await db_session.flush()
    return org


@pytest.fixture
async def other_org(db_session):
    other = Organization(name="Other FD", slug=f"oth-{uuid4().hex[:8]}", settings={})
    db_session.add(other)
    await db_session.flush()
    return other


@pytest.fixture
def send_email():
    mock = AsyncMock(return_value=(1, 0))
    # One patch, entered once, outside any concurrent section (pitfall #22).
    with patch.object(EmailService, "send_email", mock):
        yield mock


@pytest.fixture
def clean_chain():
    verify = AsyncMock(
        return_value={"verified": True, "total_checked": 10, "errors": []}
    )
    with patch.object(report.audit_logger, "verify_integrity", verify):
        yield verify


def _alert(org_id, level=ThreatLevel.HIGH, when=None, resolved=False):
    return SecurityAlertRecord(
        alert_type=AlertType.BRUTE_FORCE,
        threat_level=level,
        description="x",
        organization_id=org_id,
        resolved=resolved,
        timestamp=when or datetime.now(timezone.utc) - timedelta(days=1),
    )


@pytest.mark.integration
class TestRecipients:
    async def test_it_manager_position_holders_receive_it(self, db_session, org):
        it_id = await _member(db_session, org, slug="it_manager", permissions=["*"])
        await _member(db_session, org, permissions=["*"])

        recipients, fallback = await report.resolve_recipients(db_session, org)

        assert [str(m.id) for m in recipients] == [it_id]
        assert fallback is False

    async def test_a_vacant_position_falls_back_to_full_administrators(
        self, db_session, org
    ):
        admin_id = await _member(db_session, org, permissions=["*"])
        await _member(db_session, org, permissions=["documents.view"])

        recipients, fallback = await report.resolve_recipients(db_session, org)

        assert [str(m.id) for m in recipients] == [admin_id]
        assert fallback is True

    async def test_an_archived_it_manager_is_skipped(self, db_session, org):
        await _member(db_session, org, slug="it_manager", status="archived")
        recipients, fallback = await report.resolve_recipients(db_session, org)
        assert recipients == []
        assert fallback is True

    async def test_another_departments_it_manager_is_not_a_recipient(
        self, db_session, org, other_org
    ):
        await _member(db_session, other_org, slug="it_manager", permissions=["*"])
        recipients, _fallback = await report.resolve_recipients(db_session, org)
        assert recipients == []


@pytest.mark.integration
class TestGather:
    async def test_only_this_departments_week_is_counted(
        self, db_session, org, other_org, clean_chain
    ):
        now = datetime.now(timezone.utc)
        db_session.add_all(
            [
                _alert(str(org.id), ThreatLevel.CRITICAL),
                _alert(str(org.id), ThreatLevel.LOW),
                _alert(str(org.id), when=now - timedelta(days=30)),
                _alert(str(other_org.id), ThreatLevel.CRITICAL),
                ErrorLog(
                    organization_id=str(org.id),
                    error_type="NETWORK_ERROR",
                    error_message="x",
                    created_at=now - timedelta(days=2),
                ),
                ErrorLog(
                    organization_id=str(other_org.id),
                    error_type="NETWORK_ERROR",
                    error_message="x",
                    created_at=now - timedelta(days=2),
                ),
            ]
        )
        await db_session.flush()

        with patch.object(
            report, "_is_single_organization", AsyncMock(return_value=False)
        ):
            data = await report.gather_report_data(
                db_session, org, now - timedelta(days=7), now
            )

        assert data.alerts_total == 2
        assert data.alerts_by_level == {"critical": 1, "low": 1}
        assert data.errors_total == 1
        assert data.errors_by_type == [("NETWORK_ERROR", 1)]
        assert data.includes_platform_alerts is False

    async def test_unresolved_high_alerts_count_whatever_their_age(
        self, db_session, org, clean_chain
    ):
        now = datetime.now(timezone.utc)
        db_session.add_all(
            [
                _alert(str(org.id), when=now - timedelta(days=40)),
                _alert(str(org.id), resolved=True),
                _alert(str(org.id), ThreatLevel.LOW),
            ]
        )
        await db_session.flush()

        with patch.object(
            report, "_is_single_organization", AsyncMock(return_value=False)
        ):
            data = await report.gather_report_data(
                db_session, org, now - timedelta(days=7), now
            )

        assert data.unresolved_high_or_critical == 1

    async def test_pre_login_alerts_count_only_on_a_single_department_install(
        self, db_session, org, clean_chain
    ):
        now = datetime.now(timezone.utc)
        db_session.add(_alert(None, ThreatLevel.MEDIUM))
        await db_session.flush()

        with patch.object(
            report, "_is_single_organization", AsyncMock(return_value=True)
        ):
            single = await report.gather_report_data(
                db_session, org, now - timedelta(days=7), now
            )
        with patch.object(
            report, "_is_single_organization", AsyncMock(return_value=False)
        ):
            shared = await report.gather_report_data(
                db_session, org, now - timedelta(days=7), now
            )

        assert single.alerts_total == 1
        assert single.includes_platform_alerts is True
        assert shared.alerts_total == 0

    async def test_a_failed_chain_check_is_carried_into_the_report(
        self, db_session, org
    ):
        now = datetime.now(timezone.utc)
        failing = AsyncMock(
            return_value={
                "verified": False,
                "total_checked": 5,
                "pending_seal": 2,
                "errors": [{"log_id": 1, "error": "hash mismatch"}],
            }
        )
        with (
            patch.object(report.audit_logger, "verify_integrity", failing),
            patch.object(
                report, "_is_single_organization", AsyncMock(return_value=False)
            ),
        ):
            await db_session.execute(
                text(
                    "INSERT INTO audit_logs (timestamp, timestamp_nanos, event_type, "
                    "event_category, severity, event_data) VALUES "
                    "(:ts, 0, 'x', 'security', 'info', '{}')"
                ),
                {"ts": now - timedelta(days=1)},
            )
            data = await report.gather_report_data(
                db_session, org, now - timedelta(days=7), now
            )

        assert data.audit_verified is False
        assert data.audit_integrity_errors == 1
        assert data.audit_pending_seal == 2
        assert data.needs_attention


@pytest.mark.integration
class TestSend:
    async def _due_now(self, org):
        report.write_schedule(org, enabled=True, weekday=0, hour=7)
        slot = report.latest_scheduled_time(
            datetime.now(timezone.utc).astimezone(NEW_YORK), 0, 7
        )
        return slot + timedelta(minutes=30)

    async def test_the_it_manager_is_emailed_counts_when_a_report_is_due(
        self, db_session, org, send_email, clean_chain
    ):
        await _member(db_session, org, slug="it_manager", permissions=["*"])
        await _member(db_session, org, permissions=["*"])
        db_session.add(_alert(str(org.id), ThreatLevel.CRITICAL))
        await db_session.flush()
        moment = await self._due_now(org)

        with patch.object(
            report, "_is_single_organization", AsyncMock(return_value=False)
        ):
            sent = await report.send_weekly_security_report(db_session, org, now=moment)

        assert sent == 1
        kwargs = send_email.await_args.kwargs
        assert kwargs["template_type"] == "security_weekly_report"
        assert kwargs["subject"].startswith("Action needed")
        assert "still unresolved" in kwargs["html_body"]
        stored = report.read_schedule(org)
        assert stored.last_sent_at is not None

    async def test_a_quiet_week_still_sends_the_all_clear(
        self, db_session, org, send_email, clean_chain
    ):
        await _member(db_session, org, slug="it_manager", permissions=["*"])
        moment = await self._due_now(org)

        with patch.object(
            report, "_is_single_organization", AsyncMock(return_value=False)
        ):
            sent = await report.send_weekly_security_report(db_session, org, now=moment)

        assert sent == 1
        assert (
            "No security alerts were raised."
            in send_email.await_args.kwargs["html_body"]
        )

    async def test_it_is_sent_once_per_slot(
        self, db_session, org, send_email, clean_chain
    ):
        await _member(db_session, org, slug="it_manager", permissions=["*"])
        moment = await self._due_now(org)

        with patch.object(
            report, "_is_single_organization", AsyncMock(return_value=False)
        ):
            first = await report.send_weekly_security_report(
                db_session, org, now=moment
            )
            second = await report.send_weekly_security_report(
                db_session, org, now=moment + timedelta(hours=1)
            )

        assert (first, second) == (1, 0)

    async def test_a_disabled_report_sends_nothing(
        self, db_session, org, send_email, clean_chain
    ):
        await _member(db_session, org, slug="it_manager", permissions=["*"])
        moment = await self._due_now(org)
        report.write_schedule(org, enabled=False, weekday=0, hour=7)

        assert (
            await report.send_weekly_security_report(db_session, org, now=moment) == 0
        )
        send_email.assert_not_awaited()

    async def test_a_failed_send_is_tried_again_on_the_next_tick(
        self, db_session, org, send_email, clean_chain
    ):
        await _member(db_session, org, slug="it_manager", permissions=["*"])
        moment = await self._due_now(org)
        send_email.return_value = (0, 1)

        with patch.object(
            report, "_is_single_organization", AsyncMock(return_value=False)
        ):
            assert (
                await report.send_weekly_security_report(db_session, org, now=moment)
                == 0
            )
        assert report.read_schedule(org).last_sent_at is None

    async def _two_recipients(self, db_session, org):
        reached = await _member(db_session, org, slug="it_manager", permissions=["*"])
        position = (
            await db_session.execute(
                select(Position).where(
                    Position.organization_id == org.id, Position.slug == "it_manager"
                )
            )
        ).scalar_one()
        missed = await _member(db_session, org, position=position)
        return f"m-{reached[:8]}@example.org", f"m-{missed[:8]}@example.org", missed

    def _reaching_everyone_but(self, send_email, bad_address):
        state = {"healthy": False}

        async def send(*args, **kwargs):
            if kwargs["to_emails"] == [bad_address] and not state["healthy"]:
                return 0, 1
            return 1, 0

        send_email.side_effect = send
        return state

    async def test_a_partial_failure_retries_only_the_recipient_missed(
        self, db_session, org, send_email, clean_chain
    ):
        good, bad, bad_id = await self._two_recipients(db_session, org)
        state = self._reaching_everyone_but(send_email, bad)
        moment = await self._due_now(org)

        with patch.object(
            report, "_is_single_organization", AsyncMock(return_value=False)
        ):
            first = await report.send_weekly_security_report(
                db_session, org, now=moment
            )
            stored = report.read_schedule(org)
            assert first == 1
            assert stored.last_sent_at is not None
            assert stored.retry_user_ids == (bad_id,)

            send_email.reset_mock()
            state["healthy"] = True
            retried = await report.send_weekly_security_report(
                db_session, org, now=moment + timedelta(hours=1)
            )
            after = await report.send_weekly_security_report(
                db_session, org, now=moment + timedelta(hours=2)
            )

        assert retried == 1
        assert [c.kwargs["to_emails"] for c in send_email.await_args_list] == [[bad]]
        assert after == 0
        assert report.read_schedule(org).retry_user_ids == ()
        assert good not in [
            c.kwargs["to_emails"][0] for c in send_email.await_args_list
        ]

    async def test_a_recipient_who_stays_unreachable_is_given_up_on(
        self, db_session, org, send_email, clean_chain
    ):
        _good, bad, _bad_id = await self._two_recipients(db_session, org)
        self._reaching_everyone_but(send_email, bad)
        moment = await self._due_now(org)

        with patch.object(
            report, "_is_single_organization", AsyncMock(return_value=False)
        ):
            for hour in range(0, 8):
                await report.send_weekly_security_report(
                    db_session, org, now=moment + timedelta(hours=hour)
                )

        to_bad = [
            c for c in send_email.await_args_list if c.kwargs["to_emails"] == [bad]
        ]
        assert len(to_bad) == 1 + report.MAX_RETRY_ATTEMPTS
        assert report.read_schedule(org).retry_user_ids == ()

    async def test_a_retry_is_not_attempted_for_a_disabled_report(
        self, db_session, org, send_email, clean_chain
    ):
        _good, bad, _bad_id = await self._two_recipients(db_session, org)
        self._reaching_everyone_but(send_email, bad)
        moment = await self._due_now(org)

        with patch.object(
            report, "_is_single_organization", AsyncMock(return_value=False)
        ):
            await report.send_weekly_security_report(db_session, org, now=moment)
            report.write_schedule(org, enabled=False, weekday=0, hour=7)
            send_email.reset_mock()
            sent = await report.send_weekly_security_report(
                db_session, org, now=moment + timedelta(hours=1)
            )

        assert sent == 0
        send_email.assert_not_awaited()

    async def test_the_scheduled_task_runs_it_for_each_department(
        self, db_session, org, send_email, clean_chain
    ):
        from app.services.scheduled_tasks import TASK_RUNNERS

        send = AsyncMock(return_value=0)
        with patch.object(report, "send_weekly_security_report", send):
            result = await TASK_RUNNERS["weekly_security_report"](db_session)

        assert result["task"] == "weekly_security_report"
        assert send.await_count >= 1


@pytest.mark.integration
class TestSettingsEndpoint:
    def _user(self, org):
        return SimpleNamespace(
            id=str(uuid4()),
            organization_id=str(org.id),
            username="admin",
        )

    async def test_it_reports_the_defaults_and_who_will_receive_it(
        self, db_session, org
    ):
        from app.api.v1.endpoints.security_monitoring import (
            get_weekly_report_settings,
        )

        await _member(db_session, org, permissions=["*"])

        view = await get_weekly_report_settings(
            db=db_session, current_user=self._user(org)
        )

        assert (view["enabled"], view["weekday"], view["hour"]) == (True, 0, 7)
        assert view["timezone"] == "America/New_York"
        assert view["recipient_count"] == 1
        assert view["recipients_are_fallback"] is True
        assert view["last_sent_at"] is None

    async def test_saving_changes_the_schedule_and_is_audited(self, db_session, org):
        from app.api.v1.endpoints.security_monitoring import (
            update_weekly_report_settings,
        )
        from app.schemas.security_alert import WeeklyReportSettings

        audit = AsyncMock()
        request = SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"), headers={})
        with patch("app.api.v1.endpoints.security_monitoring.log_audit_event", audit):
            view = await update_weekly_report_settings(
                data=WeeklyReportSettings(enabled=False, weekday=4, hour=16),
                request=request,
                db=db_session,
                current_user=self._user(org),
            )

        assert (view["enabled"], view["weekday"], view["hour"]) == (False, 4, 16)
        stored = report.read_schedule(org)
        assert (stored.enabled, stored.weekday, stored.hour) == (False, 4, 16)
        assert audit.await_args.kwargs["event_type"] == (
            "security_weekly_report_updated"
        )

    @pytest.mark.parametrize(
        "payload",
        [
            {"enabled": True, "weekday": 7, "hour": 7},
            {"enabled": True, "weekday": 0, "hour": 24},
            {"enabled": True, "weekday": -1, "hour": 7},
            {"enabled": True, "weekday": 0, "hour": 7, "extra": 1},
        ],
    )
    def test_out_of_range_input_is_refused(self, payload):
        from pydantic import ValidationError

        from app.schemas.security_alert import WeeklyReportSettings

        with pytest.raises(ValidationError):
            WeeklyReportSettings(**payload)
