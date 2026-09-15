"""
Tests for the admin-hours endpoint's own permission-scoping logic
(app/api/v1/endpoints/admin_hours.py) — not the service, which
test_admin_hours_service.py already covers.

`get_summary` and `get_user_hours_compliance` both let an officer view
another member's data by hand-checking permissions before delegating to the
service, independent of `require_permission` (which only gates the route,
not which `user_id` the query targets). Regression coverage for a fix
(pass 5, AH-21): both endpoints previously scanned
`p in ("admin_hours.manage", ...) for role in current_user.positions for p
in (role.permissions or [])` directly, instead of routing through
`user_has_permission()` the way `require_permission("admin_hours.manage")`
does for every other route in this file. That hand-rolled scan matched only
the literal "admin_hours.manage"/"compliance.view"/"*" strings, so an officer
holding the grant via a module wildcard (e.g. a custom position with
"admin_hours.*" — a form CLAUDE.md's permission wildcard convention
explicitly allows) or via their operational rank's default permissions was
silently downgraded to a self-only view, while `require_permission` admitted
the same officer to every other admin_hours.manage-gated route in the file.
DB mocked — this is pure permission-gate logic, no query to exercise.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.api.v1.endpoints import admin_hours as admin_hours_endpoint

pytestmark = [pytest.mark.unit]


def _position(*permissions):
    return SimpleNamespace(permissions=list(permissions))


def _user(user_id, *, positions=(), rank=None, org_id="org-1"):
    return SimpleNamespace(
        id=user_id,
        organization_id=org_id,
        positions=list(positions),
        rank=rank,
    )


class TestSummaryScope:
    """GET /admin-hours/summary?userId=<other>"""

    async def test_module_wildcard_grant_sees_the_requested_member(self):
        officer = _user("officer-1", positions=[_position("admin_hours.*")])
        with patch.object(
            admin_hours_endpoint.AdminHoursService,
            "get_summary",
            new=AsyncMock(return_value={"total_hours": 0}),
        ) as mock_get_summary:
            await admin_hours_endpoint.get_summary(
                user_id="member-2",
                start_date=None,
                end_date=None,
                db=AsyncMock(),
                current_user=officer,
            )
        assert mock_get_summary.await_args.kwargs["user_id"] == "member-2"

    async def test_exact_grant_still_sees_the_requested_member(self):
        officer = _user("officer-1", positions=[_position("admin_hours.manage")])
        with patch.object(
            admin_hours_endpoint.AdminHoursService,
            "get_summary",
            new=AsyncMock(return_value={"total_hours": 0}),
        ) as mock_get_summary:
            await admin_hours_endpoint.get_summary(
                user_id="member-2",
                start_date=None,
                end_date=None,
                db=AsyncMock(),
                current_user=officer,
            )
        assert mock_get_summary.await_args.kwargs["user_id"] == "member-2"

    async def test_no_grant_is_still_downgraded_to_self(self):
        member = _user("member-1", positions=[_position("events.manage")])
        with patch.object(
            admin_hours_endpoint.AdminHoursService,
            "get_summary",
            new=AsyncMock(return_value={"total_hours": 0}),
        ) as mock_get_summary:
            await admin_hours_endpoint.get_summary(
                user_id="member-2",
                start_date=None,
                end_date=None,
                db=AsyncMock(),
                current_user=member,
            )
        assert mock_get_summary.await_args.kwargs["user_id"] == "member-1"


class TestComplianceScope:
    """GET /admin-hours/compliance/{user_id}"""

    async def test_module_wildcard_grant_sees_the_requested_member(self):
        officer = _user("officer-1", positions=[_position("admin_hours.*")])
        with patch.object(
            admin_hours_endpoint.AdminHoursService,
            "get_user_hours_compliance",
            new=AsyncMock(return_value=[]),
        ) as mock_get_compliance:
            await admin_hours_endpoint.get_user_hours_compliance(
                user_id="member-2",
                year=None,
                db=AsyncMock(),
                current_user=officer,
            )
        assert mock_get_compliance.await_args.kwargs["user_id"] == "member-2"

    async def test_compliance_view_wildcard_grant_sees_the_requested_member(self):
        officer = _user("officer-1", positions=[_position("compliance.*")])
        with patch.object(
            admin_hours_endpoint.AdminHoursService,
            "get_user_hours_compliance",
            new=AsyncMock(return_value=[]),
        ) as mock_get_compliance:
            await admin_hours_endpoint.get_user_hours_compliance(
                user_id="member-2",
                year=None,
                db=AsyncMock(),
                current_user=officer,
            )
        assert mock_get_compliance.await_args.kwargs["user_id"] == "member-2"

    async def test_no_grant_is_still_downgraded_to_self(self):
        member = _user("member-1", positions=[_position("events.manage")])
        with patch.object(
            admin_hours_endpoint.AdminHoursService,
            "get_user_hours_compliance",
            new=AsyncMock(return_value=[]),
        ) as mock_get_compliance:
            await admin_hours_endpoint.get_user_hours_compliance(
                user_id="member-2",
                year=None,
                db=AsyncMock(),
                current_user=member,
            )
        assert mock_get_compliance.await_args.kwargs["user_id"] == "member-1"

    async def test_own_id_needs_no_grant(self):
        member = _user("member-1", positions=[_position("events.manage")])
        with patch.object(
            admin_hours_endpoint.AdminHoursService,
            "get_user_hours_compliance",
            new=AsyncMock(return_value=[]),
        ) as mock_get_compliance:
            await admin_hours_endpoint.get_user_hours_compliance(
                user_id="member-1",
                year=None,
                db=AsyncMock(),
                current_user=member,
            )
        assert mock_get_compliance.await_args.kwargs["user_id"] == "member-1"
