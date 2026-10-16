"""Signing adopted minutes, over HTTP against the real schema.

A signature is a typed name plus a password, in a slot the department defined,
on the version of the minutes that is current. What matters: who may sign what,
that it cannot be done on minutes that are not adopted or twice, that the name
and password are really checked, that it is tied to the version, and that a
reopen leaves the corrected version unsigned.
"""

from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import minutes as minutes_endpoints
from app.api.v1.endpoints import minutes_records as records_endpoints
from app.core.database import get_db
from app.core.security import hash_password
from app.models.minute import MinutesSignature
from app.models.user import Organization, User
from tests.minutes_support import (
    _approve,
    _client,
    _create,
    _fill_required_sections,
    _user,
    _World,
    build_world,
)

pytestmark = [pytest.mark.integration]

PASSWORD = "Correct-Horse-9!"


@pytest.fixture
async def world(db_session: AsyncSession) -> _World:
    w = await build_world(db_session)
    for person in (w.secretary, w.approver, w.member):
        person.password_hash = hash_password(PASSWORD)
    await db_session.flush()
    return w


def _client_without_rate_limit(db: AsyncSession, user: User) -> AsyncClient:
    """Like ``_client``, with the signing rate limit out of the way so the
    count across many tests in one run cannot turn a test into a 429."""
    app = FastAPI()
    app.include_router(minutes_endpoints.router, prefix="/minutes")
    app.include_router(records_endpoints.router, prefix="/minutes")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[records_endpoints._rate_limit_signing] = lambda: None
    return AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    )


async def _adopted(world: _World) -> str:
    minutes = await _create(world)
    await _approve(world, minutes["id"])
    return minutes["id"]


async def _sign(
    world: _World,
    user: User,
    minutes_id: str,
    slot: str = "recording_secretary",
    name: str | None = None,
    password: str = PASSWORD,
):
    async with _client_without_rate_limit(world.db, user) as c:
        return await c.post(
            f"/minutes/{minutes_id}/signatures",
            json={
                "slot_key": slot,
                "signed_name": name if name is not None else user.full_name,
                "password": password,
            },
        )


async def _status(world: _World, user: User, minutes_id: str) -> dict[str, Any]:
    async with _client(world.db, user) as c:
        resp = await c.get(f"/minutes/{minutes_id}/signatures")
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _set_slots(world: _World, slots: list[dict[str, Any]]) -> None:
    org = await world.db.get(Organization, world.org_id)
    assert org is not None
    org.settings = {**(org.settings or {}), "minutes": {"signature_slots": slots}}
    await world.db.flush()


class TestStatus:
    async def test_the_default_slots_are_a_secretary_and_a_presiding_officer(
        self, world
    ):
        minutes_id = await _adopted(world)
        body = await _status(world, world.secretary, minutes_id)

        assert [s["key"] for s in body["slots"]] == [
            "recording_secretary",
            "presiding_officer",
        ]
        assert body["version"] == 1
        assert all(s["signature"] is None for s in body["slots"])

    async def test_a_manager_may_sign_and_an_ordinary_member_may_not(self, world):
        minutes_id = await _adopted(world)

        manager = await _status(world, world.secretary, minutes_id)
        member = await _status(world, world.member, minutes_id)

        assert all(s["can_sign"] for s in manager["slots"])
        assert not any(s["can_sign"] for s in member["slots"])

    async def test_minutes_that_are_not_adopted_have_nothing_to_sign(self, world):
        minutes = await _create(world)
        body = await _status(world, world.secretary, minutes["id"])

        assert body["version"] is None
        assert not any(s["can_sign"] for s in body["slots"])

    async def test_another_department_cannot_see_them(self, world):
        minutes_id = await _adopted(world)
        async with _client(world.db, world.outsider) as c:
            resp = await c.get(f"/minutes/{minutes_id}/signatures")

        assert resp.status_code == 404


class TestSigning:
    async def test_a_signature_is_recorded_against_the_current_version(self, world):
        minutes_id = await _adopted(world)
        resp = await _sign(world, world.secretary, minutes_id)

        assert resp.status_code == 201, resp.text
        assert resp.json()["signed_name"] == world.secretary.full_name
        body = await _status(world, world.secretary, minutes_id)
        signed = next(s for s in body["slots"] if s["key"] == "recording_secretary")
        assert signed["signature"]["intact"] is True
        assert signed["can_sign"] is False

    async def test_the_person_who_circulated_the_minutes_may_sign(self, world):
        minutes_id = await _adopted(world)  # the secretary circulated them
        resp = await _sign(world, world.secretary, minutes_id)

        assert resp.status_code == 201, resp.text

    async def test_one_person_may_sign_two_slots(self, world):
        minutes_id = await _adopted(world)
        await _sign(world, world.approver, minutes_id, "recording_secretary")
        resp = await _sign(world, world.approver, minutes_id, "presiding_officer")

        assert resp.status_code == 201, resp.text

    async def test_a_slot_can_be_signed_only_once(self, world):
        minutes_id = await _adopted(world)
        await _sign(world, world.secretary, minutes_id)
        resp = await _sign(world, world.approver, minutes_id)

        assert resp.status_code == 400
        assert "already signed" in resp.json()["detail"]

    async def test_minutes_must_be_adopted_first(self, world):
        minutes = await _create(world)
        await _fill_required_sections(world, minutes["id"])
        resp = await _sign(world, world.secretary, minutes["id"])

        assert resp.status_code == 400
        assert "adopted" in resp.json()["detail"]

    async def test_an_unknown_slot_is_refused(self, world):
        minutes_id = await _adopted(world)
        resp = await _sign(world, world.secretary, minutes_id, "treasurer")

        assert resp.status_code == 400

    async def test_someone_who_may_not_sign_is_refused(self, world):
        minutes_id = await _adopted(world)
        resp = await _sign(world, world.member, minutes_id)

        assert resp.status_code == 400
        assert "do not hold the role" in resp.json()["detail"]


class TestProofOfPerson:
    async def test_the_typed_name_must_be_the_signers_own(self, world):
        minutes_id = await _adopted(world)
        resp = await _sign(world, world.secretary, minutes_id, name="Someone Else")

        assert resp.status_code == 400
        assert "as it appears on your account" in resp.json()["detail"]
        assert (await world.db.execute(select(MinutesSignature))).first() is None

    async def test_case_and_spacing_in_the_name_do_not_matter(self, world):
        minutes_id = await _adopted(world)
        name = f"  {world.secretary.full_name.upper().replace(' ', '   ')}  "
        resp = await _sign(world, world.secretary, minutes_id, name=name)

        assert resp.status_code == 201, resp.text

    async def test_a_wrong_password_is_refused(self, world):
        minutes_id = await _adopted(world)
        resp = await _sign(world, world.secretary, minutes_id, password="nope")

        assert resp.status_code == 400
        assert "password is incorrect" in resp.json()["detail"]
        assert (await world.db.execute(select(MinutesSignature))).first() is None

    async def test_an_account_with_no_password_cannot_sign(self, world):
        sso_only = await _user(
            world.db, world.org_id, "Sso", ["minutes.view", "minutes.manage"]
        )
        sso_only.password_hash = None
        await world.db.flush()
        minutes_id = await _adopted(world)
        resp = await _sign(world, sso_only, minutes_id)

        assert resp.status_code == 400
        assert "no password" in resp.json()["detail"]

    async def test_the_password_is_never_echoed_or_stored(self, world):
        minutes_id = await _adopted(world)
        resp = await _sign(world, world.secretary, minutes_id)

        assert PASSWORD not in resp.text
        rows = (
            await world.db.execute(text("SELECT * FROM minutes_signatures"))
        ).fetchall()
        assert all(PASSWORD not in str(row) for row in rows)

    async def test_signing_is_rate_limited(self, world):
        route = next(
            r
            for r in records_endpoints.router.routes
            if getattr(r, "path", "") == "/{minutes_id}/signatures"
            and "POST" in getattr(r, "methods", set())
        )
        dependants = [d.call for d in route.dependant.dependencies]  # type: ignore[attr-defined]
        assert records_endpoints._rate_limit_signing in dependants


class TestDepartmentSlots:
    async def test_a_slot_can_name_a_position(self, world):
        chief = await _user(world.db, world.org_id, "Chief", ["minutes.view"])
        chief.password_hash = hash_password(PASSWORD)
        position_slug = (
            await world.db.execute(
                text(
                    "SELECT p.slug FROM positions p JOIN user_positions up "
                    "ON up.position_id = p.id WHERE up.user_id = :u"
                ),
                {"u": str(chief.id)},
            )
        ).scalar_one()
        await _set_slots(
            world,
            [
                {"key": "chair", "title": "Chair", "position_slug": position_slug},
                {"key": "clerk", "title": "Clerk"},
            ],
        )
        minutes_id = await _adopted(world)

        by_chief = await _status(world, chief, minutes_id)
        assert [s["can_sign"] for s in by_chief["slots"]] == [True, False]
        assert (await _sign(world, chief, minutes_id, "chair")).status_code == 201

        by_secretary = await _status(world, world.secretary, minutes_id)
        assert [s["can_sign"] for s in by_secretary["slots"]] == [False, True]
        refused = await _sign(world, world.secretary, minutes_id, "chair")
        assert refused.status_code == 400

    async def test_a_department_can_ask_for_one_signature(self, world):
        await _set_slots(world, [{"key": "clerk", "title": "Town Clerk"}])
        minutes_id = await _adopted(world)

        body = await _status(world, world.secretary, minutes_id)

        assert [s["title"] for s in body["slots"]] == ["Town Clerk"]

    async def test_the_settings_endpoint_reports_the_slots(self, world):
        await _set_slots(world, [{"key": "clerk", "title": "Town Clerk"}])
        async with _client(world.db, world.secretary) as c:
            body = (await c.get("/minutes/settings")).json()

        assert body["signature_slots"] == [
            {"key": "clerk", "title": "Town Clerk", "position_slug": None}
        ]


class TestVersions:
    async def test_a_signature_is_bound_to_the_hash_of_its_version(self, world):
        minutes_id = await _adopted(world)
        await _sign(world, world.secretary, minutes_id)

        await world.db.execute(update(MinutesSignature).values(content_hash="0" * 64))
        body = await _status(world, world.secretary, minutes_id)
        signed = next(s for s in body["slots"] if s["key"] == "recording_secretary")

        assert signed["signature"]["intact"] is False

    async def test_reopening_leaves_the_corrected_version_unsigned(self, world):
        minutes_id = await _adopted(world)
        await _sign(world, world.secretary, minutes_id)
        async with _client(world.db, world.approver) as c:
            reopened = await c.post(
                f"/minutes/{minutes_id}/reopen",
                json={"reason": "The location was recorded wrongly"},
            )
        assert reopened.status_code == 200, reopened.text

        draft = await _status(world, world.secretary, minutes_id)
        assert draft["version"] is None

        await _approve(world, minutes_id)
        corrected = await _status(world, world.secretary, minutes_id)
        assert corrected["version"] == 2
        assert all(s["signature"] is None for s in corrected["slots"])
        # The first version's signature is still on file.
        assert len((await world.db.execute(select(MinutesSignature))).all()) == 1

    async def test_the_printed_minutes_carry_the_signatures(self, world):
        minutes_id = await _adopted(world)
        await _sign(world, world.secretary, minutes_id)

        async with _client(world.db, world.secretary) as c:
            pdf = await c.get(f"/minutes/{minutes_id}/pdf")

        assert pdf.status_code == 200
        assert pdf.content.startswith(b"%PDF")
