"""
Correcting the reason recorded for a member's last status change.

The reason was write-once: typed in the Change status dialog and never
editable afterwards. Officers can now correct it. Only the wording moves --
the status, when it changed, and the original audit entry stay as they were.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from app.api.v1.endpoints.member_status import (
    StatusChangeReasonUpdate,
    get_status_change,
    update_status_change_reason,
)
from app.models.audit import AuditLog
from app.models.user import Organization, User, UserStatus

pytestmark = [pytest.mark.integration]


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Status Reason Department",
        slug=f"statreason-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _user(db_session, org, **overrides) -> User:
    handle = uuid.uuid4().hex[:10]
    fields = dict(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"u-{handle}",
        email=f"{handle}@statreason.test",
        first_name="Sam",
        last_name="Smith",
        password_hash="x",
        status=UserStatus.ACTIVE,
        hire_date=date(2018, 3, 1),
    )
    fields.update(overrides)
    user = User(**fields)
    db_session.add(user)
    await db_session.flush()
    return user


async def _retired(db_session, org, reason="Moved out of the district"):
    # Whole seconds: the column stores no fraction, so a comparison after a
    # refresh would otherwise fail on microseconds the database never kept.
    changed = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(days=10)
    return await _user(
        db_session,
        org,
        status=UserStatus.RETIRED,
        status_changed_at=changed,
        status_change_reason=reason,
    )


async def _audit_rows(db_session, member):
    rows = (
        (
            await db_session.execute(
                select(AuditLog).where(
                    AuditLog.event_type == "member_status_reason_updated"
                )
            )
        )
        .scalars()
        .all()
    )
    return [r for r in rows if r.event_data.get("target_user_id") == member.id]


async def test_reads_the_last_change_and_its_reason(db_session):
    org = await _org(db_session)
    officer = await _user(db_session, org)
    member = await _retired(db_session, org)

    record = await get_status_change(member.id, db=db_session, current_user=officer)

    assert record.status == "retired"
    assert record.status_change_reason == "Moved out of the district"
    assert record.status_changed_at is not None


async def test_corrects_the_reason_and_leaves_the_change_alone(db_session):
    org = await _org(db_session)
    officer = await _user(db_session, org)
    member = await _retired(db_session, org)
    changed_at = member.status_changed_at

    record = await update_status_change_reason(
        member.id,
        StatusChangeReasonUpdate(reason="  Retired after 20 years of service  "),
        db=db_session,
        current_user=officer,
    )

    assert record.status_change_reason == "Retired after 20 years of service"
    await db_session.refresh(member)
    assert member.status == UserStatus.RETIRED
    assert member.status_changed_at == changed_at
    [entry] = await _audit_rows(db_session, member)
    assert entry.event_data["previous_reason"] == "Moved out of the district"
    assert entry.event_data["new_reason"] == "Retired after 20 years of service"


async def test_a_blank_reason_clears_it(db_session):
    org = await _org(db_session)
    officer = await _user(db_session, org)
    member = await _retired(db_session, org)

    record = await update_status_change_reason(
        member.id,
        StatusChangeReasonUpdate(reason="   "),
        db=db_session,
        current_user=officer,
    )

    assert record.status_change_reason is None
    await db_session.refresh(member)
    assert member.status_change_reason is None


async def test_an_unchanged_reason_is_not_logged(db_session):
    org = await _org(db_session)
    officer = await _user(db_session, org)
    member = await _retired(db_session, org)

    await update_status_change_reason(
        member.id,
        StatusChangeReasonUpdate(reason="Moved out of the district"),
        db=db_session,
        current_user=officer,
    )

    assert await _audit_rows(db_session, member) == []


async def test_refused_when_no_status_change_is_recorded(db_session):
    org = await _org(db_session)
    officer = await _user(db_session, org)
    member = await _user(db_session, org, status_changed_at=None)

    with pytest.raises(HTTPException) as exc:
        await update_status_change_reason(
            member.id,
            StatusChangeReasonUpdate(reason="Joined"),
            db=db_session,
            current_user=officer,
        )
    assert exc.value.status_code == 400
    await db_session.refresh(member)
    assert member.status_change_reason is None


async def test_another_departments_member_is_not_found(db_session):
    org = await _org(db_session)
    other = await _org(db_session)
    officer = await _user(db_session, org)
    member = await _retired(db_session, other)

    with pytest.raises(HTTPException) as read:
        await get_status_change(member.id, db=db_session, current_user=officer)
    assert read.value.status_code == 404

    with pytest.raises(HTTPException) as write:
        await update_status_change_reason(
            member.id,
            StatusChangeReasonUpdate(reason="Rewritten from outside"),
            db=db_session,
            current_user=officer,
        )
    assert write.value.status_code == 404
    await db_session.refresh(member)
    assert member.status_change_reason == "Moved out of the district"


@pytest.mark.unit
def test_an_overlong_reason_is_rejected():
    with pytest.raises(ValidationError):
        StatusChangeReasonUpdate(reason="x" * 2001)
