"""
`GET|PUT /users/me/profile-visibility` — a member's own choice of what
colleagues see of their contact block.

Self-scoped by construction: there is no user id in the path, and deliberately
no by-id counterpart, so the "403 for another member's preference" case is
enforced by the router having no such route rather than by a permission check
that could regress.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pydantic
import pytest

from app.api.v1.endpoints.users import (
    get_my_profile_visibility,
    router,
    set_my_profile_visibility,
)
from app.schemas.user import PROFILE_VISIBILITY_DEFAULTS, ProfileVisibility

pytestmark = [pytest.mark.unit]

SHARE_EVERYTHING = {
    "email": True,
    "personal_email": True,
    "phone": True,
    "mobile": True,
    "address": True,
}


def _caller(profile_visibility: object = None) -> SimpleNamespace:
    return SimpleNamespace(
        id=str(uuid.uuid4()),
        organization_id=str(uuid.uuid4()),
        username="jsmith",
        profile_visibility=profile_visibility,
    )


def _request() -> MagicMock:
    request = MagicMock()
    request.client.host = "203.0.113.7"
    request.headers = {}
    return request


class TestGet:
    async def test_never_chosen_is_the_defaults(self):
        result = await get_my_profile_visibility(current_user=_caller(None))

        assert result == ProfileVisibility(**PROFILE_VISIBILITY_DEFAULTS)

    async def test_stored_choice_is_returned(self):
        stored = {**PROFILE_VISIBILITY_DEFAULTS, "address": True, "email": False}
        result = await get_my_profile_visibility(current_user=_caller(stored))

        assert result.address is True
        assert result.email is False


class TestPut:
    async def test_replaces_the_whole_object_and_commits(self):
        caller = _caller({**PROFILE_VISIBILITY_DEFAULTS, "mobile": False})
        db = MagicMock()
        db.commit = AsyncMock()
        body = ProfileVisibility(**SHARE_EVERYTHING)

        with patch(
            "app.api.v1.endpoints.users.log_audit_event", new=AsyncMock()
        ) as audit:
            result = await set_my_profile_visibility(
                body=body, request=_request(), current_user=caller, db=db
            )

        assert result == body
        assert caller.profile_visibility == SHARE_EVERYTHING
        # A fresh dict, not the body's own (the endpoint returns `body`, and a
        # shared reference would let later mutation of one change the other).
        assert caller.profile_visibility is not SHARE_EVERYTHING
        db.commit.assert_awaited_once()

        audit.assert_awaited_once()
        kwargs = audit.await_args.kwargs
        assert kwargs["event_type"] == "profile_visibility_updated"
        assert kwargs["user_id"] == caller.id
        assert kwargs["event_data"]["previous"]["mobile"] is False
        assert kwargs["event_data"]["current"] == SHARE_EVERYTHING

    async def test_previous_is_resolved_for_a_member_who_never_chose(self):
        caller = _caller(None)
        db = MagicMock()
        db.commit = AsyncMock()

        with patch(
            "app.api.v1.endpoints.users.log_audit_event", new=AsyncMock()
        ) as audit:
            await set_my_profile_visibility(
                body=ProfileVisibility(**SHARE_EVERYTHING),
                request=_request(),
                current_user=caller,
                db=db,
            )

        assert audit.await_args.kwargs["event_data"]["previous"] == (
            PROFILE_VISIBILITY_DEFAULTS
        )


class TestBodyValidation:
    """FastAPI turns these into 422s; the schema is where the rule lives."""

    def test_missing_key_is_refused(self):
        partial = {k: v for k, v in SHARE_EVERYTHING.items() if k != "address"}
        with pytest.raises(pydantic.ValidationError):
            ProfileVisibility.model_validate(partial)

    def test_unknown_key_is_refused(self):
        # A misspelt key must not silently do nothing while the member believes
        # they hid something; nor may a leadership-only field be smuggled in.
        with pytest.raises(pydantic.ValidationError):
            ProfileVisibility.model_validate(
                {**SHARE_EVERYTHING, "date_of_birth": True}
            )

    def test_non_bool_is_refused(self):
        with pytest.raises(pydantic.ValidationError):
            ProfileVisibility.model_validate({**SHARE_EVERYTHING, "email": "true"})
        with pytest.raises(pydantic.ValidationError):
            ProfileVisibility.model_validate({**SHARE_EVERYTHING, "email": 1})


class TestRouting:
    @staticmethod
    def _routes() -> dict[str, set[str]]:
        table: dict[str, set[str]] = {}
        for route in router.routes:
            table.setdefault(route.path, set()).update(route.methods or set())
        return table

    def test_self_routes_exist_and_no_by_id_write_path_does(self):
        routes = self._routes()

        assert {"GET", "PUT"} <= routes["/me/profile-visibility"]
        assert "/{user_id}/profile-visibility" not in routes

    def test_no_me_route_is_shadowed_by_an_earlier_by_id_route(self):
        """FastAPI matches in declaration order and parses `user_id: UUID` only
        after choosing the route, so a `/{user_id}/<suffix>` declared above a
        `/me/<suffix>` would capture `me` and answer 422."""
        seen_by_id: dict[str, int] = {}
        for index, route in enumerate(router.routes):
            path = route.path
            if path.startswith("/{user_id}/"):
                seen_by_id.setdefault(path.removeprefix("/{user_id}/"), index)
            elif path.startswith("/me/"):
                suffix = path.removeprefix("/me/")
                assert suffix not in seen_by_id, (
                    f"/me/{suffix} is declared after /{{user_id}}/{suffix} and "
                    "would never be reached"
                )
