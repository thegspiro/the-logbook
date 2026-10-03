"""
`GET|PUT /users/me/bottom-navigation` — a member's own choice of the two
configurable tabs on the phone bottom bar, and the same value on `/auth/me`.

Self-scoped by construction, like the profile-visibility routes: there is no
user id in the path, so there is nothing to point at another member's bar.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pydantic
import pytest
from sqlalchemy import select

from app.api.v1.endpoints.auth import _build_current_user_dict
from app.api.v1.endpoints.users import (
    get_my_bottom_navigation,
    router,
    set_my_bottom_navigation,
)
from app.models.user import Organization, User
from app.schemas.user import BottomNavigationPreference, normalize_bottom_nav_slots


def _caller(bottom_nav_slots: object = None) -> SimpleNamespace:
    return SimpleNamespace(
        id=str(uuid.uuid4()),
        organization_id=str(uuid.uuid4()),
        bottom_nav_slots=bottom_nav_slots,
    )


def _db() -> MagicMock:
    db = MagicMock()
    db.commit = AsyncMock()
    return db


@pytest.mark.unit
class TestNormalize:
    def test_never_chosen_is_none(self):
        assert normalize_bottom_nav_slots(None) is None

    def test_stored_choice_is_kept_in_order(self):
        assert normalize_bottom_nav_slots(["/members", "/account"]) == [
            "/members",
            "/account",
        ]

    @pytest.mark.parametrize("stored", [{}, "/events", 3, [], [None, 7]])
    def test_malformed_value_reads_as_never_chosen(self, stored):
        assert normalize_bottom_nav_slots(stored) is None

    def test_bad_entries_are_dropped_not_fatal(self):
        stored = ["javascript:alert(1)", "/events", "/events", "/account", "/x"]
        assert normalize_bottom_nav_slots(stored) == ["/events", "/account"]


@pytest.mark.unit
class TestSchema:
    def test_accepts_two_distinct_paths(self):
        body = BottomNavigationPreference(slots=["/events", "/training/my-training"])
        assert body.slots == ["/events", "/training/my-training"]

    def test_null_clears_the_choice(self):
        assert BottomNavigationPreference(slots=None).slots is None

    @pytest.mark.parametrize(
        "slots",
        [
            [],
            ["/events", "/members", "/documents"],
            ["/events", "/events"],
            ["https://evil.example/"],
            ["events"],
            ["/Events"],
            ["/" + "a" * 80],
        ],
    )
    def test_refuses_malformed_slots(self, slots):
        with pytest.raises(pydantic.ValidationError):
            BottomNavigationPreference(slots=slots)

    def test_refuses_unknown_keys(self):
        with pytest.raises(pydantic.ValidationError):
            BottomNavigationPreference(slots=["/events"], user_id="someone-else")


@pytest.mark.unit
class TestEndpoints:
    async def test_get_reports_never_chosen_as_null(self):
        result = await get_my_bottom_navigation(current_user=_caller(None))
        assert result.slots is None

    async def test_get_returns_the_stored_choice(self):
        result = await get_my_bottom_navigation(
            current_user=_caller(["/members", "/account"])
        )
        assert result.slots == ["/members", "/account"]

    async def test_put_replaces_the_choice_and_commits(self):
        caller = _caller(["/events", "/scheduling"])
        db = _db()
        body = BottomNavigationPreference(slots=["/documents", "/account"])

        result = await set_my_bottom_navigation(body=body, current_user=caller, db=db)

        assert result == body
        assert caller.bottom_nav_slots == ["/documents", "/account"]
        db.commit.assert_awaited_once()

    async def test_put_null_restores_the_defaults(self):
        caller = _caller(["/events", "/scheduling"])
        db = _db()

        await set_my_bottom_navigation(
            body=BottomNavigationPreference(slots=None), current_user=caller, db=db
        )

        assert caller.bottom_nav_slots is None
        db.commit.assert_awaited_once()

    def test_routes_are_self_scoped_only(self):
        paths = {
            route.path
            for route in router.routes
            if route.path.endswith("/bottom-navigation")
        }
        assert paths == {"/me/bottom-navigation"}


async def _make_user(db) -> User:
    org = Organization(name="Bar FD", slug=f"bar-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    user = User(
        organization_id=org.id,
        username=f"member-{uuid.uuid4().hex[:8]}",
        email=f"member-{uuid.uuid4().hex[:8]}@example.org",
        first_name="Member",
        last_name="One",
    )
    db.add(user)
    await db.flush()
    return user


@pytest.mark.integration
class TestPersistence:
    async def test_choice_round_trips_through_the_column_and_auth_me(self, db_session):
        user = await _make_user(db_session)
        # Read before the commit expires the instance; async attribute access
        # after that would need a lazy load the test cannot await.
        user_id = user.id
        assert (await _build_current_user_dict(user, db_session))[
            "bottom_nav_slots"
        ] is None

        await set_my_bottom_navigation(
            body=BottomNavigationPreference(slots=["/members", "/account"]),
            current_user=user,
            db=db_session,
        )
        db_session.expire_all()

        stored = (
            await db_session.execute(select(User).where(User.id == user_id))
        ).scalar_one()
        assert stored.bottom_nav_slots == ["/members", "/account"]
        current = await _build_current_user_dict(stored, db_session)
        assert current["bottom_nav_slots"] == ["/members", "/account"]

    async def test_clearing_writes_null(self, db_session):
        user = await _make_user(db_session)
        user_id = user.id
        user.bottom_nav_slots = ["/events", "/account"]
        await db_session.flush()

        await set_my_bottom_navigation(
            body=BottomNavigationPreference(slots=None),
            current_user=user,
            db=db_session,
        )
        db_session.expire_all()

        stored = (
            await db_session.execute(select(User).where(User.id == user_id))
        ).scalar_one()
        assert stored.bottom_nav_slots is None
