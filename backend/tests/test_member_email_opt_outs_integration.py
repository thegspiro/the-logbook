"""The opt-out view reads one department's current members, from the database.

Only a real database proves the query half: that a member of another
department, a deleted member and a former member are never listed, that the
JSON preferences column is read the way the senders read it, and that paging
and the per-kind counts agree with the filter.
"""

import json
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.email_templates import list_member_email_opt_outs

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _org(db: AsyncSession, settings=None) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone, settings) "
            "VALUES (:id, 'Test Dept', 'fire_department', :slug, 'UTC', :settings)"
        ),
        {
            "id": org_id,
            "slug": f"test-{org_id[:8]}",
            "settings": json.dumps(settings) if settings is not None else None,
        },
    )
    return org_id


async def _member(
    db: AsyncSession,
    org_id: str,
    last_name: str,
    *,
    prefs=None,
    status="active",
    deleted=False,
) -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, notification_preferences, "
            "deleted_at) "
            "VALUES (:id, :org, :un, 'Jo', :last, :em, 'hashed', :status, "
            ":prefs, :deleted)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"u{user_id[:8]}",
            "last": last_name,
            "em": f"{user_id[:8]}@test.com",
            "status": status,
            "prefs": json.dumps(prefs) if prefs is not None else None,
            "deleted": "2026-01-01 00:00:00" if deleted else None,
        },
    )
    return user_id


async def _list(db, org_id, *, kind=None, skip=0, limit=50):
    return await list_member_email_opt_outs(
        kind=kind,
        skip=skip,
        limit=limit,
        db=db,
        current_user=SimpleNamespace(id="admin", organization_id=org_id),
    )


SHIFTS_OFF = {"email_kinds": {"shift_notices": False}}


async def test_only_this_departments_current_members_with_opt_outs_are_listed(
    db_session: AsyncSession,
):
    org_id = await _org(db_session)
    other_org = await _org(db_session)
    await _member(db_session, org_id, "Adams")  # chose nothing
    master_off = await _member(
        db_session, org_id, "Baker", prefs={"email_notifications": False}
    )
    shifts_off = await _member(
        db_session, org_id, "Clark", prefs=SHIFTS_OFF, status="probationary"
    )
    await _member(db_session, org_id, "Davis", prefs=SHIFTS_OFF, deleted=True)
    await _member(db_session, org_id, "Evans", prefs=SHIFTS_OFF, status="inactive")
    await _member(db_session, other_org, "Foster", prefs=SHIFTS_OFF)
    await db_session.flush()

    page = await _list(db_session, org_id)

    assert [m.user_id for m in page.members] == [master_off, shifts_off]
    assert page.total == 2
    assert page.members_considered == 3
    baker, clark = page.members
    assert baker.email_notifications_off is True
    assert baker.turned_off == []
    assert clark.email_notifications_off is False
    assert clark.turned_off == ["shift_notices"]
    assert clark.name == "Jo Clark"
    # Baker's master switch and Clark's own choice both stop shift notices.
    assert page.not_emailed["shift_notices"] == 2
    assert page.not_emailed["volunteer_calls"] == 1


async def test_the_kind_filter_lists_who_is_not_emailed_it(db_session: AsyncSession):
    org_id = await _org(db_session)
    master_off = await _member(
        db_session, org_id, "Baker", prefs={"email_notifications": False}
    )
    shifts_off = await _member(db_session, org_id, "Clark", prefs=SHIFTS_OFF)
    await _member(
        db_session, org_id, "Dunn", prefs={"email_kinds": {"volunteer_calls": False}}
    )
    await db_session.flush()

    page = await _list(db_session, org_id, kind="shift_notices")

    assert [m.user_id for m in page.members] == [master_off, shifts_off]
    assert page.total == 2


async def test_a_kind_the_department_requires_reaches_everyone(
    db_session: AsyncSession,
):
    org_id = await _org(
        db_session, settings={"email_policy": {"required_kinds": ["shift_notices"]}}
    )
    shifts_off = await _member(db_session, org_id, "Clark", prefs=SHIFTS_OFF)
    await db_session.flush()

    filtered = await _list(db_session, org_id, kind="shift_notices")
    assert filtered.members == []
    assert filtered.department_required == ["shift_notices"]

    # The member's own choice is still shown, so the screen can say the
    # department overrides it.
    everything = await _list(db_session, org_id)
    assert [m.user_id for m in everything.members] == [shifts_off]
    assert everything.not_emailed["shift_notices"] == 0


async def test_paging_keeps_the_total(db_session: AsyncSession):
    org_id = await _org(db_session)
    ids = [
        await _member(db_session, org_id, name, prefs=SHIFTS_OFF)
        for name in ("Adams", "Baker", "Clark")
    ]
    await db_session.flush()

    page = await _list(db_session, org_id, skip=1, limit=1)

    assert [m.user_id for m in page.members] == [ids[1]]
    assert page.total == 3
    assert (page.skip, page.limit) == (1, 1)
