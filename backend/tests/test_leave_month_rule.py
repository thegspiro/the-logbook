"""The department's leave month rule, read end to end.

``ComplianceConfig.leave_month_rule`` decides how much of a month a leave of
absence or training waiver excuses. These tests prove the setting has a reader
(CLAUDE.md pitfall 19): the fetch helpers stamp it on every period, the
member's requirement breakdown is measured by it, and the training officer's
view of a member returns the same breakdown the member sees.
"""

import ast
import uuid
from datetime import date
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, text

from app.api.v1.endpoints.training_module_config import get_member_requirements
from app.models.compliance_config import ComplianceConfig
from app.models.training import (
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
    TrainingType,
)
from app.models.user import LeaveType, MemberLeaveOfAbsence, User
from app.schemas.compliance_config import ComplianceConfigUpdate
from app.services.training_waiver_service import (
    SOURCE_LEAVE,
    fetch_org_waivers,
    fetch_user_waivers,
    get_leave_month_rule,
)

# The owner's case: a leave of absence from 2025-07-01 to 2026-09-01, judged
# on 2026-10-21 against a rolling 12-month, 72-hour requirement.
TODAY = date(2026, 10, 21)

_ENDPOINT_SOURCE = (
    Path(__file__).parents[1] / "app/api/v1/endpoints/training_module_config.py"
)


@pytest.mark.unit
class TestSchema:
    def test_update_accepts_each_rule(self):
        for rule in ("full_month", "proportional", "half"):
            assert ComplianceConfigUpdate(leave_month_rule=rule).leave_month_rule == (
                rule
            )

    def test_update_rejects_an_unknown_rule(self):
        with pytest.raises(ValidationError):
            ComplianceConfigUpdate(leave_month_rule="majority")

    def test_officer_endpoint_requires_training_manage(self):
        tree = ast.parse(_ENDPOINT_SOURCE.read_text())
        handler = next(
            node
            for node in tree.body
            if isinstance(node, ast.AsyncFunctionDef)
            and node.name == "get_member_requirements"
        )
        permissions = {
            arg.value
            for node in ast.walk(handler.args)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "require_permission"
            for arg in node.args
            if isinstance(arg, ast.Constant)
        }
        assert permissions == {"training.manage"}


async def _user(db_session, org_id: str) -> User:
    user_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Pat', 'Member', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"member-{user_id[:8]}",
            "em": f"{user_id[:8]}@example.com",
        },
    )
    return (
        await db_session.execute(select(User).where(User.id == user_id))
    ).scalar_one()


async def _org(db_session) -> str:
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Other Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"other-{org_id[:8]}"},
    )
    return org_id


def _leave(org_id: str, user_id: str) -> MemberLeaveOfAbsence:
    return MemberLeaveOfAbsence(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        user_id=user_id,
        leave_type=LeaveType.LEAVE_OF_ABSENCE,
        reason="Private reason that must not leave the leave record",
        start_date=date(2025, 7, 1),
        end_date=date(2026, 9, 1),
        active=True,
    )


async def _seed_member_on_leave(db_session, org_id: str) -> User:
    member = await _user(db_session, org_id)
    db_session.add(
        TrainingRequirement(
            organization_id=org_id,
            name="Annual Training Hours",
            requirement_type="hours",
            required_hours=72,
            frequency="annual",
            due_date_type="rolling",
            rolling_period_months=12,
        )
    )
    db_session.add(_leave(org_id, member.id))
    # Hours earned during the leave (Dec, May) still count toward the total.
    for day, hours in (
        (date(2025, 12, 9), 4.0),
        (date(2026, 5, 9), 4.0),
        (date(2026, 10, 9), 3.0),
    ):
        db_session.add(
            TrainingRecord(
                organization_id=org_id,
                user_id=member.id,
                course_name="Drill",
                training_type=TrainingType.CONTINUING_EDUCATION,
                status=TrainingStatus.COMPLETED,
                completion_date=day,
                hours_completed=hours,
            )
        )
    await db_session.flush()
    return member


async def _set_rule(db_session, org_id: str, rule: str) -> None:
    db_session.add(ComplianceConfig(organization_id=org_id, leave_month_rule=rule))
    await db_session.flush()


async def _officer_view(db_session, officer: User, member_id: str):
    async def _today(*_a, **_kw):
        return TODAY

    with patch("app.api.v1.endpoints.training_module_config.resolve_org_today", _today):
        return await get_member_requirements(
            user_id=member_id, db=db_session, current_user=officer
        )


@pytest.mark.integration
class TestReader:
    async def test_no_config_reads_as_full_month(self, db_session, setup_org_and_admin):
        org_id, _ = setup_org_and_admin
        assert await get_leave_month_rule(db_session, org_id) == "full_month"

    async def test_stored_rule_is_stamped_on_every_period(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        member = await _seed_member_on_leave(db_session, org_id)
        await _set_rule(db_session, org_id, "proportional")

        [period] = await fetch_user_waivers(db_session, org_id, member.id)
        assert period.month_rule == "proportional"
        assert period.source == SOURCE_LEAVE

        by_user = await fetch_org_waivers(db_session, org_id)
        assert [p.month_rule for p in by_user[member.id]] == ["proportional"]


@pytest.mark.integration
class TestOfficerView:
    async def test_full_month_rule_shows_leave_and_hours(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        officer = (
            await db_session.execute(select(User).where(User.id == admin_id))
        ).scalar_one()
        member = await _seed_member_on_leave(db_session, org_id)

        result = await _officer_view(db_session, officer, member.id)

        assert result["leave_month_rule"] == "full_month"
        [detail] = result["requirements_detail"]
        # Nov 2025 - Sep 2026 excused (Sep 1 is a day of leave): 1 active
        # month of 12, so 6 of the 72 hours are owed.
        assert detail["waived_months"] == 11
        assert detail["leave_months"] == 11
        assert detail["waiver_months"] == 0
        assert detail["required_hours"] == 6.0
        assert detail["completed_hours"] == 11.0
        assert detail["is_met"] is True
        months = {m["month"]: m for m in detail["monthly_hours"]}
        assert months["2025-12"]["hours"] == 4.0
        assert months["2025-12"]["on_leave"] is True
        assert months["2026-09"]["on_leave"] is True
        assert months["2026-10"]["waived"] is False

        [leave] = result["leaves_of_absence"]
        assert leave == {
            "id": leave["id"],
            "leave_type": "leave_of_absence",
            "start_date": "2025-07-01",
            "end_date": "2026-09-01",
        }

    async def test_proportional_rule_measures_the_partial_month(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        officer = (
            await db_session.execute(select(User).where(User.id == admin_id))
        ).scalar_one()
        member = await _seed_member_on_leave(db_session, org_id)
        await _set_rule(db_session, org_id, "proportional")

        result = await _officer_view(db_session, officer, member.id)

        [detail] = result["requirements_detail"]
        months = {m["month"]: m for m in detail["monthly_hours"]}
        assert months["2026-09"]["waived_share"] == pytest.approx(1 / 30, abs=1e-4)
        # 10 whole months and 1/30 of September excused: 72 * (2 - 1/30) / 12.
        assert detail["required_hours"] == pytest.approx(11.8, abs=0.01)

    async def test_a_member_of_another_department_is_not_found(
        self, db_session, setup_org_and_admin
    ):
        _, admin_id = setup_org_and_admin
        officer = (
            await db_session.execute(select(User).where(User.id == admin_id))
        ).scalar_one()
        stranger = await _user(db_session, await _org(db_session))

        with pytest.raises(HTTPException) as exc:
            await _officer_view(db_session, officer, stranger.id)
        assert exc.value.status_code == 404
