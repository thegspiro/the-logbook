"""
W50-45: the Audit Log page attributed every event to "system" because
``/audit-logs`` echoed the stored ``username`` column, which almost every
caller of ``log_audit_event`` leaves NULL (they pass ``user_id`` only). The
endpoint now resolves the actor's username through an org-scoped join on
``users`` at read time, falling back to NULL -- rendered as "system" -- only
when the row has no ``user_id`` at all.
"""

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.audit_logs import get_audit_log_entry, list_audit_logs
from app.core.audit import log_audit_event
from app.models.user import User

pytestmark = [pytest.mark.integration]


async def _insert_org(db: AsyncSession, org_id: str) -> None:
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": f"Audit Dept {org_id[:8]}", "slug": f"aud-{org_id[:8]}"},
    )


async def _insert_user(db: AsyncSession, org_id: str, username: str) -> str:
    uid = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Test', 'Member', :em, 'hashed', 'active')"
        ),
        {"id": uid, "org": org_id, "un": username, "em": f"{uid[:8]}@test.com"},
    )
    return uid


@pytest.fixture
async def audit_world(db_session: AsyncSession):
    org_id = str(uuid.uuid4())
    other_org_id = str(uuid.uuid4())
    await _insert_org(db_session, org_id)
    await _insert_org(db_session, other_org_id)
    admin_id = await _insert_user(db_session, org_id, f"chief-{org_id[:8]}")
    voter_id = await _insert_user(db_session, org_id, f"voter-{org_id[:8]}")
    outsider_id = await _insert_user(
        db_session, other_org_id, f"outsider-{other_org_id[:8]}"
    )
    await db_session.flush()
    admin = (
        await db_session.execute(select(User).where(User.id == admin_id))
    ).scalar_one()

    # The election endpoints pass user_id and never username -- the shape
    # that produced "system" on every row.
    await log_audit_event(
        db=db_session,
        event_type="vote_cast",
        event_category="elections",
        severity="info",
        event_data={"election_id": "e1"},
        user_id=voter_id,
    )
    # No acting user at all: the only case that should still read as system.
    await log_audit_event(
        db=db_session,
        event_type="election_auto_closed",
        event_category="elections",
        severity="info",
        event_data={"election_id": "e1"},
        organization_id=org_id,
    )
    # An org-stamped row whose user_id points at another tenant's user must
    # not resolve that user's name.
    await log_audit_event(
        db=db_session,
        event_type="election_closed",
        event_category="elections",
        severity="info",
        event_data={"election_id": "e1"},
        user_id=outsider_id,
        organization_id=org_id,
    )
    await db_session.flush()
    return {
        "admin": admin,
        "voter_id": voter_id,
        "voter_username": f"voter-{org_id[:8]}",
        "outsider_id": outsider_id,
    }


async def _list(db: AsyncSession, admin: User, **kwargs):
    params = dict(
        event_type=None,
        event_category="elections",
        severity=None,
        user_id=None,
        search=None,
        start_date=None,
        end_date=None,
        skip=0,
        limit=50,
    )
    params.update(kwargs)
    return await list_audit_logs(db=db, current_user=admin, **params)


async def test_list_resolves_actor_username_from_users(
    db_session: AsyncSession, audit_world
):
    body = await _list(db_session, audit_world["admin"])
    by_type = {row["event_type"]: row for row in body["logs"]}

    vote = by_type["vote_cast"]
    assert vote["user_id"] == audit_world["voter_id"]
    assert vote["username"] == audit_world["voter_username"]


async def test_list_leaves_username_null_only_without_actor(
    db_session: AsyncSession, audit_world
):
    body = await _list(db_session, audit_world["admin"])
    by_type = {row["event_type"]: row for row in body["logs"]}

    assert by_type["election_auto_closed"]["user_id"] is None
    assert by_type["election_auto_closed"]["username"] is None
    # Cross-tenant user_id: org-scoped join must not name the outsider.
    assert by_type["election_closed"]["user_id"] == audit_world["outsider_id"]
    assert by_type["election_closed"]["username"] is None
    # The join must not multiply or drop rows.
    assert body["total"] == 3
    assert len(body["logs"]) == 3


async def test_search_matches_resolved_username(db_session: AsyncSession, audit_world):
    body = await _list(
        db_session, audit_world["admin"], search=audit_world["voter_username"]
    )
    assert body["total"] == 1
    assert [row["event_type"] for row in body["logs"]] == ["vote_cast"]


async def test_detail_resolves_actor_username(db_session: AsyncSession, audit_world):
    body = await _list(db_session, audit_world["admin"], event_type="vote_cast")
    log_id = body["logs"][0]["id"]

    entry = await get_audit_log_entry(
        log_id=log_id, db=db_session, current_user=audit_world["admin"]
    )
    assert entry["username"] == audit_world["voter_username"]
