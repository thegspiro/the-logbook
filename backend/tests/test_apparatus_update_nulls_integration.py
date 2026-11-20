"""Equipment, custom-field and operator updates against a real database.

Each update dumps its payload with ``exclude_unset`` and the Update schemas
accept ``null`` for every field, NOT NULL columns included. A hand-written
``setattr`` loop wrote that null straight onto the row, and MySQL refused it at
flush: an ``IntegrityError``, which the endpoints do not catch, so the caller
got a 500. ``apply_updates`` refuses it as a ``ValueError`` instead, which the
endpoints turn into a 400 (AP2-8). A null against a nullable column still
clears it, which is the half the setattr loop did get right and must keep.
"""

import uuid

import pytest

from app.models.apparatus import (
    Apparatus,
    ApparatusCustomField,
    ApparatusEquipment,
    ApparatusOperator,
    ApparatusStatus,
    ApparatusType,
)
from app.models.user import Organization, User
from app.schemas.apparatus import (
    ApparatusCustomFieldUpdate,
    ApparatusEquipmentUpdate,
    ApparatusOperatorUpdate,
)
from app.services.apparatus_service import ApparatusService

pytestmark = [pytest.mark.integration]


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()), name="Dept", slug=f"dept-{uuid.uuid4().hex[:8]}"
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _apparatus(db_session, org: Organization) -> Apparatus:
    kind = ApparatusType(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Engine",
        code=f"ENG{uuid.uuid4().hex[:4]}",
    )
    state = ApparatusStatus(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="In Service",
        code=f"IS{uuid.uuid4().hex[:4]}",
    )
    db_session.add_all([kind, state])
    await db_session.flush()
    apparatus = Apparatus(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        unit_number=f"E-{uuid.uuid4().hex[:5]}",
        apparatus_type_id=kind.id,
        status_id=state.id,
    )
    db_session.add(apparatus)
    await db_session.flush()
    return apparatus


async def _equipment(db_session) -> ApparatusEquipment:
    org = await _org(db_session)
    apparatus = await _apparatus(db_session, org)
    equipment = ApparatusEquipment(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        apparatus_id=apparatus.id,
        name="Halligan",
        notes="Left rear compartment",
    )
    db_session.add(equipment)
    await db_session.flush()
    return equipment


async def _custom_field(db_session) -> ApparatusCustomField:
    org = await _org(db_session)
    field = ApparatusCustomField(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Pump rating",
        field_key=f"pump_{uuid.uuid4().hex[:6]}",
        placeholder="GPM",
    )
    db_session.add(field)
    await db_session.flush()
    return field


async def _operator(db_session) -> ApparatusOperator:
    org = await _org(db_session)
    apparatus = await _apparatus(db_session, org)
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"op-{suffix}",
        email=f"op-{suffix}@example.org",
    )
    db_session.add(user)
    await db_session.flush()
    operator = ApparatusOperator(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        apparatus_id=apparatus.id,
        user_id=user.id,
        license_type_required="CDL-B",
    )
    db_session.add(operator)
    await db_session.flush()
    return operator


class TestEquipmentUpdate:
    async def test_null_name_is_refused_as_a_validation_error(self, db_session):
        equipment = await _equipment(db_session)

        with pytest.raises(ValueError, match="'name' cannot be cleared"):
            await ApparatusService(db_session).update_equipment(
                equipment.id,
                ApparatusEquipmentUpdate.model_validate({"name": None}),
                equipment.organization_id,
            )

    async def test_null_notes_clears_them(self, db_session):
        equipment = await _equipment(db_session)

        updated = await ApparatusService(db_session).update_equipment(
            equipment.id,
            ApparatusEquipmentUpdate.model_validate({"notes": None}),
            equipment.organization_id,
        )

        assert updated.notes is None
        assert updated.name == "Halligan"


class TestCustomFieldUpdate:
    async def test_null_field_key_is_refused_as_a_validation_error(self, db_session):
        field = await _custom_field(db_session)

        with pytest.raises(ValueError, match="'field_key' cannot be cleared"):
            await ApparatusService(db_session).update_custom_field(
                field.id,
                ApparatusCustomFieldUpdate.model_validate({"fieldKey": None}),
                field.organization_id,
            )

    async def test_null_placeholder_clears_it(self, db_session):
        field = await _custom_field(db_session)

        updated = await ApparatusService(db_session).update_custom_field(
            field.id,
            ApparatusCustomFieldUpdate.model_validate({"placeholder": None}),
            field.organization_id,
        )

        assert updated.placeholder is None


class TestOperatorUpdate:
    async def test_null_is_active_is_refused_as_a_validation_error(self, db_session):
        operator = await _operator(db_session)

        with pytest.raises(ValueError, match="'is_active' cannot be cleared"):
            await ApparatusService(db_session).update_operator(
                operator.id,
                ApparatusOperatorUpdate.model_validate({"isActive": None}),
                operator.organization_id,
            )

    async def test_null_license_type_clears_it(self, db_session):
        operator = await _operator(db_session)

        updated = await ApparatusService(db_session).update_operator(
            operator.id,
            ApparatusOperatorUpdate.model_validate({"licenseTypeRequired": None}),
            operator.organization_id,
        )

        assert updated.license_type_required is None
