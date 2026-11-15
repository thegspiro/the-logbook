"""Only a current member can be added as an apparatus operator.

The roster import brings former members in as archived, retired or dropped
accounts. The Add Operator picker hides them, but the endpoint accepted any
member of the organization, so a stale client or a direct API call could still
certify someone who has left the department to drive.

Run against a real database: the guard is a SQL filter on ``User.is_active``,
whose expression form a mocked session would never evaluate.
"""

import uuid
from datetime import datetime, timezone

import pytest

from app.models.apparatus import Apparatus, ApparatusStatus, ApparatusType
from app.models.user import Organization, User, UserStatus
from app.schemas.apparatus import ApparatusOperatorCreate
from app.services.apparatus_service import ApparatusService

pytestmark = [pytest.mark.integration]


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Operators",
        slug=f"operators-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _member(
    db_session,
    org: Organization,
    status: UserStatus = UserStatus.ACTIVE,
    deleted: bool = False,
) -> User:
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{suffix}",
        email=f"member-{suffix}@example.org",
        status=status,
        deleted_at=datetime.now(timezone.utc) if deleted else None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _apparatus(db_session, org: Organization) -> Apparatus:
    apparatus_type = ApparatusType(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Ambulance",
        code=f"AMB{uuid.uuid4().hex[:4]}",
    )
    status = ApparatusStatus(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="In Service",
        code=f"IS{uuid.uuid4().hex[:4]}",
    )
    db_session.add_all([apparatus_type, status])
    await db_session.flush()
    apparatus = Apparatus(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        unit_number=f"A-{uuid.uuid4().hex[:5]}",
        apparatus_type_id=apparatus_type.id,
        status_id=status.id,
    )
    db_session.add(apparatus)
    await db_session.flush()
    return apparatus


async def _add_operator(db_session, org: Organization, member: User):
    apparatus = await _apparatus(db_session, org)
    actor = await _member(db_session, org)
    return await ApparatusService(db_session).create_operator(
        ApparatusOperatorCreate(apparatus_id=apparatus.id, user_id=member.id),
        org.id,
        created_by=actor.id,
    )


class TestOperatorMustBeCurrentMember:
    @pytest.mark.parametrize(
        "status", [UserStatus.ACTIVE, UserStatus.PROBATIONARY], ids=lambda s: s.value
    )
    async def test_current_member_is_accepted(self, db_session, status):
        org = await _org(db_session)
        member = await _member(db_session, org, status)

        operator = await _add_operator(db_session, org, member)

        assert operator.user_id == member.id

    @pytest.mark.parametrize(
        "status",
        [
            UserStatus.INACTIVE,
            UserStatus.SUSPENDED,
            UserStatus.LEAVE,
            UserStatus.RETIRED,
            UserStatus.DROPPED_VOLUNTARY,
            UserStatus.DROPPED_INVOLUNTARY,
            UserStatus.ARCHIVED,
        ],
        ids=lambda s: s.value,
    )
    async def test_former_or_inactive_member_is_refused(self, db_session, status):
        org = await _org(db_session)
        member = await _member(db_session, org, status)

        with pytest.raises(ValueError, match="Only current members"):
            await _add_operator(db_session, org, member)

    async def test_deleted_active_member_is_refused(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org, UserStatus.ACTIVE, deleted=True)

        with pytest.raises(ValueError, match="Only current members"):
            await _add_operator(db_session, org, member)
