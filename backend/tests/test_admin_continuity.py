"""
Administrator continuity guard (ORU-7).

Verifies that no single request can leave an organization without an active
member holding `members.manage`. Recovering from that state needs direct
database access — the onboarding flow refuses to mint a second system owner,
and every restore endpoint is itself gated on `members.manage`.
"""

import uuid

import pytest

from app.models.user import Organization, Position, User, UserStatus
from app.services.admin_continuity_service import (
    ADMIN_PERMISSION,
    LastAdministratorError,
    assert_not_last_administrator,
    assert_positions_retain_administrator,
    assert_role_change_retains_administrator,
    is_administrator,
)

pytestmark = [pytest.mark.integration]


async def _make_org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Continuity Test Department",
        slug=f"continuity-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _make_position(db_session, org, name, permissions) -> Position:
    position = Position(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        slug=f"{name.lower().replace(' ', '_')}-{uuid.uuid4().hex[:6]}",
        permissions=permissions,
    )
    db_session.add(position)
    await db_session.flush()
    return position


async def _make_user(
    db_session, org, username, positions=(), status=UserStatus.ACTIVE
) -> User:
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=username,
        email=f"{username}@continuity.test",
        first_name="Test",
        last_name=username.title(),
        password_hash="x",
        status=status,
    )
    user.positions = list(positions)
    db_session.add(user)
    await db_session.flush()
    return user


class TestIsAdministrator:
    async def test_active_holder_of_members_manage_is_an_admin(self, db_session):
        org = await _make_org(db_session)
        chief = await _make_position(db_session, org, "Chief", [ADMIN_PERMISSION])
        user = await _make_user(db_session, org, "chief", [chief])

        assert is_administrator(user) is True

    async def test_wildcard_counts_as_admin(self, db_session):
        org = await _make_org(db_session)
        owner = await _make_position(db_session, org, "Owner", ["*"])
        user = await _make_user(db_session, org, "owner", [owner])

        assert is_administrator(user) is True

    async def test_module_wildcard_counts_as_admin(self, db_session):
        org = await _make_org(db_session)
        pos = await _make_position(db_session, org, "Members Admin", ["members.*"])
        user = await _make_user(db_session, org, "memadmin", [pos])

        assert is_administrator(user) is True

    async def test_inactive_holder_is_not_an_admin(self, db_session):
        # Authentication requires is_active, so a suspended admin cannot
        # actually restore anything.
        org = await _make_org(db_session)
        chief = await _make_position(db_session, org, "Chief", [ADMIN_PERMISSION])
        user = await _make_user(
            db_session, org, "suspended", [chief], status=UserStatus.SUSPENDED
        )

        assert is_administrator(user) is False

    async def test_member_without_the_permission_is_not_an_admin(self, db_session):
        org = await _make_org(db_session)
        pos = await _make_position(db_session, org, "Firefighter", ["events.view"])
        user = await _make_user(db_session, org, "ff", [pos])

        assert is_administrator(user) is False


class TestAssertNotLastAdministrator:
    async def test_rejects_removing_the_only_administrator(self, db_session):
        org = await _make_org(db_session)
        chief = await _make_position(db_session, org, "Chief", [ADMIN_PERMISSION])
        admin = await _make_user(db_session, org, "onlyadmin", [chief])
        await _make_user(db_session, org, "regular")

        with pytest.raises(LastAdministratorError) as exc:
            await assert_not_last_administrator(
                db_session, org.id, admin.id, action="deactivate"
            )

        assert "deactivate" in str(exc.value)

    async def test_allows_removing_one_of_two_administrators(self, db_session):
        org = await _make_org(db_session)
        chief = await _make_position(db_session, org, "Chief", [ADMIN_PERMISSION])
        first = await _make_user(db_session, org, "admin1", [chief])
        await _make_user(db_session, org, "admin2", [chief])

        await assert_not_last_administrator(
            db_session, org.id, first.id, action="deactivate"
        )

    async def test_allows_removing_a_non_administrator(self, db_session):
        org = await _make_org(db_session)
        chief = await _make_position(db_session, org, "Chief", [ADMIN_PERMISSION])
        await _make_user(db_session, org, "admin1", [chief])
        regular = await _make_user(db_session, org, "regular")

        await assert_not_last_administrator(
            db_session, org.id, regular.id, action="delete"
        )

    async def test_an_inactive_second_admin_does_not_count(self, db_session):
        # A suspended admin cannot sign in, so they are not a fallback.
        org = await _make_org(db_session)
        chief = await _make_position(db_session, org, "Chief", [ADMIN_PERMISSION])
        active = await _make_user(db_session, org, "activeadmin", [chief])
        await _make_user(
            db_session, org, "sleeping", [chief], status=UserStatus.SUSPENDED
        )

        with pytest.raises(LastAdministratorError):
            await assert_not_last_administrator(
                db_session, org.id, active.id, action="archive"
            )

    async def test_another_organizations_admin_does_not_count(self, db_session):
        # Multi-tenant isolation: org B's chief cannot restore org A.
        org_a = await _make_org(db_session)
        org_b = await _make_org(db_session)
        chief_a = await _make_position(db_session, org_a, "Chief", [ADMIN_PERMISSION])
        chief_b = await _make_position(db_session, org_b, "Chief", [ADMIN_PERMISSION])
        admin_a = await _make_user(db_session, org_a, "admin-a", [chief_a])
        await _make_user(db_session, org_b, "admin-b", [chief_b])

        with pytest.raises(LastAdministratorError):
            await assert_not_last_administrator(
                db_session, org_a.id, admin_a.id, action="delete"
            )


class TestAssertPositionsRetainAdministrator:
    async def test_rejects_stripping_the_only_admins_positions(self, db_session):
        org = await _make_org(db_session)
        chief = await _make_position(db_session, org, "Chief", [ADMIN_PERMISSION])
        admin = await _make_user(db_session, org, "onlyadmin", [chief])

        with pytest.raises(LastAdministratorError):
            await assert_positions_retain_administrator(
                db_session, org.id, admin.id, set()
            )

    async def test_allows_a_swap_that_keeps_the_permission(self, db_session):
        org = await _make_org(db_session)
        chief = await _make_position(db_session, org, "Chief", [ADMIN_PERMISSION])
        admin = await _make_user(db_session, org, "onlyadmin", [chief])

        # Moving from Chief to President keeps members.manage, so it is fine.
        await assert_positions_retain_administrator(
            db_session, org.id, admin.id, {ADMIN_PERMISSION}
        )

    async def test_allows_stripping_a_non_administrator(self, db_session):
        org = await _make_org(db_session)
        chief = await _make_position(db_session, org, "Chief", [ADMIN_PERMISSION])
        await _make_user(db_session, org, "admin1", [chief])
        regular = await _make_user(db_session, org, "regular")

        await assert_positions_retain_administrator(
            db_session, org.id, regular.id, set()
        )


class TestAssertRoleChangeRetainsAdministrator:
    async def test_rejects_emptying_the_only_admin_position(self, db_session):
        # A position's permissions are shared, so this strips every holder.
        org = await _make_org(db_session)
        chief = await _make_position(db_session, org, "Chief", [ADMIN_PERMISSION])
        await _make_user(db_session, org, "admin1", [chief])
        await _make_user(db_session, org, "admin2", [chief])

        with pytest.raises(LastAdministratorError):
            await assert_role_change_retains_administrator(
                db_session, org.id, chief.id, [], action="edit"
            )

    async def test_rejects_deleting_the_only_admin_position(self, db_session):
        org = await _make_org(db_session)
        chief = await _make_position(db_session, org, "Chief", [ADMIN_PERMISSION])
        await _make_user(db_session, org, "admin1", [chief])

        with pytest.raises(LastAdministratorError):
            await assert_role_change_retains_administrator(
                db_session, org.id, chief.id, None, action="delete"
            )

    async def test_allows_the_edit_when_another_position_still_grants_it(
        self, db_session
    ):
        org = await _make_org(db_session)
        chief = await _make_position(db_session, org, "Chief", [ADMIN_PERMISSION])
        president = await _make_position(
            db_session, org, "President", [ADMIN_PERMISSION]
        )
        await _make_user(db_session, org, "admin1", [chief])
        await _make_user(db_session, org, "admin2", [president])

        await assert_role_change_retains_administrator(
            db_session, org.id, chief.id, [], action="edit"
        )

    async def test_allows_an_edit_that_keeps_the_permission(self, db_session):
        org = await _make_org(db_session)
        chief = await _make_position(db_session, org, "Chief", [ADMIN_PERMISSION])
        await _make_user(db_session, org, "admin1", [chief])

        await assert_role_change_retains_administrator(
            db_session,
            org.id,
            chief.id,
            [ADMIN_PERMISSION, "events.view"],
            action="edit",
        )
