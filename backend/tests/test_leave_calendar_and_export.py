"""The department's leave calendar and its CSV export.

Owner decisions of 2026-11-22: a Calendar view on Leave Requests, for the
officers who manage leave, showing recorded leaves, requests still waiting
and approver covers; and a CSV of requests (any status) and recorded leaves
over a date range, without reasons. Both are audited.
"""

import csv
import io
from datetime import date

import pytest
from sqlalchemy import select

from app.models.audit import AuditLog
from app.models.leave_request import (
    LeaveApproverCover,
    LeaveRequest,
    LeaveRequestStatus,
)
from app.models.user import LeaveType, MemberLeaveOfAbsence
from tests.test_leave_requests import _as, _department, _user

pytestmark = pytest.mark.integration

PRIVATE_REASON = "Recovering from knee surgery"


async def _leave(db, org_id, member, start, end, active=True, granted_by=None):
    leave = MemberLeaveOfAbsence(
        organization_id=org_id,
        user_id=str(member.id),
        leave_type=LeaveType.MEDICAL,
        reason=PRIVATE_REASON,
        start_date=start,
        end_date=end,
        active=active,
        granted_by=str(granted_by.id) if granted_by else None,
    )
    db.add(leave)
    await db.flush()
    return leave


async def _request(db, org_id, member, start, end, status=LeaveRequestStatus.PENDING):
    request = LeaveRequest(
        organization_id=org_id,
        user_id=str(member.id),
        leave_type=LeaveType.PERSONAL,
        reason=PRIVATE_REASON,
        start_date=start,
        end_date=end,
        status=status,
    )
    db.add(request)
    await db.flush()
    return request


async def _cover(db, org_id, approver, stand_in, start, end):
    cover = LeaveApproverCover(
        organization_id=org_id,
        approver_id=str(approver.id),
        stand_in_id=str(stand_in.id),
        start_date=start,
        end_date=end,
    )
    db.add(cover)
    await db.flush()
    return cover


async def _get(db, user, path, **params):
    async with _as(db, user, []) as client:
        return await client.get(path, params=params)


async def _audit(db, event_type):
    return list(
        (
            await db.execute(
                select(AuditLog.event_data).where(AuditLog.event_type == event_type)
            )
        ).scalars()
    )


class TestCalendar:
    async def test_shows_the_months_leaves_waiting_requests_and_covers(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, chief, _, _, member = await _department(db_session, org_id)
        other = await _user(db_session, org_id, "Avery")
        # Spans into March from February: on the March calendar.
        leave = await _leave(
            db_session, org_id, member, date(2027, 2, 20), date(2027, 3, 4)
        )
        open_ended = await _leave(db_session, org_id, other, date(2027, 1, 5), None)
        # Not on it: ended before March, or removed.
        await _leave(db_session, org_id, other, date(2027, 1, 1), date(2027, 2, 28))
        await _leave(
            db_session,
            org_id,
            member,
            date(2027, 3, 10),
            date(2027, 3, 12),
            active=False,
        )
        waiting = await _request(
            db_session, org_id, other, date(2027, 3, 15), date(2027, 3, 20)
        )
        # A decided request is a recorded leave or nothing; not shown as waiting.
        await _request(
            db_session,
            org_id,
            other,
            date(2027, 3, 15),
            date(2027, 3, 20),
            LeaveRequestStatus.DENIED,
        )
        cover = await _cover(
            db_session, org_id, chief, officer, date(2027, 3, 28), date(2027, 4, 3)
        )

        response = await _get(
            db_session, officer, "/users/leave-requests/calendar", month="2027-03"
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert (body["month_start"], body["month_end"]) == ("2027-03-01", "2027-03-31")
        assert {(e["id"], e["kind"]) for e in body["entries"]} == {
            (leave.id, "leave"),
            (open_ended.id, "leave"),
            (waiting.id, "request"),
        }
        assert [c["id"] for c in body["covers"]] == [cover.id]
        assert PRIVATE_REASON not in response.text
        assert await _audit(db_session, "leave_calendar_viewed") == [
            {"month": "2027-03", "record_count": 3}
        ]

    async def test_only_those_who_manage_leave_see_it(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        *_, member = await _department(db_session, org_id)

        response = await _get(
            db_session, member, "/users/leave-requests/calendar", month="2027-03"
        )

        assert response.status_code == 403

    async def test_a_malformed_month_is_refused(self, db_session, setup_org_and_admin):
        org_id, _ = setup_org_and_admin
        officer, *_ = await _department(db_session, org_id)

        response = await _get(
            db_session, officer, "/users/leave-requests/calendar", month="2027-13"
        )

        assert response.status_code == 422


class TestExport:
    async def test_requests_of_any_status_and_recorded_leaves_without_reasons(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, chief, _, _, member = await _department(db_session, org_id)
        await _leave(
            db_session,
            org_id,
            chief,
            date(2027, 3, 1),
            date(2027, 3, 10),
            granted_by=officer,
        )
        await _request(
            db_session,
            org_id,
            member,
            date(2027, 3, 5),
            None,
            LeaveRequestStatus.WITHDRAWN,
        )
        # Outside the range: not exported.
        await _request(db_session, org_id, member, date(2027, 6, 1), date(2027, 6, 2))
        await _cover(
            db_session, org_id, chief, officer, date(2027, 3, 1), date(2027, 3, 10)
        )

        response = await _get(
            db_session,
            officer,
            "/users/leave-requests/export",
            start="2027-03-01",
            end="2027-03-31",
        )

        assert response.status_code == 200, response.text
        assert response.headers["content-type"].startswith("text/csv")
        assert (
            'filename="leave-records-2027-03-01-to-2027-03-31.csv"'
            in response.headers["content-disposition"]
        )
        assert PRIVATE_REASON not in response.text
        rows = list(csv.DictReader(io.StringIO(response.text)))
        by_kind = {r["Kind"]: r for r in rows}
        assert set(by_kind) == {"Recorded leave", "Request"}
        recorded = by_kind["Recorded leave"]
        assert recorded["Member"] == chief.display_name
        assert recorded["Type"] == "Medical"
        assert (recorded["Start"], recorded["End"]) == ("2027-03-01", "2027-03-10")
        assert recorded["Status"] == "Recorded"
        assert recorded["Decided by"] == officer.display_name
        assert recorded["Cover"] == (
            f"{officer.display_name} (2027-03-01 to 2027-03-10)"
        )
        request = by_kind["Request"]
        assert request["Status"] == "Withdrawn"
        assert request["End"] == ""
        assert request["Requested at"] != ""
        assert await _audit(db_session, "leave_records_exported") == [
            {"start": "2027-03-01", "end": "2027-03-31", "record_count": 2}
        ]

    async def test_a_name_that_looks_like_a_formula_is_neutralized(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, *_ = await _department(db_session, org_id)
        crafted = await _user(db_session, org_id, "=HYPERLINK(evil)")
        await _leave(db_session, org_id, crafted, date(2027, 3, 1), date(2027, 3, 2))

        response = await _get(
            db_session,
            officer,
            "/users/leave-requests/export",
            start="2027-03-01",
            end="2027-03-31",
        )

        [row] = list(csv.DictReader(io.StringIO(response.text)))
        assert row["Member"].startswith("'=")

    async def test_a_backwards_or_overlong_range_is_refused(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, *_ = await _department(db_session, org_id)

        backwards = await _get(
            db_session,
            officer,
            "/users/leave-requests/export",
            start="2027-03-31",
            end="2027-03-01",
        )
        overlong = await _get(
            db_session,
            officer,
            "/users/leave-requests/export",
            start="2020-01-01",
            end="2027-03-01",
        )

        assert backwards.status_code == 400
        assert overlong.status_code == 400
        assert await _audit(db_session, "leave_records_exported") == []

    async def test_only_those_who_manage_leave_may_export(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        *_, member = await _department(db_session, org_id)

        response = await _get(
            db_session,
            member,
            "/users/leave-requests/export",
            start="2027-03-01",
            end="2027-03-31",
        )

        assert response.status_code == 403
