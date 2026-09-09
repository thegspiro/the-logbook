"""`PUT /members/{user_id}/size-preferences` must validate the target user.

`user_id` arrives as a client-supplied path parameter (Pitfall #14c). Before
this fix, `upsert_member_size_preferences` never verified the referenced
`User` actually belongs to the caller's `organization_id` before reading or
writing `MemberSizePreferences` -- an inventory manager in org A could supply
org B's user id and have a preferences row created, keyed on org B's user,
under org A's `organization_id`.

That is a cross-tenant write on its own (Pitfall #14c / XC-1). It is also an
availability bug on top of it: `MemberSizePreferences.user_id` is globally
unique, so the poisoned row would then raise an IntegrityError the moment
org B's own admin -- or the member themself, via `/my/size-preferences` --
tried to create the legitimate row for that same user.

Real database, real service call (not source inspection) -- this is reachable
through a normal HTTP call to an endpoint no test previously exercised at the
service layer for this exact scenario.
"""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inventory import MemberSizePreferences
from app.models.user import Organization, User
from app.services.inventory_service import InventoryService

pytestmark = pytest.mark.integration


async def _make_org(db, name="Cross-Org Test FD"):
    org = Organization(name=name, slug=f"xorg-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _make_user(db, org):
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"tester-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.test",
        first_name="Jamie",
        last_name="Rivera",
        password_hash="x",
    )
    db.add(user)
    await db.flush()
    return user


async def test_upsert_rejects_a_user_from_another_organization(
    db_session: AsyncSession,
):
    org_a = await _make_org(db_session, "Org A")
    org_b = await _make_org(db_session, "Org B")
    user_b = await _make_user(db_session, org_b)

    service = InventoryService(db_session)

    prefs, error = await service.upsert_member_size_preferences(
        user_id=uuid.UUID(user_b.id),
        organization_id=uuid.UUID(org_a.id),
        data={"shirt_size": "L"},
    )

    assert prefs is None
    assert error is not None
    assert "User" in error

    # No row was created at all -- not under org A (the attacker's own org)
    # and not misattributed to org B either.
    result = await db_session.execute(
        select(MemberSizePreferences).where(MemberSizePreferences.user_id == user_b.id)
    )
    assert result.scalar_one_or_none() is None


async def test_upsert_still_succeeds_for_a_same_org_user(db_session: AsyncSession):
    """The fix must not block the ordinary, same-org case it was already used for."""
    org = await _make_org(db_session, "Org C")
    user = await _make_user(db_session, org)

    service = InventoryService(db_session)

    prefs, error = await service.upsert_member_size_preferences(
        user_id=uuid.UUID(user.id),
        organization_id=uuid.UUID(org.id),
        data={"shirt_size": "M"},
    )

    assert error is None
    assert prefs is not None
    assert prefs.shirt_size == "M"
