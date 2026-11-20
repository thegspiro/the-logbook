"""
A member's own training views grade them on what their compliance profile
requires (D10).

The compliance matrix, the dashboard and the compliance emails resolve a
member's requirements through ``ComplianceGrading.for_member``: the member's
highest-priority matching active profile narrows the set to its
``required_requirement_ids``. My Training, the officer's view of one member,
the profile card and ``TrainingService.get_applicable_requirements`` (behind
requirement progress, the user report and the MCP tool) skipped the profile
and listed requirements the department never grades the member on. These
tests pin every one of them to the matrix's answer (CLAUDE.md pitfall 29).

Every test that failed before the fix has at least one applicable
requirement *outside* the profile, so the unfixed code lists something extra.
The guards at the end pass before and after; they pin the cases the fix must
not move.

Profiles here never share a priority: equal priorities resolve in an
undefined order.
"""

import json
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import training_module_config
from app.api.v1.endpoints.training import (
    get_compliance_matrix,
    get_compliance_summary,
)
from app.api.v1.endpoints.training_module_config import (
    get_member_requirements,
    get_my_training_summary,
)
from app.mcp import db as mcp_db
from app.mcp.principal import McpPrincipal, bind_principal
from app.mcp.server import build_server
from app.models.user import User
from app.services.training_service import TrainingService
from tests.clock_support import reread_each_test

pytestmark = [pytest.mark.integration]


def _clock() -> dict[str, Any]:
    """Read as each test starts (tests/clock_support.py), not at import."""
    now = datetime.now(timezone.utc)
    return {"_NOW": now}


(_NOW,) = _clock().values()
_reread_clock = reread_each_test(__name__, _clock)


def _today() -> date:
    # The department's calendar (UTC), not the machine's local date.
    return datetime.now(timezone.utc).date()


def _uid() -> str:
    return str(uuid.uuid4())


async def _insert_org(db: AsyncSession) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": "Profile Dept", "slug": f"profile-{org_id[:8]}"},
    )
    await db.flush()
    return org_id


async def _insert_member(
    db: AsyncSession,
    org_id: str,
    *,
    last_name: str = "Boyle",
    membership_type: str = "active",
) -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, email, "
            "password_hash, status, membership_type, compliance_exempt) "
            "VALUES (:id, :org, :un, 'Test', :ln, :em, 'hashed', 'active', "
            ":mt, 0)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"u-{user_id[:8]}",
            "ln": last_name,
            "em": f"u-{user_id[:8]}@test.com",
            "mt": membership_type,
        },
    )
    await db.flush()
    return user_id


async def _insert_hours_req(
    db: AsyncSession,
    org_id: str,
    *,
    name: str,
    required_hours: float = 24.0,
) -> str:
    req_id = _uid()
    await db.execute(
        text(
            "INSERT INTO training_requirements "
            "(id, organization_id, name, requirement_type, source, "
            "required_hours, frequency, due_date_type, period_start_month, "
            "period_start_day, applies_to_all, active, created_at, updated_at) "
            "VALUES (:id, :org, :name, 'hours', 'department', :hours, "
            "'annual', 'calendar_period', 1, 1, 1, 1, :now, :now)"
        ),
        {
            "id": req_id,
            "org": org_id,
            "name": name,
            "hours": required_hours,
            "now": _NOW,
        },
    )
    await db.flush()
    return req_id


async def _insert_record(
    db: AsyncSession, org_id: str, user_id: str, *, hours: float
) -> None:
    await db.execute(
        text(
            "INSERT INTO training_records "
            "(id, organization_id, user_id, course_name, training_type, "
            "status, completion_date, hours_completed, created_at, updated_at) "
            "VALUES (:id, :org, :uid, 'Drill', 'continuing_education', "
            "'completed', :cd, :hrs, :now, :now)"
        ),
        {
            "id": _uid(),
            "org": org_id,
            "uid": user_id,
            "cd": _today(),
            "hrs": hours,
            "now": _NOW,
        },
    )
    await db.flush()


async def _insert_compliance_config(db: AsyncSession, org_id: str) -> str:
    config_id = _uid()
    await db.execute(
        text(
            "INSERT INTO compliance_configs "
            "(id, organization_id, compliant_threshold, at_risk_threshold, "
            "threshold_type, include_current_month, created_at, updated_at) "
            "VALUES (:id, :org, 100, 75, 'percentage', 1, :now, :now)"
        ),
        {"id": config_id, "org": org_id, "now": _NOW},
    )
    await db.flush()
    return config_id


async def _insert_profile(
    db: AsyncSession,
    config_id: str,
    *,
    name: str,
    membership_types: list[str] | None = None,
    role_ids: list[str] | None = None,
    required_requirement_ids: list[str] | None = None,
    priority: int = 10,
    is_active: bool = True,
) -> str:
    profile_id = _uid()
    await db.execute(
        text(
            "INSERT INTO compliance_profiles "
            "(id, config_id, name, membership_types, role_ids, "
            "required_requirement_ids, priority, is_active, "
            "created_at, updated_at) "
            "VALUES (:id, :cfg, :name, :mt, :ri, :rr, :prio, :active, "
            ":now, :now)"
        ),
        {
            "id": profile_id,
            "cfg": config_id,
            "name": name,
            "mt": json.dumps(membership_types) if membership_types else None,
            "ri": json.dumps(role_ids) if role_ids else None,
            "rr": (
                json.dumps(required_requirement_ids)
                if required_requirement_ids is not None
                else None
            ),
            "prio": priority,
            "active": 1 if is_active else 0,
            "now": _NOW,
        },
    )
    await db.flush()
    return profile_id


async def _insert_position(db: AsyncSession, org_id: str, user_id: str) -> str:
    position_id = _uid()
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug) "
            "VALUES (:id, :org, 'Engine Company', :slug)"
        ),
        {"id": position_id, "org": org_id, "slug": f"engine-{position_id[:8]}"},
    )
    await db.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )
    await db.flush()
    return position_id


async def _load_member(db: AsyncSession, user_id: str) -> User:
    """The graded member, positions loaded.

    Profile and position matching read ``positions``; touching it unloaded
    on an AsyncSession raises MissingGreenlet, so a transient ``User`` is
    only ever the matrix's caller here, never the member graded.
    """
    return (
        await db.execute(
            select(User).where(User.id == user_id).options(selectinload(User.positions))
        )
    ).scalar_one()


async def _my_training(db: AsyncSession, user_id: str) -> dict:
    member = await _load_member(db, user_id)
    return await get_my_training_summary(db=db, current_user=member)


async def _matrix_row(db: AsyncSession, org_id: str, user_id: str) -> dict:
    caller = User(id=_uid(), organization_id=org_id)
    payload = await get_compliance_matrix(db=db, current_user=caller)
    return next(m for m in payload["members"] if m["user_id"] == user_id)


def _names(summary: dict) -> list[str]:
    return sorted(d["name"] for d in summary["requirements_detail"])


async def _company_profile_org(db: AsyncSession) -> tuple[str, str, str, str]:
    """A member whose profile requires 'Company Hours' only.

    'Officer Hours' applies to everyone and sits outside the profile; the
    member's 30 hours meet the first and not the second.
    """
    org_id = await _insert_org(db)
    user_id = await _insert_member(db, org_id)
    company = await _insert_hours_req(db, org_id, name="Company Hours")
    officer = await _insert_hours_req(
        db, org_id, name="Officer Hours", required_hours=100.0
    )
    config_id = await _insert_compliance_config(db, org_id)
    await _insert_profile(
        db,
        config_id,
        name="Line firefighters",
        membership_types=["active"],
        required_requirement_ids=[company],
    )
    await _insert_record(db, org_id, user_id, hours=30.0)
    return org_id, user_id, company, officer


class TestMyTrainingFollowsTheProfile:
    async def test_lists_only_the_profiles_requirements(self, db_session):
        _, user_id, _, _ = await _company_profile_org(db_session)

        summary = await _my_training(db_session, user_id)

        assert _names(summary) == ["Company Hours"]
        assert summary["requirements_summary"]["total_requirements"] == 1
        assert summary["requirements_summary"]["met_requirements"] == 1

    async def test_agrees_with_the_compliance_matrix(self, db_session):
        org_id, user_id, _, _ = await _company_profile_org(db_session)

        summary = await _my_training(db_session, user_id)
        row = await _matrix_row(db_session, org_id, user_id)

        assert {d["id"] for d in summary["requirements_detail"]} == {
            c["requirement_id"] for c in row["requirements"]
        }
        rs = summary["requirements_summary"]
        assert (rs["met_requirements"], rs["total_requirements"]) == (
            row["requirements_met"],
            row["requirements_total"],
        )

    async def test_officer_view_of_the_member_matches(self, db_session):
        org_id, user_id, company, _ = await _company_profile_org(db_session)
        officer = User(id=_uid(), organization_id=org_id)

        view = await get_member_requirements(
            user_id=user_id, db=db_session, current_user=officer
        )
        own = await _my_training(db_session, user_id)

        assert [d["id"] for d in view["requirements_detail"]] == [company]
        assert view["requirements_summary"] == own["requirements_summary"]

    async def test_a_profile_requiring_nothing_grades_nothing(self, db_session):
        org_id = await _insert_org(db_session)
        user_id = await _insert_member(db_session, org_id)
        await _insert_hours_req(db_session, org_id, name="Company Hours")
        config_id = await _insert_compliance_config(db_session, org_id)
        await _insert_profile(
            db_session,
            config_id,
            name="Social members",
            membership_types=["active"],
            required_requirement_ids=[],
        )

        summary = await _my_training(db_session, user_id)

        assert summary["requirements_detail"] == []
        assert summary["requirements_summary"]["total_requirements"] == 0
        assert summary["requirements_summary"]["avg_compliance"] is None

    async def test_the_highest_priority_profile_wins(self, db_session):
        org_id = await _insert_org(db_session)
        user_id = await _insert_member(db_session, org_id)
        req1 = await _insert_hours_req(db_session, org_id, name="Req One")
        req2 = await _insert_hours_req(db_session, org_id, name="Req Two")
        config_id = await _insert_compliance_config(db_session, org_id)
        await _insert_profile(
            db_session,
            config_id,
            name="A",
            membership_types=["active"],
            required_requirement_ids=[req1],
            priority=20,
        )
        await _insert_profile(
            db_session,
            config_id,
            name="B",
            membership_types=["active"],
            required_requirement_ids=[req2],
            priority=10,
        )

        summary = await _my_training(db_session, user_id)

        assert [d["id"] for d in summary["requirements_detail"]] == [req1]

    async def test_a_position_scoped_profile_narrows(self, db_session):
        org_id = await _insert_org(db_session)
        user_id = await _insert_member(db_session, org_id)
        company = await _insert_hours_req(db_session, org_id, name="Company Hours")
        await _insert_hours_req(db_session, org_id, name="Officer Hours")
        position_id = await _insert_position(db_session, org_id, user_id)
        config_id = await _insert_compliance_config(db_session, org_id)
        await _insert_profile(
            db_session,
            config_id,
            name="Engine company",
            role_ids=[position_id],
            required_requirement_ids=[company],
        )

        summary = await _my_training(db_session, user_id)

        assert [d["id"] for d in summary["requirements_detail"]] == [company]

    async def test_loads_the_compliance_config_once(self, db_session, monkeypatch):
        _, user_id, _, _ = await _company_profile_org(db_session)
        real = training_module_config._load_compliance_config
        calls: list[str] = []

        async def counting(db, org_id):
            calls.append(org_id)
            return await real(db, org_id)

        monkeypatch.setattr(training_module_config, "_load_compliance_config", counting)

        await _my_training(db_session, user_id)

        assert len(calls) == 1


class TestProfileCardFollowsTheProfile:
    async def test_requirements_total_matches_the_matrix(self, db_session):
        org_id, user_id, _, _ = await _company_profile_org(db_session)
        member = await _load_member(db_session, user_id)

        card = await get_compliance_summary(
            user_id=UUID(user_id), db=db_session, current_user=member
        )
        row = await _matrix_row(db_session, org_id, user_id)

        assert card.requirements_total == row["requirements_total"] == 1
        assert card.requirements_met == row["requirements_met"] == 1


class TestApplicableRequirementsFollowTheProfile:
    async def test_narrows_and_keeps_name_order(self, db_session):
        org_id = await _insert_org(db_session)
        user_id = await _insert_member(db_session, org_id)
        alpha = await _insert_hours_req(db_session, org_id, name="Alpha")
        await _insert_hours_req(db_session, org_id, name="Bravo")
        charlie = await _insert_hours_req(db_session, org_id, name="Charlie")
        config_id = await _insert_compliance_config(db_session, org_id)
        await _insert_profile(
            db_session,
            config_id,
            name="Line firefighters",
            membership_types=["active"],
            # The profile's own order is the reverse of the name order;
            # paging relies on the (name, id) order surviving the filter.
            required_requirement_ids=[charlie, alpha],
        )

        result = await TrainingService(db_session).get_applicable_requirements(
            UUID(user_id), org_id
        )

        assert [r.name for r in result] == ["Alpha", "Charlie"]

    async def test_user_report_leaves_out_ungraded_requirements(self, db_session):
        org_id, user_id, company, officer = await _company_profile_org(db_session)
        year_start = date(_today().year, 1, 1)

        report = await TrainingService(db_session).generate_training_report(
            organization_id=org_id,
            start_date=year_start,
            end_date=_today() + timedelta(days=1),
            user_id=UUID(user_id),
        )

        met = {str(r) for r in report.requirements_met}
        pending = {str(r) for r in report.requirements_pending}
        assert officer not in met
        assert officer not in pending
        assert company in met | pending


@pytest.fixture
def _use_test_session(db_session, monkeypatch):
    """Point the MCP tools at the rolled-back-per-test session."""

    @asynccontextmanager
    async def factory():
        yield db_session

    monkeypatch.setattr(mcp_db, "session_factory", factory)


class TestMcpToolFollowsTheProfile:
    @pytest.mark.usefixtures("_use_test_session")
    async def test_total_is_the_narrowed_count(self, db_session):
        org_id, user_id, company, _ = await _company_profile_org(db_session)
        admin_id = await _insert_member(db_session, org_id, last_name="Admin")
        principal = McpPrincipal(
            organization_id=org_id,
            key_id=_uid(),
            key_prefix="logbook_mcp_testkey0",
            issued_by_user_id=admin_id,
            access_mode="read_only",
            expose_finance=False,
            expose_medical_screening=False,
            client_ip="127.0.0.1",
        )
        tool = build_server()._tool_manager.get_tool("get_member_requirements_progress")
        assert tool is not None

        with bind_principal(principal):
            result = await tool.fn(member_id=user_id)

        assert result["total"] == 1
        assert [p["requirement_id"] for p in result["items"]] == [company]


class TestUnchangedWithoutANarrowingProfile:
    """Guards: each passes before and after the fix. A department with no
    profiles, a profile the member does not match, an inactive profile and a
    threshold-only profile all leave the member's list exactly as it was."""

    async def _two_requirements(self, db_session) -> tuple[str, str]:
        org_id = await _insert_org(db_session)
        user_id = await _insert_member(db_session, org_id)
        await _insert_hours_req(db_session, org_id, name="Company Hours")
        await _insert_hours_req(db_session, org_id, name="Officer Hours")
        return org_id, user_id

    async def _assert_both_listed(self, db_session, org_id, user_id) -> None:
        summary = await _my_training(db_session, user_id)
        assert _names(summary) == ["Company Hours", "Officer Hours"]
        assert summary["requirements_summary"]["total_requirements"] == 2
        applicable = await TrainingService(db_session).get_applicable_requirements(
            UUID(user_id), org_id
        )
        assert [r.name for r in applicable] == ["Company Hours", "Officer Hours"]

    async def test_no_compliance_config(self, db_session):
        org_id, user_id = await self._two_requirements(db_session)
        await self._assert_both_listed(db_session, org_id, user_id)

    async def test_config_without_profiles(self, db_session):
        org_id, user_id = await self._two_requirements(db_session)
        await _insert_compliance_config(db_session, org_id)
        await self._assert_both_listed(db_session, org_id, user_id)

    async def test_profile_the_member_does_not_match(self, db_session):
        org_id, user_id = await self._two_requirements(db_session)
        config_id = await _insert_compliance_config(db_session, org_id)
        await _insert_profile(
            db_session,
            config_id,
            name="Administrative",
            membership_types=["administrative"],
            required_requirement_ids=[],
        )
        await self._assert_both_listed(db_session, org_id, user_id)

    async def test_inactive_profile(self, db_session):
        org_id, user_id = await self._two_requirements(db_session)
        config_id = await _insert_compliance_config(db_session, org_id)
        await _insert_profile(
            db_session,
            config_id,
            name="Retired profile",
            membership_types=["active"],
            required_requirement_ids=[],
            is_active=False,
        )
        await self._assert_both_listed(db_session, org_id, user_id)

    async def test_threshold_only_profile(self, db_session):
        org_id, user_id = await self._two_requirements(db_session)
        config_id = await _insert_compliance_config(db_session, org_id)
        await _insert_profile(
            db_session,
            config_id,
            name="Thresholds only",
            membership_types=["active"],
            required_requirement_ids=None,
        )
        await self._assert_both_listed(db_session, org_id, user_id)
