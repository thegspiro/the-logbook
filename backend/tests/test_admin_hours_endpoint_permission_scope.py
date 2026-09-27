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

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.api.v1.endpoints import admin_hours as admin_hours_endpoint


@pytest.fixture(autouse=True)
def _department_today(monkeypatch):
    """The service asks the org for its date; answer with the same
    ``date.today()`` the fixtures here are built from."""
    monkeypatch.setattr(
        "app.api.v1.endpoints.admin_hours.resolve_org_today",
        AsyncMock(return_value=date.today()),
    )


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


def _entry_row(status="pending"):
    return SimpleNamespace(
        id="entry-1",
        organization_id="org-1",
        user_id="member-1",
        category_id="cat-1",
        clock_in_at=None,
        clock_out_at=None,
        duration_minutes=60,
        description=None,
        entry_method=SimpleNamespace(value="manual"),
        status=SimpleNamespace(value=status),
        approved_by=None,
        approved_at=None,
        rejection_reason=None,
        created_at=None,
        updated_at=None,
    )


class TestOwnEntryScope:
    """PATCH /entries/my/{id} and POST /entries/my/{id}/withdraw are open to
    any member, so the owner the service scopes to must be the caller — never
    a value the client supplies."""

    async def test_edit_passes_the_callers_own_id(self):
        member = _user("member-1")
        member.username = "member1"
        with (
            patch.object(
                admin_hours_endpoint.AdminHoursService,
                "edit_own_entry",
                new=AsyncMock(return_value=(_entry_row(), True)),
            ) as mock_edit,
            patch.object(
                admin_hours_endpoint.AdminHoursService,
                "get_category",
                new=AsyncMock(return_value=None),
            ),
            patch.object(
                admin_hours_endpoint, "log_audit_event", new=AsyncMock()
            ) as mock_audit,
        ):
            out = await admin_hours_endpoint.edit_my_entry(
                entry_id="entry-1",
                data=admin_hours_endpoint.AdminHoursEntryEdit(description="x"),
                db=AsyncMock(),
                current_user=member,
            )
        assert mock_edit.await_args.kwargs["user_id"] == "member-1"
        assert mock_edit.await_args.kwargs["organization_id"] == "org-1"
        assert mock_audit.await_args.kwargs["event_data"]["resubmitted"] is True
        assert out["status"] == "pending"

    async def test_withdraw_passes_the_callers_own_id(self):
        member = _user("member-1")
        member.username = "member1"
        with (
            patch.object(
                admin_hours_endpoint.AdminHoursService,
                "withdraw_own_entry",
                new=AsyncMock(return_value=_entry_row("withdrawn")),
            ) as mock_withdraw,
            patch.object(
                admin_hours_endpoint.AdminHoursService,
                "get_category",
                new=AsyncMock(return_value=None),
            ),
            patch.object(admin_hours_endpoint, "log_audit_event", new=AsyncMock()),
        ):
            out = await admin_hours_endpoint.withdraw_my_entry(
                entry_id="entry-1", db=AsyncMock(), current_user=member
            )
        assert mock_withdraw.await_args.kwargs["user_id"] == "member-1"
        assert out["status"] == "withdrawn"

    async def test_service_refusal_is_a_400(self):
        member = _user("member-1")
        with patch.object(
            admin_hours_endpoint.AdminHoursService,
            "withdraw_own_entry",
            new=AsyncMock(side_effect=ValueError("Entry not found")),
        ):
            with pytest.raises(admin_hours_endpoint.HTTPException) as exc:
                await admin_hours_endpoint.withdraw_my_entry(
                    entry_id="entry-1", db=AsyncMock(), current_user=member
                )
        assert exc.value.status_code == 400
