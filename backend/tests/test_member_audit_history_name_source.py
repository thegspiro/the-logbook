"""
The member audit-history page must not write into the history it shows.

``MemberAuditHistoryPage`` used to load the member's header name through
``GET /users/{id}/with-roles`` (``get_user_with_roles``), which records a
``user_viewed`` ("Member profile viewed") audit entry on every call -- and
``user_viewed`` is one of the event types the audit-history query returns, so
each visit added a row to the very timeline being read. The owner ruled those
view entries out for this page.

The page now reads the name from ``GET /users/{id}/roles``
(``get_user_roles``). These tests pin the properties that choice relies on:
that endpoint carries the name fields the header renders, is org-scoped, and
neither it nor the history read itself writes a ``user_viewed`` entry. The full
profile endpoint's own view logging is untouched and is not exercised here.
"""

import uuid
from uuid import UUID

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.users import get_member_audit_history, get_user_roles
from app.models.audit import AuditLog
from app.models.user import User

pytestmark = [pytest.mark.integration]


async def _insert_org(db: AsyncSession, org_id: str) -> None:
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": f"Audit Name Source Dept {org_id[:8]}",
            "otype": "fire_department",
            "slug": f"audit-name-{org_id[:8]}",
            "tz": "UTC",
        },
    )


async def _insert_user(
    db: AsyncSession, org_id: str, uid: str, un: str, fn: str, ln: str
) -> None:
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
        ),
        {
            "id": uid,
            "org": org_id,
            "un": f"{un}-{uid[:8]}",
            "fn": fn,
            "ln": ln,
            "em": f"{un}-{uid[:8]}@test.com",
            "pw": "hashed",
        },
    )


@pytest.fixture
async def members(db_session: AsyncSession):
    org_id = str(uuid.uuid4())
    other_org_id = str(uuid.uuid4())
    manager_id = str(uuid.uuid4())
    member_id = str(uuid.uuid4())
    outsider_id = str(uuid.uuid4())

    await _insert_org(db_session, org_id)
    await _insert_org(db_session, other_org_id)
    await _insert_user(db_session, org_id, manager_id, "manager", "Morgan", "Chief")
    await _insert_user(db_session, org_id, member_id, "member", "Emeka", "Adeyemi")
    await _insert_user(
        db_session, other_org_id, outsider_id, "outsider", "Olu", "Elsewhere"
    )
    await db_session.flush()

    manager = (
        await db_session.execute(select(User).where(User.id == manager_id))
    ).scalar_one()
    return {
        "org_id": org_id,
        "manager": manager,
        "member_id": member_id,
        "outsider_id": outsider_id,
    }


async def _user_viewed_count(db: AsyncSession, org_id: str) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(AuditLog)
            .where(AuditLog.organization_id == org_id)
            .where(AuditLog.event_type == "user_viewed")
        )
    ).scalar_one()


async def test_name_read_carries_the_name_and_logs_no_view(
    db_session: AsyncSession, members
):
    member_id = members["member_id"]
    org_id = members["org_id"]
    before = await _user_viewed_count(db_session, org_id)

    body = await get_user_roles(
        user_id=UUID(member_id), db=db_session, current_user=members["manager"]
    )
    await db_session.flush()

    assert str(body["user_id"]) == member_id
    assert body["full_name"] == "Emeka Adeyemi"
    assert body["username"] == f"member-{member_id[:8]}"
    assert await _user_viewed_count(db_session, org_id) == before


async def test_history_read_logs_no_view(db_session: AsyncSession, members):
    org_id = members["org_id"]
    before = await _user_viewed_count(db_session, org_id)

    history = await get_member_audit_history(
        user_id=UUID(members["member_id"]),
        page=1,
        page_size=50,
        event_type=None,
        db=db_session,
        current_user=members["manager"],
    )
    await db_session.flush()

    assert all(e.event_type != "user_viewed" for e in history)
    assert await _user_viewed_count(db_session, org_id) == before


async def test_name_read_does_not_cross_organizations(
    db_session: AsyncSession, members
):
    with pytest.raises(HTTPException) as exc:
        await get_user_roles(
            user_id=UUID(members["outsider_id"]),
            db=db_session,
            current_user=members["manager"],
        )
    assert exc.value.status_code == 404
