"""Unticking a seeded position in the setup wizard has to remove it.

``save_session_roles`` deleted only ``is_system=False`` rows and then updated
whatever the wizard submitted. A seeded position the administrator unticked was
therefore never mentioned again — and survived. The department finished setup
believing it had said "we do not have Lieutenants", and Lieutenant went on
appearing in every position picker.

That is the failure this whole step exists to avoid: the wizard is where a
department describes the structure it actually has, and a checkbox that looks
like it removes a position and does not is worse than not offering one.

Three things are never removed this way, and each is asserted below: the System
Owner's own position, the baseline ``member`` position every account is given,
and any position somebody already holds.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.onboarding import (
    RolePermission,
    RoleSetupItem,
    RolesSetupRequest,
    save_session_roles,
)
from app.core.constants import ROLE_IT_MANAGER, ROLE_MEMBER
from app.models.user import Position, User
from app.services.onboarding import OnboardingService

pytestmark = [pytest.mark.integration, pytest.mark.onboarding]


async def _org_with_seeded_positions(db_session: AsyncSession):
    service = OnboardingService(db_session)
    unique = str(uuid.uuid4())[:8]
    org = await service.create_organization(
        name=f"Removal Test Department {unique}",
        slug=f"removal-test-{unique}",
        organization_type="fire_department",
        timezone="America/New_York",
    )
    await db_session.flush()
    return org


async def _slugs(db_session: AsyncSession, org_id: str) -> set[str]:
    result = await db_session.execute(
        select(Position.slug).where(Position.organization_id == org_id)
    )
    return set(result.scalars().all())


def _submit(slugs, seeded: dict) -> RolesSetupRequest:
    """A wizard submission carrying exactly these positions, unedited.

    The checkboxes say what the registry seeded, so ``_merge_default_permissions``
    treats every module as untouched and the stored grants are unchanged — the
    common path, where the only thing the administrator did was untick a row.
    """
    return RolesSetupRequest(
        roles=[
            RoleSetupItem(
                id=slug,
                name=seeded[slug].name,
                description=seeded[slug].description,
                priority=seeded[slug].priority,
                permissions={},
            )
            for slug in slugs
        ]
    )


async def _save(db_session: AsyncSession, org_id: str, request: RolesSetupRequest):
    session = SimpleNamespace(data={"department": {"organization_id": str(org_id)}})
    with patch(
        "app.api.v1.onboarding.validate_session",
        new=AsyncMock(return_value=session),
    ), patch(
        "app.services.onboarding.OnboardingService.needs_onboarding",
        new=AsyncMock(return_value=True),
    ):
        return await save_session_roles(SimpleNamespace(), request, db_session)


class TestUntickedPositionsAreRemoved:
    async def test_an_unticked_seeded_position_is_removed(
        self, db_session: AsyncSession
    ):
        org = await _org_with_seeded_positions(db_session)
        before = await _slugs(db_session, org.id)
        assert "lieutenant" in before, "fixture expects the seeded fire ladder"

        seeded = {
            p.slug: p
            for p in (
                await db_session.execute(
                    select(Position).where(Position.organization_id == org.id)
                )
            ).scalars()
        }
        kept = before - {"lieutenant", "captain"}
        response = await _save(db_session, org.id, _submit(kept, seeded))

        after = await _slugs(db_session, org.id)
        assert "lieutenant" not in after
        assert "captain" not in after
        assert kept <= after
        assert sorted(response.removed) == sorted(
            [seeded["captain"].name, seeded["lieutenant"].name]
        )

    async def test_the_system_owner_and_member_positions_survive_being_unticked(
        self, db_session: AsyncSession
    ):
        """Neither is the administrator's to remove.

        it_manager is the position the System Owner holds — removing it would
        lock the only account out of the installation it is setting up — and
        member is the baseline every account is given.
        """
        org = await _org_with_seeded_positions(db_session)
        seeded = {
            p.slug: p
            for p in (
                await db_session.execute(
                    select(Position).where(Position.organization_id == org.id)
                )
            ).scalars()
        }

        await _save(db_session, org.id, _submit(["firefighter"], seeded))

        after = await _slugs(db_session, org.id)
        assert ROLE_IT_MANAGER in after
        assert ROLE_MEMBER in after

    async def test_a_position_somebody_holds_is_not_removed(
        self, db_session: AsyncSession
    ):
        """Silently stripping a member's access is not a thing to leave to chance.

        During setup the only account is the System Owner, whose two positions
        are both protected outright — so this guard covers a resumed or unusual
        session rather than an expected one, and is asserted here because the
        cost of it being wrong is somebody losing access without being told.
        """
        org = await _org_with_seeded_positions(db_session)
        positions = {
            p.slug: p
            for p in (
                await db_session.execute(
                    select(Position).where(Position.organization_id == org.id)
                )
            ).scalars()
        }
        holder = User(
            organization_id=org.id,
            username=f"holder-{str(uuid.uuid4())[:8]}",
            email=f"holder-{str(uuid.uuid4())[:8]}@example.com",
            password_hash="x",
            first_name="Held",
            last_name="Position",
        )
        holder.positions.append(positions["captain"])
        db_session.add(holder)
        await db_session.flush()

        response = await _save(db_session, org.id, _submit(["firefighter"], positions))

        after = await _slugs(db_session, org.id)
        assert "captain" in after
        assert positions["captain"].name not in response.removed

    async def test_reticking_a_removed_position_puts_it_back_with_its_grants(
        self, db_session: AsyncSession
    ):
        """Going back a step must not be a one-way door.

        The create branch rebuilds a registry slug from DEFAULT_POSITIONS, so a
        position removed and then reselected comes back with the grants the
        registry seeds rather than with whatever two checkboxes could express.
        """
        from app.core.permissions import DEFAULT_POSITIONS

        org = await _org_with_seeded_positions(db_session)
        seeded = {
            p.slug: p
            for p in (
                await db_session.execute(
                    select(Position).where(Position.organization_id == org.id)
                )
            ).scalars()
        }
        all_slugs = set(seeded)

        await _save(db_session, org.id, _submit(all_slugs - {"captain"}, seeded))
        assert "captain" not in await _slugs(db_session, org.id)

        await _save(db_session, org.id, _submit(all_slugs, seeded))

        restored = (
            await db_session.execute(
                select(Position).where(
                    Position.organization_id == org.id, Position.slug == "captain"
                )
            )
        ).scalar_one()
        assert sorted(restored.permissions) == sorted(
            DEFAULT_POSITIONS["captain"]["permissions"]
        )


class TestRolePermissionIsStillHonoured:
    async def test_a_submitted_position_is_never_removed(
        self, db_session: AsyncSession
    ):
        org = await _org_with_seeded_positions(db_session)
        request = RolesSetupRequest(
            roles=[
                RoleSetupItem(
                    id="firefighter",
                    name="Firefighter",
                    description="",
                    priority=40,
                    permissions={"events": RolePermission(view=True, manage=False)},
                )
            ]
        )
        response = await _save(db_session, org.id, request)

        assert "firefighter" in await _slugs(db_session, org.id)
        assert "Firefighter" not in response.removed
