"""Nobody grants or extends their own leave of absence (ADV2-9).

Owner decision 2026-11-16. A leave creates a training waiver for its member,
so an officer holding ``members.manage`` and ``scheduling.assign`` could
excuse their own training requirements by giving themselves a leave, and with
``members.manage`` alone could extend a leave they were already on. Their own
leave now goes through a leave request, whose approvers never include the
requester. Ending one's own leave early is still allowed: it excuses nothing.
"""

import uuid
from datetime import date

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.member_leaves import (
    LeaveOfAbsenceCreate,
    LeaveOfAbsenceUpdate,
    create_leave_of_absence,
    delete_leave_of_absence,
    update_leave_of_absence,
)
from app.models.training import TrainingWaiver
from app.models.user import MemberLeaveOfAbsence, User
from app.services.member_leave_service import MemberLeaveService

pytestmark = [pytest.mark.integration]


@pytest.fixture
async def officers(db_session: AsyncSession):
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Self Leave Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"selfleave-{org_id[:8]}"},
    )
    ids = {}
    for role in ("officer", "colleague"):
        uid = str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) "
                "VALUES (:id, :org, :un, :fn, 'User', :em, 'hashed', 'active')"
            ),
            {
                "id": uid,
                "org": org_id,
                "un": f"{role}-{uid[:8]}",
                "fn": role.capitalize(),
                "em": f"{role}-{uid[:8]}@test.com",
            },
        )
        ids[role] = uid
    await db_session.flush()
    users = {
        role: (
            await db_session.execute(select(User).where(User.id == uid))
        ).scalar_one()
        for role, uid in ids.items()
    }
    return users


async def _counts(db: AsyncSession, user_id: str) -> tuple[int, int]:
    leaves = await db.scalar(
        select(MemberLeaveOfAbsence.id)
        .where(MemberLeaveOfAbsence.user_id == user_id)
        .limit(1)
    )
    waivers = await db.scalar(
        select(TrainingWaiver.id).where(TrainingWaiver.user_id == user_id).limit(1)
    )
    return (leaves is not None, waivers is not None)


async def test_an_officer_cannot_grant_themselves_a_leave(db_session, officers):
    officer = officers["officer"]

    with pytest.raises(HTTPException) as refused:
        await create_leave_of_absence(
            LeaveOfAbsenceCreate(
                user_id=officer.id,
                start_date=date(2026, 1, 1),
                end_date=date(2026, 6, 30),
            ),
            BackgroundTasks(),
            db_session,
            officer,
        )

    assert refused.value.status_code == 400
    assert "your own leave" in refused.value.detail
    # No leave, and so no training waiver excusing their requirements.
    assert await _counts(db_session, officer.id) == (False, False)


async def test_the_service_refuses_it_whatever_the_caller(db_session, officers):
    officer = officers["officer"]
    with pytest.raises(ValueError, match="your own leave"):
        await MemberLeaveService(db_session).create_leave(
            organization_id=officer.organization_id,
            user_id=officer.id,
            start_date=date(2026, 1, 1),
            granted_by=officer.id,
        )


async def test_an_officer_cannot_extend_a_leave_they_are_on(db_session, officers):
    officer, colleague = officers["officer"], officers["colleague"]
    granted = await create_leave_of_absence(
        LeaveOfAbsenceCreate(
            user_id=officer.id,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 2, 1),
        ),
        BackgroundTasks(),
        db_session,
        colleague,
    )

    with pytest.raises(HTTPException) as refused:
        await update_leave_of_absence(
            granted.id,
            LeaveOfAbsenceUpdate(end_date=date(2026, 12, 31)),
            BackgroundTasks(),
            db_session,
            officer,
        )

    assert refused.value.status_code == 403
    db_session.expire_all()
    stored = await db_session.get(MemberLeaveOfAbsence, granted.id)
    assert stored.end_date == date(2026, 2, 1)


async def test_a_colleague_still_grants_and_changes_it(db_session, officers):
    officer, colleague = officers["officer"], officers["colleague"]
    granted = await create_leave_of_absence(
        LeaveOfAbsenceCreate(
            user_id=officer.id,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 2, 1),
        ),
        BackgroundTasks(),
        db_session,
        colleague,
    )
    updated = await update_leave_of_absence(
        granted.id,
        LeaveOfAbsenceUpdate(end_date=date(2026, 3, 1)),
        BackgroundTasks(),
        db_session,
        colleague,
    )

    assert updated.end_date == date(2026, 3, 1)
    assert await _counts(db_session, officer.id) == (True, True)


async def test_an_officer_may_end_their_own_leave_early(db_session, officers):
    officer, colleague = officers["officer"], officers["colleague"]
    granted = await create_leave_of_absence(
        LeaveOfAbsenceCreate(user_id=officer.id, start_date=date(2026, 1, 1)),
        BackgroundTasks(),
        db_session,
        colleague,
    )

    await delete_leave_of_absence(granted.id, BackgroundTasks(), db_session, officer)

    db_session.expire_all()
    stored = await db_session.get(MemberLeaveOfAbsence, granted.id)
    assert stored.active is False
