"""
Integration tests for shift-scheduling scheduled tasks.

Covers the four code paths added/changed when the shift-scheduling
review fixes were implemented:

  - run_shift_reminders: enriched pre-shift report; verifies inactive
    users are excluded from the roster + notifications.
  - run_end_of_shift_summary: per-member summary; verifies the
    require_finalized gate (default True) and the preliminary opt-in.
  - run_trainee_report_escalation: N-day acknowledgment escalation;
    verifies it skips fresh reports and rate-limits via
    review_history.
  - ShiftCompletionService._maybe_alert_training_officers: low-rating
    / improvement-text alert; verifies the configurable threshold.
"""

import pytest
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import ROLE_TRAINING_OFFICER
from app.models.notification import NotificationLog
from app.models.training import Shift, ShiftCompletionReport
from app.services.scheduled_tasks import (
    run_end_of_shift_summary,
    run_shift_reminders,
    run_trainee_report_escalation,
)
from app.services.shift_completion_service import ShiftCompletionService

pytestmark = [pytest.mark.integration]


# ── Helpers ──────────────────────────────────────────────────────────


def _uid() -> str:
    return str(uuid.uuid4())


async def _insert_org(
    db: AsyncSession,
    *,
    settings_json: str = "{}",
) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, :name, :otype, :slug, :tz, :settings)"
        ),
        {
            "id": org_id,
            "name": "Test FD",
            "otype": "fire_department",
            "slug": f"test-{org_id[:8]}",
            "tz": "America/New_York",
            "settings": settings_json,
        },
    )
    return org_id


async def _insert_user(
    db: AsyncSession,
    *,
    org_id: str,
    status: str = "active",
    first_name: str = "Test",
    last_name: str = "User",
    username_prefix: str = "u",
) -> str:
    uid = _uid()
    await db.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, :ln, :em, 'pw', :status)"
        ),
        {
            "id": uid,
            "org": org_id,
            "un": f"{username_prefix}-{uid[:8]}",
            "fn": first_name,
            "ln": last_name,
            "em": f"{username_prefix}-{uid[:8]}@test.com",
            "status": status,
        },
    )
    return uid


async def _insert_shift(
    db: AsyncSession,
    *,
    org_id: str,
    start_offset_minutes: int,
    duration_minutes: int = 12 * 60,
    is_finalized: bool = False,
    apparatus_id: str | None = None,
) -> tuple[str, datetime, datetime]:
    shift_id = _uid()
    start = datetime.now(timezone.utc) + timedelta(minutes=start_offset_minutes)
    end = start + timedelta(minutes=duration_minutes)
    await db.execute(
        text(
            "INSERT INTO shifts "
            "(id, organization_id, shift_date, start_time, end_time, "
            "apparatus_id, is_finalized) "
            "VALUES (:id, :org, :d, :st, :et, :ap, :fin)"
        ),
        {
            "id": shift_id,
            "org": org_id,
            "d": start.date(),
            "st": start,
            "et": end,
            "ap": apparatus_id,
            "fin": 1 if is_finalized else 0,
        },
    )
    return shift_id, start, end


async def _insert_assignment(
    db: AsyncSession,
    *,
    org_id: str,
    shift_id: str,
    user_id: str,
    position: str = "firefighter",
    status_str: str = "assigned",
) -> str:
    aid = _uid()
    await db.execute(
        text(
            "INSERT INTO shift_assignments "
            "(id, organization_id, shift_id, user_id, position, "
            "assignment_status) "
            "VALUES (:id, :org, :sid, :uid, :pos, :status)"
        ),
        {
            "id": aid,
            "org": org_id,
            "sid": shift_id,
            "uid": user_id,
            "pos": position,
            "status": status_str,
        },
    )
    return aid


async def _insert_attendance(
    db: AsyncSession,
    *,
    shift_id: str,
    user_id: str,
    duration_minutes: int | None = 720,
) -> str:
    aid = _uid()
    await db.execute(
        text(
            "INSERT INTO shift_attendance "
            "(id, shift_id, user_id, duration_minutes) "
            "VALUES (:id, :sid, :uid, :dur)"
        ),
        {
            "id": aid,
            "sid": shift_id,
            "uid": user_id,
            "dur": duration_minutes,
        },
    )
    return aid


# ── run_shift_reminders ──────────────────────────────────────────────


class TestShiftRemindersRosterFilter:
    """Verifies fix #1: deactivated members no longer get pre-shift
    reminders or appear in the broadcast roster."""

    async def test_inactive_users_excluded_from_pre_shift_reminder(
        self,
        db_session: AsyncSession,
    ):
        org_id = await _insert_org(db_session)
        active_a = await _insert_user(
            db_session, org_id=org_id, first_name="Alice"
        )
        active_b = await _insert_user(
            db_session, org_id=org_id, first_name="Bob"
        )
        deactivated = await _insert_user(
            db_session,
            org_id=org_id,
            status="inactive",
            first_name="Carol",
        )

        shift_id, _, _ = await _insert_shift(
            db_session,
            org_id=org_id,
            start_offset_minutes=30,
        )
        for uid in (active_a, active_b, deactivated):
            await _insert_assignment(
                db_session,
                org_id=org_id,
                shift_id=shift_id,
                user_id=uid,
            )
        await db_session.flush()

        await run_shift_reminders(db_session)

        notifs = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.organization_id == org_id,
                        NotificationLog.category == "shift_reminder",
                    )
                )
            )
            .scalars()
            .all()
        )
        recipients = {n.recipient_id for n in notifs}
        assert active_a in recipients
        assert active_b in recipients
        assert deactivated not in recipients

        all_roster_names: set[str] = set()
        for n in notifs:
            for entry in (n.notification_metadata or {}).get("roster") or []:
                if entry.get("name"):
                    all_roster_names.add(entry["name"])
        assert "Carol User" not in all_roster_names
        assert "Alice User" in all_roster_names
        assert "Bob User" in all_roster_names

    async def test_reminder_idempotent_per_shift(
        self,
        db_session: AsyncSession,
    ):
        org_id = await _insert_org(db_session)
        user_id = await _insert_user(db_session, org_id=org_id)
        shift_id, _, _ = await _insert_shift(
            db_session,
            org_id=org_id,
            start_offset_minutes=30,
        )
        await _insert_assignment(
            db_session,
            org_id=org_id,
            shift_id=shift_id,
            user_id=user_id,
        )
        await db_session.flush()

        await run_shift_reminders(db_session)
        first_count = (
            await db_session.execute(
                select(NotificationLog).where(
                    NotificationLog.organization_id == org_id,
                    NotificationLog.category == "shift_reminder",
                )
            )
        ).scalars().all()

        await run_shift_reminders(db_session)
        second_count = (
            await db_session.execute(
                select(NotificationLog).where(
                    NotificationLog.organization_id == org_id,
                    NotificationLog.category == "shift_reminder",
                )
            )
        ).scalars().all()

        assert len(first_count) == 1
        assert len(second_count) == 1


# ── run_end_of_shift_summary ─────────────────────────────────────────


class TestEndOfShiftSummaryFinalizationGate:
    """Verifies fix #2: by default the summary waits for officer
    finalization so duration_minutes is reliable."""

    async def test_unfinalized_shift_skipped_by_default(
        self,
        db_session: AsyncSession,
    ):
        org_id = await _insert_org(db_session)
        user_id = await _insert_user(db_session, org_id=org_id)
        shift_id, _, _ = await _insert_shift(
            db_session,
            org_id=org_id,
            start_offset_minutes=-13 * 60,
            is_finalized=False,
        )
        await _insert_attendance(
            db_session,
            shift_id=shift_id,
            user_id=user_id,
            duration_minutes=720,
        )
        await db_session.flush()

        await run_end_of_shift_summary(db_session)

        notifs = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.organization_id == org_id,
                        NotificationLog.category == "shift_summary",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert notifs == []

    async def test_finalized_shift_sends_full_summary(
        self,
        db_session: AsyncSession,
    ):
        org_id = await _insert_org(db_session)
        user_id = await _insert_user(db_session, org_id=org_id)
        shift_id, _, _ = await _insert_shift(
            db_session,
            org_id=org_id,
            start_offset_minutes=-13 * 60,
            is_finalized=True,
        )
        await _insert_attendance(
            db_session,
            shift_id=shift_id,
            user_id=user_id,
            duration_minutes=720,
        )
        await db_session.flush()

        await run_end_of_shift_summary(db_session)

        notifs = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.organization_id == org_id,
                        NotificationLog.recipient_id == user_id,
                        NotificationLog.category == "shift_summary",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(notifs) == 1
        notif = notifs[0]
        assert notif.subject is not None
        assert "Preliminary" not in notif.subject
        meta = notif.notification_metadata or {}
        assert meta.get("hours_recorded") == 12.0
        assert meta.get("is_preliminary") is False

    async def test_preliminary_opt_in_sends_with_banner(
        self,
        db_session: AsyncSession,
    ):
        # Org explicitly opts in to preliminary summaries
        import json

        org_settings = json.dumps(
            {
                "shift_reports": {
                    "member_summary": {
                        "enabled": True,
                        "require_finalized": False,
                    }
                }
            }
        )
        org_id = await _insert_org(db_session, settings_json=org_settings)
        user_id = await _insert_user(db_session, org_id=org_id)
        shift_id, _, _ = await _insert_shift(
            db_session,
            org_id=org_id,
            start_offset_minutes=-13 * 60,
            is_finalized=False,
        )
        await _insert_attendance(
            db_session,
            shift_id=shift_id,
            user_id=user_id,
            duration_minutes=720,
        )
        await db_session.flush()

        await run_end_of_shift_summary(db_session)

        notif = (
            await db_session.execute(
                select(NotificationLog).where(
                    NotificationLog.organization_id == org_id,
                    NotificationLog.recipient_id == user_id,
                    NotificationLog.category == "shift_summary",
                )
            )
        ).scalar_one()
        assert "Preliminary" in (notif.subject or "")
        assert (notif.notification_metadata or {}).get("is_preliminary") is True
        assert "preliminary" in (notif.message or "").lower()

    async def test_summary_idempotent_per_member(
        self,
        db_session: AsyncSession,
    ):
        org_id = await _insert_org(db_session)
        user_id = await _insert_user(db_session, org_id=org_id)
        shift_id, _, _ = await _insert_shift(
            db_session,
            org_id=org_id,
            start_offset_minutes=-13 * 60,
            is_finalized=True,
        )
        await _insert_attendance(
            db_session,
            shift_id=shift_id,
            user_id=user_id,
            duration_minutes=720,
        )
        await db_session.flush()

        await run_end_of_shift_summary(db_session)
        await run_end_of_shift_summary(db_session)

        notifs = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.organization_id == org_id,
                        NotificationLog.recipient_id == user_id,
                        NotificationLog.category == "shift_summary",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(notifs) == 1


# ── _maybe_alert_training_officers ───────────────────────────────────


class TestLowRatingTrainingOfficerAlert:
    """Verifies fix #3 + the underlying alert path."""

    @staticmethod
    async def _setup_org_with_training_officer(
        db: AsyncSession,
        *,
        org_settings_json: str | None = None,
    ) -> tuple[str, str, str, str]:
        """Returns (org_id, officer_id, trainee_id, t_officer_id)."""
        if org_settings_json is None:
            org_id = await _insert_org(db)
        else:
            org_id = await _insert_org(
                db, settings_json=org_settings_json
            )
        officer_id = await _insert_user(
            db, org_id=org_id, first_name="Mike"
        )
        trainee_id = await _insert_user(
            db, org_id=org_id, first_name="Probie"
        )
        t_officer_id = await _insert_user(
            db, org_id=org_id, first_name="Trainer"
        )

        position_id = _uid()
        await db.execute(
            text(
                "INSERT INTO positions "
                "(id, organization_id, name, slug, permissions) "
                "VALUES (:id, :org, :name, :slug, '[]')"
            ),
            {
                "id": position_id,
                "org": org_id,
                "name": "Training Officer",
                "slug": ROLE_TRAINING_OFFICER,
            },
        )
        await db.execute(
            text(
                "INSERT INTO user_positions (user_id, position_id) "
                "VALUES (:uid, :pid)"
            ),
            {"uid": t_officer_id, "pid": position_id},
        )
        await db.flush()
        return org_id, officer_id, trainee_id, t_officer_id

    async def test_low_rating_alerts_training_officer(
        self,
        db_session: AsyncSession,
    ):
        (
            org_id,
            officer_id,
            trainee_id,
            t_officer_id,
        ) = await self._setup_org_with_training_officer(db_session)

        svc = ShiftCompletionService(db_session)
        await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
            performance_rating=2,
            review_status="approved",
        )

        notifs = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.organization_id == org_id,
                        NotificationLog.recipient_id == t_officer_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        followup = [
            n for n in notifs if "follow-up" in (n.subject or "").lower()
        ]
        assert len(followup) == 1
        assert (followup[0].notification_metadata or {}).get(
            "low_rating"
        ) is True

    async def test_high_rating_no_improvement_does_not_alert(
        self,
        db_session: AsyncSession,
    ):
        (
            org_id,
            officer_id,
            trainee_id,
            t_officer_id,
        ) = await self._setup_org_with_training_officer(db_session)

        svc = ShiftCompletionService(db_session)
        await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
            performance_rating=5,
            review_status="approved",
        )

        notifs = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.organization_id == org_id,
                        NotificationLog.recipient_id == t_officer_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        followup = [
            n for n in notifs if "follow-up" in (n.subject or "").lower()
        ]
        assert followup == []

    async def test_areas_for_improvement_alone_triggers_alert(
        self,
        db_session: AsyncSession,
    ):
        (
            org_id,
            officer_id,
            trainee_id,
            t_officer_id,
        ) = await self._setup_org_with_training_officer(db_session)

        svc = ShiftCompletionService(db_session)
        await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
            performance_rating=4,
            areas_for_improvement="Needs more radio practice",
            review_status="approved",
        )

        notifs = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.organization_id == org_id,
                        NotificationLog.recipient_id == t_officer_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        followup = [
            n for n in notifs if "follow-up" in (n.subject or "").lower()
        ]
        assert len(followup) == 1

    async def test_configurable_threshold_raises_trigger_bar(
        self,
        db_session: AsyncSession,
    ):
        # Org configures threshold of 4 — a 3-rating now alerts
        import json

        settings_json = json.dumps(
            {
                "shift_reports": {
                    "follow_up": {"low_rating_threshold": 4}
                }
            }
        )
        (
            org_id,
            officer_id,
            trainee_id,
            t_officer_id,
        ) = await self._setup_org_with_training_officer(
            db_session, org_settings_json=settings_json
        )

        svc = ShiftCompletionService(db_session)
        await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
            performance_rating=3,
            review_status="approved",
        )

        followup = [
            n
            for n in (
                (
                    await db_session.execute(
                        select(NotificationLog).where(
                            NotificationLog.organization_id == org_id,
                            NotificationLog.recipient_id == t_officer_id,
                        )
                    )
                )
                .scalars()
                .all()
            )
            if "follow-up" in (n.subject or "").lower()
        ]
        assert len(followup) == 1

    async def test_threshold_zero_disables_low_rating_trigger(
        self,
        db_session: AsyncSession,
    ):
        import json

        settings_json = json.dumps(
            {
                "shift_reports": {
                    "follow_up": {"low_rating_threshold": 0}
                }
            }
        )
        (
            org_id,
            officer_id,
            trainee_id,
            t_officer_id,
        ) = await self._setup_org_with_training_officer(
            db_session, org_settings_json=settings_json
        )

        svc = ShiftCompletionService(db_session)
        await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
            performance_rating=1,
            review_status="approved",
        )

        followup = [
            n
            for n in (
                (
                    await db_session.execute(
                        select(NotificationLog).where(
                            NotificationLog.organization_id == org_id,
                            NotificationLog.recipient_id == t_officer_id,
                        )
                    )
                )
                .scalars()
                .all()
            )
            if "follow-up" in (n.subject or "").lower()
        ]
        # rating=1 with threshold=0 disables the rating trigger and
        # there's no improvement text, so no alert should fire.
        assert followup == []

    async def test_filing_officer_excluded_from_self_alert(
        self,
        db_session: AsyncSession,
    ):
        """If the officer who filed the report ALSO holds the training
        officer role, they shouldn't get an alert about their own
        report."""
        org_id = await _insert_org(db_session)
        officer_id = await _insert_user(
            db_session, org_id=org_id, first_name="Mike"
        )
        trainee_id = await _insert_user(
            db_session, org_id=org_id, first_name="Probie"
        )
        position_id = _uid()
        await db_session.execute(
            text(
                "INSERT INTO positions "
                "(id, organization_id, name, slug, permissions) "
                "VALUES (:id, :org, :name, :slug, '[]')"
            ),
            {
                "id": position_id,
                "org": org_id,
                "name": "Training Officer",
                "slug": ROLE_TRAINING_OFFICER,
            },
        )
        await db_session.execute(
            text(
                "INSERT INTO user_positions (user_id, position_id) "
                "VALUES (:uid, :pid)"
            ),
            {"uid": officer_id, "pid": position_id},
        )
        await db_session.flush()

        svc = ShiftCompletionService(db_session)
        await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
            performance_rating=1,
            review_status="approved",
        )

        followup = [
            n
            for n in (
                (
                    await db_session.execute(
                        select(NotificationLog).where(
                            NotificationLog.organization_id == org_id,
                            NotificationLog.recipient_id == officer_id,
                        )
                    )
                )
                .scalars()
                .all()
            )
            if "follow-up" in (n.subject or "").lower()
        ]
        assert followup == []


# ── run_trainee_report_escalation ───────────────────────────────────


class TestTraineeReportEscalation:
    """Verifies the daily escalation skips fresh reports, fires for
    overdue ones, and rate-limits via review_history."""

    async def test_fresh_report_not_escalated(
        self,
        db_session: AsyncSession,
    ):
        org_id = await _insert_org(db_session)
        officer_id = await _insert_user(db_session, org_id=org_id)
        trainee_id = await _insert_user(db_session, org_id=org_id)

        svc = ShiftCompletionService(db_session)
        await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today(),
            hours_on_shift=12.0,
            review_status="approved",
        )

        await run_trainee_report_escalation(db_session)

        notifs = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.organization_id == org_id,
                        NotificationLog.category == "shift_report_followup",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert notifs == []

    async def test_overdue_unack_report_escalates_and_caps(
        self,
        db_session: AsyncSession,
    ):
        org_id = await _insert_org(db_session)
        officer_id = await _insert_user(db_session, org_id=org_id)
        trainee_id = await _insert_user(db_session, org_id=org_id)

        svc = ShiftCompletionService(db_session)
        report = await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today() - timedelta(days=10),
            hours_on_shift=12.0,
            review_status="approved",
        )
        # Backdate created_at to land before the 7-day cutoff
        await db_session.execute(
            text(
                "UPDATE shift_completion_reports "
                "SET created_at = :ts WHERE id = :id"
            ),
            {
                "ts": datetime.now(timezone.utc) - timedelta(days=10),
                "id": report.id,
            },
        )
        await db_session.flush()

        # Three runs should each add one reminder, then stop
        for _ in range(5):
            await run_trainee_report_escalation(db_session)

        trainee_notifs = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.organization_id == org_id,
                        NotificationLog.recipient_id == trainee_id,
                        NotificationLog.category == "shift_report_followup",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(trainee_notifs) == 3

        refreshed = (
            await db_session.execute(
                select(ShiftCompletionReport).where(
                    ShiftCompletionReport.id == report.id
                )
            )
        ).scalar_one()
        ack_entries = [
            e
            for e in (refreshed.review_history or [])
            if e.get("status") == "ack_reminder"
        ]
        assert len(ack_entries) == 3

    async def test_acknowledged_report_not_escalated(
        self,
        db_session: AsyncSession,
    ):
        org_id = await _insert_org(db_session)
        officer_id = await _insert_user(db_session, org_id=org_id)
        trainee_id = await _insert_user(db_session, org_id=org_id)

        svc = ShiftCompletionService(db_session)
        report = await svc.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee_id,
            shift_date=date.today() - timedelta(days=10),
            hours_on_shift=12.0,
            review_status="approved",
        )
        await db_session.execute(
            text(
                "UPDATE shift_completion_reports "
                "SET created_at = :ts, trainee_acknowledged = 1 "
                "WHERE id = :id"
            ),
            {
                "ts": datetime.now(timezone.utc) - timedelta(days=10),
                "id": report.id,
            },
        )
        await db_session.flush()

        await run_trainee_report_escalation(db_session)

        notifs = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.organization_id == org_id,
                        NotificationLog.category == "shift_report_followup",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert notifs == []


# ── Misc: shift.activities flag is stored, not lost ─────────────────


class TestActivitiesFlagPersistence:
    """Smoke test that confirms the JSON column writes survive — guards
    against the pitfall #12 mutation issue."""

    async def test_start_reminder_flag_persisted(
        self,
        db_session: AsyncSession,
    ):
        org_id = await _insert_org(db_session)
        user_id = await _insert_user(db_session, org_id=org_id)
        shift_id, _, _ = await _insert_shift(
            db_session,
            org_id=org_id,
            start_offset_minutes=30,
        )
        await _insert_assignment(
            db_session,
            org_id=org_id,
            shift_id=shift_id,
            user_id=user_id,
        )
        await db_session.flush()

        await run_shift_reminders(db_session)

        refreshed = (
            await db_session.execute(
                select(Shift).where(Shift.id == shift_id)
            )
        ).scalar_one()
        assert (refreshed.activities or {}).get("start_reminder_sent") is True
