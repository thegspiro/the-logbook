"""Changing a member's status or archiving them respects the caller's ceiling.

Both take an account out of service (or put one back), so they apply the same
check as deleting a member or resetting their password: a member manager may
not act on someone holding permissions they do not hold themselves.
"""

import uuid
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.api.v1.endpoints import users as users_endpoint
from app.api.v1.endpoints.member_status import (
    ArchiveMemberRequest,
    MemberStatusChangeRequest,
    archive_member,
    change_member_status,
)
from app.models.user import Organization, Position, User, UserStatus

pytestmark = pytest.mark.integration


async def _org(db):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Ceiling Test Department",
        slug=f"ceiling-{uuid.uuid4().hex[:8]}",
        settings={},
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    return org


async def _member(db, org, permissions, status=UserStatus.ACTIVE):
    name = f"u{uuid.uuid4().hex[:8]}"
    position = Position(
        organization_id=org.id,
        name=f"Position {name}",
        slug=f"pos-{name}",
        permissions=permissions,
    )
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=name,
        email=f"{name}@ceiling.test",
        first_name="Test",
        last_name=name.title(),
        password_hash="x",
        status=status,
        hire_date=date(2015, 1, 1),
        positions=[position],
    )
    db.add_all([position, user])
    await db.flush()
    return user


def _caller(org, *permissions):
    return SimpleNamespace(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username="secretary",
        rank=None,
        positions=[SimpleNamespace(permissions=list(permissions))],
    )


@pytest.fixture
def escalation_report(monkeypatch):
    report = AsyncMock()
    monkeypatch.setattr(users_endpoint, "report_privilege_escalation_attempt", report)
    return report


class TestStatusChange:
    async def test_refused_for_a_more_privileged_member(
        self, db_session, escalation_report
    ):
        org = await _org(db_session)
        owner = await _member(db_session, org, ["members.manage", "settings.manage"])
        owner_id = owner.id

        with pytest.raises(HTTPException) as exc:
            await change_member_status(
                owner.id,
                MemberStatusChangeRequest(new_status="inactive"),
                BackgroundTasks(),
                db=db_session,
                current_user=_caller(org, "members.manage"),
            )

        assert exc.value.status_code == 403
        assert "privileges beyond your own" in exc.value.detail
        assert escalation_report.await_args.args[2] == (
            f"member-status-change:{owner_id}"
        )
        refreshed = await db_session.get(User, owner_id)
        assert refreshed.status == UserStatus.ACTIVE

    async def test_allowed_within_the_callers_permissions(
        self, db_session, escalation_report
    ):
        org = await _org(db_session)
        member = await _member(db_session, org, ["events.view"])
        member_id = member.id

        await change_member_status(
            member.id,
            MemberStatusChangeRequest(new_status="inactive"),
            BackgroundTasks(),
            db=db_session,
            current_user=_caller(org, "members.manage", "events.view"),
        )

        refreshed = await db_session.get(User, member_id)
        assert refreshed.status == UserStatus.INACTIVE
        escalation_report.assert_not_awaited()


class TestArchive:
    async def test_refused_for_a_more_privileged_member(
        self, db_session, escalation_report
    ):
        org = await _org(db_session)
        officer = await _member(
            db_session,
            org,
            ["members.manage", "finance.manage"],
            status=UserStatus.DROPPED_VOLUNTARY,
        )
        officer_id = officer.id

        with pytest.raises(HTTPException) as exc:
            await archive_member(
                officer.id,
                ArchiveMemberRequest(),
                db=db_session,
                current_user=_caller(org, "members.manage"),
            )

        assert exc.value.status_code == 403
        assert "privileges beyond your own" in exc.value.detail
        assert escalation_report.await_args.args[2] == f"member-archive:{officer_id}"
        refreshed = await db_session.get(User, officer_id)
        assert refreshed.status == UserStatus.DROPPED_VOLUNTARY

    async def test_allowed_within_the_callers_permissions(
        self, db_session, escalation_report
    ):
        org = await _org(db_session)
        member = await _member(
            db_session, org, ["events.view"], status=UserStatus.DROPPED_VOLUNTARY
        )
        member_id = member.id

        await archive_member(
            member.id,
            ArchiveMemberRequest(),
            db=db_session,
            current_user=_caller(org, "members.manage", "events.view"),
        )

        refreshed = await db_session.get(User, member_id)
        assert refreshed.status == UserStatus.ARCHIVED
        escalation_report.assert_not_awaited()
