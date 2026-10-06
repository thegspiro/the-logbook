"""
A new or renamed position may not reuse another position's name (W05-5).

Two positions named alike were indistinguishable wherever an administrator
picks one to grant. Names are compared trimmed and case-insensitively. Pairs
that already share a name are left as they are — saving one without renaming
it still works — and the Role Management screen marks them.
"""

import uuid

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.roles import _duplicate_name_409
from app.models.user import Organization, Role, User, UserStatus
from app.services.role_service import DuplicatePositionNameError, RoleManagementService

pytestmark = [pytest.mark.integration]


async def _org_and_admin(db_session):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Positions Department",
        slug=f"positions-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    handle = uuid.uuid4().hex[:10]
    admin = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"a-{handle}",
        email=f"{handle}@positions.test",
        first_name="Ada",
        last_name="Admin",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db_session.add(admin)
    await db_session.flush()
    return org, admin


def _role(org, name, slug=None) -> Role:
    return Role(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        slug=slug or f"r_{uuid.uuid4().hex[:8]}",
        permissions=[],
        is_system=False,
        priority=10,
    )


async def test_create_refuses_a_name_in_use(db_session):
    org, admin = await _org_and_admin(db_session)
    db_session.add(_role(org, "Report Reader"))
    await db_session.flush()

    with pytest.raises(DuplicatePositionNameError):
        await RoleManagementService().create_role(
            db=db_session,
            organization_id=org.id,
            name="  report reader ",
            permissions=[],
            created_by=admin.id,
        )


async def test_another_organization_may_use_the_name(db_session):
    org, admin = await _org_and_admin(db_session)
    other, _ = await _org_and_admin(db_session)
    db_session.add(_role(other, "Report Reader"))
    await db_session.flush()

    role = await RoleManagementService().create_role(
        db=db_session,
        organization_id=org.id,
        name="Report Reader",
        permissions=[],
        created_by=admin.id,
    )

    assert role.name == "Report Reader"


async def test_rename_refuses_a_name_in_use(db_session):
    org, admin = await _org_and_admin(db_session)
    taken = _role(org, "Driver")
    renamed = _role(org, "Engineer")
    db_session.add_all([taken, renamed])
    await db_session.flush()

    with pytest.raises(DuplicatePositionNameError):
        await RoleManagementService().update_role(
            db=db_session,
            role_id=renamed.id,
            organization_id=org.id,
            updated_by=admin.id,
            name="DRIVER",
        )


async def test_an_existing_duplicate_can_still_be_saved_and_renamed(db_session):
    org, admin = await _org_and_admin(db_session)
    first = _role(org, "Report Reader")
    second = _role(org, "Report Reader")
    db_session.add_all([first, second])
    await db_session.flush()
    svc = RoleManagementService()

    # Saving without renaming — even resending the shared name — is allowed.
    await svc.update_role(
        db=db_session,
        role_id=second.id,
        organization_id=org.id,
        updated_by=admin.id,
        name="Report Reader",
        description="Reads reports",
    )
    # Renaming one apart resolves the pair.
    renamed = await svc.update_role(
        db=db_session,
        role_id=second.id,
        organization_id=org.id,
        updated_by=admin.id,
        name="Report Reader (Training)",
    )

    assert renamed.name == "Report Reader (Training)"


async def _refused_inside_the_guard():
    async with _duplicate_name_409():
        raise DuplicatePositionNameError('A position named "X" already exists.')


async def test_the_endpoints_answer_409():
    with pytest.raises(HTTPException) as exc:
        await _refused_inside_the_guard()

    assert exc.value.status_code == 409
