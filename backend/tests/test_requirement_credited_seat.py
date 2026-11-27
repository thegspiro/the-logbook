"""A shift-credited requirement may count time in one seat only.

Owner decisions (2026-11-26): an optional seat on a shift-credited Hours or
Shifts requirement ("24 hours a year as Driver/Operator"), one seat per
requirement. Only shifts the member held that seat on count; a shift with no
seat recorded and time on another agency's apparatus carry no seat and never
count toward one. With no seat set, a requirement counts what it always did.

The member below works, in one year:

- a 12-hour shift as Driver/Operator;
- a 10-hour shift as Officer;
- an 8-hour shift with no seat recorded;
- a 6-hour counted shift on another agency's apparatus;
- a 4-hour Driver/Operator shift not yet finalized.

So a driver requirement reads 1 shift and 12 hours, and an unlimited one reads
4 shifts (the outside shift is a shift worked) and 36 hours.
"""

import uuid
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.api.v1.endpoints.training import create_requirement, update_requirement
from app.models.external_shift_hours import ExternalShiftHours, ExternalShiftHoursStatus
from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementType,
    Shift,
    ShiftAssignment,
    ShiftAttendance,
    TrainingRequirement,
)
from app.schemas.training import TrainingRequirementCreate, TrainingRequirementUpdate
from app.services.requirement_seat import (
    SEAT_LIMIT_MESSAGE,
    seat_limit_allowed,
    settle_credited_seat,
)
from app.services.scheduling_service import SchedulingService
from app.services.training_compliance import (
    evaluate_member_requirement_detail,
    load_credited_shift_dates,
)

# Mid-December: every shift below is in a closed month.
REFERENCE = date(2025, 12, 15)


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.mark.unit
class TestTheSeatRule:
    @pytest.mark.parametrize(
        ("kind", "credited", "allowed"),
        [
            ("shifts", None, True),
            ("shifts", True, True),
            ("shifts", False, False),
            ("hours", True, True),
            ("hours", None, False),
            ("hours", False, False),
            ("courses", True, False),
            ("calls", True, False),
        ],
    )
    def test_which_requirements_take_a_seat(self, kind, credited, allowed):
        req = SimpleNamespace(requirement_type=kind, shift_credited=credited)
        assert seat_limit_allowed(req) is allowed

    def test_a_seat_is_stored_canonical(self):
        req = SimpleNamespace(
            requirement_type="shifts", shift_credited=True, credited_seat=" EMT "
        )
        settle_credited_seat(req, sent=True)
        assert req.credited_seat == "ems"

    def test_a_departments_own_seat_keeps_its_spelling(self):
        req = SimpleNamespace(
            requirement_type="hours",
            shift_credited=True,
            credited_seat=" Rescue Technician ",
        )
        settle_credited_seat(req, sent=True)
        assert req.credited_seat == "Rescue Technician"

    def test_a_seat_sent_where_it_would_do_nothing_is_refused(self):
        req = SimpleNamespace(
            requirement_type="courses", shift_credited=False, credited_seat="driver"
        )
        with pytest.raises(ValueError, match=SEAT_LIMIT_MESSAGE):
            settle_credited_seat(req, sent=True)

    def test_a_stored_seat_an_edit_made_meaningless_is_cleared(self):
        req = SimpleNamespace(
            requirement_type="hours", shift_credited=False, credited_seat="driver"
        )
        settle_credited_seat(req, sent=False)
        assert req.credited_seat is None


async def _org_and_member(db):
    org_id, user_id = _uid(), _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Seat FD', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"seat-{org_id[:8]}"},
    )
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, 'Jordan', 'Lee', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"seat-{user_id[:8]}",
            "em": f"seat-{user_id[:8]}@test.com",
        },
    )
    await db.flush()
    return org_id, user_id


async def _worked(db, org_id, user_id, day, minutes, seat, *, finalized=True):
    shift_id = _uid()
    start = datetime(day.year, day.month, day.day, 8, 0)
    db.add(
        Shift(
            id=shift_id,
            organization_id=org_id,
            shift_date=day,
            start_time=start,
            end_time=start + timedelta(minutes=minutes),
            is_finalized=finalized,
        )
    )
    db.add(
        ShiftAttendance(
            id=_uid(),
            shift_id=shift_id,
            user_id=user_id,
            checked_in_at=start,
            checked_out_at=start + timedelta(minutes=minutes),
            duration_minutes=minutes,
        )
    )
    if seat:
        db.add(
            ShiftAssignment(
                id=_uid(),
                organization_id=org_id,
                shift_id=shift_id,
                user_id=user_id,
                position=seat,
            )
        )
    await db.flush()


async def _a_year_of_shifts(db, org_id, user_id):
    await _worked(db, org_id, user_id, date(2025, 3, 3), 12 * 60, "driver")
    await _worked(db, org_id, user_id, date(2025, 4, 7), 10 * 60, "officer")
    await _worked(db, org_id, user_id, date(2025, 5, 5), 8 * 60, None)
    await _worked(
        db, org_id, user_id, date(2025, 7, 7), 4 * 60, "driver", finalized=False
    )
    db.add(
        ExternalShiftHours(
            id=_uid(),
            organization_id=org_id,
            user_id=user_id,
            shift_date=date(2025, 6, 2),
            duration_minutes=6 * 60,
            agency_name="County",
            apparatus_name="E116",
            status=ExternalShiftHoursStatus.COUNTED.value,
        )
    )
    await db.flush()


async def _requirement(db, org_id, kind, seat, **fields) -> TrainingRequirement:
    req = TrainingRequirement(
        id=_uid(),
        organization_id=org_id,
        name=f"{kind} as {seat or 'anything'}",
        requirement_type=kind,
        shift_credited=True,
        credited_seat=seat,
        applies_to_all=True,
        active=True,
        frequency=RequirementFrequency.ANNUAL.value,
        due_date_type=DueDateType.CALENDAR_PERIOD.value,
        **fields,
    )
    db.add(req)
    await db.flush()
    return req


@pytest.mark.integration
class TestTheSharedCountOfShiftsWorked:
    async def test_a_driver_requirement_counts_driver_shifts_only(self, db_session):
        org_id, user_id = await _org_and_member(db_session)
        await _a_year_of_shifts(db_session, org_id, user_id)
        driver = await _requirement(
            db_session,
            org_id,
            RequirementType.SHIFTS.value,
            "driver",
            required_shifts=2,
        )
        anything = await _requirement(
            db_session, org_id, RequirementType.SHIFTS.value, None, required_shifts=2
        )

        shifts = await load_credited_shift_dates(
            db_session, org_id, [user_id], [driver, anything], REFERENCE, True
        )
        mine = shifts.get(user_id, [])

        seated = evaluate_member_requirement_detail(
            driver, [], REFERENCE, shift_dates=mine
        )
        unlimited = evaluate_member_requirement_detail(
            anything, [], REFERENCE, shift_dates=mine
        )

        assert seated.progress_current == 1
        assert seated.status != "completed"
        assert unlimited.progress_current == 4

    async def test_legacy_emt_spelling_counts_toward_the_emt_seat(self, db_session):
        org_id, user_id = await _org_and_member(db_session)
        await _worked(db_session, org_id, user_id, date(2025, 3, 3), 600, "EMT")
        # Another seat, so a count that ignored the seat would read 2.
        await _worked(db_session, org_id, user_id, date(2025, 4, 7), 600, "driver")
        emt = await _requirement(
            db_session, org_id, RequirementType.SHIFTS.value, "ems", required_shifts=1
        )

        shifts = await load_credited_shift_dates(
            db_session, org_id, [user_id], [emt], REFERENCE, True
        )
        result = evaluate_member_requirement_detail(
            emt, [], REFERENCE, shift_dates=shifts.get(user_id, [])
        )

        assert result.progress_current == 1


@pytest.mark.integration
class TestTheShiftComplianceReport:
    async def test_hours_and_shifts_rows_count_the_seat_only(self, db_session):
        org_id, user_id = await _org_and_member(db_session)
        await _a_year_of_shifts(db_session, org_id, user_id)
        await _requirement(
            db_session, org_id, RequirementType.HOURS.value, "driver", required_hours=24
        )
        await _requirement(
            db_session,
            org_id,
            RequirementType.SHIFTS.value,
            "driver",
            required_shifts=1,
        )

        rows = {
            row["requirement_type"]: row["members"][0]
            for row in await SchedulingService(db_session).get_shift_compliance(
                org_id, reference_date=REFERENCE
            )
        }

        hours = rows[RequirementType.HOURS.value]
        assert hours["completed_value"] == 12.0
        assert hours["total_hours"] == 12.0
        assert hours["external_hours"] == 0
        assert hours["compliant"] is False
        shifts = rows[RequirementType.SHIFTS.value]
        assert shifts["completed_value"] == 1
        assert shifts["compliant"] is True

    async def test_an_unlimited_hours_row_still_counts_every_shift(self, db_session):
        org_id, user_id = await _org_and_member(db_session)
        await _a_year_of_shifts(db_session, org_id, user_id)
        await _requirement(
            db_session, org_id, RequirementType.HOURS.value, None, required_hours=24
        )

        (row,) = await SchedulingService(db_session).get_shift_compliance(
            org_id, reference_date=REFERENCE
        )
        (member,) = row["members"]

        # Driver 12 + officer 10 + unseated 8 + outside 6.
        assert member["completed_value"] == 36.0
        assert member["compliant"] is True


@pytest.mark.integration
class TestTheRequirementEndpoints:
    async def _officer(self, db):
        org_id, user_id = await _org_and_member(db)
        return SimpleNamespace(id=user_id, organization_id=org_id, username="officer")

    async def test_create_stores_the_seat(self, db_session):
        officer = await self._officer(db_session)
        created = await create_requirement(
            TrainingRequirementCreate(
                name="Driver time",
                requirement_type="shifts",
                required_shifts=6,
                frequency="annual",
                credited_seat="Driver",
            ),
            db_session,
            officer,
        )
        assert created.credited_seat == "driver"

    async def test_create_refuses_a_seat_on_a_training_hours_requirement(
        self, db_session
    ):
        officer = await self._officer(db_session)
        with pytest.raises(HTTPException) as exc:
            await create_requirement(
                TrainingRequirementCreate(
                    name="Hazmat hours",
                    requirement_type="hours",
                    required_hours=8,
                    frequency="annual",
                    credited_seat="driver",
                ),
                db_session,
                officer,
            )
        assert exc.value.status_code == 400
        assert exc.value.detail == SEAT_LIMIT_MESSAGE

    async def test_update_sets_and_clears_the_seat(self, db_session):
        officer = await self._officer(db_session)
        created = await create_requirement(
            TrainingRequirementCreate(
                name="Seat hours",
                requirement_type="hours",
                required_hours=24,
                frequency="annual",
                shift_credited=True,
            ),
            db_session,
            officer,
        )
        requirement_id = uuid.UUID(str(created.id))

        seated = await update_requirement(
            requirement_id,
            TrainingRequirementUpdate(credited_seat="officer"),
            db_session,
            officer,
        )
        assert seated.credited_seat == "officer"

        cleared = await update_requirement(
            requirement_id,
            TrainingRequirementUpdate(credited_seat=None),
            db_session,
            officer,
        )
        assert cleared.credited_seat is None

    async def test_turning_shift_credit_off_drops_the_seat(self, db_session):
        officer = await self._officer(db_session)
        created = await create_requirement(
            TrainingRequirementCreate(
                name="Seat hours",
                requirement_type="hours",
                required_hours=24,
                frequency="annual",
                shift_credited=True,
                credited_seat="driver",
            ),
            db_session,
            officer,
        )

        updated = await update_requirement(
            uuid.UUID(str(created.id)),
            TrainingRequirementUpdate(shift_credited=False),
            db_session,
            officer,
        )

        assert updated.credited_seat is None
