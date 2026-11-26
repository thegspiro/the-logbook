"""Every member's time in one seat, for the member roster's Time in seat
filter (owner decisions, 2026-11-26).

The figures are the department's Hours by Position for one seat: credited
(finalized) shifts dated in the period, approved pre-shift work in the seat it
was worked in, seats compared after canonical_position so a legacy ``EMT``
assignment counts toward the ``ems`` seat. Officers holding scheduling.report
see them; the endpoint is the same gate as another member's hours history.
"""

from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.scheduling import get_seat_hours
from app.services.reports_service import ReportsService
from app.services.scheduling_service import SchedulingService
from tests.test_position_hours_report import _add_org, _add_user, _shift, _worked

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def crew(db_session):
    org_id = await _add_org(db_session)
    avery = await _add_user(db_session, org_id, "Avery", "Stone")
    blake = await _add_user(db_session, org_id, "Blake", "Adams")
    first = await _shift(db_session, org_id, date(2025, 4, 7))
    await _worked(db_session, org_id, first, avery, 720, "driver", calls=3)
    await _worked(db_session, org_id, first, blake, 720, "officer", calls=3)
    second = await _shift(db_session, org_id, date(2025, 6, 2))
    await _worked(db_session, org_id, second, blake, 600, "Driver")
    third = await _shift(db_session, org_id, date(2025, 8, 4))
    await _worked(db_session, org_id, third, avery, 480, "driver", calls=1)
    earlier = await _shift(db_session, org_id, date(2024, 12, 31))
    await _worked(db_session, org_id, earlier, blake, 600, "driver")
    pending = await _shift(db_session, org_id, date(2025, 9, 1), finalized=False)
    await _worked(db_session, org_id, pending, blake, 600, "driver")
    return org_id, avery, blake


class TestSeatHours:
    async def test_members_in_the_seat_most_hours_first(self, db_session, crew):
        org_id, avery, blake = crew

        rows = await SchedulingService(db_session).get_seat_hours(
            org_id, "Driver", date(2025, 1, 1), date(2025, 12, 31)
        )

        # Avery 12 + 8 as driver; Blake 10 as "Driver" (the spelling does not
        # matter); Blake's officer shift, last year's and the pending one do
        # not count.
        assert rows == [
            {"user_id": avery, "shifts": 2, "hours": 20.0, "calls": 4},
            {"user_id": blake, "shifts": 1, "hours": 10.0, "calls": 0},
        ]

    async def test_all_time_reaches_last_year(self, db_session, crew):
        org_id, _, blake = crew

        rows = await SchedulingService(db_session).get_seat_hours(org_id, "driver")

        assert {r["user_id"]: r["hours"] for r in rows}[blake] == 20.0

    async def test_agrees_with_hours_by_position(self, db_session, crew):
        org_id, _, _ = crew
        start, end = date(2025, 1, 1), date(2025, 12, 31)

        rows = await SchedulingService(db_session).get_seat_hours(
            org_id, "officer", start, end
        )
        report = await ReportsService(db_session).generate_report(
            org_id, "position_hours", start, end
        )

        assert [r["hours"] for r in rows] == [
            e["hours"] for e in report["entries"] if e["position"] == "Officer"
        ]

    async def test_a_legacy_emt_spelling_counts_toward_the_emt_seat(self, db_session):
        org_id = await _add_org(db_session)
        member = await _add_user(db_session, org_id, "Casey", "Reed")
        shift_id = await _shift(db_session, org_id, date(2025, 3, 3))
        await _worked(db_session, org_id, shift_id, member, 600, "EMT")

        rows = await SchedulingService(db_session).get_seat_hours(org_id, "ems")

        assert [(r["user_id"], r["hours"]) for r in rows] == [(member, 10.0)]

    async def test_another_departments_time_is_not_counted(self, db_session, crew):
        _, avery, _ = crew
        other = await _add_org(db_session)
        theirs = await _shift(db_session, other, date(2025, 4, 7))
        await _worked(db_session, other, theirs, avery, 600, "driver")

        rows = await SchedulingService(db_session).get_seat_hours(other, "driver")

        # Avery is not a member of the other department: their shift on its
        # roster is not reported there, as Hours by Position leaves it out.
        assert rows == []


class TestTheEndpoint:
    async def test_returns_the_period_and_the_rows(self, db_session, crew):
        org_id, avery, _ = crew
        officer = SimpleNamespace(id=avery, organization_id=org_id)

        body = await get_seat_hours(
            "driver", date(2025, 1, 1), date(2025, 12, 31), db_session, officer
        )

        assert body["position"] == "driver"
        assert body["start_date"] == date(2025, 1, 1)
        assert [m["user_id"] for m in body["members"]][0] == avery

    async def test_refuses_a_period_that_ends_before_it_starts(self, db_session, crew):
        org_id, avery, _ = crew
        officer = SimpleNamespace(id=avery, organization_id=org_id)

        with pytest.raises(HTTPException) as exc:
            await get_seat_hours(
                "driver", date(2025, 12, 31), date(2025, 1, 1), db_session, officer
            )

        assert exc.value.status_code == 400
