"""``GET .../policy`` on both waiver routers: who decides is for managers.

Every member reads the policy, because the request form is built from it, but
the form needs none of the routing: which positions decide, which are copied
on decisions, and which member decides the Chief's own request. Those named
the officers a member would be asking and the stand-in for the Chief, to
anyone signed in. A member now gets the member-facing policy without them; the
workflow's manager (training.manage, meetings.manage) still reads all of it to
edit it.
"""

from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

from tests.test_attendance_waiver_endpoints import _APP, _CURRENT
from tests.waiver_request_support import (
    assign,
    load,
    make_member,
    make_org,
    make_position,
    set_meeting_policy,
    set_policy,
)

pytestmark = pytest.mark.integration

TRAINING = "/api/v1/training/waivers/requests/policy"
MEETINGS = "/api/v1/meetings/waiver-requests/policy"
ROUTING = {"approver_position_ids", "cc_position_ids", "chief_alternate_user_id"}


@pytest.fixture
def as_user(db_session):
    _CURRENT["db"] = db_session

    def client(user) -> AsyncClient:
        _CURRENT["user"] = user
        return AsyncClient(transport=ASGITransport(app=_APP), base_url="http://test")

    yield client
    _CURRENT.clear()


@pytest.fixture
async def dept(db_session):
    org_id = await make_org(db_session)
    trainer_pos = await make_position(
        db_session, org_id, "Training Admin", permissions=["training.manage"]
    )
    secretary_pos = await make_position(
        db_session, org_id, "Secretary", permissions=["meetings.manage"]
    )
    trainer = await make_member(db_session, org_id, "Trent")
    secretary = await make_member(db_session, org_id, "Sally")
    member = await make_member(db_session, org_id, "Mo")
    await assign(db_session, trainer, trainer_pos)
    await assign(db_session, secretary, secretary_pos)
    routing = {
        "approver_position_ids": [trainer_pos],
        "cc_position_ids": [secretary_pos],
        "chief_alternate_user_id": secretary,
    }
    await set_policy(db_session, org_id, categories=["Medical"], **routing)
    await set_meeting_policy(db_session, org_id, categories=["Work"], **routing)
    await db_session.flush()
    return SimpleNamespace(
        trainer=await load(db_session, trainer),
        secretary=await load(db_session, secretary),
        member=await load(db_session, member),
        routing=routing,
    )


@pytest.mark.parametrize(("url", "category"), [(TRAINING, "Medical"), (MEETINGS, "Work")])
async def test_a_member_reads_the_form_policy_without_the_routing(
    as_user, dept, url, category
):
    async with as_user(dept.member) as client:
        resp = await client.get(url)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["enabled"] is True
    assert body["categories"] == [category]
    assert ROUTING.isdisjoint(body)


async def test_the_training_manager_reads_the_routing(as_user, dept):
    async with as_user(dept.trainer) as client:
        resp = await client.get(TRAINING)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert {k: body[k] for k in ROUTING} == dept.routing


async def test_the_secretary_reads_the_meeting_routing_only(as_user, dept):
    async with as_user(dept.secretary) as client:
        meetings = (await client.get(MEETINGS)).json()
        training = (await client.get(TRAINING)).json()
    assert {k: meetings[k] for k in ROUTING} == dept.routing
    assert ROUTING.isdisjoint(training)
