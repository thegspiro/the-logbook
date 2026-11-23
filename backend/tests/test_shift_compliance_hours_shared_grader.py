"""
The Shift Compliance report grades shift-credited HOURS rows through the
shared grader.

``SchedulingService.get_shift_compliance`` graded its SHIFTS rows through
``evaluate_member_requirement_detail`` with the member's waivers, but its
shift-credited HOURS rows through an adjustment of its own: leaves of absence
only, and only for a rolling requirement. A member excused by a training
waiver read short on the report while the training screens prorated the same
requirement (CLAUDE.md pitfall 29). The HOURS rows now go through the shared
grader too, over the same window, waivers, cut-off and catch-up rule as the
SHIFTS rows beside them, counting the same credited hours: finalized shift
attendance, counted external shifts and approved pre-shift work.

The expected figures are written out rather than computed by the grader, so a
wrong proration in the code under test fails here.
"""

import uuid
from datetime import date, datetime, timedelta

import pytest

from app.models.external_shift_hours import ExternalShiftHours
from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementType,
    Shift,
    ShiftAttendance,
    TrainingRequirement,
    TrainingWaiver,
    TrainingWaiverType,
)
from app.services.scheduling_service import SchedulingService
from tests.test_external_shift_hours import _add_org, _add_user

pytestmark = [pytest.mark.integration]

# Mid-December, so every shift below is in a closed month whether or not the
# department counts the current one.
REFERENCE = date(2025, 12, 15)


def _uid() -> str:
    return str(uuid.uuid4())


async def _shift(db, org_id, user_id, shift_date, minutes, *, finalized=True):
    shift_id = _uid()
    start = datetime(shift_date.year, shift_date.month, shift_date.day, 8, 0)
    db.add(
        Shift(
            id=shift_id,
            organization_id=org_id,
            shift_date=shift_date,
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
    await db.flush()


async def _hours_req(db, org_id, required_hours, **fields) -> TrainingRequirement:
    fields.setdefault("frequency", RequirementFrequency.ANNUAL.value)
    fields.setdefault("due_date_type", DueDateType.CALENDAR_PERIOD.value)
    req = TrainingRequirement(
        id=_uid(),
        organization_id=org_id,
        name="Shift hours",
        requirement_type=RequirementType.HOURS.value,
        required_hours=required_hours,
        shift_credited=True,
        applies_to_all=True,
        active=True,
        **fields,
    )
    db.add(req)
    await db.flush()
    return req


async def _waiver(db, org_id, user_id, start, end) -> None:
    # A medical waiver, not a leave of absence: the report's old adjustment
    # read leaves only, so this is the case it got wrong.
    db.add(
        TrainingWaiver(
            id=_uid(),
            organization_id=org_id,
            user_id=user_id,
            waiver_type=TrainingWaiverType.MEDICAL,
            start_date=start,
            end_date=end,
            active=True,
        )
    )
    await db.flush()


async def _row(db, org_id) -> dict:
    (requirement,) = await SchedulingService(db).get_shift_compliance(
        org_id, reference_date=REFERENCE
    )
    (member,) = requirement["members"]
    return member


async def test_a_training_waiver_prorates_a_calendar_hours_row(db_session):
    org_id = await _add_org(db_session)
    user_id = await _add_user(db_session, org_id)
    await _hours_req(db_session, org_id, 12)
    await _waiver(db_session, org_id, user_id, date(2025, 1, 1), date(2025, 6, 30))
    await _shift(db_session, org_id, user_id, date(2025, 8, 4), 8 * 60)

    member = await _row(db_session, org_id)

    # Six of twelve months excused: 12 hours become 6, and 8 meets them.
    assert member["required_value"] == 6.0
    assert member["leave_months"] == 6
    assert member["completed_value"] == 8.0
    assert member["compliant"] is True


async def test_a_training_waiver_prorates_a_rolling_hours_row(db_session):
    org_id = await _add_org(db_session)
    user_id = await _add_user(db_session, org_id)
    await _hours_req(
        db_session,
        org_id,
        12,
        due_date_type=DueDateType.ROLLING.value,
        rolling_period_months=12,
    )
    await _waiver(db_session, org_id, user_id, date(2025, 3, 1), date(2025, 8, 31))
    await _shift(db_session, org_id, user_id, date(2025, 10, 6), 8 * 60)

    member = await _row(db_session, org_id)

    assert member["required_value"] == 6.0
    assert member["leave_months"] == 6
    assert member["compliant"] is True


async def test_hours_count_finalized_shifts_external_and_pre_work_alike(db_session):
    org_id = await _add_org(db_session)
    user_id = await _add_user(db_session, org_id)
    await _hours_req(db_session, org_id, 20)
    await _shift(db_session, org_id, user_id, date(2025, 5, 5), 10 * 60)
    # Pending attendance is not credit until an officer finalizes the shift,
    # as for the SHIFTS rows and My Hours.
    await _shift(
        db_session, org_id, user_id, date(2025, 5, 6), 10 * 60, finalized=False
    )
    db_session.add(
        ExternalShiftHours(
            id=_uid(),
            organization_id=org_id,
            user_id=user_id,
            shift_date=date(2025, 6, 10),
            duration_minutes=12 * 60,
            agency_name="Neighbouring FD",
            apparatus_name="Engine 1",
            status="counted",
        )
    )
    await db_session.flush()

    member = await _row(db_session, org_id)

    assert member["completed_value"] == 22.0
    assert member["total_hours"] == 22.0
    assert member["external_hours"] == 12.0
    assert member["required_value"] == 20.0
    assert member["compliant"] is True
