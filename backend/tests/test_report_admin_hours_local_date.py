"""The Admin Hours report dates each entry on the department's calendar.

Workflow review W72: a member clocked in at 7 PM in Chicago on 15 October
(00:00 UTC on the 16th). The report's period filter already counted in
department days, but each row printed the UTC date, "2026-10-16", while the
admin-hours screens showed 10/15.
"""

import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin_hours import (
    AdminHoursCategory,
    AdminHoursEntry,
    AdminHoursEntryMethod,
    AdminHoursEntryStatus,
)
from app.models.user import Organization, User
from app.services.reports_service import ReportsService

pytestmark = pytest.mark.integration


async def test_an_evening_entry_is_dated_on_the_local_day(db_session: AsyncSession):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Report VFD",
        slug=f"report-{uuid.uuid4().hex[:8]}",
        timezone="America/Chicago",
    )
    db_session.add(org)
    await db_session.flush()
    name = f"member-{uuid.uuid4().hex[:8]}"
    user = User(
        organization_id=org.id,
        username=name,
        first_name="Jordan",
        last_name="Avery",
        email=f"{name}@example.com",
    )
    category = AdminHoursCategory(organization_id=org.id, name="Station Duty")
    db_session.add_all([user, category])
    await db_session.flush()
    db_session.add(
        AdminHoursEntry(
            organization_id=org.id,
            user_id=user.id,
            category_id=category.id,
            clock_in_at=datetime(2026, 10, 16, 0, 0, tzinfo=timezone.utc),
            clock_out_at=datetime(2026, 10, 16, 1, 0, tzinfo=timezone.utc),
            duration_minutes=60,
            entry_method=AdminHoursEntryMethod.MANUAL,
            status=AdminHoursEntryStatus.APPROVED,
        )
    )
    await db_session.flush()

    report = await ReportsService(db_session).generate_report(
        org.id, "admin_hours", date(2026, 10, 15), date(2026, 10, 15)
    )

    assert [row["date"] for row in report["entries"]] == ["2026-10-15"]
