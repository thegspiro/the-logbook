"""
`AnnualComplianceReportService.generate_annual_report` graded every active
member against every active org requirement, with no check for whether a
requirement's `applies_to_all` / `required_membership_types` /
`required_roles` actually named that member. Three sibling functions
(`get_compliance_matrix`, `compute_org_compliance_pct`,
`get_member_period_status`, `get_compliance_summary`) already apply this
filter via the shared `requirement_applies_to_member` helper (see its
docstring in `app/services/training_compliance.py`) -- the annual report
was a fifth, independent reimplementation that never got it, so a member
outside a requirement's scope was graded against it anyway (almost always
as unmet), understating both that member's own percentage and the
per-requirement "members_compliant / members_total" figures the report's
"Requirement Analysis" section shows a compliance officer.

Both loops in `generate_annual_report` need the same fix:

- the per-member loop (denominator = requirements that apply to *this*
  member)
- the per-requirement "requirement analysis" loop (denominator = members
  the requirement applies to, not the org's whole active roster)
"""

import uuid

import pytest

from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementType,
    TrainingRequirement,
)
from app.models.user import Organization, Position, User, UserStatus
from app.services.compliance_officer_service import AnnualComplianceReportService

pytestmark = [pytest.mark.integration]


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Membership-Scoped Report Department",
        slug=f"scoped-report-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _member(db_session, org, membership_type: str) -> User:
    handle = uuid.uuid4().hex[:10]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{handle}",
        email=f"{handle}@scoped-report.test",
        first_name="Test",
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
        membership_type=membership_type,
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _member_with_position(db_session, org, position: Position) -> User:
    handle = uuid.uuid4().hex[:10]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{handle}",
        email=f"{handle}@scoped-report.test",
        first_name="Test",
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
        membership_type="active",
    )
    user.positions.append(position)
    db_session.add(user)
    await db_session.flush()
    return user


async def _position(db_session, org, name: str) -> Position:
    position = Position(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        slug=f"{name.lower()}-{uuid.uuid4().hex[:8]}",
        permissions=[],
    )
    db_session.add(position)
    await db_session.flush()
    return position


async def _role_scoped_requirement(
    db_session, org, position: Position
) -> TrainingRequirement:
    """A requirement scoped ONLY by `required_roles` -- no
    `required_membership_types`, `applies_to_all=False`. Reachable through
    the requirement-config UI (a requirement can name roles without also
    naming membership types), and the one shape `requirement_applies_to_member`
    cannot resolve without a member's role ids."""
    req = TrainingRequirement(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Safety Officer Certification",
        requirement_type=RequirementType.HOURS,
        required_hours=8.0,
        frequency=RequirementFrequency.ANNUAL,
        due_date_type=DueDateType.CALENDAR_PERIOD,
        active=True,
        applies_to_all=False,
        required_roles=[position.id],
    )
    db_session.add(req)
    await db_session.flush()
    return req


async def _officers_only_requirement(db_session, org) -> TrainingRequirement:
    """A requirement scoped to officers only -- unmet by everyone, since no
    training record is ever created for it in these tests."""
    req = TrainingRequirement(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Officer Continuing Education",
        requirement_type=RequirementType.HOURS,
        required_hours=8.0,
        frequency=RequirementFrequency.ANNUAL,
        due_date_type=DueDateType.CALENDAR_PERIOD,
        active=True,
        applies_to_all=False,
        required_membership_types=["officer"],
    )
    db_session.add(req)
    await db_session.flush()
    return req


class TestGenerateAnnualReportMembershipScoping:
    async def test_member_not_in_scope_is_not_graded_against_the_requirement(
        self, db_session
    ):
        """A regular ('active') member is not an 'officer', so the
        officers-only requirement must not appear in their denominator --
        pre-fix, it did, and reported them 0% / non_compliant."""
        org = await _org(db_session)
        member = await _member(db_session, org, membership_type="active")
        assert member.organization_id == org.id
        await _officers_only_requirement(db_session, org)

        service = AnnualComplianceReportService(db_session)
        report = await service.generate_annual_report(org.id, year=2026)

        [row] = report["member_compliance"]
        assert row["requirements_total"] == 0
        assert row["compliance_pct"] == 100.0
        assert row["status"] == "compliant"

    async def test_member_in_scope_is_still_graded(self, db_session):
        """The other direction, so the test above can't pass by always
        excluding every requirement: an actual officer IS graded against the
        officers-only requirement, and fails it (no record filed)."""
        org = await _org(db_session)
        member = await _member(db_session, org, membership_type="officer")
        assert member.organization_id == org.id
        await _officers_only_requirement(db_session, org)

        service = AnnualComplianceReportService(db_session)
        report = await service.generate_annual_report(org.id, year=2026)

        [row] = report["member_compliance"]
        assert row["requirements_total"] == 1
        assert row["compliance_pct"] == 0.0
        assert row["status"] == "non_compliant"

    async def test_requirement_analysis_denominator_excludes_out_of_scope_members(
        self, db_session
    ):
        """The 'Requirement Analysis' section's members_total must count
        only members the requirement applies to -- pre-fix it was every
        active org member, diluting an officers-only requirement's
        compliance_pct with members it was never meant to grade."""
        org = await _org(db_session)
        officer = await _member(db_session, org, membership_type="officer")
        regular = await _member(db_session, org, membership_type="active")
        assert officer.organization_id == org.id
        assert regular.organization_id == org.id
        await _officers_only_requirement(db_session, org)

        service = AnnualComplianceReportService(db_session)
        report = await service.generate_annual_report(org.id, year=2026)

        [analysis] = report["requirement_analysis"]
        assert analysis["members_total"] == 1  # only the officer
        assert analysis["members_compliant"] == 0


class TestGenerateAnnualReportRoleScopedRequirements:
    """`requirement_applies_to_member`'s `required_roles` branch only ever
    matches when the caller passes the member's role ids -- a requirement
    scoped ONLY by `required_roles` (no `required_membership_types`,
    `applies_to_all=False`) previously matched nobody here, because neither
    loop loaded or passed `User.positions`. That silently excluded a
    role-scoped requirement from every member's denominator (inflating
    their compliance_pct) while reporting zero applicable members in
    "Requirement Analysis" -- even for a member who actually held the role."""

    async def test_member_holding_the_role_is_graded(self, db_session):
        org = await _org(db_session)
        position = await _position(db_session, org, "Safety Officer")
        member = await _member_with_position(db_session, org, position)
        assert member.organization_id == org.id
        await _role_scoped_requirement(db_session, org, position)

        service = AnnualComplianceReportService(db_session)
        report = await service.generate_annual_report(org.id, year=2026)

        [row] = report["member_compliance"]
        assert row["requirements_total"] == 1
        assert row["compliance_pct"] == 0.0
        assert row["status"] == "non_compliant"

    async def test_member_without_the_role_is_not_graded(self, db_session):
        org = await _org(db_session)
        position = await _position(db_session, org, "Safety Officer")
        other_position = await _position(db_session, org, "Driver")
        member = await _member_with_position(db_session, org, other_position)
        assert member.organization_id == org.id
        await _role_scoped_requirement(db_session, org, position)

        service = AnnualComplianceReportService(db_session)
        report = await service.generate_annual_report(org.id, year=2026)

        [row] = report["member_compliance"]
        assert row["requirements_total"] == 0
        assert row["compliance_pct"] == 100.0
        assert row["status"] == "compliant"

    async def test_requirement_analysis_counts_only_role_holders(self, db_session):
        org = await _org(db_session)
        position = await _position(db_session, org, "Safety Officer")
        holder = await _member_with_position(db_session, org, position)
        other_position = await _position(db_session, org, "Driver")
        non_holder = await _member_with_position(db_session, org, other_position)
        assert holder.organization_id == org.id
        assert non_holder.organization_id == org.id
        await _role_scoped_requirement(db_session, org, position)

        service = AnnualComplianceReportService(db_session)
        report = await service.generate_annual_report(org.id, year=2026)

        [analysis] = report["requirement_analysis"]
        assert analysis["members_total"] == 1  # only the role holder
        assert analysis["members_compliant"] == 0
