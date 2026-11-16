"""The member history reads in words, not stored identifiers (W11-11).

A profile save was listed as "Member profile updated: middle_name, phone,
membership_number, rank, emergency_contacts", and a status change as
"probationary → leave": the stored field names and status values, underscores
and all. The officer reading the history sees words.
"""

import uuid
from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.users import get_member_audit_history
from app.core.audit import log_audit_event
from app.models.user import User

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def officer_and_member(db_session: AsyncSession):
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'History Wording Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"history-wording-{org_id[:8]}"},
    )
    ids = {}
    for role in ("officer", "member"):
        uid = str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) "
                "VALUES (:id, :org, :un, 'Pat', 'Doe', :em, 'x', 'active')"
            ),
            {
                "id": uid,
                "org": org_id,
                "un": f"{role}-{uid[:8]}",
                "em": f"{role}-{uid[:8]}@test.com",
            },
        )
        ids[role] = uid
    await db_session.flush()
    officer = (
        await db_session.execute(select(User).where(User.id == ids["officer"]))
    ).scalar_one()
    return officer, ids["member"]


async def _history(db_session, officer, member_id):
    return await get_member_audit_history(
        user_id=UUID(member_id),
        page=1,
        page_size=50,
        event_type=None,
        db=db_session,
        current_user=officer,
    )


async def test_a_profile_save_names_the_fields_in_words(
    db_session: AsyncSession, officer_and_member
):
    officer, member_id = officer_and_member
    await log_audit_event(
        db=db_session,
        event_type="user_profile_updated",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": member_id,
            "fields_updated": ["middle_name", "membership_number", "phone"],
        },
        user_id=str(officer.id),
        username=officer.username,
    )
    await db_session.flush()

    (entry,) = await _history(db_session, officer, member_id)

    assert (
        entry.description
        == "Member profile updated: middle name, membership number, phone"
    )


async def test_a_status_change_reads_as_words(
    db_session: AsyncSession, officer_and_member
):
    officer, member_id = officer_and_member
    await log_audit_event(
        db=db_session,
        event_type="member_status_changed",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": member_id,
            "previous_status": "active",
            "new_status": "dropped_voluntary",
        },
        user_id=str(officer.id),
        username=officer.username,
    )
    await db_session.flush()

    (entry,) = await _history(db_session, officer, member_id)

    assert entry.description == "Status changed: Active → Dropped voluntary"
