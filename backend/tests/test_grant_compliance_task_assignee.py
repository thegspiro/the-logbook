"""A compliance task can be assigned when it is created (W68).

The create schema had no ``assigned_to``, so the only way to give a task an
owner was to edit it afterwards. The assignee is the client's id, so it is
checked against the department before it is stored (XC-1), as on update.
"""

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.grants import create_compliance_task
from app.models.user import Organization, User
from app.schemas.grant import GrantComplianceTaskCreate
from app.services.grant_service import GrantService

pytestmark = pytest.mark.integration


async def _org(db: AsyncSession) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Assignee VFD",
        slug=f"assignee-{uuid.uuid4().hex[:8]}",
        timezone="America/Chicago",
    )
    db.add(org)
    await db.flush()
    return org


async def _user(db: AsyncSession, org: Organization) -> User:
    name = f"member-{uuid.uuid4().hex[:8]}"
    user = User(
        organization_id=org.id,
        username=name,
        first_name="Pat",
        last_name="Lee",
        email=f"{name}@example.com",
    )
    db.add(user)
    await db.flush()
    return user


@pytest.fixture
async def setup(db_session: AsyncSession):
    org = await _org(db_session)
    treasurer = await _user(db_session, org)
    application = await GrantService(db_session).create_application(
        org.id,
        {"grant_program_name": "Small Equipment Grant", "grant_agency": "SFM"},
        treasurer.id,
    )
    return {
        "db": db_session,
        "org": org,
        "treasurer": treasurer,
        "app_id": uuid.UUID(application.id),
    }


def _task(assignee_id: str) -> GrantComplianceTaskCreate:
    return GrantComplianceTaskCreate.model_validate(
        {
            "taskType": "performance_report",
            "title": "Q4 report",
            "dueDate": "2027-01-15",
            "assignedTo": assignee_id,
        }
    )


async def test_the_assignee_is_stored_on_create(setup):
    member = await _user(setup["db"], setup["org"])

    task = await create_compliance_task(
        app_id=setup["app_id"],
        data=_task(member.id),
        db=setup["db"],
        current_user=setup["treasurer"],
    )

    assert str(task.assigned_to) == member.id


async def test_another_departments_member_is_refused(setup):
    other = await _user(setup["db"], await _org(setup["db"]))

    with pytest.raises(HTTPException) as refused:
        await create_compliance_task(
            app_id=setup["app_id"],
            data=_task(other.id),
            db=setup["db"],
            current_user=setup["treasurer"],
        )

    assert refused.value.status_code == 400
