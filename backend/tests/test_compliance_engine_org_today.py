"""
The compliance engine grades against the department's date.

At 02:30 UTC on October 7 it is 10:30 PM on October 6 in New York. The
compliance matrix, dashboard percentage, annual report and exports all have to
agree which of those two days "today" is, and it is the department's
(Pitfall #29): the matrix reports the date it graded against as ``as_of``, so
that is what these pin end to end.
"""

import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.utils import org_timezone
from tests.test_compliance_matrix_endpoint import (
    _call,
    _insert_hours_req,
    _insert_member,
)

pytestmark = [pytest.mark.integration]

FROZEN_UTC = datetime(2026, 10, 7, 2, 30, tzinfo=timezone.utc)


class _Frozen(datetime):
    @classmethod
    def now(cls, tz=None):
        if tz is None:
            return FROZEN_UTC.replace(tzinfo=None)
        return FROZEN_UTC.astimezone(tz)


@pytest.fixture(autouse=True)
def _frozen_clock(monkeypatch):
    monkeypatch.setattr(org_timezone, "datetime", _Frozen)


async def _insert_org(db_session: AsyncSession, tz: str) -> str:
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Zone Dept', 'fire_department', :slug, :tz)"
        ),
        {"id": org_id, "slug": f"zone-{org_id[:8]}", "tz": tz},
    )
    await db_session.flush()
    return org_id


class TestComplianceMatrixGradesOnTheDepartmentsDay:
    async def test_as_of_is_the_departments_date(self, db_session: AsyncSession):
        org_id = await _insert_org(db_session, "America/New_York")
        await _insert_member(db_session, org_id, last_name="Boyle")
        await _insert_hours_req(db_session, org_id, name="Company Hours")

        payload = await _call(db_session, org_id)

        assert payload["as_of"] == date(2026, 10, 6).isoformat()
        cell = payload["members"][0]["requirements"][0]
        assert cell["as_of"] == date(2026, 10, 6).isoformat()

    async def test_a_utc_department_is_already_on_the_next_day(
        self, db_session: AsyncSession
    ):
        org_id = await _insert_org(db_session, "UTC")
        await _insert_member(db_session, org_id, last_name="Boyle")
        await _insert_hours_req(db_session, org_id, name="Company Hours")

        payload = await _call(db_session, org_id)

        assert payload["as_of"] == date(2026, 10, 7).isoformat()
