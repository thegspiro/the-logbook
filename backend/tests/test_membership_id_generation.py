"""Membership numbers are checked against every row the unique index covers.

``idx_user_org_membership_number`` is unique over ``(organization_id,
membership_number)`` for every row, deleted or not, and anonymization marks a
member deleted while keeping its number. The generator, the preview and the
duplicate checks all used to look at live rows only, so they approved a number
the insert then refused with an IntegrityError -- a 500 on Add Member rather
than the next free number.

The preview is also read by Add Member to decide whether the Membership Number
field may be left blank, so it must report nothing when auto-generation is off
and must show the number that will actually be issued.
"""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Organization, User
from app.services.organization_service import OrganizationService

pytestmark = [pytest.mark.integration]

AUTO = {"enabled": True, "auto_generate": True, "prefix": "FD-", "next_number": 1}


async def _org(db_session: AsyncSession, membership_id: dict) -> Organization:
    org = Organization(
        name="Member ID Test VFD",
        slug=f"member-id-{uuid.uuid4().hex[:8]}",
        settings={"membership_id": membership_id},
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _member(db_session: AsyncSession, org: Organization, number: str) -> User:
    user = User(
        organization_id=org.id,
        username=f"member-{uuid.uuid4().hex[:8]}",
        email=f"member-{uuid.uuid4().hex[:8]}@example.org",
        first_name="Alex",
        last_name="Reyes",
        membership_number=number,
    )
    db_session.add(user)
    await db_session.flush()
    return user


class TestDeletedMembersHoldTheirNumber:
    async def test_the_generator_skips_a_deleted_members_number(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session, dict(AUTO))
        # Anonymization's end state: deleted, number kept.
        gone = await _member(db_session, org, "FD-0001")
        gone.deleted_at = datetime.now(timezone.utc)
        await db_session.flush()

        issued = await OrganizationService(db_session).generate_next_membership_id(
            org.id
        )

        assert issued == "FD-0002"

    async def test_in_use_counts_deleted_rows(self, db_session: AsyncSession):
        org = await _org(db_session, dict(AUTO))
        gone = await _member(db_session, org, "FD-0042")
        gone.deleted_at = datetime.now(timezone.utc)
        await db_session.flush()

        assert await OrganizationService(db_session).membership_number_in_use(
            org.id, "FD-0042"
        )

    async def test_a_member_does_not_collide_with_itself(
        self, db_session: AsyncSession
    ):
        # The profile update check excludes the member being edited, so saving
        # a profile without changing the number is not refused.
        org = await _org(db_session, dict(AUTO))
        member = await _member(db_session, org, "FD-0042")

        org_service = OrganizationService(db_session)

        assert not await org_service.membership_number_in_use(
            org.id, "FD-0042", exclude_user_id=str(member.id)
        )
        assert await org_service.membership_number_in_use(org.id, "FD-0042")

    async def test_another_orgs_number_is_not_in_use(self, db_session: AsyncSession):
        org = await _org(db_session, dict(AUTO))
        await _member(db_session, org, "FD-0042")
        other = await _org(db_session, dict(AUTO))

        assert not await OrganizationService(db_session).membership_number_in_use(
            other.id, "FD-0042"
        )


class TestThePreview:
    async def test_it_shows_the_number_that_will_be_issued(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session, dict(AUTO))
        await _member(db_session, org, "FD-0001")
        await _member(db_session, org, "FD-0002")
        # Both hand-typed, so the counter still reads 1.
        org_service = OrganizationService(db_session)

        preview = await org_service.preview_next_membership_id(org.id)
        issued = await org_service.generate_next_membership_id(org.id)

        assert preview == issued == "FD-0003"

    async def test_it_does_not_advance_the_counter(self, db_session: AsyncSession):
        org = await _org(db_session, dict(AUTO))
        org_service = OrganizationService(db_session)

        assert await org_service.preview_next_membership_id(org.id) == "FD-0001"
        assert await org_service.preview_next_membership_id(org.id) == "FD-0001"
        assert org.settings["membership_id"]["next_number"] == 1

    async def test_it_is_empty_when_numbers_are_typed_by_hand(
        self, db_session: AsyncSession
    ):
        # Add Member makes the field optional whenever a preview exists; one
        # shown here would let a member be saved with no number at all.
        org = await _org(db_session, {**AUTO, "auto_generate": False})

        assert (
            await OrganizationService(db_session).preview_next_membership_id(org.id)
            is None
        )

    async def test_it_is_empty_when_numbering_is_off(self, db_session: AsyncSession):
        org = await _org(db_session, {**AUTO, "enabled": False})

        assert (
            await OrganizationService(db_session).preview_next_membership_id(org.id)
            is None
        )
