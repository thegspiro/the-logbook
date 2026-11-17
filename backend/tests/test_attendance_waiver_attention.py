"""``attention``: whether the caller decides waiver requests, and how many wait.

The navigation offers the queue to the members who decide requests. Most of
them decide by holding a position the department chose, an office or the
alternate's place, none of which is a permission the menu can check, so the
server answers. Pinned, on the business-meeting workflow (the training one
shares the code and its endpoint is checked below):

* a holder of a chosen position decides, and counts a member's pending request;
* an ordinary member decides nothing and counts nothing;
* the Secretary, the fallback, decides only where the chosen positions leave
  nobody (all requests when none is chosen, a lone holder's own otherwise),
  exactly as the routing does;
* nobody counts their own request, a request waiting on the member to confirm
  a moved meeting, or one already decided;
* with the policy off, a decider with nothing waiting is offered no link, and
  one with a request still waiting is;
* the queue and the count agree on what the caller may decide.
"""

from datetime import timedelta
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

from app.models.attendance_waiver import AttendanceWaiverStatus
from app.services import attendance_waiver_service as engine
from app.services.attendance_waiver_service import (
    MEETING_WORKFLOW,
    AttendanceWaiverService,
)
from tests.test_attendance_waiver_endpoints import _APP, _CURRENT
from tests.waiver_request_support import (
    assign,
    load,
    make_meeting_event,
    make_member,
    make_org,
    make_position,
    set_meeting_policy,
    utc,
)

pytestmark = pytest.mark.integration

NOW = utc(2026, 11, 10, 12)
MEETING = utc(2026, 11, 21, 0)


@pytest.fixture(autouse=True)
def _clock(monkeypatch):
    monkeypatch.setattr(engine, "_now", lambda: NOW)


@pytest.fixture
async def dept(db_session):
    org_id = await make_org(db_session)
    clerk_pos = await make_position(db_session, org_id, "Clerk")
    secretary_pos = await make_position(
        db_session, org_id, "Secretary", slug="secretary"
    )
    ids = {
        name: await make_member(db_session, org_id, name.title())
        for name in ("member", "other", "clerk", "secretary")
    }
    await assign(db_session, ids["clerk"], clerk_pos)
    await assign(db_session, ids["secretary"], secretary_pos)
    await set_meeting_policy(db_session, org_id, approver_position_ids=[clerk_pos])
    meeting = await make_meeting_event(db_session, org_id, MEETING)
    second = await make_meeting_event(db_session, org_id, MEETING + timedelta(days=28))
    users = {name: await load(db_session, uid) for name, uid in ids.items()}
    return SimpleNamespace(
        org=org_id, clerk_pos=clerk_pos, meeting=meeting, second=second, **users
    )


def _svc(db) -> AttendanceWaiverService:
    return AttendanceWaiverService(db, MEETING_WORKFLOW)


async def _attention(db, dept, who):
    return await _svc(db).attention(dept.org, who)


async def _submit(db, dept, who, event_id=None):
    return await _svc(db).submit(
        dept.org, who, event_id or dept.meeting, None, "Away that week"
    )


class TestWhoDecides:
    async def test_a_chosen_position_holder_decides_and_counts(self, db_session, dept):
        assert await _attention(db_session, dept, dept.clerk) == {
            "decides": True,
            "pending": 0,
        }
        await _submit(db_session, dept, dept.member)
        assert await _attention(db_session, dept, dept.clerk) == {
            "decides": True,
            "pending": 1,
        }

    async def test_an_ordinary_member_decides_nothing(self, db_session, dept):
        await _submit(db_session, dept, dept.member)
        assert await _attention(db_session, dept, dept.other) == {
            "decides": False,
            "pending": 0,
        }

    async def test_the_fallback_decides_only_where_the_chain_reaches_it(
        self, db_session, dept
    ):
        await _submit(db_session, dept, dept.member)
        # One Clerk: the Clerk's own request falls through to the Secretary,
        # so the Secretary decides something, but not the member's request.
        assert await _attention(db_session, dept, dept.secretary) == {
            "decides": True,
            "pending": 0,
        }
        # Two Clerks decide each other's: the Secretary decides nothing.
        await assign(db_session, dept.other.id, dept.clerk_pos)
        assert await _attention(db_session, dept, dept.secretary) == {
            "decides": False,
            "pending": 0,
        }
        # No chosen positions: everything falls to the Secretary.
        await set_meeting_policy(db_session, dept.org, approver_position_ids=[])
        assert await _attention(db_session, dept, dept.secretary) == {
            "decides": True,
            "pending": 1,
        }


class TestWhatCounts:
    async def test_not_their_own_request(self, db_session, dept):
        await _submit(db_session, dept, dept.clerk)
        result = await _attention(db_session, dept, dept.clerk)
        assert result["pending"] == 0

    async def test_not_a_decided_one(self, db_session, dept):
        request = await _submit(db_session, dept, dept.member)
        await _svc(db_session).approve(dept.org, dept.clerk, request.id, None)
        assert (await _attention(db_session, dept, dept.clerk))["pending"] == 0

    async def test_not_one_waiting_on_the_member_to_confirm(self, db_session, dept):
        request = await _submit(db_session, dept, dept.member)
        request.reconfirm_requested_at = NOW
        await db_session.flush()
        assert (await _attention(db_session, dept, dept.clerk))["pending"] == 0

    async def test_the_queue_lists_what_the_count_counts(self, db_session, dept):
        await _submit(db_session, dept, dept.member)
        await _submit(db_session, dept, dept.other, dept.second)
        _, total = await _svc(db_session).list_for_decider(
            dept.org, dept.clerk, status=AttendanceWaiverStatus.PENDING
        )
        assert (await _attention(db_session, dept, dept.clerk))["pending"] == total == 2


class TestPolicyOff:
    async def test_no_link_without_a_policy_or_anything_waiting(self, db_session, dept):
        await set_meeting_policy(
            db_session, dept.org, enabled=False, approver_position_ids=[dept.clerk_pos]
        )
        assert await _attention(db_session, dept, dept.clerk) == {
            "decides": False,
            "pending": 0,
        }

    async def test_a_request_left_waiting_keeps_the_link(self, db_session, dept):
        await _submit(db_session, dept, dept.member)
        await set_meeting_policy(
            db_session, dept.org, enabled=False, approver_position_ids=[dept.clerk_pos]
        )
        assert await _attention(db_session, dept, dept.clerk) == {
            "decides": True,
            "pending": 1,
        }


@pytest.fixture
def as_user(db_session):
    _CURRENT["db"] = db_session

    def client(user) -> AsyncClient:
        _CURRENT["user"] = user
        return AsyncClient(transport=ASGITransport(app=_APP), base_url="http://test")

    yield client
    _CURRENT.clear()


class TestEndpoints:
    async def test_every_member_may_ask_about_themselves(self, as_user, dept):
        async with as_user(dept.clerk) as client:
            meetings = await client.get("/api/v1/meetings/waiver-requests/attention")
        async with as_user(dept.other) as client:
            training = await client.get("/api/v1/training/waivers/requests/attention")
        assert meetings.status_code == 200, meetings.text
        assert meetings.json() == {"decides": True, "pending": 0}
        assert training.status_code == 200, training.text
        assert training.json() == {"decides": False, "pending": 0}
