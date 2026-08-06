"""Minutes action-item visibility on the unified dashboard feed.

MM-3 confined draft and executive-session minutes to ``minutes.manage``
holders in the minutes module. The dashboard's unified action-item feed reads
``ActionItem`` across the whole organization and is available to *any*
authenticated member, so it has to apply the same gate — an action item carries
the minutes record's free text in its description.

The filter is asserted against the compiled SQL rather than a live query: the
predicate is the security control, and it can be verified without MySQL.
"""

from types import SimpleNamespace
from unittest.mock import patch

from app.api.v1.endpoints.dashboard import minutes_visibility_filter


def _user(uid="u1"):
    return SimpleNamespace(id=uid, organization_id="org1")


def _sql(clause) -> str:
    return str(clause.compile(compile_kwargs={"literal_binds": True}))


class TestMinutesVisibilityFilter:
    def test_manage_holder_gets_no_restriction(self):
        with patch(
            "app.api.v1.endpoints.dashboard.user_has_permission", return_value=True
        ):
            assert minutes_visibility_filter(_user()) is None

    def test_plain_member_is_confined_to_approved_non_executive(self):
        with patch(
            "app.api.v1.endpoints.dashboard.user_has_permission", return_value=False
        ):
            clause = minutes_visibility_filter(_user())
        assert clause is not None
        sql = _sql(clause)
        # Approved-only, and executive sessions excluded.
        assert "'approved'" in sql
        assert "'executive'" in sql
        assert "!=" in sql or "IS NOT" in sql

    def test_plain_member_still_sees_items_assigned_to_them(self):
        # Without this carve-out, assigned_to_me would hide a member's own
        # tasks whenever they came from a draft or executive session.
        with patch(
            "app.api.v1.endpoints.dashboard.user_has_permission", return_value=False
        ):
            clause = minutes_visibility_filter(_user("member-42"))
        sql = _sql(clause)
        assert "'member-42'" in sql
        assert " OR " in sql

    def test_the_permission_checked_is_minutes_manage(self):
        # A different permission would silently widen or narrow the gate.
        seen = {}

        def _fake(user, permission):
            seen["permission"] = permission
            return False

        with patch("app.api.v1.endpoints.dashboard.user_has_permission", new=_fake):
            minutes_visibility_filter(_user())
        assert seen["permission"] == "minutes.manage"
