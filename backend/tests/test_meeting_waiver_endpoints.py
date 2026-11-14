"""The business-meeting waiver routes, and the Secretary's grant, over HTTP.

Mounted through ``api_router``, so the include order is under test: the
meetings router's ``/{meeting_id}`` must not claim ``/meetings/waiver-requests``.

Also pins defect D7: the Secretary's grant took ``user_id`` and ``reason`` as
query parameters while the client sent a JSON body, so the call failed (422)
and the only way to make it work put the reason in the URL, and it was
written into the audit log. It now takes a JSON body, and the reason is in
neither.
"""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.dependencies import get_current_user, get_request_enabled_modules
from app.api.v1.api import api_router
from app.api.v1.endpoints import meeting_waiver_requests, meetings
from app.core.database import get_db
from app.core.security_middleware import verify_csrf_token
from app.models.audit import AuditLog
from app.models.meeting import MeetingAttendee
from app.services import attendance_waiver_service as engine
from tests.waiver_request_support import (
    assign,
    load,
    make_meeting_event,
    make_member,
    make_minutes_record,
    make_org,
    make_position,
    set_meeting_policy,
    utc,
)

pytestmark = pytest.mark.integration

NOW = utc(2026, 11, 10, 12)
MEETING = utc(2026, 11, 21, 0)
BASE = "/api/v1/meetings/waiver-requests"


@pytest.fixture(autouse=True)
def _clock(monkeypatch):
    monkeypatch.setattr(engine, "_now", lambda: NOW)


@pytest.fixture
async def dept(db_session):
    org_id = await make_org(db_session)
    secretary_pos = await make_position(
        db_session,
        org_id,
        "Secretary",
        slug="secretary",
        permissions=["meetings.manage"],
    )
    chief_pos = await make_position(db_session, org_id, "Chief", slug="fire_chief")
    ids = {
        name: await make_member(db_session, org_id, name.title())
        for name in ("member", "other", "secretary", "chief")
    }
    await assign(db_session, ids["secretary"], secretary_pos)
    await assign(db_session, ids["chief"], chief_pos)
    await set_meeting_policy(db_session, org_id)
    meeting = await make_meeting_event(db_session, org_id, MEETING)
    users = {name: await load(db_session, uid) for name, uid in ids.items()}
    return SimpleNamespace(org=org_id, meeting=meeting, ids=ids, **users)


_CURRENT: dict = {}
_APP = FastAPI()
_APP.include_router(api_router, prefix="/api/v1")
_APP.dependency_overrides[get_current_user] = lambda: _CURRENT["user"]
_APP.dependency_overrides[get_db] = lambda: _CURRENT["db"]
_APP.dependency_overrides[verify_csrf_token] = lambda: None
_APP.dependency_overrides[get_request_enabled_modules] = lambda: None


@pytest.fixture
def as_user(db_session):
    _CURRENT["db"] = db_session

    def client(user) -> AsyncClient:
        _CURRENT["user"] = user
        return AsyncClient(transport=ASGITransport(app=_APP), base_url="http://test")

    yield client
    _CURRENT.clear()


class TestRouterOrder:
    def test_the_request_routes_are_mounted_before_the_meetings_router(self):
        def mounted_at(router) -> int:
            for index, route in enumerate(api_router.routes):
                if getattr(route, "original_router", None) is router:
                    return index
            raise AssertionError(f"{router} is not included in api_router")

        assert mounted_at(meeting_waiver_requests.router) < mounted_at(meetings.router)

    async def test_each_path_reaches_its_own_handler(self, as_user, dept):
        async with as_user(dept.member) as client:
            policy = await client.get(f"{BASE}/policy")
            mine = await client.get(f"{BASE}/mine")
            queue = await client.get(BASE)
        assert policy.status_code == 200, policy.text
        assert policy.json()["enabled"] is True
        assert mine.json() == []
        assert queue.json()["total"] == 0


class TestRoutes:
    async def test_policy_save_needs_meetings_manage(self, as_user, dept):
        body = {"enabled": True, "cap": 2, "deadline": "24h_after_end"}
        async with as_user(dept.chief) as client:
            refused = await client.put(f"{BASE}/policy", json=body)
        async with as_user(dept.secretary) as client:
            saved = await client.put(f"{BASE}/policy", json=body)
        assert refused.status_code == 403
        assert saved.status_code == 200, saved.text
        assert saved.json()["cap"] == 2

    async def test_submit_decide_and_read(self, as_user, dept):
        async with as_user(dept.member) as client:
            eligibility = await client.get(
                f"{BASE}/eligibility", params={"event_id": dept.meeting}
            )
            created = await client.post(
                BASE, json={"event_id": dept.meeting, "reason": "Working late"}
            )
        assert eligibility.json()["allowed"] is True
        assert created.status_code == 201, created.text
        body = created.json()
        assert body["workflow"] == "business_meeting"
        request_id = body["id"]

        async with as_user(dept.other) as client:
            hidden = await client.get(f"{BASE}/{request_id}")
        assert hidden.status_code == 404

        async with as_user(dept.member) as client:
            own = await client.post(f"{BASE}/{request_id}/approve", json={})
        assert own.status_code == 403

        async with as_user(dept.secretary) as client:
            queue = await client.get(BASE, params={"status": "pending"})
            approved = await client.post(f"{BASE}/{request_id}/approve", json={})
        assert queue.json()["total"] == 1
        assert approved.status_code == 200, approved.text
        assert approved.json()["status"] == "approved"

    async def test_a_training_request_route_does_not_serve_it(self, as_user, dept):
        async with as_user(dept.member) as client:
            created = await client.post(BASE, json={"event_id": dept.meeting})
            via_training = await client.get(
                f"/api/v1/training/waivers/requests/{created.json()['id']}"
            )
        assert via_training.status_code == 404

    async def test_deny_then_chief_override(self, as_user, dept):
        async with as_user(dept.member) as client:
            created = await client.post(BASE, json={"event_id": dept.meeting})
        request_id = created.json()["id"]
        async with as_user(dept.secretary) as client:
            await client.post(f"{BASE}/{request_id}/deny", json={"note": "No"})
            refused = await client.post(
                f"{BASE}/{request_id}/override", json={"note": "Try"}
            )
        async with as_user(dept.chief) as client:
            overridden = await client.post(
                f"{BASE}/{request_id}/override", json={"note": "Verified"}
            )
        assert refused.status_code == 403
        assert overridden.json()["chief_override"] is True

    async def test_withdraw(self, as_user, dept):
        async with as_user(dept.member) as client:
            created = await client.post(BASE, json={"event_id": dept.meeting})
            withdrawn = await client.post(f"{BASE}/{created.json()['id']}/withdraw")
        assert withdrawn.json()["status"] == "withdrawn"


class TestSecretaryGrantD7:
    async def test_takes_a_json_body(self, as_user, db_session, dept):
        meeting_id = await make_minutes_record(
            db_session, dept.org, dept.ids["secretary"]
        )
        async with as_user(dept.secretary) as client:
            resp = await client.post(
                f"/api/v1/meetings/{meeting_id}/attendance-waiver",
                json={"user_id": dept.ids["member"], "reason": "Hospital stay"},
            )
        assert resp.status_code == 200, resp.text
        attendee = (
            await db_session.execute(
                select(MeetingAttendee).where(
                    MeetingAttendee.meeting_id == meeting_id,
                    MeetingAttendee.user_id == dept.ids["member"],
                )
            )
        ).scalar_one()
        assert attendee.waiver_reason == "Hospital stay"
        assert attendee.present is False

    async def test_query_parameters_are_not_accepted(self, as_user, db_session, dept):
        meeting_id = await make_minutes_record(
            db_session, dept.org, dept.ids["secretary"]
        )
        async with as_user(dept.secretary) as client:
            resp = await client.post(
                f"/api/v1/meetings/{meeting_id}/attendance-waiver",
                params={"user_id": dept.ids["member"], "reason": "Hospital stay"},
            )
        assert resp.status_code == 422

    async def test_the_reason_stays_out_of_the_audit_log(
        self, as_user, db_session, dept
    ):
        meeting_id = await make_minutes_record(
            db_session, dept.org, dept.ids["secretary"]
        )
        async with as_user(dept.secretary) as client:
            resp = await client.post(
                f"/api/v1/meetings/{meeting_id}/attendance-waiver",
                json={"user_id": dept.ids["member"], "reason": "Hospital stay"},
            )
        assert resp.status_code == 200, resp.text
        audit = (
            await db_session.execute(
                select(AuditLog).where(
                    AuditLog.event_type == "meeting_attendance_waiver_granted",
                    AuditLog.event_data["meeting_id"].as_string() == meeting_id,
                )
            )
        ).scalar_one()
        assert audit.event_data["user_id"] == dept.ids["member"]
        assert "reason" not in audit.event_data
        assert "Hospital stay" not in str(audit.event_data)

    async def test_a_short_reason_is_refused(self, as_user, db_session, dept):
        meeting_id = await make_minutes_record(
            db_session, dept.org, dept.ids["secretary"]
        )
        async with as_user(dept.secretary) as client:
            resp = await client.post(
                f"/api/v1/meetings/{meeting_id}/attendance-waiver",
                json={"user_id": dept.ids["member"], "reason": "   ab   "},
            )
        assert resp.status_code == 422

    async def test_needs_meetings_manage(self, as_user, db_session, dept):
        meeting_id = await make_minutes_record(
            db_session, dept.org, dept.ids["secretary"]
        )
        async with as_user(dept.member) as client:
            resp = await client.post(
                f"/api/v1/meetings/{meeting_id}/attendance-waiver",
                json={"user_id": dept.ids["other"], "reason": "Hospital stay"},
            )
        assert resp.status_code == 403
