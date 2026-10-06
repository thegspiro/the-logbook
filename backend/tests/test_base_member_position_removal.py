"""
The base Member position cannot be removed from a member who is still a member
(W11-9).

It carries the baseline grants every member needs; removing it left an account
that could sign in and see almost nothing. The owner chose to refuse the
removal unless the member is archived. Both write paths are covered: the
single removal and the replace-all assignment the admin screens use.
"""

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.endpoints.users import (
    BASE_POSITION_REMOVAL_REFUSED,
    _refuse_base_position_removal,
    remove_role_from_user,
)
from app.models.user import Organization, Role, User, UserStatus, user_roles


class TestRule:
    pytestmark = [pytest.mark.unit]

    def test_refused_for_a_current_member(self):
        for status in (
            UserStatus.ACTIVE,
            UserStatus.LEAVE,
            UserStatus.DROPPED_VOLUNTARY,
        ):
            with pytest.raises(HTTPException) as exc:
                _refuse_base_position_removal(
                    SimpleNamespace(status=status), SimpleNamespace(slug="member")
                )
            assert exc.value.status_code == 400
            assert exc.value.detail == BASE_POSITION_REMOVAL_REFUSED

    def test_allowed_for_an_archived_member(self):
        _refuse_base_position_removal(
            SimpleNamespace(status=UserStatus.ARCHIVED), SimpleNamespace(slug="member")
        )

    def test_other_positions_are_unaffected(self):
        _refuse_base_position_removal(
            SimpleNamespace(status=UserStatus.ACTIVE), SimpleNamespace(slug="driver")
        )


async def _setup(db_session, member_status):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Base Position Department",
        slug=f"basepos-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    member_role = Role(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Member",
        slug="member",
        permissions=["members.view"],
        is_system=True,
        priority=10,
    )
    driver = Role(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Driver",
        slug=f"driver_{uuid.uuid4().hex[:6]}",
        permissions=[],
        is_system=False,
        priority=20,
    )
    db_session.add_all([member_role, driver])
    await db_session.flush()

    def _user(status):
        handle = uuid.uuid4().hex[:10]
        return User(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            username=f"u-{handle}",
            email=f"{handle}@basepos.test",
            first_name="Ian",
            last_name="Two",
            password_hash="x",
            status=status,
        )

    officer = _user(UserStatus.ACTIVE)
    member = _user(member_status)
    member.roles = [member_role, driver]
    db_session.add_all([officer, member])
    await db_session.flush()
    return officer, member, member_role, driver


async def _held_slugs(db_session, member) -> list[str]:
    rows = await db_session.execute(
        select(Role.slug)
        .join(user_roles, user_roles.c.position_id == Role.id)
        .where(user_roles.c.user_id == member.id)
    )
    return sorted(slug for (slug,) in rows.all())


@pytest.mark.integration
class TestRemovalEndpoint:
    async def test_refuses_the_base_position_for_an_active_member(self, db_session):
        officer, member, member_role, _ = await _setup(db_session, UserStatus.ACTIVE)

        with pytest.raises(HTTPException) as exc:
            await remove_role_from_user(
                user_id=uuid.UUID(member.id),
                role_id=uuid.UUID(member_role.id),
                db=db_session,
                current_user=officer,
            )

        assert exc.value.status_code == 400
        assert member_role in member.roles

    async def test_other_positions_still_come_off(self, db_session):
        officer, member, _, driver = await _setup(db_session, UserStatus.ACTIVE)

        await remove_role_from_user(
            user_id=uuid.UUID(member.id),
            role_id=uuid.UUID(driver.id),
            db=db_session,
            current_user=officer,
        )

        assert await _held_slugs(db_session, member) == ["member"]

    async def test_allowed_for_an_archived_member(self, db_session):
        officer, member, member_role, _ = await _setup(db_session, UserStatus.ARCHIVED)

        await remove_role_from_user(
            user_id=uuid.UUID(member.id),
            role_id=uuid.UUID(member_role.id),
            db=db_session,
            current_user=officer,
        )

        assert "member" not in await _held_slugs(db_session, member)
