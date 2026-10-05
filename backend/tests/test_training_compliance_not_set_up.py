"""
A department with no active training requirements is not "100% compliant".

``compute_org_compliance_pct`` returns 100 when nothing is required, which is
arithmetically true and was shown verbatim: a training officer opening the
administration hub on a fresh install read "Compliance 100% — 20 of 20
members current" beside a Requirements panel saying "No active requirements".
The hub metric now says the measure is not set up, and the dashboard's
admin summary withholds the figure (the frontend drops the tile on None).
"""

import uuid

import pytest

from app.api.v1.endpoints.training import get_training_dashboard_summary
from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementType,
    TrainingCourse,
    TrainingProgram,
    TrainingRequirement,
    TrainingType,
)
from app.models.user import Organization, User, UserStatus
from app.services.admin_hub_service import (
    MODULE_REGISTRY,
    UNKNOWN_VALUE,
    AdminHubService,
)
from app.services.training_compliance import count_active_requirements

pytestmark = [pytest.mark.integration]


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Not Set Up Department",
        slug=f"notsetup-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _member(db_session, org) -> User:
    handle = uuid.uuid4().hex[:10]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{handle}",
        email=f"{handle}@notsetup.test",
        first_name="Test",
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
        membership_type="active",
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _requirement(db_session, org, *, active: bool) -> TrainingRequirement:
    req = TrainingRequirement(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Annual Training Hours",
        requirement_type=RequirementType.HOURS,
        required_hours=24.0,
        frequency=RequirementFrequency.ANNUAL,
        due_date_type=DueDateType.CALENDAR_PERIOD,
        applies_to_all=True,
        active=active,
    )
    db_session.add(req)
    await db_session.flush()
    return req


def _course(org, name: str, *, active: bool = True) -> TrainingCourse:
    return TrainingCourse(
        organization_id=org.id,
        name=name,
        training_type=TrainingType.CERTIFICATION,
        active=active,
    )


async def _compliance_metric(db_session, member) -> tuple[str, str]:
    ctx = await AdminHubService(db_session)._context(member)
    metric = next(
        m for m in MODULE_REGISTRY["training"].metrics if m.key == "compliance_rate"
    )
    return await metric.resolve(ctx)


class TestCountActiveRequirements:
    async def test_counts_only_active_requirements_in_the_org(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session)
        await _requirement(db_session, org, active=True)
        await _requirement(db_session, org, active=False)
        await _requirement(db_session, other, active=True)

        assert await count_active_requirements(db_session, org.id) == 1

    async def test_zero_for_a_fresh_department(self, db_session):
        org = await _org(db_session)

        assert await count_active_requirements(db_session, org.id) == 0


class TestHubComplianceMetric:
    async def test_not_set_up_when_nothing_is_required(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        await _member(db_session, org)

        value, context = await _compliance_metric(db_session, member)

        assert value == UNKNOWN_VALUE
        assert context == "no requirements set up yet"

    async def test_a_deactivated_requirement_does_not_count_as_set_up(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        await _requirement(db_session, org, active=False)

        value, _ = await _compliance_metric(db_session, member)

        assert value == UNKNOWN_VALUE

    async def test_reports_a_percentage_once_a_requirement_exists(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        await _requirement(db_session, org, active=True)

        value, context = await _compliance_metric(db_session, member)

        # Nobody has logged hours against the requirement, so nobody is current.
        assert value == "0%"
        assert context.endswith("members current")


class TestNothingApplicable:
    """TR4-4: requirements exist, but none applies to any member. There is
    nothing measured, so no figure is shown — not a vacuous 100%."""

    async def test_hub_metric_says_nothing_applies(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        req = await _requirement(db_session, org, active=True)
        req.applies_to_all = False
        req.required_membership_types = ["reserve"]  # member is "active"
        await db_session.flush()

        value, context = await _compliance_metric(db_session, member)

        assert value == UNKNOWN_VALUE
        assert context == "no requirement applies to any member"

    async def test_hub_metric_counts_only_graded_members(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        reservist = await _member(db_session, org)
        reservist.membership_type = "reserve"
        req = await _requirement(db_session, org, active=True)
        req.applies_to_all = False
        req.required_membership_types = ["reserve"]
        await db_session.flush()

        value, context = await _compliance_metric(db_session, member)

        assert value == "0%"
        assert context == "0 of 1 members current"

    async def test_dashboard_card_has_no_percentage(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        req = await _requirement(db_session, org, active=True)
        req.applies_to_all = False
        req.required_membership_types = ["reserve"]
        await db_session.flush()

        summary = await get_training_dashboard_summary(
            expiration_days=90, db=db_session, current_user=member
        )

        stats = summary["stats"]
        assert stats["compliance_percentage"] is None
        assert stats["graded_members"] == 0
        assert stats["not_applicable_members"] == 1
        assert stats["compliant_members"] == 0


class TestDashboardSummarySetupCounts:
    """The dashboard's setup guide ticks its steps off these counts."""

    async def test_a_fresh_department_has_built_nothing(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)

        summary = await get_training_dashboard_summary(
            expiration_days=90, db=db_session, current_user=member
        )

        stats = summary["stats"]
        assert stats["active_requirements"] == 0
        assert stats["active_courses"] == 0
        assert stats["training_sessions"] == 0
        assert stats["active_programs"] == 0

    async def test_counts_only_this_departments_live_items(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session)
        member = await _member(db_session, org)
        await _requirement(db_session, org, active=True)
        await _requirement(db_session, org, active=False)
        await _requirement(db_session, other, active=True)
        db_session.add_all(
            [
                _course(org, "Firefighter I"),
                _course(org, "Retired", active=False),
                _course(other, "Elsewhere"),
                TrainingProgram(organization_id=org.id, name="Probationary"),
                TrainingProgram(
                    organization_id=org.id, name="Template", is_template=True
                ),
                TrainingProgram(organization_id=other.id, name="Elsewhere"),
            ]
        )
        await db_session.flush()

        summary = await get_training_dashboard_summary(
            expiration_days=90, db=db_session, current_user=member
        )

        stats = summary["stats"]
        assert stats["active_requirements"] == 1
        assert stats["active_courses"] == 1
        assert stats["active_programs"] == 1
