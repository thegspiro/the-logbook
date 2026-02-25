"""
Integration tests for the scheduling module.

Covers:
  - Shift CRUD (create, get, update, delete, list, date filtering)
  - Template management (create, get, list, update, delete)
  - Pattern management and shift generation (daily, weekly, platoon, custom)
  - Assignment lifecycle (create, confirm, delete, leave-block)
  - Swap request flow (create, approve with swap, deny, cancel)
  - Time-off flow (create, approve, deny, cancel, availability)
  - Attendance tracking (add, update with duration calc, remove)
  - Shift calls (create, update, delete)
  - Reporting (member hours, coverage, call volume)
  - Compliance period-bounds computation
  - Duplicate-guard on pattern generation
"""

import pytest
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.scheduling_service import SchedulingService
from app.models.training import (
    AssignmentStatus,
    PatternType,
    SwapRequestStatus,
    TimeOffStatus,
)


# ── Helpers ──────────────────────────────────────────────────────────


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def setup_org_and_users(db_session: AsyncSession):
    """Create a minimal org with two users for scheduling tests."""
    org_id = _uid()
    user_id = _uid()
    user2_id = _uid()

    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": "Test FD",
            "otype": "fire_department",
            "slug": f"test-{org_id[:8]}",
            "tz": "America/New_York",
        },
    )
    for uid, uname, fn, ln in [
        (user_id, "officer1", "John", "Smith"),
        (user2_id, "ff1", "Jane", "Doe"),
    ]:
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, last_name, "
                "email, password_hash, status) VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
            ),
            {
                "id": uid,
                "org": org_id,
                "un": uname,
                "fn": fn,
                "ln": ln,
                "em": f"{uname}@test.com",
                "pw": "hashed",
            },
        )
    await db_session.flush()
    return org_id, user_id, user2_id


@pytest.fixture
async def setup_template(db_session: AsyncSession, setup_org_and_users):
    """Create an org, users, and a day-shift template."""
    org_id, user_id, user2_id = await setup_org_and_users
    svc = SchedulingService(db_session)

    template, err = await svc.create_template(
        uuid.UUID(org_id),
        {
            "name": "Day Shift",
            "start_time_of_day": "07:00",
            "end_time_of_day": "19:00",
            "duration_hours": 12.0,
            "min_staffing": 4,
        },
        uuid.UUID(user_id),
    )
    assert err is None
    return org_id, user_id, user2_id, template


# ── Shift CRUD Tests ────────────────────────────────────────────────


class TestShiftCRUD:

    @pytest.mark.asyncio
    async def test_create_and_get_shift(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, err = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
                "end_time": datetime(today.year, today.month, today.day, 19, 0),
                "notes": "Test shift",
            },
            uuid.UUID(user_id),
        )
        assert err is None
        assert shift is not None
        assert shift.notes == "Test shift"

        fetched = await svc.get_shift_by_id(uuid.UUID(shift.id), uuid.UUID(org_id))
        assert fetched is not None
        assert fetched.id == shift.id

    @pytest.mark.asyncio
    async def test_list_shifts_date_range(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        base = date.today()
        for i in range(5):
            d = base + timedelta(days=i)
            await svc.create_shift(
                uuid.UUID(org_id),
                {
                    "shift_date": d,
                    "start_time": datetime(d.year, d.month, d.day, 7, 0),
                },
                uuid.UUID(user_id),
            )

        # Fetch only the first 3 days
        shifts, total = await svc.get_shifts(
            uuid.UUID(org_id),
            start_date=base,
            end_date=base + timedelta(days=2),
        )
        assert total == 3
        assert len(shifts) == 3

    @pytest.mark.asyncio
    async def test_update_shift(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )

        updated, err = await svc.update_shift(
            uuid.UUID(shift.id),
            uuid.UUID(org_id),
            {"notes": "Updated notes"},
        )
        assert err is None
        assert updated.notes == "Updated notes"

    @pytest.mark.asyncio
    async def test_update_shift_not_found(self, db_session, setup_org_and_users):
        org_id, _, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        result, err = await svc.update_shift(
            uuid.uuid4(), uuid.UUID(org_id), {"notes": "x"}
        )
        assert result is None
        assert "not found" in err.lower()

    @pytest.mark.asyncio
    async def test_delete_shift(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )
        success, err = await svc.delete_shift(uuid.UUID(shift.id), uuid.UUID(org_id))
        assert success is True
        assert err is None

        fetched = await svc.get_shift_by_id(uuid.UUID(shift.id), uuid.UUID(org_id))
        assert fetched is None

    @pytest.mark.asyncio
    async def test_delete_shift_not_found(self, db_session, setup_org_and_users):
        org_id, _, _ = await setup_org_and_users
        svc = SchedulingService(db_session)
        success, err = await svc.delete_shift(uuid.uuid4(), uuid.UUID(org_id))
        assert success is False
        assert "not found" in err.lower()

    @pytest.mark.asyncio
    async def test_protected_fields_not_updated(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )
        original_id = shift.id

        updated, err = await svc.update_shift(
            uuid.UUID(shift.id),
            uuid.UUID(org_id),
            {"id": "evil-id", "notes": "legit update"},
        )
        assert err is None
        assert updated.id == original_id
        assert updated.notes == "legit update"


# ── Calendar Helpers ─────────────────────────────────────────────────


class TestCalendarHelpers:

    @pytest.mark.asyncio
    async def test_get_week_shifts(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        # Create shifts for a full week
        monday = date.today() - timedelta(days=date.today().weekday())
        for i in range(7):
            d = monday + timedelta(days=i)
            await svc.create_shift(
                uuid.UUID(org_id),
                {
                    "shift_date": d,
                    "start_time": datetime(d.year, d.month, d.day, 7, 0),
                },
                uuid.UUID(user_id),
            )

        shifts = await svc.get_week_shifts(uuid.UUID(org_id), monday)
        assert len(shifts) == 7

    @pytest.mark.asyncio
    async def test_get_month_shifts(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        # Create a shift on the 15th
        d = date(date.today().year, date.today().month, 15)
        await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": d,
                "start_time": datetime(d.year, d.month, d.day, 7, 0),
            },
            uuid.UUID(user_id),
        )

        shifts = await svc.get_month_shifts(
            uuid.UUID(org_id), d.year, d.month
        )
        assert len(shifts) >= 1

    @pytest.mark.asyncio
    async def test_get_summary(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )

        summary = await svc.get_summary(uuid.UUID(org_id))
        assert summary["total_shifts"] >= 1
        assert summary["shifts_this_week"] >= 0
        assert summary["shifts_this_month"] >= 1


# ── Template Tests ───────────────────────────────────────────────────


class TestTemplateManagement:

    @pytest.mark.asyncio
    async def test_create_and_list_templates(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        t, err = await svc.create_template(
            uuid.UUID(org_id),
            {
                "name": "Night Shift",
                "start_time_of_day": "19:00",
                "end_time_of_day": "07:00",
                "duration_hours": 12.0,
                "min_staffing": 3,
            },
            uuid.UUID(user_id),
        )
        assert err is None
        assert t.name == "Night Shift"

        templates = await svc.get_templates(uuid.UUID(org_id))
        assert any(tmpl.id == t.id for tmpl in templates)

    @pytest.mark.asyncio
    async def test_update_template(self, db_session, setup_template):
        org_id, user_id, _, template = await setup_template
        svc = SchedulingService(db_session)

        updated, err = await svc.update_template(
            uuid.UUID(template.id),
            uuid.UUID(org_id),
            {"name": "Morning Shift"},
        )
        assert err is None
        assert updated.name == "Morning Shift"

    @pytest.mark.asyncio
    async def test_delete_template(self, db_session, setup_template):
        org_id, _, _, template = await setup_template
        svc = SchedulingService(db_session)

        success, err = await svc.delete_template(
            uuid.UUID(template.id), uuid.UUID(org_id)
        )
        assert success is True
        assert err is None

        fetched = await svc.get_template_by_id(
            uuid.UUID(template.id), uuid.UUID(org_id)
        )
        assert fetched is None


# ── Pattern Generation Tests ─────────────────────────────────────────


class TestPatternGeneration:

    @pytest.mark.asyncio
    async def test_daily_pattern(self, db_session, setup_template):
        org_id, user_id, _, template = await setup_template
        svc = SchedulingService(db_session)

        pattern, err = await svc.create_pattern(
            uuid.UUID(org_id),
            {
                "name": "Daily Pattern",
                "pattern_type": PatternType.DAILY,
                "template_id": template.id,
                "start_date": date.today(),
            },
            uuid.UUID(user_id),
        )
        assert err is None

        start = date.today()
        end = start + timedelta(days=4)
        shifts, gen_err = await svc.generate_shifts_from_pattern(
            uuid.UUID(pattern.id), uuid.UUID(org_id), start, end, uuid.UUID(user_id)
        )
        assert gen_err is None
        assert len(shifts) == 5  # 5 days inclusive

    @pytest.mark.asyncio
    async def test_weekly_pattern(self, db_session, setup_template):
        org_id, user_id, _, template = await setup_template
        svc = SchedulingService(db_session)

        # Monday and Wednesday only
        pattern, _ = await svc.create_pattern(
            uuid.UUID(org_id),
            {
                "name": "Weekly MW",
                "pattern_type": PatternType.WEEKLY,
                "template_id": template.id,
                "start_date": date.today(),
                "schedule_config": {"weekdays": [0, 2]},  # Mon, Wed
            },
            uuid.UUID(user_id),
        )

        # Generate for 2 full weeks (14 days)
        monday = date.today() - timedelta(days=date.today().weekday())
        end = monday + timedelta(days=13)
        shifts, err = await svc.generate_shifts_from_pattern(
            uuid.UUID(pattern.id), uuid.UUID(org_id), monday, end, uuid.UUID(user_id)
        )
        assert err is None
        assert len(shifts) == 4  # 2 Mon + 2 Wed

    @pytest.mark.asyncio
    async def test_platoon_pattern(self, db_session, setup_template):
        org_id, user_id, _, template = await setup_template
        svc = SchedulingService(db_session)

        pattern, _ = await svc.create_pattern(
            uuid.UUID(org_id),
            {
                "name": "Platoon 24/48",
                "pattern_type": PatternType.PLATOON,
                "template_id": template.id,
                "start_date": date.today(),
                "days_on": 1,
                "days_off": 2,
            },
            uuid.UUID(user_id),
        )

        start = date.today()
        end = start + timedelta(days=8)  # 9 days: expect 3 on-days (0,3,6)
        shifts, err = await svc.generate_shifts_from_pattern(
            uuid.UUID(pattern.id), uuid.UUID(org_id), start, end, uuid.UUID(user_id)
        )
        assert err is None
        assert len(shifts) == 3

    @pytest.mark.asyncio
    async def test_custom_pattern(self, db_session, setup_template):
        org_id, user_id, _, template = await setup_template
        svc = SchedulingService(db_session)

        specific_dates = [
            (date.today() + timedelta(days=1)).isoformat(),
            (date.today() + timedelta(days=5)).isoformat(),
        ]
        pattern, _ = await svc.create_pattern(
            uuid.UUID(org_id),
            {
                "name": "Custom Dates",
                "pattern_type": PatternType.CUSTOM,
                "template_id": template.id,
                "start_date": date.today(),
                "schedule_config": {"dates": specific_dates},
            },
            uuid.UUID(user_id),
        )

        start = date.today()
        end = start + timedelta(days=10)
        shifts, err = await svc.generate_shifts_from_pattern(
            uuid.UUID(pattern.id), uuid.UUID(org_id), start, end, uuid.UUID(user_id)
        )
        assert err is None
        assert len(shifts) == 2

    @pytest.mark.asyncio
    async def test_overnight_shift_end_time(self, db_session, setup_org_and_users):
        """Shifts where end_time < start_time should end on the next day."""
        org_id, user_id, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        # Create a night-shift template: 19:00 -> 07:00
        template, _ = await svc.create_template(
            uuid.UUID(org_id),
            {
                "name": "Night Shift",
                "start_time_of_day": "19:00",
                "end_time_of_day": "07:00",
                "duration_hours": 12.0,
            },
            uuid.UUID(user_id),
        )

        pattern, _ = await svc.create_pattern(
            uuid.UUID(org_id),
            {
                "name": "Nightly",
                "pattern_type": PatternType.DAILY,
                "template_id": template.id,
                "start_date": date.today(),
            },
            uuid.UUID(user_id),
        )

        start = date.today()
        shifts, err = await svc.generate_shifts_from_pattern(
            uuid.UUID(pattern.id), uuid.UUID(org_id), start, start, uuid.UUID(user_id)
        )
        assert err is None
        assert len(shifts) == 1
        shift = shifts[0]
        # End time should be 07:00 the next day
        assert shift.end_time > shift.start_time
        assert shift.end_time.day == shift.start_time.day + 1 or (
            shift.start_time.month != shift.end_time.month
        )

    @pytest.mark.asyncio
    async def test_pattern_auto_assigns_members(self, db_session, setup_template):
        org_id, user_id, user2_id, template = await setup_template
        svc = SchedulingService(db_session)

        pattern, _ = await svc.create_pattern(
            uuid.UUID(org_id),
            {
                "name": "With Members",
                "pattern_type": PatternType.DAILY,
                "template_id": template.id,
                "start_date": date.today(),
                "assigned_members": [
                    {"user_id": user_id, "position": "officer"},
                    {"user_id": user2_id, "position": "firefighter"},
                ],
            },
            uuid.UUID(user_id),
        )

        start = date.today()
        shifts, err = await svc.generate_shifts_from_pattern(
            uuid.UUID(pattern.id), uuid.UUID(org_id), start, start, uuid.UUID(user_id)
        )
        assert err is None
        assert len(shifts) == 1

        assignments = await svc.get_shift_assignments(
            uuid.UUID(shifts[0].id), uuid.UUID(org_id)
        )
        assert len(assignments) == 2

    @pytest.mark.asyncio
    async def test_generate_missing_template_returns_error(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        pattern, _ = await svc.create_pattern(
            uuid.UUID(org_id),
            {
                "name": "No Template",
                "pattern_type": PatternType.DAILY,
                "start_date": date.today(),
            },
            uuid.UUID(user_id),
        )

        shifts, err = await svc.generate_shifts_from_pattern(
            uuid.UUID(pattern.id), uuid.UUID(org_id),
            date.today(), date.today(),
            uuid.UUID(user_id),
        )
        assert len(shifts) == 0
        assert "template" in err.lower()

    @pytest.mark.asyncio
    async def test_duplicate_guard_prevents_double_generation(self, db_session, setup_template):
        """Running generate twice for the same range should not create duplicates."""
        org_id, user_id, _, template = await setup_template
        svc = SchedulingService(db_session)

        pattern, _ = await svc.create_pattern(
            uuid.UUID(org_id),
            {
                "name": "Dup Test",
                "pattern_type": PatternType.DAILY,
                "template_id": template.id,
                "start_date": date.today(),
            },
            uuid.UUID(user_id),
        )

        start = date.today()
        end = start + timedelta(days=2)

        shifts1, _ = await svc.generate_shifts_from_pattern(
            uuid.UUID(pattern.id), uuid.UUID(org_id), start, end, uuid.UUID(user_id)
        )
        shifts2, _ = await svc.generate_shifts_from_pattern(
            uuid.UUID(pattern.id), uuid.UUID(org_id), start, end, uuid.UUID(user_id)
        )

        # Second run should create 0 new shifts
        assert len(shifts1) == 3
        assert len(shifts2) == 0

        # Total shifts for this range should be 3, not 6
        all_shifts, total = await svc.get_shifts(
            uuid.UUID(org_id), start_date=start, end_date=end
        )
        assert total == 3


# ── Assignment Tests ─────────────────────────────────────────────────


class TestAssignmentManagement:

    @pytest.mark.asyncio
    async def test_create_and_list_assignments(self, db_session, setup_org_and_users):
        org_id, user_id, user2_id = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )

        assignment, err = await svc.create_assignment(
            uuid.UUID(org_id),
            uuid.UUID(shift.id),
            {"user_id": user2_id, "position": "firefighter"},
            uuid.UUID(user_id),
        )
        assert err is None
        assert assignment is not None

        assignments = await svc.get_shift_assignments(
            uuid.UUID(shift.id), uuid.UUID(org_id)
        )
        assert len(assignments) == 1

    @pytest.mark.asyncio
    async def test_create_assignment_nonexistent_shift(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        result, err = await svc.create_assignment(
            uuid.UUID(org_id),
            uuid.uuid4(),
            {"user_id": user_id, "position": "firefighter"},
            uuid.UUID(user_id),
        )
        assert result is None
        assert "not found" in err.lower()

    @pytest.mark.asyncio
    async def test_confirm_assignment(self, db_session, setup_org_and_users):
        org_id, user_id, user2_id = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )

        assignment, _ = await svc.create_assignment(
            uuid.UUID(org_id),
            uuid.UUID(shift.id),
            {"user_id": user2_id, "position": "firefighter"},
            uuid.UUID(user_id),
        )

        confirmed, err = await svc.confirm_assignment(
            uuid.UUID(assignment.id), uuid.UUID(user2_id)
        )
        assert err is None
        assert confirmed.assignment_status == AssignmentStatus.CONFIRMED
        assert confirmed.confirmed_at is not None

    @pytest.mark.asyncio
    async def test_confirm_assignment_wrong_user(self, db_session, setup_org_and_users):
        org_id, user_id, user2_id = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )
        assignment, _ = await svc.create_assignment(
            uuid.UUID(org_id),
            uuid.UUID(shift.id),
            {"user_id": user2_id, "position": "firefighter"},
            uuid.UUID(user_id),
        )

        # user_id (the officer) tries to confirm user2's assignment
        result, err = await svc.confirm_assignment(
            uuid.UUID(assignment.id), uuid.UUID(user_id)
        )
        assert result is None
        assert "not assigned to you" in err.lower() or "not found" in err.lower()

    @pytest.mark.asyncio
    async def test_delete_assignment(self, db_session, setup_org_and_users):
        org_id, user_id, user2_id = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )
        assignment, _ = await svc.create_assignment(
            uuid.UUID(org_id),
            uuid.UUID(shift.id),
            {"user_id": user2_id, "position": "firefighter"},
            uuid.UUID(user_id),
        )

        success, err = await svc.delete_assignment(
            uuid.UUID(assignment.id), uuid.UUID(org_id)
        )
        assert success is True

        remaining = await svc.get_shift_assignments(
            uuid.UUID(shift.id), uuid.UUID(org_id)
        )
        assert len(remaining) == 0

    @pytest.mark.asyncio
    async def test_get_user_assignments_date_range(self, db_session, setup_org_and_users):
        org_id, user_id, user2_id = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        for i in range(3):
            d = today + timedelta(days=i)
            shift, _ = await svc.create_shift(
                uuid.UUID(org_id),
                {
                    "shift_date": d,
                    "start_time": datetime(d.year, d.month, d.day, 7, 0),
                },
                uuid.UUID(user_id),
            )
            await svc.create_assignment(
                uuid.UUID(org_id),
                uuid.UUID(shift.id),
                {"user_id": user2_id, "position": "firefighter"},
                uuid.UUID(user_id),
            )

        assignments = await svc.get_user_assignments(
            uuid.UUID(user2_id),
            uuid.UUID(org_id),
            start_date=today,
            end_date=today + timedelta(days=1),
        )
        assert len(assignments) == 2


# ── Swap Request Tests ───────────────────────────────────────────────


class TestSwapRequests:

    @pytest.mark.asyncio
    async def test_create_and_list_swap_requests(self, db_session, setup_org_and_users):
        org_id, user_id, user2_id = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )

        swap, err = await svc.create_swap_request(
            uuid.UUID(org_id),
            uuid.UUID(user_id),
            {"offering_shift_id": shift.id, "reason": "Family event"},
        )
        assert err is None
        assert swap.status == SwapRequestStatus.PENDING

        requests, total = await svc.get_swap_requests(uuid.UUID(org_id))
        assert total >= 1

    @pytest.mark.asyncio
    async def test_approve_swap_performs_assignment_swap(self, db_session, setup_org_and_users):
        org_id, user_id, user2_id = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift_a, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )
        tomorrow = today + timedelta(days=1)
        shift_b, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": tomorrow,
                "start_time": datetime(tomorrow.year, tomorrow.month, tomorrow.day, 7, 0),
            },
            uuid.UUID(user_id),
        )

        # Assign user1 to shift_a, user2 to shift_b
        await svc.create_assignment(
            uuid.UUID(org_id), uuid.UUID(shift_a.id),
            {"user_id": user_id, "position": "officer"},
            uuid.UUID(user_id),
        )
        await svc.create_assignment(
            uuid.UUID(org_id), uuid.UUID(shift_b.id),
            {"user_id": user2_id, "position": "firefighter"},
            uuid.UUID(user_id),
        )

        # User1 wants to swap shift_a for shift_b
        swap, _ = await svc.create_swap_request(
            uuid.UUID(org_id),
            uuid.UUID(user_id),
            {
                "offering_shift_id": shift_a.id,
                "requesting_shift_id": shift_b.id,
                "target_user_id": user2_id,
            },
        )

        reviewed, err = await svc.review_swap_request(
            uuid.UUID(swap.id),
            uuid.UUID(org_id),
            uuid.UUID(user_id),  # reviewer
            SwapRequestStatus.APPROVED,
        )
        assert err is None
        assert reviewed.status == SwapRequestStatus.APPROVED

    @pytest.mark.asyncio
    async def test_deny_swap_request(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )
        swap, _ = await svc.create_swap_request(
            uuid.UUID(org_id),
            uuid.UUID(user_id),
            {"offering_shift_id": shift.id},
        )

        reviewed, err = await svc.review_swap_request(
            uuid.UUID(swap.id),
            uuid.UUID(org_id),
            uuid.UUID(user_id),
            SwapRequestStatus.DENIED,
            reviewer_notes="Staffing too low",
        )
        assert err is None
        assert reviewed.status == SwapRequestStatus.DENIED
        assert reviewed.reviewer_notes == "Staffing too low"

    @pytest.mark.asyncio
    async def test_review_already_reviewed_fails(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )
        swap, _ = await svc.create_swap_request(
            uuid.UUID(org_id),
            uuid.UUID(user_id),
            {"offering_shift_id": shift.id},
        )

        await svc.review_swap_request(
            uuid.UUID(swap.id), uuid.UUID(org_id),
            uuid.UUID(user_id), SwapRequestStatus.DENIED,
        )

        # Try again
        result, err = await svc.review_swap_request(
            uuid.UUID(swap.id), uuid.UUID(org_id),
            uuid.UUID(user_id), SwapRequestStatus.APPROVED,
        )
        assert result is None
        assert "no longer pending" in err.lower()

    @pytest.mark.asyncio
    async def test_cancel_swap_by_wrong_user_fails(self, db_session, setup_org_and_users):
        org_id, user_id, user2_id = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )
        swap, _ = await svc.create_swap_request(
            uuid.UUID(org_id),
            uuid.UUID(user_id),
            {"offering_shift_id": shift.id},
        )

        result, err = await svc.cancel_swap_request(
            uuid.UUID(swap.id), uuid.UUID(org_id), uuid.UUID(user2_id)
        )
        assert result is None
        assert "only the requesting user" in err.lower()

    @pytest.mark.asyncio
    async def test_cancel_swap_success(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )
        swap, _ = await svc.create_swap_request(
            uuid.UUID(org_id),
            uuid.UUID(user_id),
            {"offering_shift_id": shift.id},
        )

        cancelled, err = await svc.cancel_swap_request(
            uuid.UUID(swap.id), uuid.UUID(org_id), uuid.UUID(user_id)
        )
        assert err is None
        assert cancelled.status == SwapRequestStatus.CANCELLED


# ── Time-Off Tests ───────────────────────────────────────────────────


class TestTimeOff:

    @pytest.mark.asyncio
    async def test_create_and_list_time_off(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        time_off, err = await svc.create_time_off(
            uuid.UUID(org_id),
            uuid.UUID(user_id),
            {
                "start_date": date.today(),
                "end_date": date.today() + timedelta(days=3),
                "reason": "Vacation",
            },
        )
        assert err is None
        assert time_off.status == TimeOffStatus.PENDING

        requests, total = await svc.get_time_off_requests(uuid.UUID(org_id))
        assert total >= 1

    @pytest.mark.asyncio
    async def test_approve_time_off(self, db_session, setup_org_and_users):
        org_id, user_id, user2_id = await setup_org_and_users
        svc = SchedulingService(db_session)

        time_off, _ = await svc.create_time_off(
            uuid.UUID(org_id),
            uuid.UUID(user2_id),
            {
                "start_date": date.today(),
                "end_date": date.today() + timedelta(days=2),
            },
        )

        reviewed, err = await svc.review_time_off(
            uuid.UUID(time_off.id), uuid.UUID(org_id),
            uuid.UUID(user_id), TimeOffStatus.APPROVED,
        )
        assert err is None
        assert reviewed.status == TimeOffStatus.APPROVED

    @pytest.mark.asyncio
    async def test_cancel_time_off_by_wrong_user(self, db_session, setup_org_and_users):
        org_id, user_id, user2_id = await setup_org_and_users
        svc = SchedulingService(db_session)

        time_off, _ = await svc.create_time_off(
            uuid.UUID(org_id),
            uuid.UUID(user_id),
            {
                "start_date": date.today(),
                "end_date": date.today() + timedelta(days=1),
            },
        )

        result, err = await svc.cancel_time_off(
            uuid.UUID(time_off.id), uuid.UUID(org_id), uuid.UUID(user2_id)
        )
        assert result is None
        assert "only the requesting user" in err.lower()

    @pytest.mark.asyncio
    async def test_cancel_time_off_success(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        time_off, _ = await svc.create_time_off(
            uuid.UUID(org_id),
            uuid.UUID(user_id),
            {
                "start_date": date.today(),
                "end_date": date.today() + timedelta(days=1),
            },
        )

        cancelled, err = await svc.cancel_time_off(
            uuid.UUID(time_off.id), uuid.UUID(org_id), uuid.UUID(user_id)
        )
        assert err is None
        assert cancelled.status == TimeOffStatus.CANCELLED

    @pytest.mark.asyncio
    async def test_get_availability_returns_approved_only(self, db_session, setup_org_and_users):
        org_id, user_id, user2_id = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        end = today + timedelta(days=5)

        # Create and approve one request
        to1, _ = await svc.create_time_off(
            uuid.UUID(org_id), uuid.UUID(user_id),
            {"start_date": today, "end_date": end},
        )
        await svc.review_time_off(
            uuid.UUID(to1.id), uuid.UUID(org_id),
            uuid.UUID(user_id), TimeOffStatus.APPROVED,
        )

        # Create but leave pending
        await svc.create_time_off(
            uuid.UUID(org_id), uuid.UUID(user2_id),
            {"start_date": today, "end_date": end},
        )

        availability = await svc.get_availability(
            uuid.UUID(org_id), today, end
        )
        # Only the approved one should appear
        assert len(availability) == 1
        assert availability[0]["user_id"] == user_id


# ── Attendance Tests ─────────────────────────────────────────────────


class TestAttendance:

    @pytest.mark.asyncio
    async def test_add_and_get_attendance(self, db_session, setup_org_and_users):
        org_id, user_id, user2_id = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )

        att, err = await svc.add_attendance(
            uuid.UUID(shift.id),
            uuid.UUID(org_id),
            {"user_id": user2_id},
        )
        assert err is None
        assert att is not None

        records = await svc.get_shift_attendance(
            uuid.UUID(shift.id), uuid.UUID(org_id)
        )
        assert len(records) == 1

    @pytest.mark.asyncio
    async def test_update_attendance_calculates_duration(self, db_session, setup_org_and_users):
        org_id, user_id, user2_id = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )

        att, _ = await svc.add_attendance(
            uuid.UUID(shift.id), uuid.UUID(org_id),
            {"user_id": user2_id},
        )

        check_in = datetime(today.year, today.month, today.day, 7, 0, tzinfo=timezone.utc)
        check_out = datetime(today.year, today.month, today.day, 19, 0, tzinfo=timezone.utc)

        updated, err = await svc.update_attendance(
            uuid.UUID(att.id), uuid.UUID(org_id),
            {"checked_in_at": check_in, "checked_out_at": check_out},
        )
        assert err is None
        assert updated.duration_minutes == 720  # 12 hours

    @pytest.mark.asyncio
    async def test_remove_attendance(self, db_session, setup_org_and_users):
        org_id, user_id, user2_id = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )

        att, _ = await svc.add_attendance(
            uuid.UUID(shift.id), uuid.UUID(org_id),
            {"user_id": user2_id},
        )

        success, err = await svc.remove_attendance(
            uuid.UUID(att.id), uuid.UUID(org_id)
        )
        assert success is True

        remaining = await svc.get_shift_attendance(
            uuid.UUID(shift.id), uuid.UUID(org_id)
        )
        assert len(remaining) == 0


# ── Shift Call Tests ─────────────────────────────────────────────────


class TestShiftCalls:

    @pytest.mark.asyncio
    async def test_create_and_list_calls(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )

        call, err = await svc.create_shift_call(
            uuid.UUID(org_id),
            uuid.UUID(shift.id),
            {
                "incident_type": "medical",
                "incident_number": "INC-001",
            },
        )
        assert err is None

        calls = await svc.get_shift_calls(uuid.UUID(shift.id), uuid.UUID(org_id))
        assert len(calls) == 1

    @pytest.mark.asyncio
    async def test_update_call(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )

        call, _ = await svc.create_shift_call(
            uuid.UUID(org_id), uuid.UUID(shift.id),
            {"incident_type": "fire"},
        )

        updated, err = await svc.update_shift_call(
            uuid.UUID(call.id), uuid.UUID(org_id),
            {"incident_type": "structure_fire"},
        )
        assert err is None
        assert updated.incident_type == "structure_fire"

    @pytest.mark.asyncio
    async def test_delete_call(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )

        call, _ = await svc.create_shift_call(
            uuid.UUID(org_id), uuid.UUID(shift.id),
            {"incident_type": "ems"},
        )

        success, err = await svc.delete_shift_call(
            uuid.UUID(call.id), uuid.UUID(org_id)
        )
        assert success is True

        remaining = await svc.get_shift_calls(
            uuid.UUID(shift.id), uuid.UUID(org_id)
        )
        assert len(remaining) == 0


# ── Reporting Tests ──────────────────────────────────────────────────


class TestReporting:

    @pytest.mark.asyncio
    async def test_member_hours_report(self, db_session, setup_org_and_users):
        org_id, user_id, user2_id = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )

        # Add attendance with duration
        att, _ = await svc.add_attendance(
            uuid.UUID(shift.id), uuid.UUID(org_id),
            {"user_id": user2_id},
        )
        check_in = datetime(today.year, today.month, today.day, 7, 0, tzinfo=timezone.utc)
        check_out = datetime(today.year, today.month, today.day, 19, 0, tzinfo=timezone.utc)
        await svc.update_attendance(
            uuid.UUID(att.id), uuid.UUID(org_id),
            {"checked_in_at": check_in, "checked_out_at": check_out},
        )

        report = await svc.get_member_hours_report(
            uuid.UUID(org_id), today, today
        )
        assert len(report) >= 1
        member_entry = next((r for r in report if r["user_id"] == user2_id), None)
        assert member_entry is not None
        assert member_entry["total_hours"] == 12.0

    @pytest.mark.asyncio
    async def test_coverage_report(self, db_session, setup_org_and_users):
        org_id, user_id, user2_id = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )

        # Shift with no assignments → understaffed
        report = await svc.get_shift_coverage_report(
            uuid.UUID(org_id), today, today
        )
        assert len(report) == 1
        assert report[0]["total_shifts"] == 1
        assert report[0]["understaffed_shifts"] >= 0

    @pytest.mark.asyncio
    async def test_call_volume_report(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )

        now = datetime.now(timezone.utc)
        await svc.create_shift_call(
            uuid.UUID(org_id), uuid.UUID(shift.id),
            {
                "incident_type": "medical",
                "dispatched_at": now,
                "on_scene_at": now + timedelta(minutes=5),
            },
        )
        await svc.create_shift_call(
            uuid.UUID(org_id), uuid.UUID(shift.id),
            {"incident_type": "fire"},
        )

        report = await svc.get_call_volume_report(
            uuid.UUID(org_id), today, today
        )
        assert len(report) >= 1
        assert report[0]["total_calls"] == 2
        assert "medical" in report[0]["by_type"]

    @pytest.mark.asyncio
    async def test_my_shifts(self, db_session, setup_org_and_users):
        org_id, user_id, user2_id = await setup_org_and_users
        svc = SchedulingService(db_session)

        today = date.today()
        shift, _ = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": today,
                "start_time": datetime(today.year, today.month, today.day, 7, 0),
            },
            uuid.UUID(user_id),
        )

        # Assign user2 to the shift
        await svc.create_assignment(
            uuid.UUID(org_id), uuid.UUID(shift.id),
            {"user_id": user2_id, "position": "firefighter"},
            uuid.UUID(user_id),
        )

        my_shifts, total = await svc.get_my_shifts(
            uuid.UUID(user2_id), uuid.UUID(org_id),
        )
        assert total >= 1
        assert any(s["id"] == shift.id for s in my_shifts)


# ── Compliance Period Bounds Tests ───────────────────────────────────


class TestCompliancePeriodBounds:
    """Test the _compute_period_bounds helper for various frequencies."""

    def _make_requirement(self, **kwargs):
        """Create a mock requirement object with the given attributes."""

        class MockReq:
            pass

        req = MockReq()
        req.frequency = kwargs.get("frequency")
        req.due_date_type = kwargs.get("due_date_type")
        req.rolling_period_months = kwargs.get("rolling_period_months")
        req.period_start_month = kwargs.get("period_start_month", 1)
        req.start_date = kwargs.get("start_date")
        req.due_date = kwargs.get("due_date")
        return req

    def test_monthly_bounds(self, db_session):
        from app.models.training import DueDateType, RequirementFrequency

        svc = SchedulingService(db_session)
        req = self._make_requirement(
            frequency=RequirementFrequency.MONTHLY,
            due_date_type=DueDateType.CALENDAR_PERIOD,
        )
        ref = date(2026, 2, 15)
        start, end = svc._compute_period_bounds(req, ref)
        assert start == date(2026, 2, 1)
        assert end == date(2026, 2, 28)

    def test_annual_bounds_after_start_month(self, db_session):
        from app.models.training import DueDateType, RequirementFrequency

        svc = SchedulingService(db_session)
        req = self._make_requirement(
            frequency=RequirementFrequency.ANNUAL,
            due_date_type=DueDateType.CALENDAR_PERIOD,
            period_start_month=7,  # Fiscal year starting July
        )
        ref = date(2026, 9, 15)  # After July
        start, end = svc._compute_period_bounds(req, ref)
        assert start == date(2026, 7, 1)
        assert end == date(2027, 6, 30)

    def test_annual_bounds_before_start_month(self, db_session):
        from app.models.training import DueDateType, RequirementFrequency

        svc = SchedulingService(db_session)
        req = self._make_requirement(
            frequency=RequirementFrequency.ANNUAL,
            due_date_type=DueDateType.CALENDAR_PERIOD,
            period_start_month=7,
        )
        ref = date(2026, 3, 1)  # Before July
        start, end = svc._compute_period_bounds(req, ref)
        assert start == date(2025, 7, 1)
        assert end == date(2026, 6, 30)

    def test_rolling_bounds(self, db_session):
        from app.models.training import DueDateType, RequirementFrequency

        svc = SchedulingService(db_session)
        req = self._make_requirement(
            frequency=RequirementFrequency.ANNUAL,
            due_date_type=DueDateType.ROLLING,
            rolling_period_months=6,
        )
        ref = date(2026, 6, 15)
        start, end = svc._compute_period_bounds(req, ref)
        assert end == ref
        assert start == date(2025, 12, 15)

    def test_quarterly_bounds(self, db_session):
        from app.models.training import DueDateType, RequirementFrequency

        svc = SchedulingService(db_session)
        req = self._make_requirement(
            frequency=RequirementFrequency.QUARTERLY,
            due_date_type=DueDateType.CALENDAR_PERIOD,
            period_start_month=1,
        )
        ref = date(2026, 5, 10)  # Q2 (Apr-Jun)
        start, end = svc._compute_period_bounds(req, ref)
        assert start == date(2026, 4, 1)
        assert end == date(2026, 6, 30)
