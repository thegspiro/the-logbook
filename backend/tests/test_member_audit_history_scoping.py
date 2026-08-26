"""
Regression test for the member audit-history query's actor-fallback bug.

``get_member_audit_history`` (``api/v1/endpoints/users.py``) is documented as
returning "changes to the member's record" for one member. Its query OR's
together five target-field matches (the member was acted upon) with a sixth,
unconditional clause: ``AuditLog.user_id == user_id_str`` (the member was the
actor). That sixth clause fired for *any* event the member performed,
including ones with a different member as the recorded target -- pulling that
other member's event_data into the acting member's history under their name.

The fix narrows the actor clause to only self-inherent events (no target key
populated at all), leaving already-target-matched events to the first five
clauses on their own merits.
"""

import uuid
from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.users import (
    _AUDIT_EVENT_DESCRIPTIONS,
    get_member_audit_history,
)
from app.core.audit import log_audit_event
from app.models.user import User

pytestmark = [pytest.mark.integration]


def test_new_event_types_are_in_the_member_history_allowlist():
    """admin_mfa_reset and compliance_exemption_changed are real, emitted
    event types (users.py:1820, member_status.py:1028) that the audit-history
    query filters through this dict -- they were missing, so a manager could
    never see either action in a member's history."""
    assert "admin_mfa_reset" in _AUDIT_EVENT_DESCRIPTIONS
    assert "compliance_exemption_changed" in _AUDIT_EVENT_DESCRIPTIONS


@pytest.fixture
async def two_members(db_session: AsyncSession):
    org_id = str(uuid.uuid4())
    manager_id = str(uuid.uuid4())
    other_id = str(uuid.uuid4())

    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": "Audit Scope Test Dept",
            "otype": "fire_department",
            "slug": f"audit-{org_id[:8]}",
            "tz": "UTC",
        },
    )
    for uid, un in ((manager_id, "manager"), (other_id, "other")):
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, last_name, "
                "email, password_hash, status) "
                "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
            ),
            {
                "id": uid,
                "org": org_id,
                "un": f"{un}-{uid[:8]}",
                "fn": un.capitalize(),
                "ln": "Member",
                "em": f"{un}-{uid[:8]}@test.com",
                "pw": "hashed",
            },
        )
    await db_session.flush()

    manager = (
        await db_session.execute(select(User).where(User.id == manager_id))
    ).scalar_one()
    return {"org_id": org_id, "manager": manager, "other_id": other_id}


async def test_actor_fallback_does_not_leak_actions_on_other_members(
    db_session: AsyncSession, two_members
):
    manager = two_members["manager"]
    other_id = two_members["other_id"]

    # The manager acts ON the other member (a real target-bearing event).
    await log_audit_event(
        db=db_session,
        event_type="admin_mfa_reset",
        event_category="user_management",
        severity="warning",
        event_data={"target_user_id": other_id, "target_username": "other"},
        user_id=str(manager.id),
        username=manager.username,
    )
    # The manager acts on THEMSELVES with a genuinely self-inherent event --
    # no target key at all, e.g. updating their own contact info.
    await log_audit_event(
        db=db_session,
        event_type="user_updated",
        event_category="user_management",
        severity="info",
        event_data={"fields_changed": ["phone"]},
        user_id=str(manager.id),
        username=manager.username,
    )
    await db_session.flush()

    # Viewing the OTHER member's history: the admin_mfa_reset event belongs
    # here (they were the target) -- this side already worked before the fix.
    other_history = await get_member_audit_history(
        user_id=UUID(other_id),
        page=1,
        page_size=50,
        event_type=None,
        db=db_session,
        current_user=manager,
    )
    assert any(e.event_type == "admin_mfa_reset" for e in other_history)

    # Viewing the MANAGER's own history: their self-update belongs here, but
    # the admin_mfa_reset event they performed ON SOMEONE ELSE must not --
    # that's the bug. Before the fix, the unconditional `user_id == manager`
    # clause pulled it in under the manager's own history.
    manager_history = await get_member_audit_history(
        user_id=UUID(str(manager.id)),
        page=1,
        page_size=50,
        event_type=None,
        db=db_session,
        current_user=manager,
    )
    manager_event_types = {e.event_type for e in manager_history}
    assert "user_updated" in manager_event_types
    assert "admin_mfa_reset" not in manager_event_types
