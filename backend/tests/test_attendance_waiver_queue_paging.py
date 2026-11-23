"""``GET .../requests?state=``: the approver's queue, split on the server.

The queue page showed pending requests first and decided ones after, but the
list route filtered by one status at a time and "decided" spans several. So the
page fetched the unfiltered list and dropped the pending rows itself: each
"Show more" page came up short by however many pending rows it held, and more
than 200 pending requests could not be reached at all. ``state=pending`` and
``state=decided`` now filter on the server, with ``total`` counting only that
state, so both lists page properly.
"""

from datetime import timedelta
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

from app.services import attendance_waiver_service as engine
from app.services.attendance_waiver_service import AttendanceWaiverService
from tests.test_attendance_waiver_endpoints import _APP, _CURRENT
from tests.waiver_request_support import (
    assign,
    load,
    make_member,
    make_org,
    make_position,
    make_requirement,
    make_session,
    set_meeting_policy,
    set_policy,
    utc,
)

pytestmark = pytest.mark.integration

NOW = utc(2026, 11, 10, 12)
FIRST = utc(2026, 11, 20, 23)
TRAINING = "/api/v1/training/waivers/requests"
MEETINGS = "/api/v1/meetings/waiver-requests"


@pytest.fixture(autouse=True)
def _clock(monkeypatch):
    monkeypatch.setattr(engine, "_now", lambda: NOW)


@pytest.fixture
def as_user(db_session):
    _CURRENT["db"] = db_session

    def client(user) -> AsyncClient:
        _CURRENT["user"] = user
        return AsyncClient(transport=ASGITransport(app=_APP), base_url="http://test")

    yield client
    _CURRENT.clear()


@pytest.fixture
async def queue(db_session):
    """Five requests from one member: three approved, two pending."""
    org_id = await make_org(db_session)
    officer_pos = await make_position(db_session, org_id, "Training Officer")
    member_id = await make_member(db_session, org_id, "Member")
    officer_id = await make_member(db_session, org_id, "Officer")
    await assign(db_session, officer_id, officer_pos)
    await set_policy(db_session, org_id, approver_position_ids=[officer_pos])
    await set_meeting_policy(db_session, org_id, approver_position_ids=[officer_pos])
    requirement = await make_requirement(db_session, org_id)
    member = await load(db_session, member_id)
    officer = await load(db_session, officer_id)
    service = AttendanceWaiverService(db_session)
    ids = []
    for day in range(5):
        session = await make_session(
            db_session, org_id, FIRST + timedelta(days=day), link=[requirement]
        )
        request = await service.submit(org_id, member, session, None, "Away")
        ids.append(str(request.id))
    for request_id in ids[:3]:
        await service.approve(org_id, officer, request_id)
    return SimpleNamespace(officer=officer, decided=ids[:3], pending=ids[3:])


async def _page(as_user, who, url=TRAINING, **params):
    async with as_user(who) as client:
        resp = await client.get(url, params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_decided_pages_are_full_and_hold_no_pending(as_user, queue):
    first = await _page(as_user, queue.officer, state="decided", limit=2)
    rest = await _page(as_user, queue.officer, state="decided", skip=2, limit=2)

    assert first["total"] == rest["total"] == 3
    assert len(first["items"]) == 2
    assert len(rest["items"]) == 1
    seen = [r["id"] for r in first["items"] + rest["items"]]
    assert sorted(seen) == sorted(queue.decided)
    assert {r["status"] for r in first["items"] + rest["items"]} == {"approved"}


async def test_pending_pages_past_the_first(as_user, queue):
    first = await _page(as_user, queue.officer, state="pending", limit=1)
    second = await _page(as_user, queue.officer, state="pending", skip=1, limit=1)

    assert first["total"] == second["total"] == 2
    seen = [r["id"] for r in first["items"] + second["items"]]
    assert sorted(seen) == sorted(queue.pending)


async def test_without_a_state_the_list_is_unchanged(as_user, queue):
    everything = await _page(as_user, queue.officer)
    assert everything["total"] == 5


@pytest.mark.parametrize("url", [TRAINING, MEETINGS])
async def test_an_unknown_state_is_refused_on_both_routers(as_user, queue, url):
    async with as_user(queue.officer) as client:
        resp = await client.get(url, params={"state": "everything"})
    assert resp.status_code == 422
