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
from datetime import date, datetime, timezone
from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Organization, User
from app.schemas.organization import MembershipIdSettings
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


def _on(day: date):
    """Fix the org's "today" -- the generator reads it for {YYYY} and resets."""
    return patch("app.services.organization_service.org_today", return_value=day)


YEARLY = {
    **AUTO,
    "prefix": "",
    "pattern": "{YYYY}-{SEQ}",
    "padding": 3,
    "reset_yearly": True,
    "start_number": 1,
}


class TestPatterns:
    async def test_a_year_pattern_is_issued_and_advances(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session, dict(YEARLY))
        service = OrganizationService(db_session)

        with _on(date(2026, 9, 29)):
            first = await service.generate_next_membership_id(org.id)
            second = await service.generate_next_membership_id(org.id)

        assert (first, second) == ("2026-001", "2026-002")
        assert org.settings["membership_id"]["counter_year"] == 2026

    async def test_the_count_restarts_when_the_year_turns(
        self, db_session: AsyncSession
    ):
        org = await _org(
            db_session, {**YEARLY, "next_number": 57, "counter_year": 2025}
        )

        with _on(date(2026, 1, 2)):
            issued = await OrganizationService(db_session).generate_next_membership_id(
                org.id
            )

        assert issued == "2026-001"
        assert org.settings["membership_id"]["next_number"] == 2

    async def test_the_count_carries_on_without_yearly_reset(
        self, db_session: AsyncSession
    ):
        org = await _org(
            db_session,
            {**YEARLY, "reset_yearly": False, "next_number": 57, "counter_year": 2025},
        )

        with _on(date(2026, 1, 2)):
            issued = await OrganizationService(db_session).generate_next_membership_id(
                org.id
            )

        assert issued == "2026-057"

    async def test_switching_reset_on_mid_year_keeps_the_officers_number(
        self, db_session: AsyncSession
    ):
        # No recorded period: the counter has not issued since reset was turned
        # on, so next_number is what the officer set and must be honoured.
        org = await _org(db_session, {**YEARLY, "next_number": 15})

        with _on(date(2026, 9, 29)):
            issued = await OrganizationService(db_session).generate_next_membership_id(
                org.id
            )

        assert issued == "2026-015"

    async def test_a_fiscal_year_named_by_its_end(self, db_session: AsyncSession):
        org = await _org(
            db_session,
            {
                **YEARLY,
                "year_basis": "fiscal",
                "fiscal_year_start_month": 7,
                "fiscal_year_label": "end",
                "next_number": 40,
                "counter_year": 2026,
            },
        )

        # 1 July 2026 opens FY2027, so the count restarts.
        with _on(date(2026, 7, 1)):
            issued = await OrganizationService(db_session).generate_next_membership_id(
                org.id
            )

        assert issued == "2027-001"

    async def test_the_preview_follows_the_reset_without_applying_it(
        self, db_session: AsyncSession
    ):
        org = await _org(
            db_session, {**YEARLY, "next_number": 57, "counter_year": 2025}
        )

        with _on(date(2026, 1, 2)):
            preview = await OrganizationService(db_session).preview_next_membership_id(
                org.id
            )

        assert preview == "2026-001"
        assert org.settings["membership_id"]["next_number"] == 57
        assert org.settings["membership_id"]["counter_year"] == 2025

    async def test_saving_the_settings_keeps_the_counter_year(
        self, db_session: AsyncSession
    ):
        # counter_year is outside the schema so a settings save cannot write it
        # back stale; the deep merge must keep the stored one.
        org = await _org(db_session, {**YEARLY, "counter_year": 2026})
        service = OrganizationService(db_session)

        await service.update_organization_settings(
            org.id,
            {"membership_id": MembershipIdSettings(**YEARLY).model_dump(mode="json")},
        )

        assert org.settings["membership_id"]["counter_year"] == 2026


class TestTheStartingNumber:
    async def test_it_is_a_floor(self, db_session: AsyncSession):
        # A department that says its numbers start at 100 gets 100, without an
        # officer also having to move the counter.
        org = await _org(db_session, {**AUTO, "start_number": 100, "next_number": 1})

        issued = await OrganizationService(db_session).generate_next_membership_id(
            org.id
        )

        assert issued == "FD-0100"
        assert org.settings["membership_id"]["next_number"] == 101

    async def test_a_counter_already_past_it_carries_on(self, db_session: AsyncSession):
        org = await _org(db_session, {**AUTO, "start_number": 100, "next_number": 140})

        issued = await OrganizationService(db_session).generate_next_membership_id(
            org.id
        )

        assert issued == "FD-0140"


class TestFormerMembersKeepTheirNumber:
    async def _former(self, db_session, org, number):
        # users.py soft-delete: the number moves aside and the column is freed.
        gone = await _member(db_session, org, None)
        gone.previous_membership_number = number
        gone.deleted_at = datetime.now(timezone.utc)
        await db_session.flush()
        return gone

    async def test_the_generator_never_reissues_it(self, db_session: AsyncSession):
        org = await _org(db_session, dict(AUTO))
        await self._former(db_session, org, "FD-0001")

        issued = await OrganizationService(db_session).generate_next_membership_id(
            org.id
        )

        assert issued == "FD-0002"

    async def test_it_cannot_be_typed_in_for_someone_else(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session, dict(AUTO))
        await self._former(db_session, org, "FD-0001")

        with pytest.raises(ValueError, match="belonged to a former member"):
            await OrganizationService(db_session).ensure_membership_number_available(
                org.id, "FD-0001"
            )

    async def test_it_can_be_given_back_to_its_owner(self, db_session: AsyncSession):
        org = await _org(db_session, dict(AUTO))
        gone = await self._former(db_session, org, "FD-0001")

        await OrganizationService(db_session).ensure_membership_number_available(
            org.id, "FD-0001", exclude_user_id=str(gone.id)
        )

    async def test_a_current_number_is_reported_as_taken(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session, dict(AUTO))
        await _member(db_session, org, "FD-0001")

        with pytest.raises(ValueError, match="already exists"):
            await OrganizationService(db_session).ensure_membership_number_available(
                org.id, "FD-0001"
            )
