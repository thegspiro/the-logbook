"""
Reading somebody else's admin-hours compliance must not 500.

`get_user_hours_compliance` fetches the target user and then reads
`user.positions` to decide which compliance profiles apply. That query carried
no eager load, so the read was deferred IO — which under asyncio raises
`MissingGreenlet` instead of emitting a SELECT.

What kept it hidden is SQLAlchemy's identity map. Asking for *your own*
compliance resolves to the `current_user` instance the auth dependency already
loaded with its positions, so no lazy load happens and the endpoint answers.
Only a lookup of another member reaches a freshly loaded `User` — so the
endpoint worked for every developer who tried it on themselves and 500ed for
every officer who used it for its actual purpose.

The tests below therefore expunge the session before calling the service. A
test that skipped that step would exercise the masked path and pass against the
unfixed code.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.admin_hours import (
    AdminHoursCategory,
    AdminHoursEntry,
    AdminHoursEntryStatus,
)
from app.models.compliance_config import ComplianceConfig, ComplianceProfile
from app.models.user import Organization, Position, User, UserStatus
from app.services.admin_hours_service import AdminHoursService

pytestmark = [pytest.mark.integration]


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Compliance Lookup Department",
        slug=f"complookup-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _member_with_position(db_session, org) -> tuple[User, Position]:
    handle = uuid.uuid4().hex[:10]
    position = Position(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=f"Firefighter {handle}",
        slug=f"firefighter-{handle}",
        permissions=[],
    )
    db_session.add(position)
    await db_session.flush()

    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{handle}",
        email=f"{handle}@complookup.test",
        first_name="Test",
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
        membership_type="active",
    )
    user.positions = [position]
    db_session.add(user)
    await db_session.flush()
    return user, position


async def _category(db_session, org, name="Station Maintenance") -> AdminHoursCategory:
    category = AdminHoursCategory(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        is_active=True,
    )
    db_session.add(category)
    await db_session.flush()
    return category


async def _profile_requiring(
    db_session, org, category, *, required_hours: int, role_ids=None
) -> ComplianceProfile:
    config = ComplianceConfig(id=str(uuid.uuid4()), organization_id=org.id)
    db_session.add(config)
    await db_session.flush()

    profile = ComplianceProfile(
        id=str(uuid.uuid4()),
        config_id=config.id,
        name="Active members",
        membership_types=["active"],
        role_ids=role_ids,
        is_active=True,
        priority=10,
        admin_hours_requirements=[
            {
                "category_id": category.id,
                "required_hours": required_hours,
                "frequency": "annual",
            }
        ],
    )
    db_session.add(profile)
    await db_session.flush()
    return profile


async def _approved_hours(db_session, org, user, category, minutes: int) -> None:
    start = datetime.now(timezone.utc).replace(month=1, day=15, hour=9, minute=0)
    db_session.add(
        AdminHoursEntry(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            user_id=user.id,
            category_id=category.id,
            clock_in_at=start,
            clock_out_at=start + timedelta(minutes=minutes),
            duration_minutes=minutes,
            status=AdminHoursEntryStatus.APPROVED,
        )
    )
    await db_session.flush()


class TestComplianceForAnotherMember:
    async def test_a_member_the_session_has_not_loaded_does_not_raise(self, db_session):
        """The regression. Without the eager load this is a MissingGreenlet."""
        org = await _org(db_session)
        user, _ = await _member_with_position(db_session, org)
        category = await _category(db_session, org)
        await _profile_requiring(db_session, org, category, required_hours=20)
        await _approved_hours(db_session, org, user, category, minutes=300)
        user_id = user.id

        # Production shape: the officer's own user is loaded, the member's is
        # not. Without this the identity map answers the service's SELECT with
        # the instance built above, whose positions are already populated.
        db_session.expunge_all()

        service = AdminHoursService(db_session)
        results = await service.get_user_hours_compliance(
            organization_id=org.id, user_id=user_id, year=datetime.now().year
        )

        assert len(results) == 1
        assert results[0]["required_hours"] == 20

    async def test_the_member_positions_actually_select_the_profile(self, db_session):
        """The eager-loaded collection is read, not merely loaded.

        A profile scoped to a role the member does not hold must not apply — if
        `user.positions` came back empty the role filter would be evaluated
        against nothing and this would wrongly return a requirement.
        """
        org = await _org(db_session)
        user, _ = await _member_with_position(db_session, org)
        category = await _category(db_session, org)
        await _profile_requiring(
            db_session,
            org,
            category,
            required_hours=20,
            role_ids=[str(uuid.uuid4())],
        )
        user_id = user.id
        db_session.expunge_all()

        service = AdminHoursService(db_session)
        results = await service.get_user_hours_compliance(
            organization_id=org.id, user_id=user_id, year=datetime.now().year
        )

        assert results == []

    async def test_a_profile_scoped_to_the_members_own_role_applies(self, db_session):
        """The other direction, so the test above cannot pass by always failing
        to match."""
        org = await _org(db_session)
        user, position = await _member_with_position(db_session, org)
        category = await _category(db_session, org)
        await _profile_requiring(
            db_session, org, category, required_hours=12, role_ids=[position.id]
        )
        user_id = user.id
        db_session.expunge_all()

        service = AdminHoursService(db_session)
        results = await service.get_user_hours_compliance(
            organization_id=org.id, user_id=user_id, year=datetime.now().year
        )

        assert len(results) == 1
        assert results[0]["required_hours"] == 12


class TestRequirementProgressArithmetic:
    """`func.sum` returns Decimal on MySQL; the profile's JSON returns float.

    Dividing one by the other raised TypeError, and only for a member who had
    logged something: with no approved rows `or 0` substitutes an int and every
    value below is float, so the endpoint answered fine for anyone it had
    nothing to report about and 500ed for everyone it did.
    """

    async def test_a_member_with_logged_hours_gets_progress(self, db_session):
        org = await _org(db_session)
        user, _ = await _member_with_position(db_session, org)
        category = await _category(db_session, org)
        # 8.0, not 8. The trigger is Decimal / **float**: func.sum gives a
        # Decimal and the profile's stored JSON gives a float, because the API
        # schema coerces required_hours on the way in. An int here divides a
        # Decimal quite happily and reproduces nothing.
        await _profile_requiring(db_session, org, category, required_hours=8.0)
        # 240 minutes, so func.sum returns a Decimal rather than the int `or 0`
        # fallback -- the other half of the trigger.
        await _approved_hours(db_session, org, user, category, minutes=240)
        user_id = user.id
        db_session.expunge_all()

        service = AdminHoursService(db_session)
        results = await service.get_user_hours_compliance(
            organization_id=org.id, user_id=user_id, year=datetime.now().year
        )

        assert len(results) == 1
        assert results[0]["logged_hours"] == 4.0
        assert results[0]["required_hours"] == 8.0
        # 4 of 8 is 50%, which clears the default at-risk threshold of 75 only
        # if the arithmetic ran at all.
        assert results[0]["status"] in {"at_risk", "non_compliant"}

    async def test_meeting_the_requirement_reads_compliant(self, db_session):
        org = await _org(db_session)
        user, _ = await _member_with_position(db_session, org)
        category = await _category(db_session, org)
        await _profile_requiring(db_session, org, category, required_hours=2.0)
        await _approved_hours(db_session, org, user, category, minutes=180)
        user_id = user.id
        db_session.expunge_all()

        service = AdminHoursService(db_session)
        results = await service.get_user_hours_compliance(
            organization_id=org.id, user_id=user_id, year=datetime.now().year
        )

        assert results[0]["logged_hours"] == 3.0
        assert results[0]["status"] == "compliant"
