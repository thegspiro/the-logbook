"""The session waiver request routes, over HTTP through the real API router.

The happy path of every route and the refusals each one owes: 403 for the
policy save without training.manage, for deciding one's own request, for a
non-Chief override and for withdrawing someone else's; 404 for a request the
caller may neither see nor decide; 400 for what the policy refuses.

Mounted through ``api_router`` rather than the endpoint module alone, so the
router order in ``api.py`` is under test: ``/training/waivers/{waiver_id}``
must not swallow ``/training/waivers/requests/...``.
"""

from datetime import timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import get_current_user, get_request_enabled_modules
from app.api.v1.api import api_router
from app.api.v1.endpoints import attendance_waiver_requests, training_waivers
from app.core.database import get_db
from app.core.security_middleware import verify_csrf_token
from app.services import attendance_waiver_service as engine
from tests.waiver_request_support import (
    assign,
    load,
    make_member,
    make_org,
    make_position,
    make_requirement,
    make_session,
    set_policy,
    utc,
)

pytestmark = pytest.mark.integration

NOW = utc(2026, 11, 10, 12)
DRILL = utc(2026, 11, 20, 23)
BASE = "/api/v1/training/waivers/requests"


@pytest.fixture(autouse=True)
def _clock(monkeypatch):
    monkeypatch.setattr(engine, "_now", lambda: NOW)


@pytest.fixture
async def dept(db_session):
    org_id = await make_org(db_session)
    officer_pos = await make_position(db_session, org_id, "Training Officer")
    chief_pos = await make_position(db_session, org_id, "Chief", slug="fire_chief")
    manager_pos = await make_position(
        db_session, org_id, "Training Admin", permissions=["training.manage"]
    )
    ids = {
        name: await make_member(db_session, org_id, name.title())
        for name in ("member", "other", "officer", "chief", "manager")
    }
    await assign(db_session, ids["officer"], officer_pos)
    await assign(db_session, ids["chief"], chief_pos)
    await assign(db_session, ids["manager"], manager_pos)
    await set_policy(db_session, org_id, approver_position_ids=[officer_pos])
    requirement = await make_requirement(db_session, org_id)
    drill = await make_session(db_session, org_id, DRILL, link=[requirement])
    second = await make_session(
        db_session, org_id, DRILL + timedelta(days=7), link=[requirement]
    )
    users = {name: await load(db_session, uid) for name, uid in ids.items()}
    return SimpleNamespace(
        org=org_id,
        officer_pos=officer_pos,
        drill=drill,
        second=second,
        **users,
    )


# Built once: including the whole API router is the slow part.
_CURRENT: dict = {}
_APP = FastAPI()
_APP.include_router(api_router, prefix="/api/v1")
_APP.dependency_overrides[get_current_user] = lambda: _CURRENT["user"]
_APP.dependency_overrides[get_db] = lambda: _CURRENT["db"]
_APP.dependency_overrides[verify_csrf_token] = lambda: None
_APP.dependency_overrides[get_request_enabled_modules] = lambda: None


@pytest.fixture
def as_user(db_session):
    """``as_user(member)`` -> a client signed in as that member."""
    _CURRENT["db"] = db_session

    def client(user) -> AsyncClient:
        _CURRENT["user"] = user
        return AsyncClient(transport=ASGITransport(app=_APP), base_url="http://test")

    yield client
    _CURRENT.clear()


async def _submit(as_user, member, event_id, **body):
    async with as_user(member) as client:
        return await client.post(BASE, json={"event_id": event_id, **body})


class TestPolicy:
    async def test_every_member_reads_it(self, as_user, dept):
        async with as_user(dept.member) as client:
            resp = await client.get(f"{BASE}/policy")
        assert resp.status_code == 200, resp.text
        assert resp.json()["enabled"] is True
        assert resp.json()["approver_position_ids"] == [dept.officer_pos]

    async def test_saving_needs_training_manage(self, as_user, dept):
        body = {"enabled": True, "cap": 3, "categories": ["Medical"]}
        async with as_user(dept.officer) as client:
            refused = await client.put(f"{BASE}/policy", json=body)
        assert refused.status_code == 403
        async with as_user(dept.manager) as client:
            saved = await client.put(f"{BASE}/policy", json=body)
            read = await client.get(f"{BASE}/policy")
        assert saved.status_code == 200, saved.text
        assert read.json()["cap"] == 3

    async def test_a_bad_policy_is_refused(self, as_user, dept):
        async with as_user(dept.manager) as client:
            foreign = await client.put(
                f"{BASE}/policy",
                json={"enabled": True, "approver_position_ids": ["not-ours"]},
            )
            invalid = await client.put(
                f"{BASE}/policy", json={"enabled": True, "cap": 0}
            )
        assert foreign.status_code == 400
        assert foreign.json()["detail"] == "Invalid position"
        assert invalid.status_code == 422


class TestAsking:
    async def test_eligibility(self, as_user, dept):
        async with as_user(dept.member) as client:
            ok = await client.get(
                f"{BASE}/eligibility", params={"event_id": dept.drill}
            )
            missing = await client.get(
                f"{BASE}/eligibility", params={"event_id": "no-such-event"}
            )
        assert ok.status_code == 200, ok.text
        body = ok.json()
        assert body["allowed"] is True
        assert body["session_date"] == "2026-11-20"
        assert body["deadline"].startswith("2026-11-20T23:00:00")
        assert missing.status_code == 404

    async def test_submit_then_mine(self, as_user, dept):
        resp = await _submit(as_user, dept.member, dept.drill, reason="Sick")
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert (body["status"], body["reason"], body["can_withdraw"]) == (
            "pending",
            "Sick",
            True,
        )
        assert [a["action"] for a in body["actions"]] == ["submitted"]

        again = await _submit(as_user, dept.member, dept.drill)
        assert again.status_code == 400
        assert "already asked" in again.json()["detail"]

        async with as_user(dept.member) as client:
            mine = await client.get(f"{BASE}/mine")
        assert [r["id"] for r in mine.json()] == [body["id"]]

    async def test_withdraw_is_the_members_alone(self, as_user, dept):
        request_id = (await _submit(as_user, dept.member, dept.drill)).json()["id"]
        async with as_user(dept.officer) as client:
            assert (
                await client.post(f"{BASE}/{request_id}/withdraw")
            ).status_code == 403
        async with as_user(dept.other) as client:
            assert (
                await client.post(f"{BASE}/{request_id}/withdraw")
            ).status_code == 404
        async with as_user(dept.member) as client:
            resp = await client.post(f"{BASE}/{request_id}/withdraw")
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "withdrawn"


class TestDeciding:
    async def test_the_queue_and_one_request(self, as_user, dept):
        request_id = (
            await _submit(as_user, dept.member, dept.drill, reason="Sick")
        ).json()["id"]

        async with as_user(dept.officer) as client:
            queue = await client.get(BASE, params={"status": "pending"})
            detail = await client.get(f"{BASE}/{request_id}")
        assert queue.status_code == 200, queue.text
        assert queue.json()["total"] == 1
        assert queue.json()["items"][0]["reason"] == "Sick"
        assert detail.json()["can_decide"] is True

        async with as_user(dept.other) as client:
            empty = await client.get(BASE)
            hidden = await client.get(f"{BASE}/{request_id}")
        assert empty.json()["total"] == 0
        assert hidden.status_code == 404

    async def test_approve(self, as_user, dept):
        request_id = (await _submit(as_user, dept.member, dept.drill)).json()["id"]
        async with as_user(dept.other) as client:
            assert (
                await client.post(f"{BASE}/{request_id}/approve", json={})
            ).status_code == 404
        async with as_user(dept.officer) as client:
            resp = await client.post(
                f"{BASE}/{request_id}/approve", json={"note": "Get well"}
            )
            twice = await client.post(f"{BASE}/{request_id}/approve", json={})
        assert resp.status_code == 200, resp.text
        assert (resp.json()["status"], resp.json()["decided_by"]) == (
            "approved",
            dept.officer.id,
        )
        assert twice.status_code == 400

    async def test_nobody_decides_their_own(self, as_user, dept):
        request_id = (await _submit(as_user, dept.officer, dept.drill)).json()["id"]
        async with as_user(dept.officer) as client:
            resp = await client.post(f"{BASE}/{request_id}/deny", json={})
        assert resp.status_code == 403

    async def test_deny_then_the_chief_overrides(self, as_user, dept):
        request_id = (await _submit(as_user, dept.member, dept.drill)).json()["id"]
        async with as_user(dept.officer) as client:
            denied = await client.post(
                f"{BASE}/{request_id}/deny", json={"note": "Too late"}
            )
            not_chief = await client.post(
                f"{BASE}/{request_id}/override", json={"note": "Because"}
            )
        assert denied.json()["status"] == "denied"
        assert not_chief.status_code == 403

        async with as_user(dept.chief) as client:
            blank = await client.post(
                f"{BASE}/{request_id}/override", json={"note": "  "}
            )
            resp = await client.post(
                f"{BASE}/{request_id}/override", json={"note": "Family emergency"}
            )
        assert blank.status_code == 400
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert (body["status"], body["chief_override"]) == ("approved", True)
        assert [a["action"] for a in body["actions"]] == [
            "submitted",
            "denied",
            "chief_override",
        ]


class TestRouterOrder:
    def test_the_request_routes_are_mounted_first(self):
        """Starlette takes a full match over a method-only one, and
        training_waivers has only PATCH and DELETE on ``/{waiver_id}``, so
        today the include order changes nothing the request below can see.
        It starts to matter the day that router gains a GET or POST there,
        which would then answer ``/training/waivers/requests`` itself."""

        def mounted_at(router) -> int:
            for index, route in enumerate(api_router.routes):
                if getattr(route, "original_router", None) is router:
                    return index
            raise AssertionError(f"{router} is not included in api_router")

        assert mounted_at(attendance_waiver_requests.router) < mounted_at(
            training_waivers.router
        )

    async def test_the_waiver_routes_do_not_swallow_the_request_routes(
        self, as_user, dept
    ):
        """Every request path reaches its own handler, and the officer-only
        waiver routes beside them still answer at their own paths."""
        async with as_user(dept.member) as client:
            created = await client.post(BASE, json={"event_id": dept.drill})
            mine = await client.get(f"{BASE}/mine")
            policy = await client.get(f"{BASE}/policy")
            own_waivers = await client.get("/api/v1/training/waivers/me")
        assert created.status_code == 201, created.text
        assert mine.status_code == 200
        assert isinstance(mine.json(), list)
        assert policy.status_code == 200
        assert "deadline" in policy.json()
        assert own_waivers.status_code == 200
        assert own_waivers.json() == []
