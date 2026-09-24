"""Who hears about an applicant withdrawal, resolved against real rows.

The mocked tests in test_application_self_withdraw.py pin the selection rule;
these prove the query itself — the ``is_active`` hybrid expression, the
position eager load and the organization filter — against MySQL.
"""

import uuid

import pytest

from app.models.user import Organization, Position, User, UserStatus
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]

_MANAGE = ["prospective_members.manage"]


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Withdrawal Notice Dept",
        slug=f"withdrawal-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _position(db_session, org, slug, permissions) -> Position:
    position = Position(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=slug.replace("_", " ").title(),
        slug=slug,
        permissions=permissions,
    )
    db_session.add(position)
    await db_session.flush()
    return position


async def _user(
    db_session, org, username, positions=(), status=UserStatus.ACTIVE, email=True
) -> User:
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"{username}-{uuid.uuid4().hex[:6]}",
        email=f"{username}-{uuid.uuid4().hex[:6]}@withdrawal.test" if email else "",
        first_name="Test",
        last_name=username.title(),
        password_hash="x",
        status=status,
    )
    user.positions = list(positions)
    db_session.add(user)
    await db_session.flush()
    return user


async def _recipient_ids(db_session, org) -> set[str]:
    service = MembershipPipelineService(db_session)
    return {u.id for u in await service._withdrawal_notice_recipients(org.id)}


async def test_coordinator_and_assistant_but_not_other_managers(db_session):
    org = await _org(db_session)
    coord_pos = await _position(db_session, org, "membership_coordinator", _MANAGE)
    asst_pos = await _position(
        db_session, org, "assistant_membership_coordinator", _MANAGE
    )
    chief_pos = await _position(db_session, org, "fire_chief", _MANAGE)
    coordinator = await _user(db_session, org, "coord", [coord_pos])
    assistant = await _user(db_session, org, "asst", [asst_pos])
    await _user(db_session, org, "chief", [chief_pos])
    await _user(db_session, org, "former", [asst_pos], status=UserStatus.INACTIVE)
    await _user(db_session, org, "noemail", [coord_pos], email=False)

    assert await _recipient_ids(db_session, org) == {coordinator.id, assistant.id}


async def test_falls_back_to_pipeline_managers_in_this_org_only(db_session):
    org = await _org(db_session)
    other = await _org(db_session)
    chief_pos = await _position(db_session, org, "fire_chief", _MANAGE)
    member_pos = await _position(db_session, org, "member", ["events.view"])
    chief = await _user(db_session, org, "chief", [chief_pos])
    await _user(db_session, org, "member", [member_pos])
    other_coord = await _position(db_session, other, "membership_coordinator", _MANAGE)
    await _user(db_session, other, "elsewhere", [other_coord])

    assert await _recipient_ids(db_session, org) == {chief.id}
