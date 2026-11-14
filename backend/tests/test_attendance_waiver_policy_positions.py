"""``GET .../policy/positions`` on both waiver routers.

The settings screen's position pickers used to read
``GET /compliance/config/positions``, which needs training.manage or
compliance.manage. The business-meeting policy is saved under
meetings.manage, so a Secretary holding only that could not load the
positions to choose from. Each router now serves the list under its own
manage permission. Pinned:

* a meetings manager reads the department's positions from the meeting
  router, and a member without the permission is refused;
* the training router serves the same list under training.manage;
* only the caller's own department's positions are listed.
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
)

pytestmark = pytest.mark.integration

MEETINGS = "/api/v1/meetings/waiver-requests/policy/positions"
TRAINING = "/api/v1/training/waivers/requests/policy/positions"


@pytest.fixture
def as_user(db_session):
    """``as_user(member)`` -> a client signed in as that member, on the
    endpoint suite's app (including the whole API router is the slow part)."""
    _CURRENT["db"] = db_session

    def client(user) -> AsyncClient:
        _CURRENT["user"] = user
        return AsyncClient(transport=ASGITransport(app=_APP), base_url="http://test")

    yield client
    _CURRENT.clear()


@pytest.fixture
async def dept(db_session):
    org_id = await make_org(db_session)
    secretary_pos = await make_position(
        db_session, org_id, "Secretary", permissions=["meetings.manage"]
    )
    trainer_pos = await make_position(
        db_session, org_id, "Training Admin", permissions=["training.manage"]
    )
    other_org = await make_org(db_session)
    await make_position(db_session, other_org, "Elsewhere")
    secretary = await make_member(db_session, org_id, "Sally")
    trainer = await make_member(db_session, org_id, "Trent")
    member = await make_member(db_session, org_id, "Mo")
    await assign(db_session, secretary, secretary_pos)
    await assign(db_session, trainer, trainer_pos)
    await db_session.flush()
    return SimpleNamespace(
        secretary=await load(db_session, secretary),
        trainer=await load(db_session, trainer),
        member=await load(db_session, member),
        names={"Secretary", "Training Admin"},
    )


class TestMeetingRouter:
    async def test_a_meetings_manager_reads_the_positions(self, as_user, dept):
        async with as_user(dept.secretary) as client:
            resp = await client.get(MEETINGS)
        assert resp.status_code == 200, resp.text
        assert {p["name"] for p in resp.json()["positions"]} == dept.names

    async def test_a_member_without_meetings_manage_is_refused(self, as_user, dept):
        async with as_user(dept.member) as client:
            member = await client.get(MEETINGS)
        async with as_user(dept.trainer) as client:
            trainer = await client.get(MEETINGS)
        assert member.status_code == 403
        assert trainer.status_code == 403


class TestTrainingRouter:
    async def test_a_training_manager_reads_the_positions(self, as_user, dept):
        async with as_user(dept.trainer) as client:
            resp = await client.get(TRAINING)
        assert resp.status_code == 200, resp.text
        assert {p["name"] for p in resp.json()["positions"]} == dept.names

    async def test_a_meetings_manager_is_refused_on_the_training_router(
        self, as_user, dept
    ):
        async with as_user(dept.secretary) as client:
            resp = await client.get(TRAINING)
        assert resp.status_code == 403
