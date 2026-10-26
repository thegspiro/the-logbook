"""A full Apparatus that a shift template still names cannot be hard-deleted.

``shift_templates.apparatus_id`` (and the shift, pre-work, equipment-check and
call-response columns beside it) has no foreign key: it may hold an
``apparatus`` or a ``basic_apparatus`` id. Deleting the full Apparatus left the
template pointing at nothing, and the template form re-sends its stored id on
every save, so ``update_template`` refused every later edit with "Apparatus not
found". The basic-apparatus path already deactivated an in-use vehicle instead;
the full one now refuses and points at archiving, which keeps the row.
"""

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.apparatus import delete_apparatus
from app.models.apparatus import Apparatus, ApparatusStatus, ApparatusType
from app.models.training import ShiftTemplate
from app.models.user import Organization
from app.services.apparatus_service import ApparatusService
from app.services.scheduling_service import SchedulingService

pytestmark = pytest.mark.integration


async def _org_with_two_units(db: AsyncSession):
    suffix = uuid.uuid4().hex[:8]
    org = Organization(id=str(uuid.uuid4()), name="Units", slug=f"units-{suffix}")
    db.add(org)
    await db.flush()
    unit_type = ApparatusType(
        id=str(uuid.uuid4()), organization_id=org.id, name="Engine", code=f"E{suffix}"
    )
    status = ApparatusStatus(
        id=str(uuid.uuid4()), organization_id=org.id, name="In", code=f"I{suffix}"
    )
    db.add_all([unit_type, status])
    await db.flush()
    in_use, unused = (
        Apparatus(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            unit_number=f"{label}-{suffix}",
            apparatus_type_id=unit_type.id,
            status_id=status.id,
        )
        for label in ("E1", "E2")
    )
    db.add_all([in_use, unused])
    await db.flush()
    template = ShiftTemplate(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Day Shift",
        start_time_of_day="07:00",
        end_time_of_day="19:00",
        duration_hours=12.0,
        apparatus_id=in_use.id,
    )
    db.add(template)
    await db.flush()
    return org, in_use, unused, template


async def test_an_apparatus_a_template_names_is_not_deleted(db_session: AsyncSession):
    org, in_use, _, template = await _org_with_two_units(db_session)

    with pytest.raises(ValueError, match="archive it instead"):
        await ApparatusService(db_session).delete_apparatus(in_use.id, org.id)

    still_there = await db_session.scalar(
        select(Apparatus.id).where(Apparatus.id == in_use.id)
    )
    assert still_there == in_use.id
    # The template keeps saving, which is what the refusal protects.
    updated, err = await SchedulingService(db_session).update_template(
        uuid.UUID(template.id), org.id, {"apparatus_id": in_use.id, "name": "Days"}
    )
    assert err is None
    assert updated is not None


async def test_an_apparatus_nothing_names_is_deleted(db_session: AsyncSession):
    org, _, unused, _ = await _org_with_two_units(db_session)

    assert await ApparatusService(db_session).delete_apparatus(unused.id, org.id)

    gone = await db_session.scalar(
        select(Apparatus.id).where(Apparatus.id == unused.id)
    )
    assert gone is None


async def test_the_endpoint_answers_400(db_session: AsyncSession):
    org, in_use, _, _ = await _org_with_two_units(db_session)
    user = SimpleNamespace(id="u1", organization_id=org.id)

    with pytest.raises(HTTPException) as exc:
        await delete_apparatus(apparatus_id=in_use.id, db=db_session, current_user=user)

    assert exc.value.status_code == 400
    assert "archive it instead" in exc.value.detail
