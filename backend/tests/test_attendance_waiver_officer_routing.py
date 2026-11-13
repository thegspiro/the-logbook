"""The President, and a named alternate for the Chief's own request.

Owner decisions of 2026-11-13:

- the President, like the Chief, may decide any member's request;
- the Chief's own request is decided by the President, and the President's by
  the Chief; the department's chosen positions and fallbacks do not apply;
- when the other office is vacant, the policy's named alternate decides;
- with no alternate either (or one who is no longer a current member), the
  request cannot be submitted, and the request form says why.

``_route_ids``, ``may_decide``, ``recipients`` and the decider queue are one
definition (CLAUDE.md pitfall #29), so each case checks all of them.
"""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.api.dependencies import get_current_user, get_request_enabled_modules
from app.api.v1.api import api_router
from app.core.database import get_db
from app.core.security_middleware import verify_csrf_token
from app.models.attendance_waiver import (
    AttendanceWaiverStatus,
    AttendanceWaiverWorkflow,
)
from app.schemas.attendance_waiver import AttendanceWaiverPolicy
from app.services import attendance_waiver_service as engine
from app.services.attendance_waiver_service import (
    AttendanceWaiverNotFound,
    AttendanceWaiverService,
)
from tests.waiver_request_support import (
    assign,
    load,
    make_meeting_event,
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

NOW = utc(2026, 11, 13, 15)
DRILL = utc(2026, 11, 20, 23)
NAMES = ("member", "officer", "chief", "president", "manager", "alt")

NO_PRESIDENT = (
    "No one can decide this request: your department has no President and no "
    "alternate is named in the waiver settings. Ask an officer to name one."
)
NO_CHIEF = NO_PRESIDENT.replace("no President", "no Chief")


@pytest.fixture(autouse=True)
def _clock(monkeypatch):
    monkeypatch.setattr(engine, "_now", lambda: NOW)


@pytest.fixture
async def dept(db_session):
    """A training officer as the chosen approver, a Chief, a President, a
    training manager, a plain member and a second plain member (``alt``) who
    can be named as the alternate; one linked drill."""
    org_id = await make_org(db_session)
    officer_pos = await make_position(db_session, org_id, "Training Officer")
    chief_pos = await make_position(db_session, org_id, "Chief", slug="fire_chief")
    president_pos = await make_position(
        db_session, org_id, "President", slug="president"
    )
    manager_pos = await make_position(
        db_session, org_id, "Training Admin", permissions=["training.manage"]
    )
    ids = {name: await make_member(db_session, org_id, name.title()) for name in NAMES}
    await assign(db_session, ids["officer"], officer_pos)
    await assign(db_session, ids["chief"], chief_pos)
    await assign(db_session, ids["president"], president_pos)
    await assign(db_session, ids["manager"], manager_pos)
    await set_policy(db_session, org_id, approver_position_ids=[officer_pos])
    requirement = await make_requirement(db_session, org_id)
    drill = await make_session(db_session, org_id, DRILL, link=[requirement])
    await db_session.flush()
    users = {name: await load(db_session, uid) for name, uid in ids.items()}
    return SimpleNamespace(
        org=org_id,
        officer_pos=officer_pos,
        chief_pos=chief_pos,
        president_pos=president_pos,
        drill=drill,
        ids=ids,
        **users,
    )


def _svc(db, workflow=AttendanceWaiverWorkflow.TRAINING_SESSION):
    return AttendanceWaiverService(db, workflow)


async def _submit(db, dept, who, event_id=None, workflow=None):
    service = _svc(db, workflow) if workflow else _svc(db)
    return await service.submit(dept.org, who, event_id or dept.drill, None, None)


async def _vacate(db, position_id):
    await db.execute(
        text("DELETE FROM user_positions WHERE position_id = :p"), {"p": position_id}
    )


async def _set_status(db, user_id, status):
    await db.execute(
        text("UPDATE users SET status = :s WHERE id = :id"),
        {"s": status, "id": user_id},
    )


async def _alternate(db, dept, who=None):
    await set_policy(
        db,
        dept.org,
        approver_position_ids=[dept.officer_pos],
        chief_alternate_user_id=(who or dept.alt).id,
    )


async def _routing(db, dept, request, service=None):
    """(recipients, deciders) by name, each through its own reader."""
    service = service or _svc(db)
    policy = await service.get_policy(dept.org)
    asked = {u.id for u in await service.recipients(dept.org, request, policy)}
    return (
        {n for n in NAMES if getattr(dept, n).id in asked},
        {
            n
            for n in NAMES
            if await service.may_decide(getattr(dept, n), request, policy)
        },
    )


async def _queue_agrees(db, dept, requests, service=None):
    """The decider queue lists exactly what may_decide allows, for everyone."""
    service = service or _svc(db)
    policy = await service.get_policy(dept.org)
    for name in NAMES:
        actor = getattr(dept, name)
        expected = {
            r.id for r in requests if await service.may_decide(actor, r, policy)
        }
        listed, total = await service.list_for_decider(dept.org, actor)
        assert {r.id for r in listed} == expected, name
        assert total == len(expected), name


class TestThePresidentDecides:
    async def test_a_members_request(self, db_session, dept):
        request = await _submit(db_session, dept, dept.member)
        asked, deciders = await _routing(db_session, dept, request)
        # Asked: the chosen position. May decide: it, the Chief, the President.
        assert asked == {"officer"}
        assert deciders == {"officer", "chief", "president"}
        approved = await _svc(db_session).approve(dept.org, dept.president, request.id)
        assert approved.status == AttendanceWaiverStatus.APPROVED

    async def test_the_decision_page_offers_it(self, db_session, dept):
        request = await _submit(db_session, dept, dept.member)
        [body] = await _svc(db_session).describe(dept.org, dept.president, [request])
        assert body["can_decide"] is True
        # The override stays the Chief's alone.
        assert body["can_override"] is False

    async def test_only_the_chief_overrides_a_denial(self, db_session, dept):
        request = await _submit(db_session, dept, dept.member)
        await _svc(db_session).deny(dept.org, dept.officer, request.id, "No")
        with pytest.raises(PermissionError, match="Only the Chief"):
            await _svc(db_session).chief_override(
                dept.org, dept.president, request.id, "Because"
            )


class TestTheOfficersOwnRequests:
    async def test_the_chiefs_goes_to_the_president(self, db_session, dept):
        request = await _submit(db_session, dept, dept.chief)
        assert await _routing(db_session, dept, request) == (
            {"president"},
            {"president"},
        )
        # The chosen position neither decides nor sees it.
        with pytest.raises(AttendanceWaiverNotFound):
            await _svc(db_session).approve(dept.org, dept.officer, request.id)
        approved = await _svc(db_session).approve(dept.org, dept.president, request.id)
        assert approved.status == AttendanceWaiverStatus.APPROVED

    async def test_the_presidents_goes_to_the_chief(self, db_session, dept):
        request = await _submit(db_session, dept, dept.president)
        assert await _routing(db_session, dept, request) == ({"chief"}, {"chief"})

    async def test_a_vacant_office_goes_to_the_alternate(self, db_session, dept):
        await _vacate(db_session, dept.president_pos)
        await _alternate(db_session, dept)
        request = await _submit(db_session, dept, dept.chief)
        assert await _routing(db_session, dept, request) == ({"alt"}, {"alt"})
        [body] = await _svc(db_session).describe(dept.org, dept.alt, [request])
        assert body["can_decide"] is True

    async def test_the_alternate_is_not_asked_while_the_office_is_held(
        self, db_session, dept
    ):
        await _alternate(db_session, dept)
        request = await _submit(db_session, dept, dept.chief)
        assert await _routing(db_session, dept, request) == (
            {"president"},
            {"president"},
        )
        # Nor about anyone else's request.
        other = await _submit(db_session, dept, dept.member)
        assert "alt" not in (await _routing(db_session, dept, other))[1]

    async def test_another_chief_does_not_decide_the_chiefs(self, db_session, dept):
        """The other office decides, so a second Chief is no substitute for a
        vacant President: the alternate is asked."""
        await _vacate(db_session, dept.president_pos)
        await assign(db_session, dept.ids["manager"], dept.chief_pos)
        await _alternate(db_session, dept)
        request = await _submit(db_session, dept, dept.chief)
        assert await _routing(db_session, dept, request) == ({"alt"}, {"alt"})

    async def test_holding_both_offices_goes_to_any_other_holder(
        self, db_session, dept
    ):
        await assign(db_session, dept.ids["chief"], dept.president_pos)
        chief = await load(db_session, dept.chief.id)
        request = await _submit(db_session, dept, chief)
        assert await _routing(db_session, dept, request) == (
            {"president"},
            {"president"},
        )

    async def test_the_queue_agrees_in_every_state(self, db_session, dept):
        requests = [
            await _submit(db_session, dept, getattr(dept, name))
            for name in ("member", "officer", "chief", "president", "manager")
        ]
        await _queue_agrees(db_session, dept, requests)
        await _alternate(db_session, dept)
        await _queue_agrees(db_session, dept, requests)
        await _vacate(db_session, dept.president_pos)
        await _queue_agrees(db_session, dept, requests)
        await set_policy(db_session, dept.org, chief_alternate_user_id=dept.alt.id)
        await _queue_agrees(db_session, dept, requests)

    async def test_a_business_meeting_routes_the_same_way(self, db_session, dept):
        clerk_pos = await make_position(db_session, dept.org, "Clerk")
        await assign(db_session, dept.ids["officer"], clerk_pos)
        await set_meeting_policy(
            db_session, dept.org, approver_position_ids=[clerk_pos]
        )
        meeting = await make_meeting_event(db_session, dept.org, DRILL)
        service = _svc(db_session, AttendanceWaiverWorkflow.BUSINESS_MEETING)
        request = await service.submit(dept.org, dept.chief, meeting, None, None)
        assert await _routing(db_session, dept, request, service) == (
            {"president"},
            {"president"},
        )
        theirs = await service.submit(dept.org, dept.member, meeting, None, None)
        assert (await _routing(db_session, dept, theirs, service))[1] == {
            "officer",
            "chief",
            "president",
        }


class TestNobodyToDecide:
    async def test_the_chief_is_told_and_cannot_submit(self, db_session, dept):
        await _vacate(db_session, dept.president_pos)
        result = await _svc(db_session).eligibility(dept.org, dept.chief, dept.drill)
        assert (result.allowed, result.refusal_code) == (False, "no_decider")
        assert result.refusal == NO_PRESIDENT
        assert result.as_response()["refusal"] == NO_PRESIDENT
        with pytest.raises(ValueError, match="No one can decide"):
            await _submit(db_session, dept, dept.chief)

    async def test_the_president_is_told_the_chief_is_missing(self, db_session, dept):
        await _vacate(db_session, dept.chief_pos)
        result = await _svc(db_session).eligibility(
            dept.org, dept.president, dept.drill
        )
        assert (result.refusal_code, result.refusal) == ("no_decider", NO_CHIEF)

    async def test_an_inactive_alternate_does_not_count(self, db_session, dept):
        await _vacate(db_session, dept.president_pos)
        await _alternate(db_session, dept)
        await _set_status(db_session, dept.alt.id, "inactive")
        result = await _svc(db_session).eligibility(dept.org, dept.chief, dept.drill)
        assert result.refusal_code == "no_decider"

    async def test_a_probationary_alternate_counts(self, db_session, dept):
        await _vacate(db_session, dept.president_pos)
        await _alternate(db_session, dept)
        await _set_status(db_session, dept.alt.id, "probationary")
        result = await _svc(db_session).eligibility(dept.org, dept.chief, dept.drill)
        assert result.allowed, result.refusal

    async def test_the_alternate_never_decides_their_own(self, db_session, dept):
        await _vacate(db_session, dept.president_pos)
        await _alternate(db_session, dept, who=dept.chief)
        result = await _svc(db_session).eligibility(dept.org, dept.chief, dept.drill)
        assert result.refusal_code == "no_decider"

    async def test_a_member_is_never_refused_for_it(self, db_session, dept):
        await _vacate(db_session, dept.president_pos)
        await _vacate(db_session, dept.chief_pos)
        result = await _svc(db_session).eligibility(dept.org, dept.member, dept.drill)
        assert result.allowed, result.refusal


class TestTheSetting:
    async def _save(self, db, dept, alternate_id):
        policy = AttendanceWaiverPolicy(
            enabled=True,
            approver_position_ids=[dept.officer_pos],
            chief_alternate_user_id=alternate_id,
        )
        return await _svc(db).save_policy(dept.org, policy, dept.manager)

    async def test_a_current_member_is_saved(self, db_session, dept):
        saved = await self._save(db_session, dept, dept.alt.id)
        assert saved.chief_alternate_user_id == dept.alt.id
        stored = await _svc(db_session).get_policy(dept.org)
        assert stored.chief_alternate_user_id == dept.alt.id

    async def test_an_inactive_member_is_refused(self, db_session, dept):
        await _set_status(db_session, dept.alt.id, "inactive")
        with pytest.raises(ValueError, match="current member"):
            await self._save(db_session, dept, dept.alt.id)

    async def test_another_departments_member_is_refused(self, db_session, dept):
        elsewhere = await make_org(db_session)
        stranger = await make_member(db_session, elsewhere, "Zed")
        with pytest.raises(ValueError, match="current member"):
            await self._save(db_session, dept, stranger)

    async def test_the_options_report_a_lapsed_alternate(self, db_session, dept):
        await _alternate(db_session, dept)
        options = await _svc(db_session).alternate_options(dept.org)
        assert options["alternate"] == {
            "id": dept.alt.id,
            "name": dept.alt.display_name,
            "current": True,
        }
        await _set_status(db_session, dept.alt.id, "inactive")
        options = await _svc(db_session).alternate_options(dept.org)
        assert options["alternate"]["current"] is False
        assert dept.alt.id not in {m["id"] for m in options["members"]}
        assert dept.member.id in {m["id"] for m in options["members"]}


# Built once, like the endpoint tests: the whole router, so the route order in
# api.py is under test too (``/policy/alternate`` beside ``/{request_id}``).
_CURRENT: dict = {}
_APP = FastAPI()
_APP.include_router(api_router, prefix="/api/v1")
_APP.dependency_overrides[get_current_user] = lambda: _CURRENT["user"]
_APP.dependency_overrides[get_db] = lambda: _CURRENT["db"]
_APP.dependency_overrides[verify_csrf_token] = lambda: None
_APP.dependency_overrides[get_request_enabled_modules] = lambda: None


class TestTheOptionsRoute:
    @pytest.mark.parametrize(
        "base",
        ["/api/v1/training/waivers/requests", "/api/v1/meetings/waiver-requests"],
    )
    async def test_needs_the_manage_permission(self, db_session, dept, base):
        _CURRENT["db"] = db_session
        transport = ASGITransport(app=_APP)
        try:
            _CURRENT["user"] = dept.member
            async with AsyncClient(transport=transport, base_url="http://t") as c:
                refused = await c.get(f"{base}/policy/alternate")
            assert refused.status_code == 403
            if "training" in base:
                _CURRENT["user"] = dept.manager
                async with AsyncClient(transport=transport, base_url="http://t") as c:
                    answered = await c.get(f"{base}/policy/alternate")
                assert answered.status_code == 200, answered.text
                assert dept.alt.id in {m["id"] for m in answered.json()["members"]}
                assert answered.json()["alternate"] is None
        finally:
            _CURRENT.clear()
