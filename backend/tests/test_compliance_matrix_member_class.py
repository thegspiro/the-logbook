"""The compliance matrix reports each member's class.

The training matrix filters its roster by class (operational /
administrative / social) so a training officer can review the two groups
separately. The class reported must be the one the rest of the app judges a
member by — ``effective_member_class`` — including for a member whose class
column was never written, and must stay unset for a custom membership tier the
class map does not know, rather than being guessed into a class.
"""

import uuid

import pytest
from sqlalchemy import update

from app.api.v1.endpoints import training as training_endpoints
from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementType,
    TrainingRequirement,
)
from app.models.user import Organization, User, UserStatus

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _org(db) -> Organization:
    org = Organization(
        id=_uid(),
        name="Member Class Department",
        slug=f"member-class-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    return org


async def _member(db, org, name: str, **fields) -> User:
    handle = uuid.uuid4().hex[:10]
    user = User(
        id=_uid(),
        organization_id=org.id,
        username=f"{name.lower()}-{handle}",
        email=f"{handle}@member-class.test",
        first_name=name,
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
        **fields,
    )
    db.add(user)
    await db.flush()
    return user


async def _clear_class(db, user: User) -> None:
    """Null member_class the way a row written before the column existed has
    it. An ORM assignment would not do: the flush listener re-derives the
    class (and rewrites membership_type) from whatever it is given."""
    await db.execute(update(User).where(User.id == user.id).values(member_class=None))
    db.expire(user)


async def _matrix_rows(db, org) -> dict[str, dict]:
    req = TrainingRequirement(
        id=_uid(),
        organization_id=org.id,
        name="Annual Hours",
        requirement_type=RequirementType.HOURS,
        required_hours=8.0,
        frequency=RequirementFrequency.ANNUAL,
        due_date_type=DueDateType.CALENDAR_PERIOD,
        active=True,
        applies_to_all=True,
    )
    db.add(req)
    await db.flush()
    caller = User(id=_uid(), organization_id=org.id)
    matrix = await training_endpoints.get_compliance_matrix(db=db, current_user=caller)
    return {str(row["user_id"]): row for row in matrix["members"]}


class TestMatrixReportsMemberClass:
    async def test_recorded_classes_are_reported(self, db_session):
        org = await _org(db_session)
        firefighter = await _member(
            db_session,
            org,
            "Firefighter",
            member_class="operational",
            member_status="regular",
        )
        clerk = await _member(
            db_session,
            org,
            "Clerk",
            member_class="administrative",
            member_status="probationary",
        )

        rows = await _matrix_rows(db_session, org)

        assert rows[firefighter.id]["member_class"] == "operational"
        assert rows[clerk.id]["member_class"] == "administrative"

    async def test_class_derives_from_legacy_type_when_unset(self, db_session):
        org = await _org(db_session)
        clerk = await _member(
            db_session, org, "Clerk", membership_type="administrative"
        )
        await _clear_class(db_session, clerk)

        rows = await _matrix_rows(db_session, org)

        assert rows[clerk.id]["member_class"] == "administrative"

    async def test_unknown_tier_is_not_guessed_into_a_class(self, db_session):
        org = await _org(db_session)
        senior = await _member(db_session, org, "Senior", membership_type="senior")
        await _clear_class(db_session, senior)

        rows = await _matrix_rows(db_session, org)

        assert rows[senior.id]["member_class"] is None
