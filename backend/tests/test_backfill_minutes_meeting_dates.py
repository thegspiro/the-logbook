"""
Tests for scripts/backfill_minutes_meeting_dates.py (W51-8).

The guard is the whole point: a row is re-dated only while it still holds the
exact value the old UTC-combining code wrote, so a date a secretary corrected
by hand is never overwritten.
"""

import importlib.util
import pathlib
import uuid
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select, text

from app.models.meeting import Meeting
from app.models.minute import MeetingMinutes

_SCRIPT = (
    pathlib.Path(__file__).resolve().parents[1]
    / "scripts"
    / "backfill_minutes_meeting_dates.py"
)
_spec = importlib.util.spec_from_file_location("_minutes_backfill", _SCRIPT)
backfill = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(backfill)

CHICAGO = ZoneInfo("America/Chicago")


@pytest.mark.unit
class TestCorrectedDate:
    def test_seven_pm_meeting_read_as_utc_is_moved_to_the_department_clock(self):
        old = datetime(2026, 3, 10, 19, 0, tzinfo=timezone.utc)
        new = backfill.corrected_date(old, date(2026, 3, 10), time(19, 0), CHICAGO)
        assert new == datetime(2026, 3, 11, 0, 0, tzinfo=timezone.utc)

    def test_naive_stored_value_is_read_as_utc(self):
        old = datetime(2026, 10, 1, 0, 0)
        new = backfill.corrected_date(old, date(2026, 10, 1), None, CHICAGO)
        assert new == datetime(2026, 10, 1, 5, 0, tzinfo=timezone.utc)

    def test_a_hand_corrected_date_is_left_alone(self):
        corrected = datetime(2026, 3, 11, 0, 0, tzinfo=timezone.utc)
        assert (
            backfill.corrected_date(corrected, date(2026, 3, 10), time(19, 0), CHICAGO)
            is None
        )

    def test_a_rescheduled_meeting_is_left_alone(self):
        old = datetime(2026, 3, 10, 19, 0, tzinfo=timezone.utc)
        assert (
            backfill.corrected_date(old, date(2026, 3, 12), time(19, 0), CHICAGO)
            is None
        )

    def test_a_utc_department_has_nothing_to_correct(self):
        old = datetime(2026, 3, 10, 19, 0, tzinfo=timezone.utc)
        assert (
            backfill.corrected_date(
                old, date(2026, 3, 10), time(19, 0), ZoneInfo("UTC")
            )
            is None
        )

    def test_missing_dates_are_left_alone(self):
        assert backfill.corrected_date(None, date(2026, 1, 1), None, CHICAGO) is None
        assert (
            backfill.corrected_date(datetime(2026, 1, 1), None, None, CHICAGO) is None
        )


async def _seed_org(db, label, tz="America/Chicago"):
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, :name, 'fire_department', :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": f"Minutes Backfill {label} {org_id[:8]}",
            "slug": f"mb-{org_id[:8]}",
            "tz": tz,
        },
    )
    return org_id


async def _seed(db, org_id, meeting_day, start, stored, meeting_org=None):
    meeting = Meeting(
        organization_id=meeting_org or org_id,
        title="Business meeting",
        meeting_date=meeting_day,
        start_time=start,
    )
    db.add(meeting)
    await db.flush()
    minutes = MeetingMinutes(
        organization_id=org_id,
        title="Minutes: Business meeting",
        meeting_date=stored,
        meeting_id=meeting.id,
    )
    db.add(minutes)
    await db.flush()
    return minutes.id


async def _stored(db, minutes_id):
    row = await db.execute(
        select(MeetingMinutes.meeting_date).where(MeetingMinutes.id == minutes_id)
    )
    return backfill._utc(row.scalar_one())


@pytest.mark.integration
class TestAgainstTheDatabase:
    async def test_dry_run_plans_and_apply_writes_only_guarded_rows(self, db_session):
        org_id = await _seed_org(db_session, "A")
        shifted = await _seed(
            db_session,
            org_id,
            date(2026, 3, 10),
            time(19, 0),
            datetime(2026, 3, 10, 19, 0, tzinfo=timezone.utc),
        )
        hand_fixed = await _seed(
            db_session,
            org_id,
            date(2026, 3, 10),
            time(19, 0),
            datetime(2026, 3, 10, 23, 30, tzinfo=timezone.utc),
        )
        await db_session.commit()

        plan = await backfill._plan(db_session, org_id)
        assert [item["minutes"].id for item in plan] == [shifted]
        # The dry run wrote nothing.
        assert await _stored(db_session, shifted) == datetime(
            2026, 3, 10, 19, 0, tzinfo=timezone.utc
        )

        assert await backfill._apply(db_session, plan) == 1

        assert await _stored(db_session, shifted) == datetime(
            2026, 3, 11, 0, 0, tzinfo=timezone.utc
        )
        assert await _stored(db_session, hand_fixed) == datetime(
            2026, 3, 10, 23, 30, tzinfo=timezone.utc
        )
        # A second run finds nothing: the corrected row left the old value.
        assert await backfill._plan(db_session, org_id) == []

    async def test_a_meeting_in_another_organization_is_never_used(self, db_session):
        org_a = await _seed_org(db_session, "A")
        org_b = await _seed_org(db_session, "B")
        await _seed(
            db_session,
            org_a,
            date(2026, 3, 10),
            time(19, 0),
            datetime(2026, 3, 10, 19, 0, tzinfo=timezone.utc),
            meeting_org=org_b,
        )
        await db_session.commit()

        assert await backfill._plan(db_session, org_a) == []
