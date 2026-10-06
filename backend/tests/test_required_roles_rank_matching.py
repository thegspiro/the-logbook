"""
``required_roles`` is matched against the member's rank on every grader.

Every writer stores rank slugs in ``TrainingRequirement.required_roles`` (the
model comment, the training-program requirements schema), and the scheduling
shift-compliance report matched it against ``User.rank``. Every training
grader compared it with position ids instead, so a requirement scoped only by
rank applied to nobody on /my-training, the matrix, the dashboard percentage
or the annual report (CMP4-5). The shared ``requirement_applies_to_member``
now matches the rank, and the scheduling report goes through it too.
"""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import training as training_endpoints
from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementType,
    TrainingRequirement,
)
from app.models.user import Organization, Position, User, UserStatus
from app.services.compliance_officer_service import AnnualComplianceReportService
from app.services.scheduling_service import SchedulingService
from app.services.training_compliance import compute_org_compliance_tally
from app.services.training_service import TrainingService
from app.utils.org_timezone import resolve_org_today

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _org(db) -> Organization:
    org = Organization(
        id=_uid(),
        name="Rank Scoped Department",
        slug=f"rank-scoped-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    return org


async def _member(db, org, name: str, rank: str, **fields) -> User:
    handle = uuid.uuid4().hex[:10]
    user = User(
        id=_uid(),
        organization_id=org.id,
        username=f"{name.lower()}-{handle}",
        email=f"{handle}@rank-scoped.test",
        first_name=name,
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
        rank=rank,
        **fields,
    )
    db.add(user)
    await db.flush()
    await db.execute(
        select(User)
        .options(selectinload(User.positions))
        .where(User.id == user.id)
        .execution_options(populate_existing=True)
    )
    return user


async def _requirement(db, org, **fields) -> TrainingRequirement:
    fields.setdefault("requirement_type", RequirementType.HOURS)
    fields.setdefault("required_hours", 8.0)
    req = TrainingRequirement(
        id=_uid(),
        organization_id=org.id,
        name=fields.pop("name", "Officer Development"),
        frequency=RequirementFrequency.ANNUAL,
        due_date_type=DueDateType.CALENDAR_PERIOD,
        active=True,
        applies_to_all=False,
        **fields,
    )
    db.add(req)
    await db.flush()
    return req


async def _captain_and_firefighter(db):
    """A captain, and a firefighter who holds a position whose id and slug
    are both "captain"-ish, so a position match cannot pass for a rank one."""
    org = await _org(db)
    position = Position(
        id=_uid(),
        organization_id=org.id,
        name="Captain",
        slug="captain",
        permissions=[],
    )
    db.add(position)
    await db.flush()
    captain = await _member(db, org, "Captain", "captain")
    firefighter = await _member(db, org, "Firefighter", "firefighter")
    firefighter.positions.append(position)
    await db.flush()
    req = await _requirement(db, org, required_roles=["captain"])
    return org, captain, firefighter, req


class TestRankScopedRequirementOnEveryGrader:
    async def test_my_training_applies_it_to_the_rank_only(self, db_session):
        org, captain, firefighter, req = await _captain_and_firefighter(db_session)
        service = TrainingService(db_session)

        assert [
            r.id for r in await service.get_applicable_requirements(captain.id, org.id)
        ] == [req.id]
        assert await service.get_applicable_requirements(firefighter.id, org.id) == []

    async def test_matrix_and_dashboard_percentage(self, db_session):
        org, captain, firefighter, req = await _captain_and_firefighter(db_session)
        caller = User(id=_uid(), organization_id=org.id)

        matrix = await training_endpoints.get_compliance_matrix(
            db=db_session, current_user=caller
        )
        rows = {str(row["user_id"]): row for row in matrix["members"]}
        assert [c["requirement_id"] for c in rows[captain.id]["requirements"]] == [
            req.id
        ]
        assert rows[captain.id]["standing"] == "non_compliant"
        assert rows[firefighter.id]["requirements"] == []
        assert rows[firefighter.id]["standing"] == "not_applicable"

        tally = await compute_org_compliance_tally(db_session, org.id)
        assert tally.graded == 1
        assert tally.not_applicable == 1
        assert tally.pct == 0.0

    async def test_annual_report(self, db_session):
        org, captain, firefighter, _ = await _captain_and_firefighter(db_session)
        today = await resolve_org_today(db_session, org.id)

        report = await AnnualComplianceReportService(db_session).generate_annual_report(
            org.id, year=today.year
        )
        rows = {row["user_id"]: row for row in report["member_compliance"]}
        assert rows[captain.id]["requirements_total"] == 1
        assert rows[firefighter.id]["status"] == "not_applicable"
        [analysis] = report["requirement_analysis"]
        assert analysis["members_total"] == 1


class TestSchedulingShiftComplianceUsesTheSharedDefinition:
    async def test_rank_scoped_requirement_still_grades_the_rank(self, db_session):
        org, captain, firefighter, req = await _captain_and_firefighter(db_session)
        req.shift_credited = True
        await db_session.flush()

        [summary] = await SchedulingService(db_session).get_shift_compliance(org.id)

        assert [m["user_id"] for m in summary["members"]] == [captain.id]

    async def test_membership_type_scoped_requirement_now_grades_its_members(
        self, db_session
    ):
        """This report alone ignored required_membership_types, so a
        requirement scoped that way graded nobody here while the matrix
        graded its members."""
        org = await _org(db_session)
        probie = await _member(
            db_session, org, "Probie", "firefighter", membership_type="probationary"
        )
        await _member(db_session, org, "Veteran", "firefighter")
        await _requirement(
            db_session,
            org,
            name="Probationary Shifts",
            requirement_type=RequirementType.SHIFTS,
            required_hours=None,
            required_shifts=4,
            required_membership_types=["probationary"],
            shift_credited=True,
        )

        [summary] = await SchedulingService(db_session).get_shift_compliance(org.id)

        assert [m["user_id"] for m in summary["members"]] == [probie.id]
