"""A leave of absence, end to end through the API.

The officer records the leave the way the app does (``POST
/users/leaves-of-absence``, which also writes the linked training waiver), the
member trains during it, and every screen that describes the member is read
back over HTTP: the member's own My Training, the officer's view of the member,
and the compliance matrix. The department's leave month rule is changed through
``PUT /compliance/config`` and read back the same way.

The owner's case (2026-11-02): a leave from 2025-07-01 to 2026-09-01, judged on
2026-10-21 against a rolling 12-month, 72-hour requirement.
"""

import uuid
from contextlib import asynccontextmanager
from datetime import date
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.api.dependencies import get_current_active_user, get_current_user
from app.api.v1.endpoints import (
    compliance_config,
    member_leaves,
    training,
    training_module_config,
)
from app.core.database import get_db
from app.models.audit import AuditLog
from app.models.training import (
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Position, User, user_positions

pytestmark = pytest.mark.integration

TODAY = date(2026, 10, 21)
OFFICER_PERMISSIONS = [
    "training.manage",
    "members.manage",
    "scheduling.assign",
    "settings.manage",
]


async def _today(*_args, **_kwargs):
    return TODAY


async def _user(db, org_id: str, first: str, permissions: list[str]) -> User:
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'Tester', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first.lower()}-{user_id[:8]}",
            "fn": first,
            "em": f"{user_id[:8]}@example.com",
        },
    )
    if permissions:
        position = Position(
            organization_id=org_id,
            name=f"{first} position",
            slug=f"{first.lower()}-{user_id[:8]}",
            permissions=permissions,
        )
        db.add(position)
        await db.flush()
        await db.execute(
            user_positions.insert().values(user_id=user_id, position_id=position.id)
        )
    await db.flush()
    return (
        await db.execute(
            select(User)
            .where(User.id == user_id)
            .options(selectinload(User.positions))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


@asynccontextmanager
async def _as(db, user: User):
    """An API client signed in as ``user``, with today pinned to ``TODAY``."""
    app = FastAPI()
    app.include_router(training.router, prefix="/training")
    app.include_router(training_module_config.router, prefix="/training/module-config")
    app.include_router(member_leaves.router, prefix="/users")
    app.include_router(compliance_config.router, prefix="/compliance")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_active_user] = lambda: user
    with patch(
        "app.api.v1.endpoints.training_module_config.resolve_org_today", _today
    ), patch("app.api.v1.endpoints.training.resolve_org_today", _today):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://t"
        ) as client:
            yield client


async def _seed(db, org_id: str) -> tuple[User, User, str]:
    """The officer, the member, and the member's hours requirement id."""
    officer = await _user(db, org_id, "Olive", OFFICER_PERMISSIONS)
    member = await _user(db, org_id, "Morgan", [])
    requirement = TrainingRequirement(
        organization_id=org_id,
        name="Annual Training Hours",
        requirement_type="hours",
        required_hours=72,
        frequency="annual",
        due_date_type="rolling",
        rolling_period_months=12,
    )
    db.add(requirement)
    # 23 hours earned during the leave, 3 after it: the screenshot's 26.
    for day, hours in (
        (date(2025, 11, 9), 5.0),
        (date(2025, 12, 9), 4.0),
        (date(2026, 1, 9), 2.0),
        (date(2026, 2, 9), 1.0),
        (date(2026, 4, 9), 3.0),
        (date(2026, 5, 9), 4.0),
        (date(2026, 6, 9), 1.0),
        (date(2026, 7, 9), 3.0),
        (date(2026, 10, 9), 3.0),
    ):
        db.add(
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
    await db.flush()
    return officer, member, str(requirement.id)


async def _record_leave(db, officer: User, member: User, **extra) -> dict:
    async with _as(db, officer) as client:
        response = await client.post(
            "/users/leaves-of-absence",
            json={
                "user_id": str(member.id),
                "leave_type": "leave_of_absence",
                "start_date": "2025-07-01",
                "end_date": "2026-09-01",
                **extra,
            },
        )
    assert response.status_code == 201, response.text
    return response.json()


async def _my_requirement(db, member: User, requirement_id: str) -> dict:
    async with _as(db, member) as client:
        response = await client.get("/training/module-config/my-training")
    assert response.status_code == 200, response.text
    return next(
        r for r in response.json()["requirements_detail"] if r["id"] == requirement_id
    )


async def _officer_view(db, officer: User, member: User) -> dict:
    async with _as(db, officer) as client:
        response = await client.get(
            f"/training/module-config/members/{member.id}/requirements"
        )
    assert response.status_code == 200, response.text
    return response.json()


async def _matrix_cell(db, officer: User, member: User, requirement_id: str) -> dict:
    async with _as(db, officer) as client:
        response = await client.get("/training/compliance-matrix")
    assert response.status_code == 200, response.text
    row = next(m for m in response.json()["members"] if m["user_id"] == str(member.id))
    return next(c for c in row["requirements"] if c["requirement_id"] == requirement_id)


async def _set_rule(db, officer: User, rule: str) -> None:
    async with _as(db, officer) as client:
        response = await client.put(
            "/compliance/config", json={"leave_month_rule": rule}
        )
        assert response.status_code == 200, response.text
        assert response.json()["leaveMonthRule"] == rule
        read_back = await client.get("/compliance/config")
    assert read_back.json()["leaveMonthRule"] == rule


class TestLeaveRecordedThroughTheApp:
    async def test_member_sees_the_leave_and_the_hours(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, member, req_id = await _seed(db_session, org_id)
        leave = await _record_leave(db_session, officer, member)
        assert leave["linked_training_waiver_id"]

        detail = await _my_requirement(db_session, member, req_id)

        # Full month (the default): Nov 2025 - Sep 2026 excused, Oct owes 6.
        assert detail["waived_months"] == 11
        assert detail["required_hours"] == 6.0
        assert detail["original_required_hours"] == 72
        assert detail["completed_hours"] == 26.0
        assert detail["is_met"] is True
        months = {m["month"]: m for m in detail["monthly_hours"]}
        assert months["2025-12"]["hours"] == 4.0
        assert months["2025-12"]["on_leave"] is True
        assert months["2026-10"]["waived"] is False
        # The linked waiver is the leave's own record, not a second reason:
        # the month reads as leave, and is counted once.
        assert months["2025-12"]["on_waiver"] is False
        assert detail["leave_months"] == 11
        assert detail["waiver_months"] == 0

    async def test_officer_sees_what_the_member_sees(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, member, req_id = await _seed(db_session, org_id)
        await _record_leave(db_session, officer, member)

        mine = await _my_requirement(db_session, member, req_id)
        officers = await _officer_view(db_session, officer, member)

        [theirs] = [d for d in officers["requirements_detail"] if d["id"] == req_id]
        assert theirs == mine
        assert officers["leaves_of_absence"] == [
            {
                "id": officers["leaves_of_absence"][0]["id"],
                "leave_type": "leave_of_absence",
                "start_date": "2025-07-01",
                "end_date": "2026-09-01",
                "excuses_training": True,
            }
        ]

    async def test_member_sees_their_own_leave_dates(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, member, _ = await _seed(db_session, org_id)
        await _record_leave(db_session, officer, member)

        async with _as(db_session, member) as client:
            response = await client.get("/training/module-config/my-training")
        body = response.json()

        assert body["leave_month_rule"] == "full_month"
        [leave] = body["leaves_of_absence"]
        assert (leave["start_date"], leave["end_date"]) == ("2025-07-01", "2026-09-01")
        assert leave["excuses_training"] is True
        # Dates and type only: the reason stays with the leave record.
        assert set(leave) == {
            "id",
            "leave_type",
            "start_date",
            "end_date",
            "excuses_training",
        }

    async def test_matrix_names_the_leave_once(self, db_session, setup_org_and_admin):
        org_id, _ = setup_org_and_admin
        officer, member, req_id = await _seed(db_session, org_id)
        await _record_leave(db_session, officer, member)

        cell = await _matrix_cell(db_session, officer, member, req_id)

        assert cell["waived_months"] == 11
        assert cell["leave_months"] == 11
        assert cell["waiver_months"] == 0
        assert cell["progress_required"] == 6.0
        assert cell["base_required"] == 72

    async def test_a_member_cannot_read_another_members_breakdown(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, member, _ = await _seed(db_session, org_id)
        async with _as(db_session, member) as client:
            response = await client.get(
                f"/training/module-config/members/{officer.id}/requirements"
            )
        assert response.status_code == 403


class TestExemptLeave:
    async def test_an_exempt_leave_excuses_no_training(
        self, db_session, setup_org_and_admin
    ):
        # "Exempt from training waiver" is the officer saying the member keeps
        # their training requirements through the leave.
        org_id, _ = setup_org_and_admin
        officer, member, req_id = await _seed(db_session, org_id)
        leave = await _record_leave(
            db_session, officer, member, exempt_from_training_waiver=True
        )
        assert leave["linked_training_waiver_id"] is None

        detail = await _my_requirement(db_session, member, req_id)
        async with _as(db_session, member) as client:
            listed = (await client.get("/training/module-config/my-training")).json()
        # Still listed, and labelled as not reducing the target.
        assert [lv["excuses_training"] for lv in listed["leaves_of_absence"]] == [False]

        assert detail["waived_months"] == 0
        assert detail["required_hours"] == 72
        assert detail["is_met"] is False
        assert not any(m["waived"] for m in detail["monthly_hours"])
        cell = await _matrix_cell(db_session, officer, member, req_id)
        assert cell["waived_months"] == 0


class TestDepartmentRule:
    async def test_each_rule_reaches_every_screen(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, member, req_id = await _seed(db_session, org_id)
        await _record_leave(db_session, officer, member)

        # (rule, hours owed, September's share)
        expected = [
            (
                "proportional",
                pytest.approx(11.8, abs=0.01),
                pytest.approx(1 / 30, abs=1e-4),
            ),
            ("half", 12.0, None),
            ("full_month", 6.0, 1.0),
        ]
        for rule, owed, september in expected:
            await _set_rule(db_session, officer, rule)
            mine = await _my_requirement(db_session, member, req_id)
            cell = await _matrix_cell(db_session, officer, member, req_id)
            officers = await _officer_view(db_session, officer, member)
            assert officers["leave_month_rule"] == rule
            assert mine["required_hours"] == owed, rule
            assert cell["progress_required"] == owed, rule
            months = {m["month"]: m for m in mine["monthly_hours"]}
            if september is None:
                assert months["2026-09"]["waived"] is False, rule
            else:
                assert months["2026-09"]["waived_share"] == september, rule


class TestSettingChangesAreAudited:
    """A rule change moves every member on leave at once; it leaves a record."""

    @staticmethod
    async def _entries(db, officer: User) -> list:
        result = await db.execute(
            select(AuditLog).where(
                AuditLog.event_type == "compliance_config_updated",
                AuditLog.user_id == str(officer.id),
            )
        )
        return list(result.scalars().all())

    async def test_a_rule_change_is_recorded_from_and_to(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _ = await _seed(db_session, org_id)
        await _set_rule(db_session, officer, "half")
        await _set_rule(db_session, officer, "proportional")

        entries = await self._entries(db_session, officer)
        changes = [e.event_data["changes"]["leave_month_rule"] for e in entries]
        assert {"from": "half", "to": "proportional"} in changes

    async def test_saving_unchanged_settings_records_nothing(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _ = await _seed(db_session, org_id)
        await _set_rule(db_session, officer, "half")
        before = len(await self._entries(db_session, officer))
        await _set_rule(db_session, officer, "half")
        assert len(await self._entries(db_session, officer)) == before

    async def test_email_recipients_are_not_copied_into_the_log(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, _, _ = await _seed(db_session, org_id)
        async with _as(db_session, officer) as client:
            response = await client.put(
                "/compliance/config",
                json={"report_email_recipients": ["chief@example.com"]},
            )
        assert response.status_code == 200, response.text

        [entry] = await self._entries(db_session, officer)
        assert entry.event_data["changes"]["report_email_recipients"] == {
            "changed": True
        }
        assert "chief@example.com" not in str(entry.event_data)


class TestShiftAndCallBreakdown:
    async def test_a_call_requirement_shows_its_months_and_the_leave(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        officer, member, _ = await _seed(db_session, org_id)
        calls = TrainingRequirement(
            organization_id=org_id,
            name="Calls Answered",
            requirement_type="calls",
            required_calls=24,
            training_type=TrainingType.CERTIFICATION,
            frequency="annual",
            due_date_type="rolling",
            rolling_period_months=12,
        )
        db_session.add(calls)
        for day in (date(2025, 12, 3), date(2025, 12, 20), date(2026, 10, 2)):
            db_session.add(
                TrainingRecord(
                    organization_id=org_id,
                    user_id=member.id,
                    course_name="Call",
                    training_type=TrainingType.CERTIFICATION,
                    status=TrainingStatus.COMPLETED,
                    completion_date=day,
                    hours_completed=1,
                )
            )
        await db_session.flush()
        await _record_leave(db_session, officer, member)

        detail = await _my_requirement(db_session, member, str(calls.id))

        assert detail["monthly_hours"] is None
        months = {m["month"]: m for m in detail["monthly_counts"]}
        assert months["2025-12"] == {
            "month": "2025-12",
            "count": 2,
            "waived": True,
            "waived_share": 1.0,
            "on_leave": True,
            "on_waiver": False,
        }
        assert months["2026-10"]["count"] == 1
        assert months["2026-10"]["waived"] is False
        assert sum(m["count"] for m in detail["monthly_counts"]) == 3
        # 24 a year with 11 months on leave: 2 owed, rounded down.
        assert detail["required_hours"] == 2.0
