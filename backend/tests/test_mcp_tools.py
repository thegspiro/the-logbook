"""MCP tools against the real database.

What matters here is the shape of what leaves a tool: a roster with phone
numbers in the database comes out without them, a gated tool refuses when
its switch is off, and every call leaves an audit entry. The tool bodies
are invoked through the registry wrapper exactly as the SDK would call
them, with a principal bound.
"""

import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone

import pytest
from mcp.server.mcpserver.exceptions import ToolError
from sqlalchemy import select, text

from app.mcp import db as mcp_db
from app.mcp.principal import McpPrincipal, bind_principal
from app.mcp.server import build_server
from app.models.audit import AuditLog


@pytest.fixture
def server():
    return build_server()


@pytest.fixture
def _use_test_session(db_session, monkeypatch):
    """Point the tools at the rolled-back-per-test session.

    The tools' ``open_session`` is an async context manager over a factory;
    the test session must not be closed on exit, so hand out a manager that
    yields it and does nothing else.
    """

    @asynccontextmanager
    async def factory():
        yield db_session

    monkeypatch.setattr(mcp_db, "session_factory", factory)


@pytest.fixture
async def org_with_members(db_session, setup_org_and_admin):
    org_id, admin_id = setup_org_and_admin
    await db_session.execute(
        text(
            "UPDATE users SET phone = '555-0100', mobile = '555-0101', "
            "personal_email = 'admin@home.example', address_street = '1 Main St', "
            "date_of_birth = '1980-01-01', rank = 'chief', station = 'Station 1' "
            "WHERE id = :id"
        ),
        {"id": admin_id},
    )
    member_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, last_name, "
            "email, phone, password_hash, status, rank) VALUES "
            "(:id, :org, :un, 'Sam', 'Rivera', :em, '555-0199', 'x', 'active', 'firefighter')"
        ),
        {
            "id": member_id,
            "org": org_id,
            "un": f"sam-{member_id[:8]}",
            "em": f"{member_id[:8]}@x.test",
        },
    )
    await db_session.flush()
    return org_id, admin_id, member_id


def _principal(org_id, admin_id, **overrides) -> McpPrincipal:
    base = dict(
        organization_id=org_id,
        key_id=str(uuid.uuid4()),
        key_prefix="logbook_mcp_testkey0",
        issued_by_user_id=admin_id,
        access_mode="read_only",
        expose_finance=False,
        expose_medical_screening=False,
        client_ip="127.0.0.1",
    )
    base.update(overrides)
    return McpPrincipal(**base)


async def _call(server, principal, name, **arguments):
    tool = server._tool_manager.get_tool(name)
    assert tool is not None, name
    with bind_principal(principal):
        return await tool.fn(**arguments)


class TestRoster:
    @pytest.mark.usefixtures("_use_test_session")
    async def test_list_members_never_carries_contact_details(
        self, server, org_with_members
    ):
        org_id, admin_id, member_id = org_with_members
        result = await _call(server, _principal(org_id, admin_id), "list_members")
        assert result["total"] == 2
        names = {m["full_name"] for m in result["items"]}
        assert names == {"Admin User", "Sam Rivera"}
        for member in result["items"]:
            for denied in (
                "phone",
                "mobile",
                "email",
                "personal_email",
                "address_street",
                "date_of_birth",
                "username",
                "membership_number",
            ):
                assert denied not in member, denied
        assert {m["rank"] for m in result["items"]} == {"chief", "firefighter"}

    @pytest.mark.usefixtures("_use_test_session")
    async def test_list_members_is_org_scoped(self, server, org_with_members):
        org_id, admin_id, _ = org_with_members
        other = _principal(str(uuid.uuid4()), admin_id)
        result = await _call(server, other, "list_members")
        assert result["total"] == 0

    @pytest.mark.usefixtures("_use_test_session")
    async def test_search_and_get_member(self, server, org_with_members):
        org_id, admin_id, member_id = org_with_members
        principal = _principal(org_id, admin_id)
        found = await _call(server, principal, "list_members", search="rivera")
        assert [m["id"] for m in found["items"]] == [member_id]
        one = await _call(server, principal, "get_member", member_id=member_id)
        assert one["full_name"] == "Sam Rivera"
        assert "phone" not in one
        with pytest.raises(ToolError, match="not found"):
            await _call(server, principal, "get_member", member_id=str(uuid.uuid4()))
        with pytest.raises(ToolError, match="not a valid id"):
            await _call(server, principal, "get_member", member_id="nope")


class TestGating:
    @pytest.mark.parametrize(
        ("tool", "kwargs"),
        [
            ("list_fiscal_years", {}),
            ("list_expiring_screenings", {}),
            (
                "create_event_draft",
                {
                    "title": "x",
                    "start_datetime": "2030-01-01T10:00:00Z",
                    "end_datetime": "2030-01-01T11:00:00Z",
                },
            ),
        ],
    )
    @pytest.mark.usefixtures("_use_test_session")
    async def test_gated_tools_refuse_when_the_switch_is_off(
        self, server, org_with_members, tool, kwargs
    ):
        org_id, admin_id, _ = org_with_members
        with pytest.raises(ToolError, match="Settings → Integrations"):
            await _call(server, _principal(org_id, admin_id), tool, **kwargs)

    async def test_list_tools_hides_gated_tools_for_a_read_only_principal(
        self, server, org_with_members
    ):
        org_id, admin_id, _ = org_with_members
        with bind_principal(_principal(org_id, admin_id)):
            names = {t.name for t in await server.list_tools()}
        assert "list_members" in names
        assert not {"list_fiscal_years", "get_budget_summary", "list_budgets"} & names
        assert not {"get_member_medical_compliance", "list_expiring_screenings"} & names
        assert not {"create_event_draft", "create_meeting_action_item"} & names

        with bind_principal(
            _principal(org_id, admin_id, access_mode="read_write", expose_finance=True)
        ):
            names = {t.name for t in await server.list_tools()}
        assert {"list_fiscal_years", "create_event_draft"} <= names
        assert "list_expiring_screenings" not in names

    @pytest.mark.usefixtures("_use_test_session")
    async def test_write_tool_creates_a_draft_attributed_to_the_issuer(
        self, server, org_with_members
    ):
        org_id, admin_id, _ = org_with_members
        principal = _principal(org_id, admin_id, access_mode="read_write")
        start = datetime.now(timezone.utc) + timedelta(days=3)
        created = await _call(
            server,
            principal,
            "create_event_draft",
            title="Ladder drill",
            start_datetime=start.isoformat(),
            end_datetime=(start + timedelta(hours=2)).isoformat(),
            event_type="training",
        )
        assert created["is_draft"] is True
        listed = await _call(server, principal, "list_events", include_drafts=True)
        assert any(e["id"] == created["id"] and e["is_draft"] for e in listed["items"])

    @pytest.mark.usefixtures("_use_test_session")
    async def test_write_refuses_when_the_issuer_is_gone(
        self, server, org_with_members
    ):
        org_id, admin_id, _ = org_with_members
        principal = _principal(
            org_id, admin_id, access_mode="read_write", issued_by_user_id=None
        )
        with pytest.raises(ToolError, match="Issue a new key"):
            await _call(
                server,
                principal,
                "create_event_draft",
                title="x",
                start_datetime="2030-01-01T10:00:00Z",
                end_datetime="2030-01-01T11:00:00Z",
            )


class TestAudit:
    @pytest.mark.usefixtures("_use_test_session")
    async def test_every_call_writes_an_audit_entry(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, _ = org_with_members
        principal = _principal(org_id, admin_id)
        await _call(server, principal, "get_department_profile")
        rows = (
            (
                await db_session.execute(
                    select(AuditLog).where(
                        AuditLog.event_type == "mcp.tool_call",
                        AuditLog.organization_id == org_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        assert rows[0].event_data["tool"] == "get_department_profile"
        assert rows[0].event_data["key_id"] == principal.key_id
        assert rows[0].ip_address == "127.0.0.1"


class TestProfileAndCalendar:
    @pytest.mark.usefixtures("_use_test_session")
    async def test_department_profile(self, server, org_with_members):
        org_id, admin_id, _ = org_with_members
        profile = await _call(
            server, _principal(org_id, admin_id), "get_department_profile"
        )
        assert profile["name"] == "Test Dept"
        assert profile["timezone"] == "UTC"
        assert isinstance(profile["enabled_modules"], list)
        assert "phone" not in profile
        assert "email" not in profile

    @pytest.mark.usefixtures("_use_test_session")
    async def test_list_events_rejects_bad_dates(self, server, org_with_members):
        org_id, admin_id, _ = org_with_members
        with pytest.raises(ToolError, match="ISO-8601"):
            await _call(
                server,
                _principal(org_id, admin_id),
                "list_events",
                start_after="yesterday",
            )

    @pytest.mark.usefixtures("_use_test_session")
    async def test_expiring_certifications_and_shifts_are_empty_but_well_formed(
        self, server, org_with_members
    ):
        org_id, admin_id, _ = org_with_members
        principal = _principal(org_id, admin_id)
        certs = await _call(
            server, principal, "list_expiring_certifications", days_ahead=30
        )
        assert certs == {"days_ahead": 30, "items": [], "total": 0}
        shifts = await _call(
            server, principal, "list_shifts", start_date=date.today().isoformat()
        )
        assert shifts["items"] == []
        assert shifts["total"] == 0
