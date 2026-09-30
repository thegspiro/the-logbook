"""A deactivated member's username and email stay taken, and say so.

Deactivating (soft-deleting) a member keeps their username and email, and the
org-scoped unique indexes on both count deleted rows. Every pre-check skipped
deleted rows, so re-adding the address -- through Add Member, a roster import,
or pipeline conversion -- passed the checks and then failed the insert as a
bare 500 with nothing to explain it.
"""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.users import create_member
from app.models.user import Organization, User
from app.schemas.user import AdminUserCreate
from app.services.membership_pipeline_service import MembershipPipelineService
from app.utils.membership import (
    DEACTIVATED_EMAIL_MESSAGE,
    DEACTIVATED_USERNAME_MESSAGE,
)

pytestmark = [pytest.mark.integration]


def _hex() -> str:
    return uuid.uuid4().hex[:8]


async def _org(db: AsyncSession) -> Organization:
    org = Organization(name="Deactivated Test VFD", slug=f"deact-{_hex()}")
    db.add(org)
    await db.flush()
    return org


async def _deactivated(db: AsyncSession, org: Organization, **fields) -> User:
    user = User(
        organization_id=org.id,
        username=fields.get("username", f"gone-{_hex()}"),
        email=fields.get("email", f"gone-{_hex()}@example.org"),
        first_name=fields.get("first_name", "Former"),
        last_name=fields.get("last_name", "Member"),
        deleted_at=datetime.now(timezone.utc),
    )
    db.add(user)
    await db.flush()
    return user


async def _add_member(db, org, **fields):
    data = {
        "username": f"new-{_hex()}",
        "email": f"new-{_hex()}@example.org",
        "first_name": "Jordan",
        "last_name": "Hale",
    }
    data.update(fields)
    return await create_member(
        user_data=AdminUserCreate(**data),
        background_tasks=BackgroundTasks(),
        request=MagicMock(),
        db=db,
        current_user=SimpleNamespace(id="admin-1", organization_id=org.id),
    )


class TestAddMember:
    async def test_a_deactivated_members_email_is_refused_plainly(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        gone = await _deactivated(db_session, org)

        with pytest.raises(HTTPException) as refused:
            await _add_member(db_session, org, email=gone.email)

        assert refused.value.status_code == 400
        assert refused.value.detail == DEACTIVATED_EMAIL_MESSAGE

    async def test_a_deactivated_members_username_is_refused_plainly(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        gone = await _deactivated(db_session, org)

        with pytest.raises(HTTPException) as refused:
            await _add_member(db_session, org, username=gone.username)

        assert refused.value.status_code == 400
        assert refused.value.detail == DEACTIVATED_USERNAME_MESSAGE


class TestPipelineConversion:
    async def test_a_generated_username_steps_past_a_deactivated_one(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        await _deactivated(db_session, org, username="jhale")

        generated = await MembershipPipelineService(
            db_session
        )._generate_unique_username("Jordan", "Hale", org.id)

        assert generated == "jhale1"

    async def test_an_applicant_using_a_deactivated_email_is_refused_plainly(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        gone = await _deactivated(
            db_session, org, first_name="Someone", last_name="Else"
        )
        svc = MembershipPipelineService(db_session)
        prospect = await svc.create_prospect(
            organization_id=org.id,
            data={"first_name": "Jordan", "last_name": "Hale", "email": gone.email},
        )
        loaded = await svc.get_prospect(str(prospect.id), org.id)

        result = await svc._do_transfer(loaded, None)

        assert result == {"success": False, "message": DEACTIVATED_EMAIL_MESSAGE}

    async def test_a_deactivated_namesake_does_not_block_conversion(
        self, db_session: AsyncSession
    ):
        # The duplicate check matches by name too; it must keep ignoring
        # deactivated rows, or every Jordan Hale after one left is refused.
        org = await _org(db_session)
        await _deactivated(db_session, org, first_name="Jordan", last_name="Hale")
        svc = MembershipPipelineService(db_session)
        prospect = await svc.create_prospect(
            organization_id=org.id,
            data={
                "first_name": "Jordan",
                "last_name": "Hale",
                "email": f"jordan-{_hex()}@example.org",
            },
        )
        loaded = await svc.get_prospect(str(prospect.id), org.id)

        result = await svc._do_transfer(loaded, None)

        assert result["success"] is True
