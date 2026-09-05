"""The organizer's name on the event detail response.

Any officer holding ``events.manage`` can close an event, but the member who
organized it is the one who reconciles its attendance — so whoever is about to
finalize needs to know whose event it is. ``Event.created_by`` has always been
stored and served, as a bare UUID that no screen could render.

These tests cover the resolution rather than the column: that the two names the
detail view shows are fetched in one round trip, that the lookup is org-scoped,
that a caller without ``events.manage`` is not told who organized the event, and
that a blank first name does not produce ``"None Smith"`` — which is what the
hand-rolled concatenation this replaced did. DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.api.v1.endpoints.events import (
    _display_name,
    _names_to_resolve,
    _resolve_display_names,
)

pytestmark = [pytest.mark.unit]


def _users(*users):
    result = MagicMock()
    result.scalars.return_value.all.return_value = list(users)
    return result


def _user(user_id, first=None, last=None, username="jdoe"):
    return SimpleNamespace(
        id=user_id, first_name=first, last_name=last, username=username
    )


class TestResolveDisplayNames:
    async def test_both_ids_resolve_in_a_single_round_trip(self):
        """The whole reason the helper takes a set rather than an id."""
        db = AsyncMock()
        db.execute.return_value = _users(
            _user("user-1", "Sam", "Ortiz"),
            _user("user-2", "Pat", "Ramirez"),
        )

        names = await _resolve_display_names(db, {"user-1", "user-2"}, "org-1")

        assert names == {"user-1": "Sam Ortiz", "user-2": "Pat Ramirez"}
        assert db.execute.await_count == 1

    async def test_an_empty_set_costs_no_query(self):
        db = AsyncMock()

        assert await _resolve_display_names(db, set(), "org-1") == {}
        db.execute.assert_not_awaited()

    async def test_an_id_the_org_scoped_query_misses_is_simply_absent(self):
        """A creator outside the caller's organization must not be named back.

        The query filters on organization_id, so a foreign row never comes back;
        the caller reports no name rather than inventing one.
        """
        db = AsyncMock()
        db.execute.return_value = _users()

        assert await _resolve_display_names(db, {"other-org-user"}, "org-1") == {}

    async def test_the_query_is_org_scoped(self):
        db = AsyncMock()
        db.execute.return_value = _users()

        await _resolve_display_names(db, {"user-1"}, "org-1")

        compiled = str(
            db.execute.await_args.args[0].compile(
                compile_kwargs={"literal_binds": True}
            )
        )
        assert "organization_id" in compiled

    async def test_a_blank_first_name_does_not_render_as_None(self):
        """The bug in the concatenation this replaced.

        ``f"{u.first_name} {u.last_name}"`` on a NULL first name produced
        "None Smith" on the screen. _display_name guards each half with `or ''`
        and falls back to the username when both are blank.
        """
        db = AsyncMock()
        db.execute.return_value = _users(
            _user("user-1", None, "Smith", username="bsmith")
        )

        names = await _resolve_display_names(db, {"user-1"}, "org-1")

        assert names == {"user-1": "Smith"}

    async def test_a_wholly_nameless_member_falls_back_to_the_username(self):
        db = AsyncMock()
        db.execute.return_value = _users(_user("user-1", None, None, username="ghost"))

        names = await _resolve_display_names(db, {"user-1"}, "org-1")

        assert names == {"user-1": "ghost"}

    def test_display_name_is_the_shared_authority(self):
        """Guards against a fourth hand-rolled copy of this concatenation."""
        assert _display_name(_user("u", None, "Smith", username="bsmith")) == "Smith"
        assert _display_name(_user("u", None, None, username="ghost")) == "ghost"
        assert _display_name(None) is None


def _event(created_by="organizer-1", finalized_by="chief-1"):
    return SimpleNamespace(created_by=created_by, attendance_finalized_by=finalized_by)


def _caller(*permissions):
    """A user whose grants come from one position, which is how they resolve.

    ``user_has_permission`` aggregates from assigned positions and the
    operational rank, so a bare ``permissions`` attribute would be ignored and
    every one of these tests would pass for the wrong reason.
    """
    return SimpleNamespace(
        id="caller-1",
        organization_id="org-1",
        rank=None,
        positions=[SimpleNamespace(permissions=list(permissions))],
    )


class TestWhichNamesACallerMaySee:
    def test_a_manager_gets_both(self):
        wanted = _names_to_resolve(_event(), _caller("events.manage"))

        assert wanted == {
            "attendance_finalized_by_name": "chief-1",
            "created_by_name": "organizer-1",
        }

    def test_a_plain_member_is_not_told_who_organized_it(self):
        wanted = _names_to_resolve(_event(), _caller("events.view"))

        assert "created_by_name" not in wanted

    def test_a_plain_member_still_gets_the_finalizer(self):
        """The regression this gate could easily have caused.

        The attendance-lock badge naming who closed the event renders for every
        member, and has since it shipped. Adding a permission gate for the
        organizer must not drag the finalizer behind it.
        """
        wanted = _names_to_resolve(_event(), _caller("events.view"))

        assert wanted["attendance_finalized_by_name"] == "chief-1"

    def test_the_organizer_closing_their_own_event_yields_two_fields(self):
        """Keyed by field, not by user id.

        The organizer closing their own event is the ordinary case, and keying
        this map by user id would collapse the two entries into one and drop a
        name from the response.
        """
        event = _event(created_by="same-1", finalized_by="same-1")

        wanted = _names_to_resolve(event, _caller("events.manage"))

        assert wanted == {
            "attendance_finalized_by_name": "same-1",
            "created_by_name": "same-1",
        }

    def test_an_event_with_neither_asks_for_nothing(self):
        wanted = _names_to_resolve(
            _event(created_by=None, finalized_by=None), _caller("events.manage")
        )

        assert wanted == {}

    def test_a_wildcard_holder_counts_as_a_manager(self):
        """checkPermission honours "*" and "events.*"; so must this."""
        assert "created_by_name" in _names_to_resolve(_event(), _caller("*"))
        assert "created_by_name" in _names_to_resolve(_event(), _caller("events.*"))
