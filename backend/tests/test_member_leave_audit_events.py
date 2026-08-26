"""
Regression coverage for leave-of-absence audit logging.

``leave_of_absence_created/updated/deleted`` were declared in the member
audit-history's event-type dict and dropdown filter map for as long as that
allowlist has existed, but no code path ever called ``log_audit_event`` with
any of them -- officers could create, edit, or deactivate a member's leave
record with no trace in that member's audit trail. These tests call the
member_leaves.py endpoint functions directly against a real database and
assert the audit row each mutation is now expected to produce.
"""

import uuid
from datetime import date

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.member_leaves import (
    LeaveOfAbsenceCreate,
    LeaveOfAbsenceUpdate,
    create_leave_of_absence,
    delete_leave_of_absence,
    update_leave_of_absence,
)
from app.models.audit import AuditLog
from app.models.user import User

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def manager_and_member(db_session: AsyncSession):
    org_id = str(uuid.uuid4())
    manager_id = str(uuid.uuid4())
    member_id = str(uuid.uuid4())

    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": "Leave Audit Test Dept",
            "otype": "fire_department",
            "slug": f"leaveaudit-{org_id[:8]}",
            "tz": "UTC",
        },
    )
    for uid, un in ((manager_id, "manager"), (member_id, "member")):
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
                "ln": "User",
                "em": f"{un}-{uid[:8]}@test.com",
                "pw": "hashed",
            },
        )
    await db_session.flush()

    manager = (
        await db_session.execute(select(User).where(User.id == manager_id))
    ).scalar_one()
    return {"manager": manager, "member_id": member_id}


async def _latest_audit_event(db_session, event_type):
    result = await db_session.execute(
        select(AuditLog)
        .where(AuditLog.event_type == event_type)
        .order_by(AuditLog.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def test_create_leave_emits_audit_event(
    db_session: AsyncSession, manager_and_member
):
    manager = manager_and_member["manager"]
    member_id = manager_and_member["member_id"]

    await create_leave_of_absence(
        LeaveOfAbsenceCreate(
            user_id=member_id,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 2, 1),
        ),
        db_session,
        manager,
    )

    event = await _latest_audit_event(db_session, "leave_of_absence_created")
    assert event is not None
    assert event.event_data["target_user_id"] == member_id
    assert event.user_id == str(manager.id)


async def test_update_leave_emits_audit_event(
    db_session: AsyncSession, manager_and_member
):
    manager = manager_and_member["manager"]
    member_id = manager_and_member["member_id"]

    created = await create_leave_of_absence(
        LeaveOfAbsenceCreate(
            user_id=member_id,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 2, 1),
        ),
        db_session,
        manager,
    )

    await update_leave_of_absence(
        created.id,
        LeaveOfAbsenceUpdate(reason="Extended"),
        db_session,
        manager,
    )

    event = await _latest_audit_event(db_session, "leave_of_absence_updated")
    assert event is not None
    assert event.event_data["target_user_id"] == member_id
    assert "reason" in event.event_data["fields_changed"]


async def test_delete_leave_emits_audit_event(
    db_session: AsyncSession, manager_and_member
):
    manager = manager_and_member["manager"]
    member_id = manager_and_member["member_id"]

    created = await create_leave_of_absence(
        LeaveOfAbsenceCreate(
            user_id=member_id,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 2, 1),
        ),
        db_session,
        manager,
    )

    await delete_leave_of_absence(created.id, db_session, manager)

    event = await _latest_audit_event(db_session, "leave_of_absence_deleted")
    assert event is not None
    assert event.event_data["target_user_id"] == member_id
