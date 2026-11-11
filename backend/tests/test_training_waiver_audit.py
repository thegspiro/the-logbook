"""Training waiver create, edit and deactivate leave an audit entry.

A waiver excludes months from a member's compliance, so who granted, changed
or withdrew one is exactly what an auditor asks. The entry names the waiver,
the member and the fields that changed — never the reason, which may be
medical and is encrypted at rest.
"""

import json
import uuid
from datetime import date
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.api.v1.endpoints.training_waivers import (
    TrainingWaiverCreate,
    TrainingWaiverUpdate,
    create_training_waiver,
    delete_training_waiver,
    update_training_waiver,
)
from app.models.audit import AuditLog
from app.models.user import Organization, User, UserStatus

pytestmark = [pytest.mark.integration]

REASON = "Knee surgery, cleared to return in March"


async def _setup(db_session):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Waiver Audit FD",
        slug=f"waiver-audit-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    users = []
    for handle in ("officer", "member"):
        user = User(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            username=f"waiver-{handle}-{uuid.uuid4().hex[:6]}",
            email=f"{handle}-{uuid.uuid4().hex[:6]}@waiver.test",
            first_name=handle.title(),
            last_name="Member",
            password_hash="x",
            status=UserStatus.ACTIVE,
        )
        db_session.add(user)
        users.append(user)
    await db_session.flush()
    officer, member = users
    actor = SimpleNamespace(
        id=officer.id, organization_id=org.id, username=officer.username
    )
    return org, actor, member


async def _entries(db_session, org_id, event_type):
    result = await db_session.execute(
        select(AuditLog).where(
            AuditLog.organization_id == str(org_id),
            AuditLog.event_type == event_type,
        )
    )
    return list(result.scalars().all())


async def test_create_edit_and_deactivate_are_audited_without_the_reason(
    db_session,
):
    org, actor, member = await _setup(db_session)

    created = await create_training_waiver(
        TrainingWaiverCreate(
            user_id=str(member.id),
            waiver_type="medical",
            reason=REASON,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 3, 31),
        ),
        db=db_session,
        current_user=actor,
    )
    await update_training_waiver(
        created.id,
        TrainingWaiverUpdate(end_date=date(2026, 4, 30), reason=REASON + " (ext)"),
        db=db_session,
        current_user=actor,
    )
    await delete_training_waiver(created.id, db=db_session, current_user=actor)

    [create_entry] = await _entries(db_session, org.id, "training_waiver_created")
    [update_entry] = await _entries(db_session, org.id, "training_waiver_updated")
    [delete_entry] = await _entries(db_session, org.id, "training_waiver_deactivated")

    for entry in (create_entry, update_entry, delete_entry):
        assert entry.user_id == str(actor.id)
        assert entry.event_category == "training"
        assert entry.event_data["waiver_id"] == created.id
        assert entry.event_data["member_id"] == str(member.id)
        assert "Knee" not in json.dumps(entry.event_data)
    assert create_entry.event_data["waiver_type"] == "medical"
    assert update_entry.event_data["changed_fields"] == ["end_date", "reason"]
