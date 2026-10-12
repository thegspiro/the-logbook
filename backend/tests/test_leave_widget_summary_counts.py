"""
The leave dashboard widget counts in SQL (USR-5).

Leave rows are never deleted, so the widget used to load every active leave in
the organization to count three numbers in Python. It now asks the database for
one aggregate row. These tests pin that the numbers are unchanged: active
leaves, active leaves ending within 30 days (inclusive of today and day 30),
and active open-ended leaves — inactive leaves and other organizations' leaves
counting toward none of them.
"""

import uuid
from datetime import date, timedelta
from unittest.mock import patch

import pytest

from app.api.v1.endpoints.member_leaves import leave_widget_summary
from app.models.user import (
    LeaveType,
    MemberLeaveOfAbsence,
    Organization,
    User,
    UserStatus,
)

pytestmark = [pytest.mark.integration]

TODAY = date(2026, 10, 5)


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Leave Widget Department",
        slug=f"leavewidget-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _member(db_session, org) -> User:
    handle = uuid.uuid4().hex[:10]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"m-{handle}",
        email=f"{handle}@leavewidget.test",
        first_name="Leave",
        last_name="Taker",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db_session.add(user)
    await db_session.flush()
    return user


def _leave(org, user, end_date, active=True) -> MemberLeaveOfAbsence:
    return MemberLeaveOfAbsence(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        user_id=user.id,
        leave_type=LeaveType.MEDICAL,
        start_date=TODAY - timedelta(days=60),
        end_date=end_date,
        active=active,
    )


async def _summary(db_session, caller):
    async def _today(*_a, **_kw):
        return TODAY

    with patch("app.api.v1.endpoints.member_leaves.resolve_org_today", _today):
        return await leave_widget_summary(db=db_session, current_user=caller)


async def test_counts_match_the_definitions(db_session):
    org = await _org(db_session)
    caller = await _member(db_session, org)
    member = await _member(db_session, org)
    db_session.add_all(
        [
            _leave(org, member, TODAY),  # ends today: within 30
            _leave(org, member, TODAY + timedelta(days=30)),  # day 30: within
            _leave(org, member, TODAY + timedelta(days=31)),  # beyond the window
            _leave(org, member, TODAY - timedelta(days=1)),  # ended, still active
            _leave(org, member, None),  # open-ended
            _leave(org, member, None),  # open-ended
            _leave(org, member, TODAY + timedelta(days=3), active=False),
            _leave(org, member, None, active=False),
        ]
    )
    other_org = await _org(db_session)
    outsider = await _member(db_session, other_org)
    db_session.add(_leave(other_org, outsider, None))
    db_session.add(_leave(other_org, outsider, TODAY + timedelta(days=1)))
    await db_session.flush()

    summary = await _summary(db_session, caller)

    assert summary.active == 6
    assert summary.ending_within_30_days == 2
    assert summary.open_ended == 2


async def test_an_organization_with_no_leaves_reads_zero(db_session):
    org = await _org(db_session)
    caller = await _member(db_session, org)

    summary = await _summary(db_session, caller)

    assert (summary.active, summary.ending_within_30_days, summary.open_ended) == (
        0,
        0,
        0,
    )
