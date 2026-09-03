"""MCP tools against the real database.

What matters here is the shape of what leaves a tool: a roster with phone
numbers in the database comes out without them, a gated tool refuses when
its switch is off, and every call leaves an audit entry. The tool bodies
are invoked through the registry wrapper exactly as the SDK would call
them, with a principal bound.
"""

import json
import re
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone

import pytest
from mcp.server.mcpserver.exceptions import ToolError
from sqlalchemy import select, text

from app.mcp import db as mcp_db
from app.mcp.constants import (
    AUDIT_ARGUMENT_CHARS,
    AUDIT_ARGUMENT_ITEMS,
    MAX_ARGUMENT_CHARS,
)
from app.mcp.principal import McpPrincipal, bind_principal
from app.mcp.registry import bound_for_audit, check_argument_sizes
from app.mcp.server import build_server

# Every test here needs the database: CI's unit job runs without one and
# deselects this marker; the integration job selects it.
pytestmark = [pytest.mark.integration]
from app.models.audit import AuditLog
from app.models.facilities import Facility, FacilityStatus, FacilityType
from app.models.inventory import (
    CheckOutRecord,
    InventoryCategory,
    InventoryItem,
    ItemType,
)
from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningRequirement,
    ScreeningStatus,
    ScreeningType,
)
from app.models.meeting import (
    ActionItemStatus,
    Meeting,
    MeetingActionItem,
    MeetingType,
)
from app.models.training import (
    Shift,
    TrainingRecord,
    TrainingStatus,
    TrainingType,
)


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
            "date_of_birth = '1980-01-01', `rank` = 'chief', station = 'Station 1' "
            "WHERE id = :id"
        ),
        {"id": admin_id},
    )
    member_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, last_name, "
            "email, phone, password_hash, status, `rank`) VALUES "
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


class TestModuleSwitches:
    """A module the department switched off is off for Claude as well: its
    tools are not listed and refuse if called, with the same 403 wording the
    module's API router uses."""

    @pytest.mark.usefixtures("_use_test_session")
    async def test_tool_of_a_disabled_module_refuses(self, server, org_with_members):
        org_id, admin_id, _ = org_with_members
        principal = _principal(
            org_id,
            admin_id,
            enabled_modules=frozenset({"members", "events", "integrations"}),
        )
        with pytest.raises(ToolError, match="Scheduling module is not enabled"):
            await _call(server, principal, "list_shifts")
        roster = await _call(server, principal, "list_members")
        assert roster["total"] == 2

    async def test_list_tools_hides_disabled_modules(self, server, org_with_members):
        org_id, admin_id, _ = org_with_members
        with bind_principal(
            _principal(
                org_id,
                admin_id,
                access_mode="read_write",
                enabled_modules=frozenset(
                    {"members", "events", "integrations", "training"}
                ),
            )
        ):
            names = {t.name for t in await server.list_tools()}
        assert {
            "list_members",
            "list_events",
            "list_expiring_certifications",
            "create_event_draft",
        } <= names
        assert (
            not {
                "list_shifts",
                "list_apparatus",
                "list_minutes",
                "create_reorder_request",
            }
            & names
        )

    async def test_unresolved_modules_do_not_gate(self, server, org_with_members):
        """``None`` means the set was not resolved; a principal built without
        one must not be locked out by it."""
        org_id, admin_id, _ = org_with_members
        with bind_principal(_principal(org_id, admin_id)):
            names = {t.name for t in await server.list_tools()}
        assert "list_shifts" in names


class TestSecondReviewRound:
    """Regressions for the second review round on #2197."""

    @pytest.mark.usefixtures("_use_test_session")
    async def test_writes_refuse_when_the_issuer_is_deactivated(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, _ = org_with_members
        await db_session.execute(
            text("UPDATE users SET status = 'suspended' WHERE id = :id"),
            {"id": admin_id},
        )
        await db_session.flush()
        principal = _principal(org_id, admin_id, access_mode="read_write")
        with pytest.raises(ToolError, match="no longer active"):
            await _call(
                server,
                principal,
                "create_event_draft",
                title="x",
                start_datetime="2030-01-01T10:00:00Z",
                end_datetime="2030-01-01T11:00:00Z",
            )

    @pytest.mark.usefixtures("_use_test_session")
    async def test_open_shifts_never_advertise_a_continuation(
        self, server, org_with_members
    ):
        org_id, admin_id, _ = org_with_members
        body = await _call(
            server,
            _principal(org_id, admin_id),
            "list_open_shifts",
            start_date=date.today().isoformat(),
            end_date=(date.today() + timedelta(days=7)).isoformat(),
        )
        assert body == {"items": [], "limit": 50, "has_more": False}


class TestAttendeeVisibility:
    """The member-facing attendee gate applies to the service key: a
    managers-only roster stays closed, a member-visible one lists ``going``
    responses only."""

    async def _event(self, db_session, org_id, admin_id, member_id, visibility):
        from app.models.event import (
            AttendeeVisibility,
            Event,
            EventRSVP,
            EventType,
            RSVPStatus,
        )

        event = Event(
            organization_id=org_id,
            title="Drill",
            event_type=EventType.TRAINING,
            start_datetime=datetime(2030, 1, 1, 10, tzinfo=timezone.utc),
            end_datetime=datetime(2030, 1, 1, 12, tzinfo=timezone.utc),
            attendee_visibility=AttendeeVisibility(visibility),
            created_by=admin_id,
        )
        db_session.add(event)
        await db_session.flush()
        for uid, status in (
            (admin_id, RSVPStatus.GOING),
            (member_id, RSVPStatus.NOT_GOING),
        ):
            db_session.add(
                EventRSVP(
                    organization_id=org_id,
                    event_id=event.id,
                    user_id=uid,
                    status=status,
                    guest_count=0,
                )
            )
        await db_session.flush()
        return event.id

    @pytest.mark.usefixtures("_use_test_session")
    async def test_managers_only_roster_is_refused(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, member_id = org_with_members
        event_id = await self._event(
            db_session, org_id, admin_id, member_id, "managers"
        )
        with pytest.raises(ToolError, match="not shared with members"):
            await _call(
                server,
                _principal(org_id, admin_id),
                "list_event_attendees",
                event_id=event_id,
            )

    @pytest.mark.usefixtures("_use_test_session")
    async def test_member_visible_roster_lists_going_only(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, member_id = org_with_members
        event_id = await self._event(db_session, org_id, admin_id, member_id, "members")
        body = await _call(
            server,
            _principal(org_id, admin_id),
            "list_event_attendees",
            event_id=event_id,
        )
        assert [(i["member_name"], i["status"]) for i in body["items"]] == [
            ("Admin User", "going")
        ]
        # The member-facing roster row is an allowlist of three fields;
        # guest counts and the check-in block are organizer-only.
        assert set(body["items"][0]) == {"member_id", "member_name", "status"}

    @pytest.mark.usefixtures("_use_test_session")
    async def test_unknown_event_is_not_found(self, server, org_with_members):
        org_id, admin_id, _ = org_with_members
        with pytest.raises(ToolError, match="Event not found"):
            await _call(
                server,
                _principal(org_id, admin_id),
                "list_event_attendees",
                event_id=str(uuid.uuid4()),
            )


class TestDatetimeParsing:
    def test_offset_values_are_converted_to_utc(self):
        from app.mcp.tools._common import parse_datetime

        assert parse_datetime("2026-09-03T09:00:00-04:00", "x") == datetime(
            2026, 9, 3, 13, tzinfo=timezone.utc
        )
        assert parse_datetime("2026-09-03T09:00:00Z", "x") == datetime(
            2026, 9, 3, 9, tzinfo=timezone.utc
        )
        assert parse_datetime("2026-09-03T09:00:00", "x") == datetime(
            2026, 9, 3, 9, tzinfo=timezone.utc
        )
        assert parse_datetime(None, "x") is None
        with pytest.raises(ValueError, match="ISO-8601"):
            parse_datetime("yesterday", "x")


class TestFourthReviewRound:
    """Regressions for the fourth review round on #2197."""

    def test_iso_emits_utc_instants_and_leaves_dates_alone(self):
        from datetime import time
        from decimal import Decimal

        from app.mcp.tools._common import iso

        assert iso(datetime(2026, 9, 3, 10)) == "2026-09-03T10:00:00+00:00"
        assert (
            iso(datetime(2026, 9, 3, 6, tzinfo=timezone(timedelta(hours=-4))))
            == "2026-09-03T10:00:00+00:00"
        )
        assert iso(date(2026, 9, 3)) == "2026-09-03"
        assert iso(time(7, 30)) == "07:30:00"
        assert iso(Decimal("12.50")) == 12.5

    @pytest.mark.usefixtures("_use_test_session")
    @pytest.mark.parametrize(
        ("tool", "extra"),
        [
            ("get_member_training_summary", {}),
            ("get_member_requirements_progress", {}),
            ("list_member_training_records", {}),
        ],
    )
    async def test_member_tools_refuse_an_unknown_member(
        self, server, org_with_members, tool, extra
    ):
        org_id, admin_id, _ = org_with_members
        with pytest.raises(ToolError, match="Member not found"):
            await _call(
                server,
                _principal(org_id, admin_id),
                tool,
                member_id=str(uuid.uuid4()),
                **extra,
            )

    @pytest.mark.usefixtures("_use_test_session")
    async def test_medical_compliance_refuses_an_unknown_member(
        self, server, org_with_members
    ):
        org_id, admin_id, _ = org_with_members
        with pytest.raises(ToolError, match="Member not found"):
            await _call(
                server,
                _principal(org_id, admin_id, expose_medical_screening=True),
                "get_member_medical_compliance",
                member_id=str(uuid.uuid4()),
            )

    @pytest.mark.usefixtures("_use_test_session")
    async def test_budget_summary_refuses_an_unknown_fiscal_year(
        self, server, org_with_members
    ):
        org_id, admin_id, _ = org_with_members
        with pytest.raises(ToolError, match="Fiscal year not found"):
            await _call(
                server,
                _principal(org_id, admin_id, expose_finance=True),
                "get_budget_summary",
                fiscal_year_id=str(uuid.uuid4()),
            )

    @pytest.mark.usefixtures("_use_test_session")
    async def test_budgets_resolve_categories_without_lazy_loads(
        self, server, org_with_members, db_session
    ):
        """The budget list does not eager-load categories and the async
        session cannot lazy-load them; names come from one explicit query."""
        from datetime import date as _date

        from app.models.finance import Budget, BudgetCategory, FiscalYear

        org_id, admin_id, _ = org_with_members
        fy = FiscalYear(
            organization_id=org_id,
            name="FY2026",
            start_date=_date(2026, 1, 1),
            end_date=_date(2026, 12, 31),
            created_by=admin_id,
        )
        category = BudgetCategory(organization_id=org_id, name="Turnout gear")
        db_session.add_all([fy, category])
        await db_session.flush()
        db_session.add(
            Budget(
                organization_id=org_id,
                fiscal_year_id=fy.id,
                category_id=category.id,
                amount_budgeted=1000,
                amount_spent=250,
                amount_encumbered=0,
                created_by=admin_id,
            )
        )
        await db_session.flush()
        fy_id = fy.id
        # Expire so the tool's own queries, not this session's identity map,
        # supply the rows — the way a fresh MCP request sees them.
        db_session.expire_all()
        principal = _principal(org_id, admin_id, expose_finance=True)
        body = await _call(
            server, principal, "list_budgets", fiscal_year_id=fy_id, limit=10
        )
        assert [b["category"] for b in body["items"]] == ["Turnout gear"]
        assert body["has_more"] is False
        summary = await _call(
            server, principal, "get_budget_summary", fiscal_year_id=fy_id
        )
        assert summary["total_budgeted"] == 1000.0

    async def test_apparatus_projection_reads_locations_from_the_lookup(self):
        from types import SimpleNamespace

        from app.mcp.tools.apparatus import _apparatus

        row = SimpleNamespace(
            id="a1",
            unit_number="E1",
            name="Engine 1",
            apparatus_type=SimpleNamespace(name="Engine"),
            status_record=SimpleNamespace(name="In Service", code="in_service"),
            status_reason=None,
            year=2020,
            make="Pierce",
            model="Enforcer",
            primary_station_id="s1",
            current_location_id="s2",
            seating_capacity=6,
            min_staffing=3,
            pump_capacity_gpm=1500,
            tank_capacity_gallons=750,
            ladder_length_feet=None,
            current_mileage=1000,
            current_hours=200.0,
            in_service_date=None,
            inspection_expiration=None,
            registration_expiration=None,
            has_deficiency=False,
            deficiency_since=None,
            is_archived=False,
            description=None,
        )
        rendered = _apparatus(row, {"s1": "Station 1", "s2": "Shop"})
        assert rendered["primary_station"] == "Station 1"
        assert rendered["current_location"] == "Shop"

    async def test_meeting_tools_belong_to_the_minutes_module(
        self, server, org_with_members
    ):
        org_id, admin_id, _ = org_with_members
        with bind_principal(
            _principal(
                org_id,
                admin_id,
                access_mode="read_write",
                enabled_modules=frozenset({"members", "events", "integrations"}),
            )
        ):
            names = {t.name for t in await server.list_tools()}
        assert (
            not {
                "list_meetings",
                "list_open_action_items",
                "create_meeting_action_item",
            }
            & names
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

    @pytest.mark.usefixtures("_use_test_session")
    async def test_audit_row_keeps_only_a_bounded_copy_of_arguments(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, _ = org_with_members
        principal = _principal(org_id, admin_id)
        search = "x" * (AUDIT_ARGUMENT_CHARS * 10)
        await _call(server, principal, "list_members", search=search)
        row = (
            await db_session.execute(
                select(AuditLog).where(
                    AuditLog.event_type == "mcp.tool_call",
                    AuditLog.organization_id == org_id,
                )
            )
        ).scalar_one()
        audited = row.event_data["arguments"]["search"]
        assert audited.startswith("x" * AUDIT_ARGUMENT_CHARS)
        assert audited.endswith(f"[{len(search)} chars]")
        assert len(audited) < AUDIT_ARGUMENT_CHARS + 40

    @pytest.mark.usefixtures("_use_test_session")
    async def test_oversized_argument_is_refused_before_the_handler_runs(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, _ = org_with_members
        principal = _principal(org_id, admin_id)
        with pytest.raises(ToolError, match="search is too long"):
            await _call(
                server, principal, "list_members", search="x" * (MAX_ARGUMENT_CHARS + 1)
            )
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
        # The refusal itself is recorded, with the argument bounded.
        assert [r.event_data["outcome"] for r in rows] == ["refused"]
        assert len(rows[0].event_data["arguments"]["search"]) < 300


class TestAuditBounding:
    def test_strings_lists_and_dicts_are_cut_recursively(self):
        value = {
            "text": "a" * (AUDIT_ARGUMENT_CHARS + 1),
            "items": [str(i) for i in range(AUDIT_ARGUMENT_ITEMS + 5)],
            "nested": {"deep": ["b" * (AUDIT_ARGUMENT_CHARS * 2)]},
            "number": 7,
        }
        bounded = bound_for_audit(value)
        assert bounded["text"].endswith(f"[{AUDIT_ARGUMENT_CHARS + 1} chars]")
        assert len(bounded["items"]) == AUDIT_ARGUMENT_ITEMS + 1
        assert bounded["items"][-1] == f"… [{AUDIT_ARGUMENT_ITEMS + 5} items]"
        assert bounded["nested"]["deep"][0].endswith(
            f"[{AUDIT_ARGUMENT_CHARS * 2} chars]"
        )
        assert bounded["number"] == 7

    def test_small_values_pass_through_unchanged(self):
        value = {"search": "engine 3", "limit": 10, "tags": ["a", "b"]}
        assert bound_for_audit(value) == value

    def test_dict_keys_are_cut_like_values(self):
        """A schema-rejected call carries the client's property names into
        the audit row, so a key is bounded the same way a value is."""
        long_key = "k" * (AUDIT_ARGUMENT_CHARS * 3)
        bounded = bound_for_audit({long_key: "v", "nested": {long_key: 1}})
        key, nested_key = (
            next(k for k in bounded if k != "nested"),
            next(iter(bounded["nested"])),
        )
        assert key == nested_key
        assert key.endswith(f"[{AUDIT_ARGUMENT_CHARS * 3} chars]")
        assert len(key) < AUDIT_ARGUMENT_CHARS + 40
        assert bounded[key] == "v"

    def test_argument_size_check_walks_nested_values(self):
        check_argument_sizes({"ok": "x" * MAX_ARGUMENT_CHARS, "n": 3})
        with pytest.raises(ToolError, match="tags is too long"):
            check_argument_sizes({"tags": ["fine", "y" * (MAX_ARGUMENT_CHARS + 1)]})


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
        assert certs["days_ahead"] == 30
        assert certs["items"] == []
        assert certs["total"] == 0
        assert certs["has_more"] is False
        shifts = await _call(
            server, principal, "list_shifts", start_date=date.today().isoformat()
        )
        assert shifts["items"] == []
        assert shifts["total"] == 0


class TestFifthRoundFindings:
    """Regressions for the fifth review round on #2197."""

    @pytest.mark.usefixtures("_use_test_session")
    async def test_expiring_certifications_are_paged_with_a_real_total(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, member_id = org_with_members
        soon = date.today() + timedelta(days=3)
        for n in range(3):
            db_session.add(
                TrainingRecord(
                    organization_id=org_id,
                    user_id=member_id,
                    course_name=f"Cert {n}",
                    training_type=TrainingType.CERTIFICATION,
                    status=TrainingStatus.COMPLETED,
                    completion_date=date.today() - timedelta(days=365),
                    expiration_date=soon + timedelta(days=n),
                    hours_completed=1.0,
                )
            )
        await db_session.flush()
        principal = _principal(org_id, admin_id)
        first = await _call(
            server, principal, "list_expiring_certifications", days_ahead=30, limit=2
        )
        assert [c["course_name"] for c in first["items"]] == ["Cert 0", "Cert 1"]
        assert first["total"] == 3
        assert first["has_more"] is True
        assert first["days_ahead"] == 30
        assert first["items"][0]["member_name"]
        assert "certification_number" not in first["items"][0]
        rest = await _call(
            server,
            principal,
            "list_expiring_certifications",
            days_ahead=30,
            limit=2,
            offset=2,
        )
        assert [c["course_name"] for c in rest["items"]] == ["Cert 2"]
        assert rest["has_more"] is False

    @pytest.mark.usefixtures("_use_test_session")
    async def test_facilities_never_carry_lease_terms_or_contact_details(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, _ = org_with_members
        kind = FacilityType(organization_id=org_id, name="Station")
        state = FacilityStatus(organization_id=org_id, name="Active")
        db_session.add_all([kind, state])
        await db_session.flush()
        db_session.add(
            Facility(
                organization_id=org_id,
                name="Station 9",
                facility_type_id=kind.id,
                status_id=state.id,
                is_owned=False,
                lease_expiration=date.today() + timedelta(days=400),
                property_tax_id="TAX-0001",
                phone="555-123-4567",
                email="station9@example.test",
                city="Springfield",
            )
        )
        await db_session.flush()
        result = await _call(server, _principal(org_id, admin_id), "list_facilities")
        assert result["total"] == 1
        item = result["items"][0]
        assert item["name"] == "Station 9"
        assert item["is_owned"] is False
        assert item["city"] == "Springfield"
        for denied in ("lease_expiration", "property_tax_id", "phone", "email"):
            assert denied not in item

    async def _stock(self, db_session, org_id, admin_id, member_id):
        """A uniform category and a medical category, each with one item
        at low stock and one overdue checkout."""
        items = {}
        for kind, name in (
            (ItemType.UNIFORM, "Class A coat"),
            (ItemType.MEDICAL, "Epinephrine"),
        ):
            category = InventoryCategory(
                organization_id=org_id,
                name=f"{kind.value} category",
                item_type=kind,
                low_stock_threshold=5,
            )
            db_session.add(category)
            await db_session.flush()
            item = InventoryItem(
                organization_id=org_id,
                category_id=category.id,
                name=name,
                quantity=1,
            )
            db_session.add(item)
            await db_session.flush()
            db_session.add(
                CheckOutRecord(
                    organization_id=org_id,
                    item_id=item.id,
                    user_id=member_id,
                    checked_out_by=admin_id,
                    checked_out_at=datetime.now(timezone.utc) - timedelta(days=5),
                    expected_return_at=datetime.now(timezone.utc) - timedelta(days=2),
                    is_returned=False,
                )
            )
            items[kind] = (category, item)
        await db_session.flush()
        return items

    @pytest.mark.usefixtures("_use_test_session")
    async def test_inventory_tools_never_show_medical_supplies(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, member_id = org_with_members
        stock = await self._stock(db_session, org_id, admin_id, member_id)
        principal = _principal(org_id, admin_id)

        listed = await _call(server, principal, "list_inventory_items")
        assert [i["name"] for i in listed["items"]] == ["Class A coat"]
        assert listed["total"] == 1

        searched = await _call(server, principal, "list_inventory_items", search="Epi")
        assert searched["items"] == []

        low = await _call(server, principal, "list_low_stock_items")
        assert [c["category_name"] for c in low["items"]] == ["uniform category"]

        overdue = await _call(server, principal, "list_overdue_checkouts")
        assert [r["item_id"] for r in overdue["items"]] == [
            stock[ItemType.UNIFORM][1].id
        ]
        assert overdue["items"][0]["item_name"] == stock[ItemType.UNIFORM][1].name
        assert "asset_tag" in overdue["items"][0]

        summary = await _call(server, principal, "get_inventory_summary")
        assert summary["total_items"] == 1
        assert summary["active_checkouts"] == 1

    @pytest.mark.usefixtures("_use_test_session")
    async def test_reorder_request_refuses_medical_supplies(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, member_id = org_with_members
        stock = await self._stock(db_session, org_id, admin_id, member_id)
        principal = _principal(org_id, admin_id, access_mode="read_write")
        medical_category, medical_item = stock[ItemType.MEDICAL]
        with pytest.raises(ToolError, match="Medical supplies"):
            await _call(
                server,
                principal,
                "create_reorder_request",
                item_name="Epinephrine",
                quantity=2,
                item_id=medical_item.id,
            )
        with pytest.raises(ToolError, match="Medical supplies"):
            await _call(
                server,
                principal,
                "create_reorder_request",
                item_name="Epinephrine",
                quantity=2,
                category_id=medical_category.id,
            )
        allowed = await _call(
            server,
            principal,
            "create_reorder_request",
            item_name="Class A coat",
            quantity=2,
            item_id=stock[ItemType.UNIFORM][1].id,
        )
        assert allowed["item_name"] == "Class A coat"


class TestScheduleVisibility:
    """Without the full-schedule switch the shift tools show only shifts
    open to all members — what any eligible member can see — since a
    service key has no rank or qualifications to be eligible with."""

    async def _shifts(self, db_session, org_id):
        day = date.today() + timedelta(days=7)
        start = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc)
        for open_to_all in (True, False):
            db_session.add(
                Shift(
                    organization_id=org_id,
                    shift_date=day,
                    start_time=start.replace(hour=8 if open_to_all else 18),
                    end_time=start.replace(hour=12 if open_to_all else 22),
                    min_staffing=2,
                    open_to_all_members=open_to_all,
                )
            )
        await db_session.flush()
        return day

    @pytest.mark.usefixtures("_use_test_session")
    async def test_only_open_to_all_shifts_without_the_switch(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, _ = org_with_members
        day = await self._shifts(db_session, org_id)
        principal = _principal(org_id, admin_id)
        listed = await _call(
            server, principal, "list_shifts", start_date=day.isoformat()
        )
        assert [s["open_to_all_members"] for s in listed["items"]] == [True]
        assert listed["total"] == 1
        open_shifts = await _call(
            server,
            principal,
            "list_open_shifts",
            start_date=day.isoformat(),
            end_date=day.isoformat(),
        )
        assert [s["open_to_all_members"] for s in open_shifts["items"]] == [True]

    @pytest.mark.usefixtures("_use_test_session")
    async def test_full_schedule_with_the_switch(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, _ = org_with_members
        day = await self._shifts(db_session, org_id)
        principal = _principal(org_id, admin_id, expose_full_schedule=True)
        listed = await _call(
            server, principal, "list_shifts", start_date=day.isoformat()
        )
        assert sorted(s["open_to_all_members"] for s in listed["items"]) == [
            False,
            True,
        ]
        assert listed["total"] == 2
        open_shifts = await _call(
            server,
            principal,
            "list_open_shifts",
            start_date=day.isoformat(),
            end_date=day.isoformat(),
        )
        assert len(open_shifts["items"]) == 2


class TestEighthRoundFindings:
    """Regressions for the eighth review round on #2197."""

    @pytest.mark.usefixtures("_use_test_session")
    async def test_expiring_screenings_are_members_only_and_paged(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, member_id = org_with_members
        requirement = ScreeningRequirement(
            organization_id=org_id,
            name="Annual physical",
            screening_type=ScreeningType.PHYSICAL_EXAM,
        )
        db_session.add(requirement)
        await db_session.flush()
        for days, user_id, status in (
            (5, member_id, ScreeningStatus.PASSED),
            (3, admin_id, ScreeningStatus.COMPLETED),
            (4, None, ScreeningStatus.PASSED),  # an applicant's record
            (2, member_id, ScreeningStatus.SCHEDULED),  # not yet held
        ):
            db_session.add(
                ScreeningRecord(
                    organization_id=org_id,
                    requirement_id=requirement.id,
                    user_id=user_id,
                    screening_type=ScreeningType.PHYSICAL_EXAM,
                    status=status,
                    expiration_date=date.today() + timedelta(days=days),
                )
            )
        await db_session.flush()
        principal = _principal(org_id, admin_id, expose_medical_screening=True)
        first = await _call(
            server, principal, "list_expiring_screenings", days=30, limit=1
        )
        assert first["total"] == 2
        assert first["has_more"] is True
        assert first["days"] == 30
        (row,) = first["items"]
        assert row["member_name"] == "Admin User"
        assert row["requirement_name"] == "Annual physical"
        assert row["screening_type"] == "physical_exam"
        assert row["days_until_expiration"] == 3
        assert set(row) == {
            "record_id",
            "member_id",
            "member_name",
            "screening_type",
            "requirement_name",
            "expiration_date",
            "days_until_expiration",
        }
        rest = await _call(
            server, principal, "list_expiring_screenings", days=30, limit=1, offset=1
        )
        assert [r["member_id"] for r in rest["items"]] == [member_id]
        assert rest["has_more"] is False

    @pytest.mark.usefixtures("_use_test_session")
    async def test_open_action_items_are_paged_undated_last(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, _ = org_with_members
        meeting = Meeting(
            organization_id=org_id,
            title="Monthly business meeting",
            meeting_type=MeetingType.BUSINESS,
            meeting_date=date.today(),
        )
        db_session.add(meeting)
        await db_session.flush()
        closed = next(
            s
            for s in ActionItemStatus
            if s not in (ActionItemStatus.OPEN, ActionItemStatus.IN_PROGRESS)
        )
        for label, due, status in (
            ("Order hose", 2, ActionItemStatus.OPEN),
            ("Undated", None, ActionItemStatus.IN_PROGRESS),
            ("Fix bay door", 1, ActionItemStatus.OPEN),
            ("Done already", 0, closed),
        ):
            db_session.add(
                MeetingActionItem(
                    organization_id=org_id,
                    meeting_id=meeting.id,
                    description=label,
                    status=status,
                    due_date=(
                        date.today() + timedelta(days=due) if due is not None else None
                    ),
                )
            )
        await db_session.flush()
        principal = _principal(org_id, admin_id)
        first = await _call(server, principal, "list_open_action_items", limit=2)
        assert [i["description"] for i in first["items"]] == [
            "Fix bay door",
            "Order hose",
        ]
        assert first["total"] == 3
        assert first["has_more"] is True
        rest = await _call(
            server, principal, "list_open_action_items", limit=2, offset=2
        )
        assert [i["description"] for i in rest["items"]] == ["Undated"]
        assert rest["has_more"] is False

    @pytest.mark.usefixtures("_use_test_session")
    async def test_member_training_records_put_undated_records_last(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, member_id = org_with_members
        for name, completed in (("Undated", None), ("Dated", date.today())):
            db_session.add(
                TrainingRecord(
                    organization_id=org_id,
                    user_id=member_id,
                    course_name=name,
                    training_type=TrainingType.CERTIFICATION,
                    status=TrainingStatus.COMPLETED,
                    completion_date=completed,
                    hours_completed=1.0,
                )
            )
        await db_session.flush()
        body = await _call(
            server,
            _principal(org_id, admin_id),
            "list_member_training_records",
            member_id=member_id,
        )
        assert [r["course_name"] for r in body["items"]] == ["Dated", "Undated"]

    @pytest.mark.usefixtures("_use_test_session")
    async def test_reorder_request_refuses_a_name_the_column_cannot_hold(
        self, server, org_with_members
    ):
        org_id, admin_id, _ = org_with_members
        with pytest.raises(ToolError, match="item_name"):
            await _call(
                server,
                _principal(org_id, admin_id, access_mode="read_write"),
                "create_reorder_request",
                item_name="x" * 300,
                quantity=1,
            )

    async def test_draft_event_description_names_only_accepted_types(self, server):
        from app.models.event import EventType

        description = server._tool_manager.get_tool("create_event_draft").description
        listed = re.search(r"is one of (.+?);", description, re.S).group(1)
        names = [n.strip() for n in re.split(r",|\bor\b", listed) if n.strip()]
        assert names
        assert set(names) == {e.value for e in EventType}


class TestEleventhRoundFindings:
    """Regressions for the eleventh review round on #2197."""

    @pytest.mark.usefixtures("_use_test_session")
    async def test_roster_filters_and_pages_in_sql(self, server, org_with_members):
        org_id, admin_id, member_id = org_with_members
        principal = _principal(org_id, admin_id)
        by_name = await _call(server, principal, "list_members", search="riv")
        assert [m["id"] for m in by_name["items"]] == [member_id]
        assert by_name["total"] == 1
        wildcard = await _call(server, principal, "list_members", search="%")
        assert wildcard["total"] == 0
        first_page = await _call(server, principal, "list_members", limit=1)
        assert len(first_page["items"]) == 1
        assert first_page["total"] == 2
        assert first_page["has_more"] is True
        assert "compliance_exempt" not in first_page["items"][0]
        with pytest.raises(ToolError, match="status must be one of"):
            await _call(server, principal, "list_members", status="bogus")

    @pytest.mark.usefixtures("_use_test_session")
    async def test_elections_page_and_results_wait_for_closing(
        self, server, org_with_members, db_session
    ):
        from app.models.election import Election, ElectionStatus

        org_id, admin_id, _ = org_with_members
        now = datetime.now(timezone.utc)
        elections = []
        for n in range(3):
            election = Election(
                organization_id=org_id,
                title=f"Election {n}",
                start_date=now - timedelta(days=10 - n),
                end_date=now + timedelta(days=1),
                status=ElectionStatus.OPEN,
                results_visible_immediately=True,
            )
            db_session.add(election)
            elections.append(election)
        await db_session.flush()
        principal = _principal(org_id, admin_id)
        listed = await _call(server, principal, "list_elections", limit=2)
        assert [e["title"] for e in listed["items"]] == ["Election 2", "Election 1"]
        assert listed["total"] == 3
        assert listed["has_more"] is True
        with pytest.raises(ToolError, match="until the election closes"):
            await _call(
                server, principal, "get_election_results", election_id=elections[0].id
            )
        with pytest.raises(ToolError, match="Election not found"):
            await _call(
                server, principal, "get_election_results", election_id=str(uuid.uuid4())
            )

    @pytest.mark.usefixtures("_use_test_session")
    async def test_meeting_filters_are_validated(self, server, org_with_members):
        org_id, admin_id, _ = org_with_members
        principal = _principal(org_id, admin_id)
        with pytest.raises(ToolError, match="status must be one of"):
            await _call(server, principal, "list_meetings", status="aproved")
        with pytest.raises(ToolError, match="meeting_type must be one of"):
            await _call(server, principal, "list_meetings", meeting_type="bored")
        ok = await _call(
            server, principal, "list_meetings", status="approved", meeting_type="board"
        )
        assert ok["items"] == []

    @pytest.mark.usefixtures("_use_test_session")
    async def test_shift_rosters_show_only_active_assignments(
        self, server, org_with_members, db_session
    ):
        from app.models.training import AssignmentStatus, ShiftAssignment

        org_id, admin_id, member_id = org_with_members
        day = date.today() + timedelta(days=3)
        start = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc)
        shift = Shift(
            organization_id=org_id,
            shift_date=day,
            start_time=start.replace(hour=8),
            end_time=start.replace(hour=12),
            min_staffing=3,
            open_to_all_members=True,
        )
        db_session.add(shift)
        await db_session.flush()
        for user_id, status in (
            (admin_id, AssignmentStatus.DECLINED),
            (member_id, AssignmentStatus.ASSIGNED),
        ):
            db_session.add(
                ShiftAssignment(
                    organization_id=org_id,
                    shift_id=shift.id,
                    user_id=user_id,
                    position="firefighter",
                    assignment_status=status,
                )
            )
        await db_session.flush()
        listed = await _call(
            server,
            _principal(org_id, admin_id),
            "list_shifts",
            start_date=day.isoformat(),
            end_date=day.isoformat(),
        )
        (row,) = listed["items"]
        assert [a["member_id"] for a in row["assignments"]] == [member_id]

    @pytest.mark.usefixtures("_use_test_session")
    async def test_open_shift_window_reports_truncation(
        self, server, org_with_members, db_session, monkeypatch
    ):
        from app.mcp.tools import scheduling as scheduling_tools

        org_id, admin_id, _ = org_with_members
        days = [date.today() + timedelta(days=n) for n in (1, 2)]
        for day in days:
            start = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc)
            db_session.add(
                Shift(
                    organization_id=org_id,
                    shift_date=day,
                    start_time=start.replace(hour=8),
                    end_time=start.replace(hour=12),
                    min_staffing=2,
                    open_to_all_members=True,
                )
            )
        await db_session.flush()
        monkeypatch.setattr(scheduling_tools, "MAX_OPEN_SHIFT_CANDIDATES", 1)
        principal = _principal(org_id, admin_id)
        first = await _call(
            server,
            principal,
            "list_open_shifts",
            start_date=days[0].isoformat(),
            end_date=days[1].isoformat(),
        )
        assert [s["shift_date"] for s in first["items"]] == [days[0].isoformat()]
        assert first["has_more"] is True
        rest = await _call(
            server,
            principal,
            "list_open_shifts",
            start_date=days[0].isoformat(),
            end_date=days[1].isoformat(),
            cursor=first["next_cursor"],
        )
        assert [s["shift_date"] for s in rest["items"]] == [days[1].isoformat()]
        assert rest["has_more"] is False
        assert "next_cursor" not in rest
        with pytest.raises(ToolError, match="not a continuation"):
            await _call(
                server,
                principal,
                "list_open_shifts",
                start_date=days[0].isoformat(),
                end_date=days[1].isoformat(),
                cursor="garbage",
            )
        with pytest.raises(ToolError, match="must not exceed"):
            await _call(
                server,
                principal,
                "list_open_shifts",
                start_date=days[0].isoformat(),
                end_date=(days[0] + timedelta(days=400)).isoformat(),
            )


class TestTwelfthRoundFindings:
    """Regressions for the twelfth review round on #2197."""

    @pytest.mark.usefixtures("_use_test_session")
    async def test_open_shift_cursor_advances_within_a_day(
        self, server, org_with_members, db_session, monkeypatch
    ):
        from app.mcp.tools import scheduling as scheduling_tools

        org_id, admin_id, _ = org_with_members
        day = date.today() + timedelta(days=1)
        base = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc)
        for hour in (8, 14):
            db_session.add(
                Shift(
                    organization_id=org_id,
                    shift_date=day,
                    start_time=base.replace(hour=hour),
                    end_time=base.replace(hour=hour + 4),
                    min_staffing=2,
                    open_to_all_members=True,
                )
            )
        await db_session.flush()
        monkeypatch.setattr(scheduling_tools, "MAX_OPEN_SHIFT_CANDIDATES", 1)
        principal = _principal(org_id, admin_id)
        seen = []
        cursor = None
        for _ in range(3):
            body = await _call(
                server,
                principal,
                "list_open_shifts",
                start_date=day.isoformat(),
                end_date=day.isoformat(),
                cursor=cursor,
            )
            seen.extend(s["start_time"] for s in body["items"])
            if not body["has_more"]:
                break
            cursor = body["next_cursor"]
        assert len(seen) == 2
        assert seen == sorted(seen)

    @pytest.mark.usefixtures("_use_test_session")
    async def test_refused_and_rejected_calls_are_audited(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, _ = org_with_members
        principal = _principal(org_id, admin_id)
        with pytest.raises(ToolError):
            await _call(server, principal, "list_fiscal_years")  # switch off
        with pytest.raises(ToolError, match="Member not found"):
            await _call(server, principal, "get_member", member_id=str(uuid.uuid4()))
        await _call(server, principal, "get_department_profile")
        rows = (
            (
                await db_session.execute(
                    select(AuditLog)
                    .where(
                        AuditLog.event_type == "mcp.tool_call",
                        AuditLog.organization_id == org_id,
                    )
                    .order_by(AuditLog.id)
                )
            )
            .scalars()
            .all()
        )
        outcomes = [(r.event_data["tool"], r.event_data["outcome"]) for r in rows]
        assert outcomes == [
            ("list_fiscal_years", "refused"),
            ("get_member", "rejected"),
            ("get_department_profile", "ok"),
        ]
        assert "Finance data is not shared" in rows[0].event_data["reason"]
        assert rows[1].event_data["reason"] == "Member not found"
        assert "reason" not in rows[2].event_data
        assert rows[0].severity != rows[2].severity

    @pytest.mark.usefixtures("_use_test_session")
    async def test_low_stock_is_paged(self, server, org_with_members, db_session):
        org_id, admin_id, _ = org_with_members
        for name in ("Boots", "Coats", "Gloves"):
            category = InventoryCategory(
                organization_id=org_id,
                name=name,
                item_type=ItemType.UNIFORM,
                low_stock_threshold=5,
            )
            db_session.add(category)
            await db_session.flush()
            db_session.add(
                InventoryItem(
                    organization_id=org_id,
                    category_id=category.id,
                    name=f"{name} item",
                    quantity=1,
                )
            )
        await db_session.flush()
        principal = _principal(org_id, admin_id)
        first = await _call(server, principal, "list_low_stock_items", limit=2)
        assert [c["category_name"] for c in first["items"]] == ["Boots", "Coats"]
        assert first["has_more"] is True
        rest = await _call(server, principal, "list_low_stock_items", limit=2, offset=2)
        assert [c["category_name"] for c in rest["items"]] == ["Gloves"]
        assert rest["has_more"] is False

    @pytest.mark.usefixtures("_use_test_session")
    async def test_document_text_is_returned_in_pieces(
        self, server, org_with_members, db_session, monkeypatch
    ):
        from app.mcp.tools import documents as document_tools

        org_id, admin_id, _ = org_with_members
        doc_id = str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO documents (id, organization_id, name, document_type, "
                "status, version, content_html) VALUES "
                "(:id, :org, 'SOG 7', 'uploaded', 'active', 1, :html)"
            ),
            {"id": doc_id, "org": org_id, "html": "<p>" + "a" * 30 + "</p>"},
        )
        await db_session.flush()
        monkeypatch.setattr(document_tools, "DOCUMENT_CONTENT_CHARS", 20)
        principal = _principal(org_id, admin_id)
        first = await _call(server, principal, "get_document", document_id=doc_id)
        assert len(first["content_html"]) == 20
        assert first["content_total_chars"] == 37
        assert first["content_has_more"] is True
        assert first["next_content_offset"] == 20
        rest = await _call(
            server,
            principal,
            "get_document",
            document_id=doc_id,
            content_offset=first["next_content_offset"],
        )
        assert first["content_html"] + rest["content_html"] == "<p>" + "a" * 30 + "</p>"
        assert rest["content_has_more"] is False


class TestThirteenthRoundFindings:
    """Regressions for the thirteenth review round on #2197."""

    @pytest.mark.usefixtures("_use_test_session")
    async def test_results_of_an_early_closed_election_are_available(
        self, server, org_with_members, db_session
    ):
        from app.models.election import Election, ElectionStatus

        org_id, admin_id, _ = org_with_members
        now = datetime.now(timezone.utc)
        election = Election(
            organization_id=org_id,
            title="Closed early",
            start_date=now - timedelta(days=3),
            end_date=now + timedelta(days=3),  # scheduled end still ahead
            status=ElectionStatus.CLOSED,
            results_visible_immediately=False,
        )
        db_session.add(election)
        await db_session.flush()
        body = await _call(
            server,
            _principal(org_id, admin_id),
            "get_election_results",
            election_id=election.id,
        )
        assert body["election_id"] == election.id

    @pytest.mark.usefixtures("_use_test_session")
    async def test_document_chunks_cannot_reassemble_a_number(
        self, server, org_with_members, db_session, monkeypatch
    ):
        from app.mcp.tools import documents as document_tools

        org_id, admin_id, _ = org_with_members
        doc_id = str(uuid.uuid4())
        html = "<p>Call me on 5551234567 today</p>"
        await db_session.execute(
            text(
                "INSERT INTO documents (id, organization_id, name, document_type, "
                "status, version, content_html) VALUES "
                "(:id, :org, 'Contact sheet', 'uploaded', 'active', 1, :html)"
            ),
            {"id": doc_id, "org": org_id, "html": html},
        )
        await db_session.flush()
        # A boundary in the middle of the number.
        monkeypatch.setattr(document_tools, "DOCUMENT_CONTENT_CHARS", 18)
        principal = _principal(org_id, admin_id)
        pieces = []
        offset = 0
        while True:
            body = await _call(
                server,
                principal,
                "get_document",
                document_id=doc_id,
                content_offset=offset,
            )
            pieces.append(body["content_html"])
            if not body["content_has_more"]:
                break
            offset = body["next_content_offset"]
        joined = "".join(pieces)
        assert "5551234567" not in joined
        assert "[phone removed]" in joined
        listed = await _call(server, principal, "list_documents")
        assert [d["name"] for d in listed["items"]] == ["Contact sheet"]
        assert "content_html" not in listed["items"][0]

    @pytest.mark.usefixtures("_use_test_session")
    async def test_meeting_caller_is_the_stored_name(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, _ = org_with_members
        db_session.add(
            Meeting(
                organization_id=org_id,
                title="Special meeting",
                meeting_type=MeetingType.SPECIAL,
                meeting_date=date.today(),
                called_by="Chief Smith",
            )
        )
        await db_session.flush()
        body = await _call(server, _principal(org_id, admin_id), "list_meetings")
        assert [m["called_by"] for m in body["items"]] == ["Chief Smith"]

    @pytest.mark.usefixtures("_use_test_session")
    async def test_minutes_text_is_bounded_and_readable_in_pieces(
        self, server, org_with_members, db_session, monkeypatch
    ):
        from app.mcp.tools import meetings as meeting_tools

        org_id, admin_id, _ = org_with_members
        minutes_id = str(uuid.uuid4())
        long_text = "x" * 25
        sections = json.dumps(
            [
                {
                    "order": 0,
                    "key": "old_business",
                    "title": "Old Business",
                    "content": long_text,
                },
                {
                    "order": 1,
                    "key": "new_business",
                    "title": "New Business",
                    "content": "short",
                },
            ]
        )
        await db_session.execute(
            text(
                "INSERT INTO meeting_minutes (id, organization_id, title, meeting_type, "
                "meeting_date, status, sections, chief_report, treasurer_report, "
                "created_by) VALUES (:id, :org, 'October meeting', 'business', "
                "'2026-10-01', 'approved', :sections, :chief, :treasurer, :by)"
            ),
            {
                "id": minutes_id,
                "org": org_id,
                "sections": sections,
                "chief": long_text,
                "treasurer": "$1",
                "by": admin_id,
            },
        )
        await db_session.flush()
        monkeypatch.setattr(meeting_tools, "MINUTES_TEXT_CHARS", 10)
        principal = _principal(org_id, admin_id)
        body = await _call(
            server, principal, "get_minutes", minutes_id=minutes_id, section_limit=1
        )
        assert body["chief_report"] == "x" * 10
        assert body["truncated_fields"] == ["chief_report"]
        assert [s["key"] for s in body["sections"]] == ["old_business"]
        assert body["sections"][0]["content"] == "x" * 10
        assert body["sections"][0]["content_truncated"] is True
        assert body["section_total"] == 2
        assert body["sections_has_more"] is True
        pieces = []
        offset = 0
        while True:
            chunk = await _call(
                server,
                principal,
                "get_minutes_text",
                minutes_id=minutes_id,
                field="section:old_business",
                content_offset=offset,
            )
            pieces.append(chunk["content"])
            if not chunk["content_has_more"]:
                break
            offset = chunk["next_content_offset"]
        assert "".join(pieces) == long_text
        with pytest.raises(ToolError, match="Finance data is not shared"):
            await _call(
                server,
                principal,
                "get_minutes_text",
                minutes_id=minutes_id,
                field="treasurer_report",
            )
        with pytest.raises(ToolError, match="field must be one of"):
            await _call(
                server,
                principal,
                "get_minutes_text",
                minutes_id=minutes_id,
                field="secrets",
            )


class TestFourteenthRoundFindings:
    """Regressions for the fourteenth review round on #2197."""

    @pytest.mark.usefixtures("_use_test_session")
    async def test_generated_documents_are_never_exposed(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, _ = org_with_members
        report_id, sog_id = str(uuid.uuid4()), str(uuid.uuid4())
        for did, name, source in (
            (report_id, "Property return - S. Rivera", "property_return_report"),
            (sog_id, "SOG 3", None),
        ):
            await db_session.execute(
                text(
                    "INSERT INTO documents (id, organization_id, name, document_type, "
                    "status, version, source_type, content_html) VALUES "
                    "(:id, :org, :name, 'uploaded', 'active', 1, :source, '<p>x</p>')"
                ),
                {"id": did, "org": org_id, "name": name, "source": source},
            )
        await db_session.flush()
        principal = _principal(org_id, admin_id)
        listed = await _call(server, principal, "list_documents")
        assert [d["name"] for d in listed["items"]] == ["SOG 3"]
        with pytest.raises(ToolError, match="Document not found"):
            await _call(server, principal, "get_document", document_id=report_id)
        assert (await _call(server, principal, "get_document", document_id=sog_id))[
            "name"
        ] == "SOG 3"

    @pytest.mark.usefixtures("_use_test_session")
    async def test_minutes_pieces_cannot_reassemble_a_number(
        self, server, org_with_members, db_session, monkeypatch
    ):
        from app.mcp.tools import meetings as meeting_tools

        org_id, admin_id, _ = org_with_members
        minutes_id = str(uuid.uuid4())
        report = "Reach the chief on 5551234567 after hours"
        await db_session.execute(
            text(
                "INSERT INTO meeting_minutes (id, organization_id, title, meeting_type, "
                "meeting_date, status, chief_report, created_by) VALUES "
                "(:id, :org, 'November meeting', 'business', '2026-11-01', "
                "'approved', :chief, :by)"
            ),
            {"id": minutes_id, "org": org_id, "chief": report, "by": admin_id},
        )
        await db_session.flush()
        monkeypatch.setattr(
            meeting_tools, "MINUTES_TEXT_CHARS", 22
        )  # inside the number
        principal = _principal(org_id, admin_id)
        summary = await _call(server, principal, "get_minutes", minutes_id=minutes_id)
        assert "5551234567" not in summary["chief_report"]
        pieces = []
        offset = 0
        while True:
            chunk = await _call(
                server,
                principal,
                "get_minutes_text",
                minutes_id=minutes_id,
                field="chief_report",
                content_offset=offset,
            )
            pieces.append(chunk["content"])
            if not chunk["content_has_more"]:
                break
            offset = chunk["next_content_offset"]
        joined = "".join(pieces)
        assert "5551234567" not in joined
        assert "[phone removed]" in joined


class TestFifteenthRoundFindings:
    """Regressions for the fifteenth review round on #2197."""

    async def _audit_outcomes(self, db_session, org_id):
        rows = (
            (
                await db_session.execute(
                    select(AuditLog)
                    .where(
                        AuditLog.event_type == "mcp.tool_call",
                        AuditLog.organization_id == org_id,
                    )
                    .order_by(AuditLog.id)
                )
            )
            .scalars()
            .all()
        )
        return [(r.event_data["tool"], r.event_data["outcome"]) for r in rows]

    @pytest.mark.usefixtures("_use_test_session")
    async def test_write_is_refused_when_the_audit_log_cannot_be_written(
        self, server, org_with_members, db_session, monkeypatch
    ):
        """A mutation without an audit row is never made: the services commit
        for themselves, so the row is written first and its failure refuses
        the call."""
        from unittest.mock import AsyncMock

        from app.mcp import registry
        from app.models.event import Event

        org_id, admin_id, _ = org_with_members
        monkeypatch.setattr(registry, "log_audit_event", AsyncMock(return_value=None))
        principal = _principal(org_id, admin_id, access_mode="read_write")
        start = datetime.now(timezone.utc) + timedelta(days=3)
        with pytest.raises(ToolError, match="audit log is unavailable"):
            await _call(
                server,
                principal,
                "create_event_draft",
                title="Unaudited drill",
                start_datetime=start.isoformat(),
                end_datetime=(start + timedelta(hours=2)).isoformat(),
            )
        created = (
            await db_session.execute(
                select(Event).where(
                    Event.organization_id == org_id, Event.title == "Unaudited drill"
                )
            )
        ).scalar_one_or_none()
        assert created is None

    @pytest.mark.usefixtures("_use_test_session")
    async def test_write_records_the_attempt_and_then_the_outcome(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, _ = org_with_members
        principal = _principal(org_id, admin_id, access_mode="read_write")
        start = datetime.now(timezone.utc) + timedelta(days=3)
        await _call(
            server,
            principal,
            "create_event_draft",
            title="Audited drill",
            start_datetime=start.isoformat(),
            end_datetime=(start + timedelta(hours=2)).isoformat(),
        )
        with pytest.raises(ToolError, match="event_type must be one of"):
            await _call(
                server,
                principal,
                "create_event_draft",
                title="Bad drill",
                start_datetime=start.isoformat(),
                end_datetime=(start + timedelta(hours=2)).isoformat(),
                event_type="parade",
            )
        assert await self._audit_outcomes(db_session, org_id) == [
            ("create_event_draft", "attempted"),
            ("create_event_draft", "ok"),
            ("create_event_draft", "attempted"),
            ("create_event_draft", "rejected"),
        ]

    @pytest.mark.usefixtures("_use_test_session")
    async def test_reads_still_succeed_when_the_audit_log_is_down(
        self, server, org_with_members, monkeypatch
    ):
        from unittest.mock import AsyncMock

        from app.mcp import registry

        org_id, admin_id, _ = org_with_members
        monkeypatch.setattr(registry, "log_audit_event", AsyncMock(return_value=None))
        profile = await _call(
            server, _principal(org_id, admin_id), "get_department_profile"
        )
        assert profile["id"] == org_id

    @pytest.mark.usefixtures("_use_test_session")
    async def test_scheduling_summary_follows_the_schedule_switch(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, _ = org_with_members
        day = date.today()
        start = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc)
        for open_to_all in (True, False):
            db_session.add(
                Shift(
                    organization_id=org_id,
                    shift_date=day,
                    start_time=start.replace(hour=8 if open_to_all else 18),
                    end_time=start.replace(hour=12 if open_to_all else 22),
                    min_staffing=2,
                    open_to_all_members=open_to_all,
                )
            )
        await db_session.flush()
        confined = await _call(
            server, _principal(org_id, admin_id), "get_scheduling_summary"
        )
        assert confined["shifts_scheduled"] == 1
        assert confined["shifts_scheduled_this_week"] == 1
        assert confined["shifts_scheduled_this_month"] == 1
        full = await _call(
            server,
            _principal(org_id, admin_id, expose_full_schedule=True),
            "get_scheduling_summary",
        )
        assert full["shifts_scheduled"] == 2

    @pytest.mark.usefixtures("_use_test_session")
    async def test_fiscal_years_are_paged(self, server, org_with_members, db_session):
        from app.models.finance import FiscalYear

        org_id, admin_id, _ = org_with_members
        for year in (2024, 2025, 2026):
            db_session.add(
                FiscalYear(
                    organization_id=org_id,
                    name=f"FY{year}",
                    start_date=date(year, 1, 1),
                    end_date=date(year, 12, 31),
                    created_by=admin_id,
                )
            )
        await db_session.flush()
        principal = _principal(org_id, admin_id, expose_finance=True)
        first = await _call(server, principal, "list_fiscal_years", limit=2)
        assert first["total"] == 3
        assert first["has_more"] is True
        assert [fy["name"] for fy in first["items"]] == ["FY2026", "FY2025"]
        rest = await _call(server, principal, "list_fiscal_years", limit=2, offset=2)
        assert [fy["name"] for fy in rest["items"]] == ["FY2024"]
        assert rest["has_more"] is False

    @pytest.mark.usefixtures("_use_test_session")
    async def test_motion_discussion_is_bounded_and_readable_in_pieces(
        self, server, org_with_members, db_session, monkeypatch
    ):
        from app.mcp.tools import meetings as meeting_tools

        org_id, admin_id, _ = org_with_members
        minutes_id = str(uuid.uuid4())
        discussion = "d" * 25
        await db_session.execute(
            text(
                "INSERT INTO meeting_minutes (id, organization_id, title, meeting_type, "
                "meeting_date, status, created_by) VALUES (:id, :org, "
                "'December meeting', 'business', '2026-12-01', 'approved', :by)"
            ),
            {"id": minutes_id, "org": org_id, "by": admin_id},
        )
        motion_id = str(uuid.uuid4())
        # Two motions with the same ``order``: the column is not unique, so
        # a motion has to be addressed by id.
        for mid, notes in ((motion_id, discussion), (str(uuid.uuid4()), "short")):
            await db_session.execute(
                text(
                    "INSERT INTO meeting_motions (id, minutes_id, `order`, "
                    "motion_text, discussion_notes) VALUES "
                    "(:id, :minutes, 0, 'Buy a new pump', :notes)"
                ),
                {"id": mid, "minutes": minutes_id, "notes": notes},
            )
        await db_session.flush()
        monkeypatch.setattr(meeting_tools, "MINUTES_TEXT_CHARS", 10)
        principal = _principal(org_id, admin_id)
        listed = await _call(server, principal, "list_minutes")
        summary = next(m for m in listed["items"] if m["id"] == minutes_id)
        assert summary["motion_count"] == 2
        assert summary["action_item_count"] == 0
        body = await _call(server, principal, "get_minutes", minutes_id=minutes_id)
        assert body["motion_count"] == 2
        motion = next(mo for mo in body["motions"] if mo["id"] == motion_id)
        assert motion["discussion_notes"] == "d" * 10
        assert motion["discussion_truncated"] is True
        pieces = []
        offset = 0
        while True:
            chunk = await _call(
                server,
                principal,
                "get_minutes_text",
                minutes_id=minutes_id,
                field=f"motion:{motion_id}",
                content_offset=offset,
            )
            pieces.append(chunk["content"])
            if not chunk["content_has_more"]:
                break
            offset = chunk["next_content_offset"]
        assert "".join(pieces) == discussion
        with pytest.raises(ToolError, match="No motion with id"):
            await _call(
                server,
                principal,
                "get_minutes_text",
                minutes_id=minutes_id,
                field=f"motion:{uuid.uuid4()}",
            )


class TestSixteenthRoundFindings:
    """Regressions for the sixteenth review round on #2197."""

    @pytest.mark.usefixtures("_use_test_session")
    async def test_built_in_finance_sections_follow_the_finance_switch(
        self, server, org_with_members, db_session
    ):
        """The trustee template's trust-fund, financial-review and audit
        sections carry figures without the word "treasurer" in them."""
        from app.models.minute import DEFAULT_TRUSTEE_SECTIONS

        org_id, admin_id, _ = org_with_members
        minutes_id = str(uuid.uuid4())
        sections = [
            {**sec, "content": f"{sec['key']} content"}
            for sec in DEFAULT_TRUSTEE_SECTIONS
        ]
        await db_session.execute(
            text(
                "INSERT INTO meeting_minutes (id, organization_id, title, meeting_type, "
                "meeting_date, status, sections, created_by) VALUES (:id, :org, "
                "'Trustees', 'trustee', '2026-10-01', 'approved', :sections, :by)"
            ),
            {
                "id": minutes_id,
                "org": org_id,
                "sections": json.dumps(sections),
                "by": admin_id,
            },
        )
        await db_session.flush()
        finance_keys = {
            "treasurer_report",
            "financial_review",
            "trust_fund_report",
            "audit_report",
        }
        all_keys = {sec["key"] for sec in DEFAULT_TRUSTEE_SECTIONS}
        assert finance_keys <= all_keys
        without = await _call(
            server,
            _principal(org_id, admin_id),
            "get_minutes",
            minutes_id=minutes_id,
            section_limit=50,
        )
        assert {s["key"] for s in without["sections"]} == all_keys - finance_keys
        with_finance = await _call(
            server,
            _principal(org_id, admin_id, expose_finance=True),
            "get_minutes",
            minutes_id=minutes_id,
            section_limit=50,
        )
        assert {s["key"] for s in with_finance["sections"]} == all_keys
        for key in ("trust_fund_report", "audit_report"):
            with pytest.raises(ToolError, match="No section named"):
                await _call(
                    server,
                    _principal(org_id, admin_id),
                    "get_minutes_text",
                    minutes_id=minutes_id,
                    field=f"section:{key}",
                )

    def test_sections_outside_the_built_in_templates_fail_closed(self):
        """A department's own section carries no metadata saying what is in
        it, so it is withheld without the finance switch: a keyword list
        cannot anticipate every name a treasurer might choose."""
        from app.mcp.tools.meetings import _is_finance_section

        for section in (
            {"key": "custom_3", "title": "Trust Fund Update"},
            {"key": "trust_fund_report", "title": "Report"},
            {"key": "fund_balance", "title": "Fund Balance"},
            {"key": "revenue_report", "title": "Revenue"},
            {"key": "accounts_payable", "title": "Accounts Payable"},
            {"key": "custom_6", "title": "Training report"},
            {"title": "No key at all"},
            "not a dict",
            # A built-in key renamed for money is still money.
            {"key": "old_business", "title": "Budget carry-over"},
        ):
            assert _is_finance_section(section), section
        for section in (
            {"key": "old_business", "title": "Old Business"},
            {"key": "chief_report", "title": "Chief's Report"},
            {"key": "roll_call", "title": "Roll Call / Attendance"},
        ):
            assert not _is_finance_section(section), section

    @pytest.mark.usefixtures("_use_test_session")
    async def test_custom_sections_follow_the_finance_switch(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, _ = org_with_members
        minutes_id = str(uuid.uuid4())
        sections = [
            {
                "order": 0,
                "key": "old_business",
                "title": "Old Business",
                "content": "x",
            },
            {
                "order": 1,
                "key": "fund_balance",
                "title": "Fund Balance",
                "content": "$9",
            },
        ]
        await db_session.execute(
            text(
                "INSERT INTO meeting_minutes (id, organization_id, title, meeting_type, "
                "meeting_date, status, sections, created_by) VALUES (:id, :org, "
                "'May meeting', 'business', '2027-05-01', 'approved', :sections, :by)"
            ),
            {
                "id": minutes_id,
                "org": org_id,
                "sections": json.dumps(sections),
                "by": admin_id,
            },
        )
        await db_session.flush()
        without = await _call(
            server, _principal(org_id, admin_id), "get_minutes", minutes_id=minutes_id
        )
        assert [s["key"] for s in without["sections"]] == ["old_business"]
        with_finance = await _call(
            server,
            _principal(org_id, admin_id, expose_finance=True),
            "get_minutes",
            minutes_id=minutes_id,
        )
        assert [s["key"] for s in with_finance["sections"]] == [
            "old_business",
            "fund_balance",
        ]

    @pytest.mark.usefixtures("_use_test_session")
    async def test_agenda_is_bounded_and_readable_in_pieces(
        self, server, org_with_members, db_session, monkeypatch
    ):
        from app.mcp.tools import meetings as meeting_tools

        org_id, admin_id, _ = org_with_members
        minutes_id = str(uuid.uuid4())
        agenda = "a" * 25
        await db_session.execute(
            text(
                "INSERT INTO meeting_minutes (id, organization_id, title, meeting_type, "
                "meeting_date, status, agenda, created_by) VALUES (:id, :org, "
                "'January meeting', 'business', '2027-01-01', 'approved', :agenda, :by)"
            ),
            {"id": minutes_id, "org": org_id, "agenda": agenda, "by": admin_id},
        )
        await db_session.flush()
        monkeypatch.setattr(meeting_tools, "MINUTES_TEXT_CHARS", 10)
        principal = _principal(org_id, admin_id)
        body = await _call(server, principal, "get_minutes", minutes_id=minutes_id)
        assert body["agenda"] == "a" * 10
        assert body["truncated_fields"] == ["agenda"]
        pieces = []
        offset = 0
        while True:
            chunk = await _call(
                server,
                principal,
                "get_minutes_text",
                minutes_id=minutes_id,
                field="agenda",
                content_offset=offset,
            )
            pieces.append(chunk["content"])
            if not chunk["content_has_more"]:
                break
            offset = chunk["next_content_offset"]
        assert "".join(pieces) == agenda


class TestSeventeenthRoundFindings:
    """Regressions for the seventeenth review round on #2197."""

    @pytest.mark.usefixtures("_use_test_session")
    async def test_open_shifts_are_returned_a_page_at_a_time(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, _ = org_with_members
        days = [date.today() + timedelta(days=n) for n in (1, 2, 3)]
        for day in days:
            start = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc)
            db_session.add(
                Shift(
                    organization_id=org_id,
                    shift_date=day,
                    start_time=start.replace(hour=8),
                    end_time=start.replace(hour=12),
                    min_staffing=2,
                    open_to_all_members=True,
                )
            )
        await db_session.flush()
        principal = _principal(org_id, admin_id)
        window = {"start_date": days[0].isoformat(), "end_date": days[-1].isoformat()}
        first = await _call(server, principal, "list_open_shifts", limit=2, **window)
        assert [s["shift_date"] for s in first["items"]] == [
            days[0].isoformat(),
            days[1].isoformat(),
        ]
        assert first["limit"] == 2
        assert first["has_more"] is True
        rest = await _call(
            server,
            principal,
            "list_open_shifts",
            limit=2,
            cursor=first["next_cursor"],
            **window,
        )
        assert [s["shift_date"] for s in rest["items"]] == [days[2].isoformat()]
        assert rest["has_more"] is False
        assert "next_cursor" not in rest

    @pytest.mark.usefixtures("_use_test_session")
    async def test_motion_text_is_bounded_and_readable_in_pieces(
        self, server, org_with_members, db_session, monkeypatch
    ):
        from app.mcp.tools import meetings as meeting_tools

        org_id, admin_id, _ = org_with_members
        minutes_id, motion_id = str(uuid.uuid4()), str(uuid.uuid4())
        wording = "m" * 25
        await db_session.execute(
            text(
                "INSERT INTO meeting_minutes (id, organization_id, title, meeting_type, "
                "meeting_date, status, created_by) VALUES (:id, :org, "
                "'February meeting', 'business', '2027-02-01', 'approved', :by)"
            ),
            {"id": minutes_id, "org": org_id, "by": admin_id},
        )
        await db_session.execute(
            text(
                "INSERT INTO meeting_motions (id, minutes_id, `order`, motion_text) "
                "VALUES (:id, :minutes, 1, :wording)"
            ),
            {"id": motion_id, "minutes": minutes_id, "wording": wording},
        )
        await db_session.flush()
        monkeypatch.setattr(meeting_tools, "MINUTES_TEXT_CHARS", 10)
        principal = _principal(org_id, admin_id)
        body = await _call(server, principal, "get_minutes", minutes_id=minutes_id)
        motion = body["motions"][0]
        assert motion["motion_text"] == "m" * 10
        assert motion["motion_text_truncated"] is True
        assert motion["discussion_truncated"] is False
        pieces = []
        offset = 0
        while True:
            chunk = await _call(
                server,
                principal,
                "get_minutes_text",
                minutes_id=minutes_id,
                field=f"motion_text:{motion_id}",
                content_offset=offset,
            )
            pieces.append(chunk["content"])
            if not chunk["content_has_more"]:
                break
            offset = chunk["next_content_offset"]
        assert "".join(pieces) == wording

    @pytest.mark.usefixtures("_use_test_session")
    async def test_meeting_agendas_are_previewed_and_readable_in_pieces(
        self, server, org_with_members, db_session, monkeypatch
    ):
        from app.mcp.tools import meetings as meeting_tools

        org_id, admin_id, _ = org_with_members
        agenda = "1. Call to order 5551234567 " + "x" * 30
        meeting = Meeting(
            organization_id=org_id,
            title="Agenda meeting",
            meeting_type=MeetingType.BUSINESS,
            meeting_date=date.today(),
            agenda=agenda,
        )
        db_session.add(meeting)
        await db_session.flush()
        monkeypatch.setattr(meeting_tools, "MINUTES_TEXT_CHARS", 12)
        principal = _principal(org_id, admin_id)
        listed = await _call(server, principal, "list_meetings")
        row = next(m for m in listed["items"] if m["id"] == meeting.id)
        assert len(row["agenda"]) == 12
        assert row["agenda_truncated"] is True
        pieces = []
        offset = 0
        while True:
            chunk = await _call(
                server,
                principal,
                "get_meeting_agenda",
                meeting_id=meeting.id,
                content_offset=offset,
            )
            pieces.append(chunk["content"])
            if not chunk["content_has_more"]:
                break
            offset = chunk["next_content_offset"]
        joined = "".join(pieces)
        assert "5551234567" not in joined
        assert joined.endswith("x" * 30)
        assert chunk["title"] == "Agenda meeting"
        with pytest.raises(ToolError, match="Meeting not found"):
            await _call(
                server, principal, "get_meeting_agenda", meeting_id=str(uuid.uuid4())
            )


class TestEighteenthRoundFindings:
    """Regressions for the eighteenth review round on #2197."""

    @pytest.mark.usefixtures("_use_test_session")
    async def test_motions_and_action_items_are_paged(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, _ = org_with_members
        minutes_id = str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO meeting_minutes (id, organization_id, title, meeting_type, "
                "meeting_date, status, created_by) VALUES (:id, :org, "
                "'March meeting', 'business', '2027-03-01', 'approved', :by)"
            ),
            {"id": minutes_id, "org": org_id, "by": admin_id},
        )
        for order in range(3):
            await db_session.execute(
                text(
                    "INSERT INTO meeting_motions (id, minutes_id, `order`, motion_text) "
                    "VALUES (:id, :minutes, :order, :wording)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "minutes": minutes_id,
                    "order": order,
                    "wording": f"Motion {order}",
                },
            )
        for n in range(2):
            await db_session.execute(
                text(
                    "INSERT INTO minutes_action_items (id, minutes_id, description) "
                    "VALUES (:id, :minutes, :description)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "minutes": minutes_id,
                    "description": f"Task {n}",
                },
            )
        await db_session.flush()
        principal = _principal(org_id, admin_id)
        body = await _call(
            server,
            principal,
            "get_minutes",
            minutes_id=minutes_id,
            motion_limit=2,
            action_item_limit=1,
        )
        assert body["motion_count"] == 3
        assert body["motion_total"] == 3
        assert [mo["motion_text"] for mo in body["motions"]] == [
            "Motion 0",
            "Motion 1",
        ]
        assert body["motions_has_more"] is True
        assert body["action_item_count"] == 2
        assert body["action_item_total"] == 2
        assert len(body["action_items"]) == 1
        assert body["action_items_has_more"] is True
        rest = await _call(
            server,
            principal,
            "get_minutes",
            minutes_id=minutes_id,
            motion_offset=2,
            motion_limit=2,
            action_item_offset=1,
            action_item_limit=1,
        )
        assert [mo["motion_text"] for mo in rest["motions"]] == ["Motion 2"]
        assert rest["motions_has_more"] is False
        assert len(rest["action_items"]) == 1
        assert rest["action_items_has_more"] is False

    @pytest.mark.usefixtures("_use_test_session")
    async def test_requirement_progress_is_paged(
        self, server, org_with_members, db_session
    ):
        from app.models.training import (
            RequirementFrequency,
            RequirementType,
            TrainingRequirement,
        )

        org_id, admin_id, member_id = org_with_members
        for name in ("Annual hours", "Driver hours", "EMS hours"):
            db_session.add(
                TrainingRequirement(
                    organization_id=org_id,
                    name=name,
                    requirement_type=RequirementType.HOURS,
                    frequency=RequirementFrequency.ANNUAL,
                    required_hours=10,
                    applies_to_all=True,
                    active=True,
                )
            )
        await db_session.flush()
        principal = _principal(org_id, admin_id)
        first = await _call(
            server,
            principal,
            "get_member_requirements_progress",
            member_id=member_id,
            limit=2,
        )
        assert first["total"] == 3
        assert first["has_more"] is True
        names = [p["requirement_name"] for p in first["items"]]
        assert names == ["Annual hours", "Driver hours"]
        rest = await _call(
            server,
            principal,
            "get_member_requirements_progress",
            member_id=member_id,
            limit=2,
            offset=2,
        )
        assert [p["requirement_name"] for p in rest["items"]] == ["EMS hours"]
        assert rest["has_more"] is False


class TestNineteenthRoundFindings:
    """Regressions for the nineteenth review round on #2197."""

    @pytest.mark.usefixtures("_use_test_session")
    async def test_open_action_item_descriptions_are_bounded_and_readable(
        self, server, org_with_members, db_session, monkeypatch
    ):
        from app.mcp.tools import meetings as meeting_tools

        org_id, admin_id, _ = org_with_members
        meeting = Meeting(
            organization_id=org_id,
            title="Task meeting",
            meeting_type=MeetingType.BUSINESS,
            meeting_date=date.today(),
        )
        db_session.add(meeting)
        await db_session.flush()
        description = "Call 5551234567 and " + "t" * 30
        item = MeetingActionItem(
            organization_id=org_id,
            meeting_id=meeting.id,
            description=description,
            status=ActionItemStatus.OPEN,
        )
        db_session.add(item)
        await db_session.flush()
        monkeypatch.setattr(meeting_tools, "MINUTES_TEXT_CHARS", 12)
        principal = _principal(org_id, admin_id)
        listed = await _call(server, principal, "list_open_action_items")
        row = next(i for i in listed["items"] if i["id"] == item.id)
        assert len(row["description"]) == 12
        assert row["description_truncated"] is True
        pieces = []
        offset = 0
        while True:
            chunk = await _call(
                server,
                principal,
                "get_action_item_description",
                action_item_id=item.id,
                content_offset=offset,
            )
            pieces.append(chunk["content"])
            if not chunk["content_has_more"]:
                break
            offset = chunk["next_content_offset"]
        joined = "".join(pieces)
        assert "5551234567" not in joined
        assert joined.endswith("t" * 30)
        assert chunk["meeting_id"] == meeting.id
        with pytest.raises(ToolError, match="Action item not found"):
            await _call(
                server,
                principal,
                "get_action_item_description",
                action_item_id=str(uuid.uuid4()),
            )

    @pytest.mark.usefixtures("_use_test_session")
    async def test_minutes_attendees_and_action_item_text_are_bounded(
        self, server, org_with_members, db_session, monkeypatch
    ):
        from app.mcp.tools import meetings as meeting_tools

        org_id, admin_id, _ = org_with_members
        minutes_id, item_id = str(uuid.uuid4()), str(uuid.uuid4())
        attendees = [f"Member {n}" for n in range(5)]
        await db_session.execute(
            text(
                "INSERT INTO meeting_minutes (id, organization_id, title, meeting_type, "
                "meeting_date, status, attendees, created_by) VALUES (:id, :org, "
                "'April meeting', 'business', '2027-04-01', 'approved', :attendees, :by)"
            ),
            {
                "id": minutes_id,
                "org": org_id,
                "attendees": json.dumps(attendees),
                "by": admin_id,
            },
        )
        await db_session.execute(
            text(
                "INSERT INTO minutes_action_items (id, minutes_id, description) "
                "VALUES (:id, :minutes, :description)"
            ),
            {"id": item_id, "minutes": minutes_id, "description": "d" * 25},
        )
        await db_session.flush()
        monkeypatch.setattr(meeting_tools, "MINUTES_TEXT_CHARS", 10)
        principal = _principal(org_id, admin_id)
        body = await _call(
            server, principal, "get_minutes", minutes_id=minutes_id, attendee_limit=2
        )
        assert body["attendees"] == ["Member 0", "Member 1"]
        assert body["attendee_total"] == 5
        assert body["attendees_has_more"] is True
        rest = await _call(
            server,
            principal,
            "get_minutes",
            minutes_id=minutes_id,
            attendee_offset=4,
            attendee_limit=2,
        )
        assert rest["attendees"] == ["Member 4"]
        assert rest["attendees_has_more"] is False
        item = body["action_items"][0]
        assert item["id"] == item_id
        assert item["description"] == "d" * 10
        assert item["description_truncated"] is True
        pieces = []
        offset = 0
        while True:
            chunk = await _call(
                server,
                principal,
                "get_minutes_text",
                minutes_id=minutes_id,
                field=f"action_item:{item_id}",
                content_offset=offset,
            )
            pieces.append(chunk["content"])
            if not chunk["content_has_more"]:
                break
            offset = chunk["next_content_offset"]
        assert "".join(pieces) == "d" * 25


class TestTwentiethRoundFindings:
    """Regressions for the twentieth review round on #2197."""

    @pytest.mark.usefixtures("_use_test_session")
    async def test_a_draft_created_by_claude_does_not_send_reminders(
        self, server, org_with_members, db_session
    ):
        from app.models.event import Event

        org_id, admin_id, _ = org_with_members
        principal = _principal(org_id, admin_id, access_mode="read_write")
        start = datetime.now(timezone.utc) + timedelta(hours=12)
        created = await _call(
            server,
            principal,
            "create_event_draft",
            title="Mandatory drill",
            start_datetime=start.isoformat(),
            end_datetime=(start + timedelta(hours=2)).isoformat(),
            is_mandatory=True,
        )
        event = (
            await db_session.execute(select(Event).where(Event.id == created["id"]))
        ).scalar_one()
        assert event.is_draft is True
        assert event.send_reminders is False

    @pytest.mark.usefixtures("_use_test_session")
    async def test_the_reminder_scheduler_skips_drafts(
        self, org_with_members, db_session
    ):
        """A draft is unpublished, so the department is not paged about it
        even when its reminder settings say otherwise."""
        from app.models.event import Event, EventType
        from app.services.scheduled_tasks import run_event_reminders

        org_id, admin_id, _ = org_with_members
        start = datetime.now(timezone.utc) + timedelta(hours=12)
        event = Event(
            organization_id=org_id,
            title="Draft drill",
            event_type=EventType.TRAINING,
            start_datetime=start,
            end_datetime=start + timedelta(hours=2),
            is_draft=True,
            send_reminders=True,
            reminder_target="all",
            created_by=admin_id,
        )
        db_session.add(event)
        await db_session.flush()
        result = await run_event_reminders(db_session)
        assert result["total_in_app_reminders"] == 0
        # The same event, published, is what the scheduler exists to send.
        event.is_draft = False
        await db_session.flush()
        result = await run_event_reminders(db_session)
        assert result["total_in_app_reminders"] > 0


class TestTwentySecondRoundFindings:
    """Regressions for the twenty-second review round on #2197."""

    @pytest.mark.usefixtures("_use_test_session")
    async def test_event_descriptions_are_bounded_and_readable_in_pieces(
        self, server, org_with_members, db_session, monkeypatch
    ):
        from app.mcp.tools import events as event_tools
        from app.models.event import Event, EventType

        org_id, admin_id, _ = org_with_members
        description = "Bring gear. Call 5551234567. " + "e" * 30
        event = Event(
            organization_id=org_id,
            title="Long drill",
            event_type=EventType.TRAINING,
            description=description,
            start_datetime=datetime(2030, 2, 1, 10, tzinfo=timezone.utc),
            end_datetime=datetime(2030, 2, 1, 12, tzinfo=timezone.utc),
            created_by=admin_id,
        )
        db_session.add(event)
        await db_session.flush()
        monkeypatch.setattr(event_tools, "EVENT_TEXT_CHARS", 12)
        principal = _principal(org_id, admin_id)
        listed = await _call(server, principal, "list_events")
        row = next(e for e in listed["items"] if e["id"] == event.id)
        assert len(row["description"]) == 12
        assert row["description_truncated"] is True
        one = await _call(server, principal, "get_event", event_id=event.id)
        assert one["description_truncated"] is True
        pieces = []
        offset = 0
        while True:
            chunk = await _call(
                server,
                principal,
                "get_event_description",
                event_id=event.id,
                content_offset=offset,
            )
            pieces.append(chunk["content"])
            if not chunk["content_has_more"]:
                break
            offset = chunk["next_content_offset"]
        joined = "".join(pieces)
        assert "5551234567" not in joined
        assert joined.endswith("e" * 30)
        assert chunk["title"] == "Long drill"
        with pytest.raises(ToolError, match="Event not found"):
            await _call(
                server, principal, "get_event_description", event_id=str(uuid.uuid4())
            )


class TestTwentyFourthRoundFindings:
    """Regressions for the twenty-fourth review round on #2197."""

    @pytest.mark.usefixtures("_use_test_session")
    async def test_minutes_child_pages_are_fetched_in_sql_and_ordered_by_id(
        self, server, org_with_members, db_session
    ):
        """Motions sharing an ``order`` still page without repeats or gaps,
        and the detail never loads the whole collection to answer for a
        one-row page."""
        from app.models.minute import MeetingMinutes

        org_id, admin_id, _ = org_with_members
        minutes_id = str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO meeting_minutes (id, organization_id, title, meeting_type, "
                "meeting_date, status, created_by) VALUES (:id, :org, "
                "'June meeting', 'business', '2027-06-01', 'approved', :by)"
            ),
            {"id": minutes_id, "org": org_id, "by": admin_id},
        )
        motion_ids = sorted(str(uuid.uuid4()) for _ in range(3))
        for mid in motion_ids:
            await db_session.execute(
                text(
                    "INSERT INTO meeting_motions (id, minutes_id, `order`, motion_text) "
                    "VALUES (:id, :minutes, 0, 'Same order')"
                ),
                {"id": mid, "minutes": minutes_id},
            )
        await db_session.flush()
        principal = _principal(org_id, admin_id)
        seen = []
        for offset in range(3):
            body = await _call(
                server,
                principal,
                "get_minutes",
                minutes_id=minutes_id,
                motion_offset=offset,
                motion_limit=1,
            )
            assert body["motion_total"] == 3
            assert len(body["motions"]) == 1
            seen.append(body["motions"][0]["id"])
        assert seen == motion_ids
        # The service leaves the collections unloaded for this caller.
        from app.services.minute_service import MinuteService

        row = await MinuteService(db_session).get_minutes(
            minutes_id, uuid.UUID(org_id), restricted=True, load_children=False
        )
        assert "motions" not in row.__dict__
        assert isinstance(row, MeetingMinutes)

    @pytest.mark.usefixtures("_use_test_session")
    async def test_calls_the_sdk_rejects_are_audited(
        self, server, org_with_members, db_session
    ):
        """An unknown tool or arguments that fail the schema never reach the
        wrapper; the server records them so a probing key leaves a trail."""
        org_id, admin_id, _ = org_with_members
        principal = _principal(org_id, admin_id)
        with bind_principal(principal):
            with pytest.raises(ToolError, match="Unknown tool"):
                await server.call_tool("no_such_tool", {})
            with pytest.raises(ToolError):
                await server.call_tool("get_member", {"member_id": ["not", "text"]})
            # A call the wrapper itself rejects is recorded exactly once.
            with pytest.raises(ToolError, match="Member not found"):
                await server.call_tool("get_member", {"member_id": str(uuid.uuid4())})
        rows = (
            (
                await db_session.execute(
                    select(AuditLog)
                    .where(
                        AuditLog.event_type == "mcp.tool_call",
                        AuditLog.organization_id == org_id,
                    )
                    .order_by(AuditLog.id)
                )
            )
            .scalars()
            .all()
        )
        outcomes = [(r.event_data["tool"], r.event_data["outcome"]) for r in rows]
        assert outcomes == [
            ("no_such_tool", "rejected"),
            ("get_member", "rejected"),
            ("get_member", "rejected"),
        ]
        assert rows[1].event_data["arguments"] == {"member_id": ["not", "text"]}

    @pytest.mark.usefixtures("_use_test_session")
    async def test_naming_a_medical_supply_is_refused_without_an_id(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, _ = org_with_members
        category = InventoryCategory(
            organization_id=org_id, name="Trauma supplies", item_type=ItemType.MEDICAL
        )
        db_session.add(category)
        await db_session.flush()
        db_session.add(
            InventoryItem(
                organization_id=org_id,
                category_id=category.id,
                name="Gauze rolls",
                quantity=1,
            )
        )
        await db_session.flush()
        principal = _principal(org_id, admin_id, access_mode="read_write")
        for name in ("Gauze rolls", "  gauze ROLLS ", "Trauma supplies"):
            with pytest.raises(ToolError, match="Medical supplies"):
                await _call(
                    server,
                    principal,
                    "create_reorder_request",
                    item_name=name,
                    quantity=2,
                )
        created = await _call(
            server,
            principal,
            "create_reorder_request",
            item_name="Wildland gloves",
            quantity=2,
        )
        assert created["item_name"] == "Wildland gloves"

    @pytest.mark.usefixtures("_use_test_session")
    async def test_maintenance_text_is_bounded_and_readable_in_pieces(
        self, server, org_with_members, db_session, monkeypatch
    ):
        from app.mcp.tools import apparatus as apparatus_tools
        from app.models.apparatus import (
            Apparatus,
            ApparatusMaintenance,
            ApparatusMaintenanceType,
            ApparatusStatus,
            ApparatusType,
            MaintenanceCategory,
        )

        org_id, admin_id, _ = org_with_members
        kind = ApparatusType(organization_id=org_id, name="Engine", code="ENG")
        status = ApparatusStatus(organization_id=org_id, name="In Service", code="IS")
        db_session.add_all([kind, status])
        await db_session.flush()
        unit = Apparatus(
            organization_id=org_id,
            unit_number="E1",
            name="Engine 1",
            apparatus_type_id=kind.id,
            status_id=status.id,
        )
        db_session.add(unit)
        await db_session.flush()
        mtype = ApparatusMaintenanceType(
            organization_id=org_id,
            name="Pump test",
            code="PUMP",
            category=MaintenanceCategory.INSPECTION,
        )
        db_session.add(mtype)
        await db_session.flush()
        findings = "Call the shop on 5551234567. " + "f" * 30
        record = ApparatusMaintenance(
            organization_id=org_id,
            apparatus_id=unit.id,
            maintenance_type_id=mtype.id,
            work_performed="w" * 25,
            findings=findings,
        )
        db_session.add(record)
        await db_session.flush()
        monkeypatch.setattr(apparatus_tools, "MAINTENANCE_TEXT_CHARS", 12)
        principal = _principal(org_id, admin_id)
        listed = await _call(server, principal, "list_apparatus_maintenance")
        row = next(r for r in listed["items"] if r["id"] == record.id)
        assert row["work_performed"] == "w" * 12
        assert row["work_performed_truncated"] is True
        assert len(row["findings"]) == 12
        assert row["findings_truncated"] is True
        pieces = []
        offset = 0
        while True:
            chunk = await _call(
                server,
                principal,
                "get_maintenance_record_text",
                record_id=record.id,
                field="findings",
                content_offset=offset,
            )
            pieces.append(chunk["content"])
            if not chunk["content_has_more"]:
                break
            offset = chunk["next_content_offset"]
        joined = "".join(pieces)
        assert "5551234567" not in joined
        assert joined.endswith("f" * 30)
        with pytest.raises(ToolError, match="field must be one of"):
            await _call(
                server,
                principal,
                "get_maintenance_record_text",
                record_id=record.id,
                field="cost",
            )
        with pytest.raises(ToolError, match="Maintenance record not found"):
            await _call(
                server,
                principal,
                "get_maintenance_record_text",
                record_id=str(uuid.uuid4()),
                field="findings",
            )


class TestReviewFindings:
    """Regressions for the first review round on #2197."""

    @pytest.mark.usefixtures("_use_test_session")
    async def test_get_event_reports_not_found_for_an_unknown_id(
        self, server, org_with_members
    ):
        org_id, admin_id, _ = org_with_members
        with pytest.raises(ToolError, match="Event not found"):
            await _call(
                server,
                _principal(org_id, admin_id),
                "get_event",
                event_id=str(uuid.uuid4()),
            )

    @pytest.mark.usefixtures("_use_test_session")
    async def test_pages_without_a_count_say_whether_there_is_more(
        self, server, org_with_members
    ):
        org_id, admin_id, _ = org_with_members
        principal = _principal(org_id, admin_id)
        body = await _call(server, principal, "list_events", limit=1)
        assert "total" not in body
        assert body["has_more"] is False
        roster = await _call(server, principal, "list_members", limit=1)
        assert roster["total"] == 2
        assert roster["has_more"] is True

    @pytest.mark.usefixtures("_use_test_session")
    async def test_documents_honour_ancestor_folder_restrictions(
        self, server, org_with_members, db_session
    ):
        """An organization-visible child under a leadership-only parent is
        not open: restrictions compose down the tree, as the documents
        service evaluates them for a member."""
        org_id, admin_id, _ = org_with_members
        parent_id, child_id, open_id = (str(uuid.uuid4()) for _ in range(3))
        for fid, name, parent, vis in (
            (parent_id, "Leadership", None, "leadership"),
            (child_id, "Under leadership", parent_id, "organization"),
            (open_id, "Open", None, "organization"),
        ):
            await db_session.execute(
                text(
                    "INSERT INTO document_folders (id, organization_id, name, slug, "
                    "visibility, parent_id, is_system, sort_order) VALUES "
                    "(:id, :org, :name, :slug, :vis, :parent, 0, 0)"
                ),
                {
                    "id": fid,
                    "org": org_id,
                    "name": name,
                    "slug": f"{name.lower().replace(' ', '-')}-{fid[:6]}",
                    "vis": vis,
                    "parent": parent,
                },
            )
        for did, folder, name in (
            (str(uuid.uuid4()), child_id, "Board packet"),
            (str(uuid.uuid4()), open_id, "SOG 1"),
        ):
            await db_session.execute(
                text(
                    "INSERT INTO documents (id, organization_id, folder_id, name, "
                    "document_type, status, version) VALUES "
                    "(:id, :org, :folder, :name, 'uploaded', 'active', 1)"
                ),
                {"id": did, "org": org_id, "folder": folder, "name": name},
            )
        await db_session.flush()
        principal = _principal(org_id, admin_id)
        listed = await _call(server, principal, "list_documents")
        assert [d["name"] for d in listed["items"]] == ["SOG 1"]
        with pytest.raises(ToolError, match="Folder not found"):
            await _call(server, principal, "list_documents", folder_id=child_id)

    @pytest.mark.usefixtures("_use_test_session")
    async def test_minutes_sections_drop_finance_unless_shared(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, _ = org_with_members
        minutes_id = str(uuid.uuid4())
        sections = json.dumps(
            [
                {
                    "order": 0,
                    "key": "old_business",
                    "title": "Agenda",
                    "content": "Roll call",
                },
                {
                    "order": 1,
                    "key": "treasurer_report",
                    "title": "Treasurer's Report",
                    "content": "$4,210 in checking",
                },
                {
                    "order": 2,
                    "key": "custom_1",
                    "title": "Budget review",
                    "content": "Discussed",
                },
                {
                    "order": 3,
                    "key": "chief_report",
                    "title": "Chief's Report",
                    "content": "Quiet month",
                },
            ]
        )
        await db_session.execute(
            text(
                "INSERT INTO meeting_minutes (id, organization_id, title, meeting_type, "
                "meeting_date, status, sections, created_by) VALUES "
                "(:id, :org, 'September business meeting', 'business', '2026-09-01', "
                "'approved', :sections, :by)"
            ),
            {"id": minutes_id, "org": org_id, "sections": sections, "by": admin_id},
        )
        await db_session.flush()
        hidden = await _call(
            server, _principal(org_id, admin_id), "get_minutes", minutes_id=minutes_id
        )
        assert [s["key"] for s in hidden["sections"]] == [
            "old_business",
            "chief_report",
        ]
        assert "treasurer_report" not in hidden
        shown = await _call(
            server,
            _principal(org_id, admin_id, expose_finance=True),
            "get_minutes",
            minutes_id=minutes_id,
        )
        assert [s["key"] for s in shown["sections"]] == [
            "old_business",
            "treasurer_report",
            "custom_1",
            "chief_report",
        ]
        # The switch alone is not enough once the Finance module is off.
        module_off = await _call(
            server,
            _principal(
                org_id,
                admin_id,
                expose_finance=True,
                enabled_modules=frozenset(
                    {"members", "events", "integrations", "minutes"}
                ),
            ),
            "get_minutes",
            minutes_id=minutes_id,
        )
        assert [s["key"] for s in module_off["sections"]] == [
            "old_business",
            "chief_report",
        ]
        assert "treasurer_report" not in module_off

    @pytest.mark.usefixtures("_use_test_session")
    async def test_free_text_is_scrubbed_of_contact_details(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, _ = org_with_members
        await db_session.execute(
            text(
                "UPDATE organizations SET website = 'https://x.test', "
                "county = 'Call 555-123-4567 or chief@x.test' WHERE id = :id"
            ),
            {"id": org_id},
        )
        await db_session.flush()
        profile = await _call(
            server, _principal(org_id, admin_id), "get_department_profile"
        )
        assert profile["county"] == "Call [phone removed] or [email removed]"


class TestTwentyFifthRoundFindings:
    """Regressions for the twenty-fifth review round on #2197."""

    @pytest.mark.usefixtures("_use_test_session")
    async def test_election_descriptions_are_bounded_and_read_in_pieces(
        self, server, org_with_members, db_session, monkeypatch
    ):
        from app.mcp.tools import elections as election_tools
        from app.models.election import Election, ElectionStatus

        org_id, admin_id, _ = org_with_members
        now = datetime.now(timezone.utc)
        election = Election(
            organization_id=org_id,
            title="Officer election",
            description="Call the secretary on 5551234567. " + "e" * 60,
            start_date=now - timedelta(days=1),
            end_date=now + timedelta(days=1),
            status=ElectionStatus.OPEN,
        )
        db_session.add(election)
        await db_session.flush()
        monkeypatch.setattr(election_tools, "ELECTION_TEXT_CHARS", 12)
        principal = _principal(org_id, admin_id)
        listed = await _call(server, principal, "list_elections")
        row = next(e for e in listed["items"] if e["id"] == election.id)
        assert len(row["description"]) == 12
        assert row["description_truncated"] is True
        pieces = []
        offset = 0
        while True:
            chunk = await _call(
                server,
                principal,
                "get_election_description",
                election_id=election.id,
                content_offset=offset,
            )
            pieces.append(chunk["content"])
            if not chunk["content_has_more"]:
                break
            offset = chunk["next_content_offset"]
        joined = "".join(pieces)
        assert "5551234567" not in joined
        assert joined.endswith("e" * 60)
        assert chunk["title"] == "Officer election"
        with pytest.raises(ToolError, match="Election not found"):
            await _call(
                server,
                principal,
                "get_election_description",
                election_id=str(uuid.uuid4()),
            )

    @pytest.mark.usefixtures("_use_test_session")
    async def test_shifts_sharing_a_start_page_without_repeats(
        self, server, org_with_members, db_session
    ):
        """Two shifts on the same date and start time have no order between
        them but their id; without it a page boundary could hand back one
        of them twice and the other never."""
        org_id, admin_id, _ = org_with_members
        day = date.today() + timedelta(days=7)
        start = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc)
        shift_ids = sorted(str(uuid.uuid4()) for _ in range(3))
        for shift_id in shift_ids:
            db_session.add(
                Shift(
                    id=shift_id,
                    organization_id=org_id,
                    shift_date=day,
                    start_time=start.replace(hour=8),
                    end_time=start.replace(hour=12),
                    min_staffing=2,
                    open_to_all_members=True,
                )
            )
        await db_session.flush()
        principal = _principal(org_id, admin_id)
        seen = []
        for offset in range(3):
            body = await _call(
                server,
                principal,
                "list_shifts",
                start_date=day.isoformat(),
                end_date=day.isoformat(),
                limit=1,
                offset=offset,
            )
            seen.extend(s["id"] for s in body["items"])
        assert seen == shift_ids

    async def test_low_stock_item_names_come_from_one_query(
        self, org_with_members, db_session, monkeypatch
    ):
        """The lowest five items of every low-stock category are fetched in
        one query, not one per category, and stay ordered by quantity."""
        from app.services.inventory_service import InventoryService

        org_id, _, _ = org_with_members
        for name in ("Boots", "Coats"):
            category = InventoryCategory(
                organization_id=org_id,
                name=name,
                item_type=ItemType.UNIFORM,
                low_stock_threshold=30,
            )
            db_session.add(category)
            await db_session.flush()
            for quantity in (6, 4, 2, 5, 1, 3, 7):
                db_session.add(
                    InventoryItem(
                        organization_id=org_id,
                        category_id=category.id,
                        name=f"{name} {quantity}",
                        quantity=quantity,
                    )
                )
        await db_session.flush()
        original_execute = db_session.execute
        statements = []

        async def counting_execute(*args, **kwargs):
            statements.append(args[0])
            return await original_execute(*args, **kwargs)

        monkeypatch.setattr(db_session, "execute", counting_execute)
        low = await InventoryService(db_session).get_low_stock_items(uuid.UUID(org_id))
        assert len(statements) == 2
        assert [c["category_name"] for c in low] == ["Boots", "Coats"]
        assert [i["quantity"] for i in low[0]["items"]] == [1, 2, 3, 4, 5]
        assert [i["name"] for i in low[1]["items"]] == [
            f"Coats {n}" for n in (1, 2, 3, 4, 5)
        ]
        assert low[0]["current_stock"] == 28


class TestTwentySixthRoundFindings:
    """Regressions for the twenty-sixth review round on #2197."""

    @pytest.mark.usefixtures("_use_test_session")
    async def test_event_detail_leaves_the_rsvp_roster_unloaded(
        self, org_with_members, db_session
    ):
        from sqlalchemy import inspect as sa_inspect

        from app.models.event import Event
        from app.services.event_service import EventService

        org_id, admin_id, _ = org_with_members
        now = datetime.now(timezone.utc)
        event = Event(
            organization_id=org_id,
            title="Drill",
            event_type="training",
            start_datetime=now + timedelta(days=1),
            end_datetime=now + timedelta(days=1, hours=2),
            created_by=admin_id,
        )
        db_session.add(event)
        await db_session.flush()
        db_session.expunge(event)
        lean, _ = await EventService(db_session).get_event(
            uuid.UUID(event.id), uuid.UUID(org_id), load_rsvps=False
        )
        assert "rsvps" in sa_inspect(lean).unloaded
        db_session.expunge(lean)
        full, _ = await EventService(db_session).get_event(
            uuid.UUID(event.id), uuid.UUID(org_id)
        )
        assert "rsvps" not in sa_inspect(full).unloaded

    @pytest.mark.usefixtures("_use_test_session")
    async def test_shift_notes_are_bounded_and_read_in_pieces(
        self, server, org_with_members, db_session, monkeypatch
    ):
        from app.mcp.tools import scheduling as scheduling_tools

        org_id, admin_id, _ = org_with_members
        day = date.today() + timedelta(days=3)
        start = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc)
        notes = "Relief crew: call 5551234567. " + "n" * 40
        shifts = {}
        for open_to_all in (True, False):
            shift = Shift(
                organization_id=org_id,
                shift_date=day,
                start_time=start.replace(hour=8 if open_to_all else 18),
                end_time=start.replace(hour=12 if open_to_all else 22),
                min_staffing=2,
                open_to_all_members=open_to_all,
                notes=notes,
            )
            db_session.add(shift)
            shifts[open_to_all] = shift
        await db_session.flush()
        monkeypatch.setattr(scheduling_tools, "SHIFT_TEXT_CHARS", 12)
        principal = _principal(org_id, admin_id)
        listed = await _call(
            server, principal, "list_shifts", start_date=day.isoformat()
        )
        assert [len(s["notes"]) for s in listed["items"]] == [12]
        assert listed["items"][0]["notes_truncated"] is True
        pieces = []
        offset = 0
        while True:
            chunk = await _call(
                server,
                principal,
                "get_shift_notes",
                shift_id=shifts[True].id,
                content_offset=offset,
            )
            pieces.append(chunk["content"])
            if not chunk["content_has_more"]:
                break
            offset = chunk["next_content_offset"]
        joined = "".join(pieces)
        assert "5551234567" not in joined
        assert joined.endswith("n" * 40)
        assert chunk["shift_date"] == day.isoformat()
        # The restricted shift follows the listing's visibility rule.
        with pytest.raises(ToolError, match="Shift not found"):
            await _call(server, principal, "get_shift_notes", shift_id=shifts[False].id)
        shown = await _call(
            server,
            _principal(org_id, admin_id, expose_full_schedule=True),
            "get_shift_notes",
            shift_id=shifts[False].id,
        )
        assert shown["content_total_chars"] == len(
            notes.replace("5551234567", "[phone removed]")
        )

    @pytest.mark.usefixtures("_use_test_session")
    async def test_medical_compliance_never_carries_the_record_status(
        self, server, org_with_members, monkeypatch
    ):
        """``ComplianceItem.status`` is the screening record's outcome —
        passed, completed or waived — which is a result by another name."""
        from app.schemas.medical_screening import ComplianceItem, ComplianceSummary
        from app.services import medical_screening_service

        org_id, admin_id, member_id = org_with_members
        summary = ComplianceSummary(
            subject_id=member_id,
            subject_name="Member",
            subject_type="user",
            total_requirements=1,
            compliant_count=1,
            non_compliant_count=0,
            expiring_soon_count=0,
            is_fully_compliant=True,
            items=[
                ComplianceItem(
                    requirement_id="req-1",
                    requirement_name="Annual physical",
                    screening_type="physical",
                    is_compliant=True,
                    last_screening_date=date(2026, 1, 1),
                    expiration_date=date(2027, 1, 1),
                    days_until_expiration=120,
                    status="waived",
                )
            ],
        )

        async def fake(self, organization_id, user_id=None, prospect_id=None):
            return summary

        monkeypatch.setattr(
            medical_screening_service.MedicalScreeningService,
            "get_compliance_status",
            fake,
        )
        body = await _call(
            server,
            _principal(org_id, admin_id, expose_medical_screening=True),
            "get_member_medical_compliance",
            member_id=member_id,
        )
        assert body["is_fully_compliant"] is True
        assert body["items"] == [
            {
                "requirement_id": "req-1",
                "requirement_name": "Annual physical",
                "screening_type": "physical",
                "is_compliant": True,
                "last_screening_date": "2026-01-01",
                "expiration_date": "2027-01-01",
                "days_until_expiration": 120,
            }
        ]
        assert "waived" not in json.dumps(body)

    @pytest.mark.usefixtures("_use_test_session")
    async def test_inventory_items_sharing_a_name_page_without_repeats(
        self, server, org_with_members, db_session
    ):
        org_id, admin_id, _ = org_with_members
        category = InventoryCategory(
            organization_id=org_id, name="Uniforms", item_type=ItemType.UNIFORM
        )
        db_session.add(category)
        await db_session.flush()
        item_ids = sorted(str(uuid.uuid4()) for _ in range(3))
        for item_id in item_ids:
            db_session.add(
                InventoryItem(
                    id=item_id,
                    organization_id=org_id,
                    category_id=category.id,
                    name="Class A coat",
                    quantity=1,
                )
            )
        await db_session.flush()
        principal = _principal(org_id, admin_id)
        seen = []
        for offset in range(3):
            body = await _call(
                server, principal, "list_inventory_items", limit=1, offset=offset
            )
            seen.extend(i["id"] for i in body["items"])
        assert seen == item_ids


class TestTwentySeventhRoundFindings:
    """Regressions for the twenty-seventh review round on #2197."""

    @pytest.mark.usefixtures("_use_test_session")
    async def test_event_location_details_are_bounded_and_events_page_by_id(
        self, server, org_with_members, db_session, monkeypatch
    ):
        from app.mcp.tools import events as event_tools
        from app.models.event import Event

        org_id, admin_id, _ = org_with_members
        start = datetime.now(timezone.utc) + timedelta(days=2)
        event_ids = sorted(str(uuid.uuid4()) for _ in range(3))
        for event_id in event_ids:
            db_session.add(
                Event(
                    id=event_id,
                    organization_id=org_id,
                    title="Simultaneous",
                    event_type="training",
                    start_datetime=start,
                    end_datetime=start + timedelta(hours=2),
                    location_details="Bay 2, ask for 5551234567. " + "d" * 40,
                    created_by=admin_id,
                )
            )
        await db_session.flush()
        monkeypatch.setattr(event_tools, "EVENT_TEXT_CHARS", 12)
        principal = _principal(org_id, admin_id)
        seen = []
        for offset in range(3):
            body = await _call(server, principal, "list_events", limit=1, offset=offset)
            seen.extend(e["id"] for e in body["items"])
            for row in body["items"]:
                assert len(row["location_details"]) == 12
                assert row["location_details_truncated"] is True
        assert seen == event_ids
        pieces = []
        offset = 0
        while True:
            chunk = await _call(
                server,
                principal,
                "get_event_description",
                event_id=event_ids[0],
                field="location_details",
                content_offset=offset,
            )
            pieces.append(chunk["content"])
            if not chunk["content_has_more"]:
                break
            offset = chunk["next_content_offset"]
        joined = "".join(pieces)
        assert "5551234567" not in joined
        assert joined.endswith("d" * 40)
        assert chunk["field"] == "location_details"
        with pytest.raises(ToolError, match="field must be one of"):
            await _call(
                server,
                principal,
                "get_event_description",
                event_id=event_ids[0],
                field="title",
            )

    @pytest.mark.usefixtures("_use_test_session")
    async def test_document_descriptions_are_bounded_and_read_in_pieces(
        self, server, org_with_members, db_session, monkeypatch
    ):
        from app.mcp.tools import documents as document_tools

        org_id, admin_id, _ = org_with_members
        doc_id = str(uuid.uuid4())
        description = "Ask sam@example.org. " + "x" * 40
        await db_session.execute(
            text(
                "INSERT INTO documents (id, organization_id, name, description, "
                "document_type, status, version) VALUES "
                "(:id, :org, 'SOG 7', :description, 'uploaded', 'active', 1)"
            ),
            {"id": doc_id, "org": org_id, "description": description},
        )
        await db_session.flush()
        monkeypatch.setattr(document_tools, "DOCUMENT_CONTENT_CHARS", 12)
        principal = _principal(org_id, admin_id)
        listed = await _call(server, principal, "list_documents")
        row = next(d for d in listed["items"] if d["id"] == doc_id)
        assert len(row["description"]) == 12
        assert row["description_truncated"] is True
        pieces = []
        offset = 0
        while True:
            chunk = await _call(
                server,
                principal,
                "get_document_description",
                document_id=doc_id,
                content_offset=offset,
            )
            pieces.append(chunk["content"])
            if not chunk["content_has_more"]:
                break
            offset = chunk["next_content_offset"]
        joined = "".join(pieces)
        assert "sam@example.org" not in joined
        assert joined.endswith("x" * 40)
        assert chunk["name"] == "SOG 7"
        with pytest.raises(ToolError, match="Document not found"):
            await _call(
                server,
                principal,
                "get_document_description",
                document_id=str(uuid.uuid4()),
            )

    @pytest.mark.usefixtures("_use_test_session")
    async def test_facility_descriptions_are_bounded_and_read_in_pieces(
        self, server, org_with_members, db_session, monkeypatch
    ):
        from app.mcp.tools import facilities as facility_tools

        org_id, admin_id, _ = org_with_members
        kind = FacilityType(organization_id=org_id, name="Station")
        state = FacilityStatus(organization_id=org_id, name="Active")
        db_session.add_all([kind, state])
        await db_session.flush()
        facility = Facility(
            organization_id=org_id,
            name="Station 3",
            facility_type_id=kind.id,
            status_id=state.id,
            description="Keyholder 555-123-4567. " + "s" * 40,
        )
        db_session.add(facility)
        await db_session.flush()
        monkeypatch.setattr(facility_tools, "FACILITY_TEXT_CHARS", 12)
        principal = _principal(org_id, admin_id)
        listed = await _call(server, principal, "list_facilities")
        row = next(f for f in listed["items"] if f["id"] == facility.id)
        assert len(row["description"]) == 12
        assert row["description_truncated"] is True
        pieces = []
        offset = 0
        while True:
            chunk = await _call(
                server,
                principal,
                "get_facility_description",
                facility_id=facility.id,
                content_offset=offset,
            )
            pieces.append(chunk["content"])
            if not chunk["content_has_more"]:
                break
            offset = chunk["next_content_offset"]
        joined = "".join(pieces)
        assert "555-123-4567" not in joined
        assert joined.endswith("s" * 40)
        assert chunk["name"] == "Station 3"
        with pytest.raises(ToolError, match="Facility not found"):
            await _call(
                server,
                principal,
                "get_facility_description",
                facility_id=str(uuid.uuid4()),
            )

    @pytest.mark.usefixtures("_use_test_session")
    async def test_budget_notes_are_bounded_and_read_in_pieces(
        self, server, org_with_members, db_session, monkeypatch
    ):
        from app.mcp.tools import finance as finance_tools
        from app.models.finance import Budget, BudgetCategory, FiscalYear

        org_id, admin_id, _ = org_with_members
        fy = FiscalYear(
            organization_id=org_id,
            name="FY2027",
            start_date=date(2027, 1, 1),
            end_date=date(2027, 12, 31),
            created_by=admin_id,
        )
        category = BudgetCategory(organization_id=org_id, name="Hose")
        db_session.add_all([fy, category])
        await db_session.flush()
        budget = Budget(
            organization_id=org_id,
            fiscal_year_id=fy.id,
            category_id=category.id,
            amount_budgeted=500,
            amount_spent=0,
            amount_encumbered=0,
            notes="Vendor rep 555-123-4567. " + "b" * 40,
            created_by=admin_id,
        )
        db_session.add(budget)
        await db_session.flush()
        monkeypatch.setattr(finance_tools, "BUDGET_TEXT_CHARS", 12)
        principal = _principal(org_id, admin_id, expose_finance=True)
        listed = await _call(server, principal, "list_budgets", fiscal_year_id=fy.id)
        row = next(b for b in listed["items"] if b["id"] == budget.id)
        assert len(row["notes"]) == 12
        assert row["notes_truncated"] is True
        pieces = []
        offset = 0
        while True:
            chunk = await _call(
                server,
                principal,
                "get_budget_notes",
                budget_id=budget.id,
                content_offset=offset,
            )
            pieces.append(chunk["content"])
            if not chunk["content_has_more"]:
                break
            offset = chunk["next_content_offset"]
        joined = "".join(pieces)
        assert "555-123-4567" not in joined
        assert joined.endswith("b" * 40)
        assert chunk["fiscal_year_id"] == fy.id
        with pytest.raises(ToolError, match="Finance data is not shared"):
            await _call(
                server,
                _principal(org_id, admin_id),
                "get_budget_notes",
                budget_id=budget.id,
            )
        with pytest.raises(ToolError, match="Budget not found"):
            await _call(
                server, principal, "get_budget_notes", budget_id=str(uuid.uuid4())
            )

    @pytest.mark.usefixtures("_use_test_session")
    async def test_maintenance_description_is_bounded_and_fleet_types_are_rows(
        self, server, org_with_members, db_session, monkeypatch
    ):
        from app.mcp.tools import apparatus as apparatus_tools
        from app.models.apparatus import (
            Apparatus,
            ApparatusMaintenance,
            ApparatusMaintenanceType,
            ApparatusStatus,
            ApparatusType,
            MaintenanceCategory,
        )

        org_id, admin_id, _ = org_with_members
        kind = ApparatusType(
            organization_id=org_id, name="Tanker (ask 555-123-4567)", code="TNK"
        )
        status = ApparatusStatus(organization_id=org_id, name="In Service", code="IS")
        db_session.add_all([kind, status])
        await db_session.flush()
        unit = Apparatus(
            organization_id=org_id,
            unit_number="T1",
            name="Tanker 1",
            apparatus_type_id=kind.id,
            status_id=status.id,
        )
        db_session.add(unit)
        await db_session.flush()
        mtype = ApparatusMaintenanceType(
            organization_id=org_id,
            name="Tank inspection",
            code="TANK",
            category=MaintenanceCategory.INSPECTION,
        )
        db_session.add(mtype)
        await db_session.flush()
        record = ApparatusMaintenance(
            organization_id=org_id,
            apparatus_id=unit.id,
            maintenance_type_id=mtype.id,
            description="Shop line 5551234567. " + "m" * 40,
        )
        db_session.add(record)
        await db_session.flush()
        monkeypatch.setattr(apparatus_tools, "MAINTENANCE_TEXT_CHARS", 12)
        principal = _principal(org_id, admin_id)
        listed = await _call(server, principal, "list_apparatus_maintenance")
        row = next(r for r in listed["items"] if r["id"] == record.id)
        assert len(row["description"]) == 12
        assert row["description_truncated"] is True
        pieces = []
        offset = 0
        while True:
            chunk = await _call(
                server,
                principal,
                "get_maintenance_record_text",
                record_id=record.id,
                field="description",
                content_offset=offset,
            )
            pieces.append(chunk["content"])
            if not chunk["content_has_more"]:
                break
            offset = chunk["next_content_offset"]
        joined = "".join(pieces)
        assert "5551234567" not in joined
        assert joined.endswith("m" * 40)
        summary = await _call(server, principal, "get_fleet_summary")
        assert summary["by_type"] == [
            {"apparatus_type": "Tanker (ask [phone removed])", "count": 1}
        ]

    @pytest.mark.usefixtures("_use_test_session")
    async def test_action_items_are_unassigned_attributed_and_never_reminded(
        self, server, org_with_members, db_session
    ):
        """The tool creates an item for an officer to assign: unassigned, so
        the due-date reminder (which goes to an assignee) has nobody to page,
        and stamped with who it is attributed to and where it came from."""
        from app.models.notification import NotificationLog
        from app.services.scheduled_tasks import run_action_item_reminders

        org_id, admin_id, _ = org_with_members
        meeting = Meeting(
            organization_id=org_id,
            title="Officers' meeting",
            meeting_type=MeetingType.BUSINESS,
            meeting_date=date.today(),
        )
        db_session.add(meeting)
        await db_session.flush()
        created = await _call(
            server,
            _principal(org_id, admin_id, access_mode="read_write"),
            "create_meeting_action_item",
            meeting_id=meeting.id,
            description="Order hose; suggested owner: the quartermaster",
            due_date=(date.today() + timedelta(days=1)).isoformat(),
            priority="high",
        )
        item = await db_session.get(MeetingActionItem, created["id"])
        assert item.assigned_to is None
        assert item.created_by == admin_id
        assert item.source == "mcp"
        assert created["created_by_member_id"] == admin_id
        assert created["source"] == "mcp"
        assert "assigned_to_member_id" not in created
        await run_action_item_reminders(db_session)
        reminders = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.organization_id == org_id,
                        NotificationLog.category == "action_items",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert reminders == []
