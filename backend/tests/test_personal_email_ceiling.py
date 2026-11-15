"""A colleague's personal email is a credential route, so it takes the ceiling.

A directory account's first password is mailed to ``personal_email``, and a
retry while ``credentials_sent`` is false resets the password and mails it
there again. The directory mailbox is the member's login address, so a
``members.manage`` holder who could repoint the personal email of a member
with wider rights could collect that member's mailbox and, through it, a
Logbook password reset.
"""

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.endpoints.users import update_user_profile
from app.models.user import Organization, User, UserStatus
from app.schemas.user import UserUpdate
from tests.fake_request import fake_request

_USERS = "app.api.v1.endpoints.users"


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Personal Email Ceiling Department",
        slug=f"pe-ceiling-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _member(db_session, org, personal_email=None) -> User:
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"pe-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@pe-ceiling.test",
        personal_email=personal_email,
        first_name="Pat",
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.mark.integration
class TestPersonalEmailCeiling:
    async def _update(self, db_session, caller, target, body, ceiling):
        with (
            patch(f"{_USERS}._has_permission", return_value=True),
            patch(f"{_USERS}._enforce_account_reset_ceiling", new=ceiling),
            patch(f"{_USERS}.log_audit_event", new=AsyncMock()),
        ):
            return await update_user_profile(
                uuid.UUID(target.id),
                UserUpdate(**body),
                db_session,
                caller,
                request=fake_request(),
            )

    async def _stored(self, db_session, member_id: str) -> User:
        db_session.expire_all()
        return (
            await db_session.execute(select(User).where(User.id == member_id))
        ).scalar_one()

    async def test_a_colleagues_change_above_the_ceiling_is_refused(self, db_session):
        org = await _org(db_session)
        manager = await _member(db_session, org)
        chief = await _member(db_session, org, personal_email="chief@home.test")
        refusal = AsyncMock(side_effect=HTTPException(status_code=403))

        with pytest.raises(HTTPException) as exc:
            await self._update(
                db_session,
                manager,
                chief,
                {"personal_email": "attacker@evil.test"},
                refusal,
            )

        assert exc.value.status_code == 403
        refusal.assert_awaited_once()
        assert refusal.await_args.kwargs["action"] == "personal-email-change"
        stored = await self._stored(db_session, chief.id)
        assert stored.personal_email == "chief@home.test"

    async def test_ones_own_personal_email_skips_the_ceiling(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org, personal_email="old@home.test")
        ceiling = AsyncMock()

        await self._update(
            db_session, member, member, {"personal_email": "new@home.test"}, ceiling
        )

        ceiling.assert_not_awaited()
        stored = await self._stored(db_session, member.id)
        assert stored.personal_email == "new@home.test"

    async def test_an_unchanged_personal_email_skips_the_ceiling(self, db_session):
        org = await _org(db_session)
        manager = await _member(db_session, org)
        member = await _member(db_session, org, personal_email="same@home.test")
        ceiling = AsyncMock()

        await self._update(
            db_session,
            manager,
            member,
            {"personal_email": "same@home.test", "first_name": "Sam"},
            ceiling,
        )

        ceiling.assert_not_awaited()
