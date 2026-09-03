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
        assert body == {"items": [], "total": 0, "has_more": False}


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
        assert rows == []


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
        assert first["next_start_date"] == days[1].isoformat()
        rest = await _call(
            server,
            principal,
            "list_open_shifts",
            start_date=first["next_start_date"],
            end_date=days[1].isoformat(),
        )
        assert [s["shift_date"] for s in rest["items"]] == [days[1].isoformat()]
        assert rest["has_more"] is False
        assert "next_start_date" not in rest
        with pytest.raises(ToolError, match="must not exceed"):
            await _call(
                server,
                principal,
                "list_open_shifts",
                start_date=days[0].isoformat(),
                end_date=(days[0] + timedelta(days=400)).isoformat(),
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
                    "key": "agenda",
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
        assert [s["key"] for s in hidden["sections"]] == ["agenda", "chief_report"]
        assert "treasurer_report" not in hidden
        shown = await _call(
            server,
            _principal(org_id, admin_id, expose_finance=True),
            "get_minutes",
            minutes_id=minutes_id,
        )
        assert [s["key"] for s in shown["sections"]] == [
            "agenda",
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
        assert [s["key"] for s in module_off["sections"]] == ["agenda", "chief_report"]
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
