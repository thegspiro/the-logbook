"""Pre-shift work: timed prep for an upcoming shift, credited once approved.

A member who does the equipment check the afternoon before a 04:00 shift
scans the vehicle, says it is pre-shift work for that shift, and scans out
when done. The session is linked to the shift and counts toward hours only
after an officer approves it — as hours, never as an extra shift.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import (
    AssignmentStatus,
    PreWorkStatus,
    Shift,
    ShiftAssignment,
    ShiftAttendance,
    ShiftPreWorkSession,
    ShiftStatus,
)
from app.models.user import Organization, User, UserStatus
from app.services.pre_shift_work_service import (
    MAX_PRE_WORK_MINUTES,
    PreShiftWorkService,
    pre_shift_work_enabled,
)
from app.services.scheduling_service import SchedulingService
from app.services.shift_eligibility_service import ShiftEligibilityService


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


@pytest.mark.unit
class TestSettingDefault:
    def test_absent_key_means_on(self):
        assert pre_shift_work_enabled({}) is True
        assert pre_shift_work_enabled({"scheduling": {}}) is True

    def test_explicit_off(self):
        assert (
            pre_shift_work_enabled({"scheduling": {"pre_shift_work_enabled": False}})
            is False
        )

    def test_lifecycle_settings_report_default_on(self):
        org = SimpleNamespace(settings={})
        svc = ShiftEligibilityService(db=MagicMock(spec=AsyncSession))
        assert svc.get_lifecycle_settings(org)["pre_shift_work_enabled"] is True


async def _org(db, settings=None) -> Organization:
    slug = f"prework-{uuid.uuid4().hex[:10]}"
    org = Organization(name="Pre-Work VFD", slug=slug, settings=settings or {})
    db.add(org)
    await db.flush()
    return org


async def _user(db, org, name="Jane") -> User:
    tag = uuid.uuid4().hex[:8]
    user = User(
        organization_id=org.id,
        username=f"{name.lower()}-{tag}",
        email=f"{name.lower()}-{tag}@example.test",
        first_name=name,
        last_name="Doe",
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    await db.flush()
    return user


async def _shift(
    db, org, *, starts_in_hours=13.0, hours=12.0, officer=None, **extra
) -> Shift:
    start = _now() + timedelta(hours=starts_in_hours)
    shift = Shift(
        organization_id=org.id,
        shift_date=start.date(),
        start_time=start,
        end_time=start + timedelta(hours=hours),
        shift_officer_id=officer.id if officer else None,
        **extra,
    )
    db.add(shift)
    await db.flush()
    return shift


async def _assign(db, shift, user, status=AssignmentStatus.ASSIGNED):
    db.add(
        ShiftAssignment(
            organization_id=shift.organization_id,
            shift_id=shift.id,
            user_id=user.id,
            assignment_status=status,
        )
    )
    await db.flush()


async def _session_row(
    db, shift, user, *, status=PreWorkStatus.PENDING, minutes=60, approved=None
):
    started = _now() - timedelta(hours=20)
    row = ShiftPreWorkSession(
        organization_id=shift.organization_id,
        shift_id=shift.id,
        user_id=user.id,
        started_at=started,
        ended_at=started + timedelta(minutes=minutes),
        duration_minutes=minutes,
        status=status,
        approved_minutes=approved,
    )
    db.add(row)
    await db.flush()
    return row


@pytest.mark.integration
class TestEligibleShifts:
    async def test_lists_tomorrows_early_shift_for_a_rostered_member(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        shift = await _shift(db_session, org, starts_in_hours=13)
        await _assign(db_session, shift, member)

        enabled, shifts = await PreShiftWorkService(db_session).eligible_shifts(
            member.id, org.id
        )
        assert enabled is True
        assert [s["id"] for s in shifts] == [shift.id]

    async def test_excludes_unrostered_far_open_finalized_and_cancelled(
        self, db_session
    ):
        org = await _org(db_session)
        member = await _user(db_session, org)
        not_mine = await _shift(db_session, org, starts_in_hours=13)
        too_far = await _shift(db_session, org, starts_in_hours=72)
        checkin_open = await _shift(db_session, org, starts_in_hours=1)
        finalized = await _shift(db_session, org, starts_in_hours=14, is_finalized=True)
        cancelled = await _shift(
            db_session, org, starts_in_hours=15, status=ShiftStatus.CANCELLED
        )
        declined = await _shift(db_session, org, starts_in_hours=16)
        for s in (too_far, checkin_open, finalized, cancelled):
            await _assign(db_session, s, member)
        await _assign(db_session, declined, member, AssignmentStatus.DECLINED)
        assert not_mine.id  # rostered on nothing

        _, shifts = await PreShiftWorkService(db_session).eligible_shifts(
            member.id, org.id
        )
        assert shifts == []

    async def test_scanned_vehicle_sorts_first(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        earlier = await _shift(db_session, org, starts_in_hours=10)
        on_truck = await _shift(
            db_session, org, starts_in_hours=20, apparatus_id="truck-1"
        )
        await _assign(db_session, earlier, member)
        await _assign(db_session, on_truck, member)

        _, shifts = await PreShiftWorkService(db_session).eligible_shifts(
            member.id, org.id, apparatus_id="truck-1"
        )
        assert [s["id"] for s in shifts] == [on_truck.id, earlier.id]
        assert shifts[0]["on_scanned_apparatus"] is True

    async def test_department_can_turn_it_off(self, db_session):
        org = await _org(db_session, {"scheduling": {"pre_shift_work_enabled": False}})
        member = await _user(db_session, org)
        shift = await _shift(db_session, org)
        await _assign(db_session, shift, member)
        service = PreShiftWorkService(db_session)

        enabled, shifts = await service.eligible_shifts(member.id, org.id)
        assert (enabled, shifts) == (False, [])
        with pytest.raises(ValueError, match="turned off"):
            await service.start(member.id, org.id, shift.id)


@pytest.mark.integration
class TestStartAndEnd:
    async def test_lifecycle_start_then_end_is_pending(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        shift = await _shift(db_session, org)
        await _assign(db_session, shift, member)
        service = PreShiftWorkService(db_session)

        session = await service.start(member.id, org.id, shift.id)
        assert session is not None
        assert session.status == PreWorkStatus.ACTIVE
        assert (await service.active_session(member.id, org.id)).id == session.id

        ended = await service.end(member.id, org.id, session.id, note=" SCBA check ")
        assert ended.status == PreWorkStatus.PENDING
        assert ended.ended_at is not None
        assert ended.duration_minutes == 0
        assert ended.note == "SCBA check"
        assert ended.approved_minutes is None
        assert await service.active_session(member.id, org.id) is None

    async def test_second_running_session_is_refused(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        a = await _shift(db_session, org, starts_in_hours=10)
        b = await _shift(db_session, org, starts_in_hours=20)
        await _assign(db_session, a, member)
        await _assign(db_session, b, member)
        service = PreShiftWorkService(db_session)

        await service.start(member.id, org.id, a.id)
        with pytest.raises(ValueError, match="already have pre-shift work running"):
            await service.start(member.id, org.id, b.id)

    async def test_unrostered_member_is_refused(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        shift = await _shift(db_session, org)
        with pytest.raises(ValueError, match="not on the roster"):
            await PreShiftWorkService(db_session).start(member.id, org.id, shift.id)

    async def test_open_check_in_means_check_in_instead(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        shift = await _shift(db_session, org, starts_in_hours=1)
        await _assign(db_session, shift, member)
        with pytest.raises(ValueError, match="check in instead"):
            await PreShiftWorkService(db_session).start(member.id, org.id, shift.id)

    async def test_cross_org_shift_and_apparatus_are_refused(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session)
        member = await _user(db_session, org)
        foreign_shift = await _shift(db_session, other)
        own_shift = await _shift(db_session, org)
        await _assign(db_session, own_shift, member)
        service = PreShiftWorkService(db_session)

        assert await service.start(member.id, org.id, foreign_shift.id) is None
        with pytest.raises(ValueError, match="Invalid apparatus"):
            await service.start(
                member.id, org.id, own_shift.id, apparatus_id=str(uuid.uuid4())
            )

    async def test_end_is_owner_only_and_once(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        someone_else = await _user(db_session, org, name="Sam")
        shift = await _shift(db_session, org)
        await _assign(db_session, shift, member)
        service = PreShiftWorkService(db_session)
        session = await service.start(member.id, org.id, shift.id)

        assert await service.end(someone_else.id, org.id, session.id) is None
        await service.end(member.id, org.id, session.id)
        with pytest.raises(ValueError, match="already ended"):
            await service.end(member.id, org.id, session.id)

    async def test_ending_still_works_after_the_department_turns_it_off(
        self, db_session
    ):
        org = await _org(db_session)
        member = await _user(db_session, org)
        shift = await _shift(db_session, org)
        await _assign(db_session, shift, member)
        service = PreShiftWorkService(db_session)
        session = await service.start(member.id, org.id, shift.id)

        await ShiftEligibilityService(db_session).update_scheduling_settings(
            organization_id=org.id, pre_shift_work_enabled=False
        )
        ended = await service.end(member.id, org.id, session.id)
        assert ended.status == PreWorkStatus.PENDING

    async def test_a_day_long_session_needs_an_officer(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        shift = await _shift(db_session, org)
        row = await _session_row(db_session, shift, member, status=PreWorkStatus.ACTIVE)
        row.started_at = _now() - timedelta(minutes=MAX_PRE_WORK_MINUTES + 5)
        row.ended_at = None
        await db_session.flush()
        with pytest.raises(ValueError, match="more than 24 hours"):
            await PreShiftWorkService(db_session).end(member.id, org.id, row.id)

    async def test_settings_round_trip(self, db_session):
        org = await _org(db_session)
        svc = ShiftEligibilityService(db_session)
        await svc.update_scheduling_settings(
            organization_id=org.id, pre_shift_work_enabled=False
        )
        refreshed = await svc._get_org(org.id)
        assert svc.get_lifecycle_settings(refreshed)["pre_shift_work_enabled"] is False


@pytest.mark.integration
class TestCheckInEndsRunningSession:
    async def test_member_check_in_ends_the_running_prep(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        shift = await _shift(
            db_session, org, starts_in_hours=1, open_to_all_members=True
        )
        row = await _session_row(db_session, shift, member, status=PreWorkStatus.ACTIVE)
        row.ended_at = None
        row.duration_minutes = None
        await db_session.flush()

        attendance, error = await SchedulingService(db_session).member_check_in(
            shift.id, member.id, org.id
        )
        assert error is None
        assert attendance is not None
        await db_session.refresh(row)
        assert row.status == PreWorkStatus.PENDING
        assert row.ended_at is not None
        assert row.duration_minutes >= 20 * 60


@pytest.mark.integration
class TestReview:
    async def test_officer_approves_with_adjusted_minutes(self, db_session):
        org = await _org(db_session)
        officer = await _user(db_session, org, name="Olive")
        member = await _user(db_session, org)
        shift = await _shift(db_session, org, officer=officer)
        row = await _session_row(db_session, shift, member, minutes=70)

        reviewed = await PreShiftWorkService(db_session).review(
            officer, row.id, can_manage=False, approve=True, approved_minutes=60
        )
        assert reviewed.status == PreWorkStatus.APPROVED
        assert reviewed.approved_minutes == 60
        assert reviewed.reviewed_by == officer.id

    async def test_approve_defaults_to_measured_minutes_and_reject_clears(
        self, db_session
    ):
        org = await _org(db_session)
        officer = await _user(db_session, org, name="Olive")
        member = await _user(db_session, org)
        shift = await _shift(db_session, org, officer=officer)
        row = await _session_row(db_session, shift, member, minutes=45)
        service = PreShiftWorkService(db_session)

        approved = await service.review(officer, row.id, can_manage=False, approve=True)
        assert approved.approved_minutes == 45
        rejected = await service.review(
            officer, row.id, can_manage=False, approve=False, review_note="dupe"
        )
        assert rejected.status == PreWorkStatus.REJECTED
        assert rejected.approved_minutes is None
        assert rejected.review_note == "dupe"

    async def test_shift_officer_cannot_approve_their_own(self, db_session):
        org = await _org(db_session)
        officer = await _user(db_session, org, name="Olive")
        shift = await _shift(db_session, org, officer=officer)
        row = await _session_row(db_session, shift, officer)
        service = PreShiftWorkService(db_session)

        with pytest.raises(PermissionError, match="your own"):
            await service.review(officer, row.id, can_manage=False, approve=True)
        approved = await service.review(officer, row.id, can_manage=True, approve=True)
        assert approved.status == PreWorkStatus.APPROVED

    async def test_unrelated_member_cannot_review(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        bystander = await _user(db_session, org, name="Bo")
        shift = await _shift(db_session, org)
        row = await _session_row(db_session, shift, member)
        with pytest.raises(PermissionError):
            await PreShiftWorkService(db_session).review(
                bystander, row.id, can_manage=False, approve=True
            )

    async def test_cross_org_reviewer_sees_nothing(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session)
        member = await _user(db_session, org)
        outsider = await _user(db_session, other, name="Oz")
        shift = await _shift(db_session, org)
        row = await _session_row(db_session, shift, member)
        assert (
            await PreShiftWorkService(db_session).review(
                outsider, row.id, can_manage=True, approve=True
            )
            is None
        )

    async def test_officer_ends_a_forgotten_session(self, db_session):
        org = await _org(db_session)
        officer = await _user(db_session, org, name="Olive")
        member = await _user(db_session, org)
        shift = await _shift(db_session, org, officer=officer)
        row = await _session_row(db_session, shift, member, status=PreWorkStatus.ACTIVE)
        row.ended_at = None
        await db_session.flush()
        service = PreShiftWorkService(db_session)

        with pytest.raises(ValueError, match="never ended"):
            await service.review(officer, row.id, can_manage=False, approve=True)
        ended_at = _as_aware(row.started_at) + timedelta(minutes=50)
        reviewed = await service.review(
            officer, row.id, can_manage=False, approve=True, ended_at=ended_at
        )
        assert reviewed.duration_minutes == 50
        assert reviewed.approved_minutes == 50

    async def test_approving_after_finalize_updates_total_hours(self, db_session):
        org = await _org(db_session)
        officer = await _user(db_session, org, name="Olive")
        member = await _user(db_session, org)
        shift = await _shift(
            db_session,
            org,
            starts_in_hours=-30,
            officer=officer,
            is_finalized=True,
            total_hours=12.0,
        )
        db_session.add(
            ShiftAttendance(
                shift_id=shift.id,
                user_id=member.id,
                checked_in_at=shift.start_time,
                checked_out_at=shift.end_time,
                duration_minutes=720,
            )
        )
        row = await _session_row(db_session, shift, member, minutes=60)

        await PreShiftWorkService(db_session).review(
            officer, row.id, can_manage=False, approve=True
        )
        await db_session.refresh(shift)
        assert shift.total_hours == 13.0

    async def test_awaiting_review_lists_pending_and_forgotten_only(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        started = await _shift(db_session, org, starts_in_hours=-2)
        upcoming = await _shift(db_session, org, starts_in_hours=10)
        pending = await _session_row(db_session, upcoming, member)
        forgotten = await _session_row(
            db_session, started, member, status=PreWorkStatus.ACTIVE
        )
        still_running = await _session_row(
            db_session, upcoming, member, status=PreWorkStatus.ACTIVE
        )
        approved = await _session_row(
            db_session, upcoming, member, status=PreWorkStatus.APPROVED, approved=60
        )

        ids = {
            s.id
            for s in await PreShiftWorkService(db_session).list_awaiting_review(org.id)
        }
        assert pending.id in ids
        assert forgotten.id in ids
        assert still_running.id not in ids
        assert approved.id not in ids


@pytest.mark.integration
class TestHoursReaders:
    async def _finalized_with_prep(self, db_session, status, approved):
        org = await _org(db_session)
        member = await _user(db_session, org)
        shift = await _shift(db_session, org, starts_in_hours=-30, is_finalized=True)
        db_session.add(
            ShiftAttendance(
                shift_id=shift.id,
                user_id=member.id,
                checked_in_at=shift.start_time,
                checked_out_at=shift.end_time,
                duration_minutes=720,
            )
        )
        await _session_row(
            db_session, shift, member, status=status, minutes=60, approved=approved
        )
        return org, member, shift

    async def test_member_hours_report_adds_approved_minutes_not_shifts(
        self, db_session
    ):
        org, member, shift = await self._finalized_with_prep(
            db_session, PreWorkStatus.APPROVED, 60
        )
        report = await SchedulingService(db_session).get_member_hours_report(
            org.id,
            shift.shift_date - timedelta(days=1),
            shift.shift_date + timedelta(days=1),
        )
        row = next(r for r in report if r["user_id"] == member.id)
        assert row["shifts_attended"] == 1
        assert row["worked_minutes"] == 780
        assert row["pre_shift_minutes"] == 60

    async def test_pending_prep_is_never_counted(self, db_session):
        org, member, shift = await self._finalized_with_prep(
            db_session, PreWorkStatus.PENDING, None
        )
        report = await SchedulingService(db_session).get_member_hours_report(
            org.id,
            shift.shift_date - timedelta(days=1),
            shift.shift_date + timedelta(days=1),
        )
        row = next(r for r in report if r["user_id"] == member.id)
        assert row["worked_minutes"] == 720
        assert row["pre_shift_minutes"] == 0

    async def test_month_totals_add_approved_minutes(self, db_session):
        org, member, shift = await self._finalized_with_prep(
            db_session, PreWorkStatus.APPROVED, 60
        )
        buckets = await SchedulingService(db_session).get_member_month_totals(
            member.id, org.id
        )
        key = (shift.shift_date.year, shift.shift_date.month)
        assert buckets[key]["shifts"] == 1
        assert buckets[key]["hours"] == 13.0

    async def test_finalize_snapshot_includes_approved_prep(self, db_session):
        org = await _org(db_session)
        officer = await _user(db_session, org, name="Olive")
        member = await _user(db_session, org)
        shift = await _shift(db_session, org, starts_in_hours=-30, officer=officer)
        db_session.add(
            ShiftAttendance(
                shift_id=shift.id,
                user_id=member.id,
                checked_in_at=shift.start_time,
                checked_out_at=shift.end_time,
                duration_minutes=720,
            )
        )
        await _session_row(
            db_session, shift, member, status=PreWorkStatus.APPROVED, approved=30
        )
        finalized, error = await SchedulingService(db_session).finalize_shift(
            shift.id, org.id, officer.id
        )
        assert error is None, error
        assert finalized.total_hours == 12.5

    async def test_session_rows_are_org_scoped_in_listing(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session)
        member = await _user(db_session, org)
        shift = await _shift(db_session, org)
        await _session_row(db_session, shift, member)
        assert (
            await PreShiftWorkService(db_session).list_for_shift(shift.id, other.id)
            == []
        )
        rows = (
            (
                await db_session.execute(
                    select(ShiftPreWorkSession).where(
                        ShiftPreWorkSession.shift_id == shift.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        assert isinstance(rows[0].created_at, (datetime, date))
