"""XC-1 sweep, scheduling and events: client-supplied FKs must be in-org.

Each fixed path is exercised against a real database with two
organizations: a reference into the other organization is refused before
anything is written, a reference into the caller's own still succeeds, and an
optional reference left empty still succeeds.

Paths covered:

* ``SchedulingService.create_pattern`` / ``update_pattern`` — ``template_id``,
  ``assigned_members[].user_id`` and ``schedule_config.day_template_id`` /
  ``night_template_id``.
* ``ShiftCompletionService.create_report`` / ``update_report`` —
  ``tasks_performed[].equipment_check_id``.
* ``PATCH /events/settings`` — ``request_pipeline.default_assignee_id``.
"""

import uuid
from datetime import date, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.models.training import (
    PatternType,
    ShiftCompletionReport,
    ShiftEquipmentCheck,
    ShiftPattern,
    ShiftTemplate,
)
from app.models.user import Organization, User
from app.schemas.event import EventSettingsUpdate, RequestPipelineUpdate
from app.services.scheduling_service import SchedulingService
from app.services.shift_completion_service import ShiftCompletionService

pytestmark = pytest.mark.integration


async def _org(db_session, name: str) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name=name,
        slug=f"xc1-se-{uuid.uuid4().hex[:8]}",
        organization_type="fire_department",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _user(db_session, org: Organization) -> User:
    tag = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"xc1-{tag}",
        email=f"xc1-{tag}@example.com",
        first_name="Test",
        last_name=tag,
        password_hash="hashed",
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _shift_template(db_session, org: Organization) -> ShiftTemplate:
    template = ShiftTemplate(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Day Shift",
        start_time_of_day="07:00",
        end_time_of_day="19:00",
        duration_hours=12.0,
    )
    db_session.add(template)
    await db_session.flush()
    return template


async def _equipment_check(db_session, org: Organization) -> ShiftEquipmentCheck:
    check = ShiftEquipmentCheck(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        check_timing="start_of_shift",
        overall_status="pass",
    )
    db_session.add(check)
    await db_session.flush()
    return check


@pytest.fixture
async def two_orgs(db_session):
    home = await _org(db_session, "XC-1 Home Department")
    away = await _org(db_session, "XC-1 Other Department")
    return {
        "home": home,
        "away": away,
        "home_user": await _user(db_session, home),
        "home_user2": await _user(db_session, home),
        "away_user": await _user(db_session, away),
        "home_template": await _shift_template(db_session, home),
        "away_template": await _shift_template(db_session, away),
        "home_check": await _equipment_check(db_session, home),
        "away_check": await _equipment_check(db_session, away),
    }


async def _pattern_count(db_session, org_id: str) -> int:
    return (
        await db_session.execute(
            select(func.count())
            .select_from(ShiftPattern)
            .where(ShiftPattern.organization_id == org_id)
        )
    ).scalar_one()


def _pattern_data(**overrides):
    data = {
        "name": "Rotation",
        "pattern_type": PatternType.DAILY,
        "start_date": date.today(),
    }
    data.update(overrides)
    return data


class TestShiftPatternReferences:
    async def test_foreign_template_is_refused(self, db_session, two_orgs):
        home = two_orgs["home"]
        svc = SchedulingService(db_session)

        pattern, err = await svc.create_pattern(
            home.id,
            _pattern_data(template_id=two_orgs["away_template"].id),
            two_orgs["home_user"].id,
        )

        assert pattern is None
        assert err == "Invalid shift template"
        assert await _pattern_count(db_session, home.id) == 0

    async def test_foreign_member_is_refused(self, db_session, two_orgs):
        home = two_orgs["home"]
        svc = SchedulingService(db_session)

        pattern, err = await svc.create_pattern(
            home.id,
            _pattern_data(
                template_id=two_orgs["home_template"].id,
                assigned_members=[
                    {"user_id": two_orgs["home_user"].id, "position": "officer"},
                    {"user_id": two_orgs["away_user"].id, "position": "firefighter"},
                ],
            ),
            two_orgs["home_user"].id,
        )

        assert pattern is None
        assert err == "Invalid member"
        assert await _pattern_count(db_session, home.id) == 0

    async def test_foreign_day_template_is_refused(self, db_session, two_orgs):
        home = two_orgs["home"]
        svc = SchedulingService(db_session)

        pattern, err = await svc.create_pattern(
            home.id,
            _pattern_data(
                pattern_type=PatternType.PLATOON,
                template_id=two_orgs["home_template"].id,
                schedule_config={
                    "cycle_pattern": ["day", "night", "off"],
                    "day_template_id": two_orgs["home_template"].id,
                    "night_template_id": two_orgs["away_template"].id,
                },
            ),
            two_orgs["home_user"].id,
        )

        assert pattern is None
        assert err == "Invalid shift template"
        assert await _pattern_count(db_session, home.id) == 0

    async def test_in_org_references_are_accepted(self, db_session, two_orgs):
        home = two_orgs["home"]
        svc = SchedulingService(db_session)

        pattern, err = await svc.create_pattern(
            home.id,
            _pattern_data(
                pattern_type=PatternType.PLATOON,
                template_id=two_orgs["home_template"].id,
                schedule_config={
                    "cycle_pattern": ["day", "off"],
                    "day_template_id": two_orgs["home_template"].id,
                },
                assigned_members=[
                    {"user_id": two_orgs["home_user"].id, "position": "officer"},
                ],
            ),
            two_orgs["home_user"].id,
        )

        assert err is None
        assert str(pattern.template_id) == two_orgs["home_template"].id

    async def test_no_template_is_still_accepted(self, db_session, two_orgs):
        svc = SchedulingService(db_session)

        pattern, err = await svc.create_pattern(
            two_orgs["home"].id, _pattern_data(), two_orgs["home_user"].id
        )

        assert err is None
        assert pattern.template_id is None

    async def test_update_refuses_foreign_template_and_member(
        self, db_session, two_orgs
    ):
        home = two_orgs["home"]
        svc = SchedulingService(db_session)
        pattern, err = await svc.create_pattern(
            home.id,
            _pattern_data(template_id=two_orgs["home_template"].id),
            two_orgs["home_user"].id,
        )
        assert err is None

        updated, err = await svc.update_pattern(
            pattern.id, home.id, {"template_id": two_orgs["away_template"].id}
        )
        assert updated is None
        assert err == "Invalid shift template"

        updated, err = await svc.update_pattern(
            pattern.id,
            home.id,
            {"assigned_members": [{"user_id": two_orgs["away_user"].id}]},
        )
        assert updated is None
        assert err == "Invalid member"

        await db_session.refresh(pattern)
        assert str(pattern.template_id) == two_orgs["home_template"].id
        assert not pattern.assigned_members

    async def test_update_accepts_in_org_and_clearing(self, db_session, two_orgs):
        home = two_orgs["home"]
        svc = SchedulingService(db_session)
        pattern, err = await svc.create_pattern(
            home.id,
            _pattern_data(template_id=two_orgs["home_template"].id),
            two_orgs["home_user"].id,
        )
        assert err is None

        updated, err = await svc.update_pattern(
            pattern.id,
            home.id,
            {
                "assigned_members": [
                    {"user_id": two_orgs["home_user2"].id, "position": "driver"}
                ]
            },
        )
        assert err is None
        assert updated.assigned_members[0]["user_id"] == two_orgs["home_user2"].id

        updated, err = await svc.update_pattern(
            pattern.id, home.id, {"template_id": None}
        )
        assert err is None
        assert updated.template_id is None

        # A partial update that does not touch a reference does not re-check it.
        updated, err = await svc.update_pattern(
            pattern.id, home.id, {"name": "Renamed"}
        )
        assert err is None
        assert updated.name == "Renamed"


async def _report_count(db_session, org_id: str) -> int:
    return (
        await db_session.execute(
            select(func.count())
            .select_from(ShiftCompletionReport)
            .where(ShiftCompletionReport.organization_id == org_id)
        )
    ).scalar_one()


async def _create_report(svc, two_orgs, tasks, review_status="approved"):
    return await svc.create_report(
        organization_id=two_orgs["home"].id,
        officer_id=two_orgs["home_user"].id,
        trainee_id=two_orgs["home_user2"].id,
        shift_date=date.today() - timedelta(days=1),
        hours_on_shift=12.0,
        tasks_performed=tasks,
        review_status=review_status,
    )


class TestShiftReportEquipmentCheckProvenance:
    async def test_foreign_equipment_check_is_refused(self, db_session, two_orgs):
        svc = ShiftCompletionService(db_session)

        with pytest.raises(ValueError, match="Invalid equipment check"):
            await _create_report(
                svc,
                two_orgs,
                [
                    {
                        "task": "Engine check",
                        "equipment_check_id": two_orgs["away_check"].id,
                    }
                ],
            )

        assert await _report_count(db_session, two_orgs["home"].id) == 0

    async def test_in_org_equipment_check_is_accepted(self, db_session, two_orgs):
        svc = ShiftCompletionService(db_session)

        report = await _create_report(
            svc,
            two_orgs,
            [
                {
                    "task": "Engine check",
                    "equipment_check_id": two_orgs["home_check"].id,
                },
                {"task": "Hose drill"},
            ],
        )

        assert report.tasks_performed[0]["equipment_check_id"] == (
            two_orgs["home_check"].id
        )

    async def test_update_refuses_foreign_equipment_check(self, db_session, two_orgs):
        svc = ShiftCompletionService(db_session)
        report = await _create_report(
            svc, two_orgs, [{"task": "Hose drill"}], review_status="draft"
        )

        with pytest.raises(ValueError, match="Invalid equipment check"):
            await svc.update_report(
                report_id=report.id,
                organization_id=two_orgs["home"].id,
                officer_id=two_orgs["home_user"].id,
                updates={
                    "tasks_performed": [
                        {
                            "task": "Engine check",
                            "equipment_check_id": two_orgs["away_check"].id,
                        }
                    ]
                },
            )

        await db_session.refresh(report)
        assert report.tasks_performed == [{"task": "Hose drill"}]

    async def test_update_accepts_in_org_equipment_check(self, db_session, two_orgs):
        svc = ShiftCompletionService(db_session)
        report = await _create_report(
            svc, two_orgs, [{"task": "Hose drill"}], review_status="draft"
        )

        updated = await svc.update_report(
            report_id=report.id,
            organization_id=two_orgs["home"].id,
            officer_id=two_orgs["home_user"].id,
            updates={
                "tasks_performed": [
                    {
                        "task": "Engine check",
                        "equipment_check_id": two_orgs["home_check"].id,
                    }
                ]
            },
        )

        assert updated.tasks_performed[0]["equipment_check_id"] == (
            two_orgs["home_check"].id
        )


class TestEventSettingsDefaultCoordinator:
    async def _update(self, db_session, user, assignee_id):
        from app.api.v1.endpoints import events as events_endpoint

        with patch.object(events_endpoint, "log_audit_event", AsyncMock()):
            return await events_endpoint.update_event_settings(
                EventSettingsUpdate(
                    request_pipeline=RequestPipelineUpdate(
                        default_assignee_id=assignee_id
                    )
                ),
                db_session,
                user,
            )

    async def _stored(self, db_session, org):
        await db_session.refresh(org)
        return (
            ((org.settings or {}).get("events") or {}).get("request_pipeline") or {}
        ).get("default_assignee_id")

    async def test_foreign_coordinator_is_refused(self, db_session, two_orgs):
        with pytest.raises(HTTPException) as exc:
            await self._update(
                db_session, two_orgs["home_user"], two_orgs["away_user"].id
            )

        assert exc.value.status_code == 400
        assert await self._stored(db_session, two_orgs["home"]) is None

    async def test_in_org_coordinator_is_accepted(self, db_session, two_orgs):
        merged = await self._update(
            db_session, two_orgs["home_user"], two_orgs["home_user2"].id
        )

        assert merged["request_pipeline"]["default_assignee_id"] == (
            two_orgs["home_user2"].id
        )

    async def test_clearing_the_coordinator_is_accepted(self, db_session, two_orgs):
        await self._update(db_session, two_orgs["home_user"], two_orgs["home_user2"].id)

        merged = await self._update(db_session, two_orgs["home_user"], None)

        assert merged["request_pipeline"]["default_assignee_id"] is None
