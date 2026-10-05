"""``ip_has_active_allowlist_exception`` against the database (INT2-28).

Only an approved, in-date allowlist exception for the exact address counts;
a pending, expired, rejected or blocklist row does not, and neither does a
neighbouring address.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.ip_security import (
    IPException,
    IPExceptionApprovalStatus,
    IPExceptionType,
)
from app.models.user import Organization, User
from app.services.ip_security_service import ip_security_service

pytestmark = pytest.mark.integration


async def _seed(db_session):
    org = Organization(
        id=str(uuid.uuid4()),
        name="IP Dept",
        slug=f"ip-{uuid.uuid4().hex[:8]}",
        organization_type="fire_department",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"ip-{uuid.uuid4().hex[:8]}",
        email=f"ip-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Travel",
        last_name="Member",
        password_hash="x",
    )
    db_session.add(user)
    await db_session.flush()
    return org, user


def _exception(org, user, ip, **kw):
    now = datetime.now(timezone.utc)
    values = dict(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        user_id=user.id,
        requested_by=user.id,
        ip_address=ip,
        exception_type=IPExceptionType.ALLOWLIST,
        reason="Travel",
        requested_duration_days=7,
        approval_status=IPExceptionApprovalStatus.APPROVED,
        valid_from=now - timedelta(days=1),
        valid_until=now + timedelta(days=6),
    )
    values.update(kw)
    return IPException(**values)


async def test_only_an_approved_in_date_allowlist_row_for_the_address_counts(
    db_session,
):
    org, user = await _seed(db_session)
    past = datetime.now(timezone.utc) - timedelta(days=1)
    db_session.add_all(
        [
            _exception(org, user, "203.0.113.10"),
            _exception(
                org,
                user,
                "203.0.113.11",
                approval_status=IPExceptionApprovalStatus.PENDING,
            ),
            _exception(
                org,
                user,
                "203.0.113.12",
                valid_from=past - timedelta(days=7),
                valid_until=past,
            ),
            _exception(
                org,
                user,
                "203.0.113.13",
                exception_type=IPExceptionType.BLOCKLIST,
            ),
        ]
    )
    await db_session.flush()

    check = ip_security_service.ip_has_active_allowlist_exception
    assert await check(db_session, "203.0.113.10") is True
    assert await check(db_session, "203.0.113.11") is False
    assert await check(db_session, "203.0.113.12") is False
    assert await check(db_session, "203.0.113.13") is False
    assert await check(db_session, "203.0.113.1") is False
