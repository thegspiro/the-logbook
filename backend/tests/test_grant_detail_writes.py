"""The grant detail page's writes, as the page sends them.

Workflow review W68, driven as the treasurer:

- Adding a budget line, an expenditure, a compliance task or a note was a 422:
  each create schema required ``application_id`` in the body, which the page
  never sent and the endpoint discards in favour of the path.
- "Mark Complete" on a compliance task, and editing a budget line or an
  opportunity, were 500s *after* the write: ``onupdate`` expired
  ``updated_at`` at the flush and the response model's lazy read raised
  MissingGreenlet.
- The application form's Budget Summary and Key Contacts are free text, which
  the schema refused, so any save with either filled was a 422.
- "Assigned To" was dropped on create, which had no such field.
"""

import uuid
from datetime import date, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.grants import (
    create_budget_item,
    create_compliance_task,
    create_expenditure,
    create_note,
    update_budget_item,
    update_compliance_task,
    update_opportunity,
)
from app.models.user import Organization, User
from app.schemas.grant import (
    GrantApplicationCreate,
    GrantApplicationUpdate,
    GrantBudgetItemCreate,
    GrantBudgetItemResponse,
    GrantBudgetItemUpdate,
    GrantComplianceTaskCreate,
    GrantComplianceTaskResponse,
    GrantComplianceTaskUpdate,
    GrantExpenditureCreate,
    GrantNoteCreate,
    GrantOpportunityResponse,
    GrantOpportunityUpdate,
)
from app.services.grant_service import GrantService

pytestmark = pytest.mark.integration


@pytest.fixture
async def setup(db_session: AsyncSession):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Grant Writes VFD",
        slug=f"grant-writes-{uuid.uuid4().hex[:8]}",
        timezone="America/Chicago",
    )
    db_session.add(org)
    await db_session.flush()
    name = f"treasurer-{uuid.uuid4().hex[:8]}"
    user = User(
        organization_id=org.id,
        username=name,
        first_name="Tess",
        last_name="Park",
        email=f"{name}@example.com",
    )
    db_session.add(user)
    await db_session.flush()

    service = GrantService(db_session)
    opportunity = await service.create_opportunity(
        org.id, {"name": "Small Equipment Grant", "agency": "SFM"}, user.id
    )
    application = await service.create_application(
        org.id,
        {"grant_program_name": "Small Equipment Grant", "grant_agency": "SFM"},
        user.id,
    )
    return {
        "db": db_session,
        "user": user,
        "opportunity": opportunity,
        "app_id": uuid.UUID(application.id),
    }


class TestCreatesWithoutApplicationIdInBody:
    async def test_budget_item(self, setup):
        data = GrantBudgetItemCreate.model_validate(
            {"category": "equipment", "description": "Cameras", "amountBudgeted": 16000}
        )
        item = await create_budget_item(
            app_id=setup["app_id"],
            data=data,
            db=setup["db"],
            current_user=setup["user"],
        )
        assert str(item.application_id) == str(setup["app_id"])

    async def test_expenditure(self, setup):
        data = GrantExpenditureCreate.model_validate(
            {"description": "FLIR K55", "amount": 8400, "expenditureDate": "2026-10-15"}
        )
        expenditure = await create_expenditure(
            app_id=setup["app_id"],
            data=data,
            db=setup["db"],
            current_user=setup["user"],
        )
        assert str(expenditure.application_id) == str(setup["app_id"])

    async def test_compliance_task(self, setup):
        data = GrantComplianceTaskCreate.model_validate(
            {
                "taskType": "performance_report",
                "title": "Q4 report",
                "dueDate": "2027-01-15",
            }
        )
        task = await create_compliance_task(
            app_id=setup["app_id"],
            data=data,
            db=setup["db"],
            current_user=setup["user"],
        )
        assert str(task.application_id) == str(setup["app_id"])

    async def test_note(self, setup):
        data = GrantNoteCreate.model_validate(
            {"noteType": "general", "content": "Cameras delivered."}
        )
        note = await create_note(
            app_id=setup["app_id"],
            data=data,
            db=setup["db"],
            current_user=setup["user"],
        )
        assert str(note.application_id) == str(setup["app_id"])


class TestUpdatesReturnASerializableRow:
    async def test_marking_a_task_complete(self, setup):
        task = await create_compliance_task(
            app_id=setup["app_id"],
            data=GrantComplianceTaskCreate.model_validate(
                {"taskType": "audit", "title": "Audit", "dueDate": "2027-01-15"}
            ),
            db=setup["db"],
            current_user=setup["user"],
        )
        updated = await update_compliance_task(
            task_id=uuid.UUID(task.id),
            data=GrantComplianceTaskUpdate.model_validate({"status": "completed"}),
            db=setup["db"],
            current_user=setup["user"],
        )
        response = GrantComplianceTaskResponse.model_validate(updated)
        assert response.status == "completed"
        assert isinstance(response.completed_date, date)

    async def test_editing_a_budget_item(self, setup):
        item = await create_budget_item(
            app_id=setup["app_id"],
            data=GrantBudgetItemCreate.model_validate(
                {"category": "training", "amountBudgeted": 2500}
            ),
            db=setup["db"],
            current_user=setup["user"],
        )
        updated = await update_budget_item(
            item_id=uuid.UUID(item.id),
            data=GrantBudgetItemUpdate.model_validate({"notes": "Two sessions"}),
            db=setup["db"],
            current_user=setup["user"],
        )
        assert GrantBudgetItemResponse.model_validate(updated).notes == "Two sessions"

    async def test_editing_an_opportunity(self, setup):
        updated = await update_opportunity(
            opportunity_id=uuid.UUID(setup["opportunity"].id),
            data=GrantOpportunityUpdate.model_validate({"notes": "Opens in spring"}),
            db=setup["db"],
            current_user=setup["user"],
        )
        response = GrantOpportunityResponse.model_validate(updated)
        assert response.notes == "Opens in spring"
        assert isinstance(response.updated_at, datetime)


class TestApplicationFields:
    def test_free_text_summary_and_contacts_are_accepted(self):
        update = GrantApplicationUpdate.model_validate(
            {
                "budgetSummary": "Cameras $16,000; admin $500",
                "keyContacts": "Jane Doe, SFM grants officer",
            }
        )
        assert update.key_contacts == "Jane Doe, SFM grants officer"

    def test_structured_contacts_are_still_accepted(self):
        update = GrantApplicationUpdate.model_validate(
            {"keyContacts": [{"name": "Jane Doe"}], "budgetSummary": {"total": 1}}
        )
        assert update.key_contacts == [{"name": "Jane Doe"}]

    async def test_create_keeps_the_assignee(self, setup):
        data = GrantApplicationCreate.model_validate(
            {
                "grantProgramName": "AFG",
                "grantAgency": "FEMA",
                "assignedTo": setup["user"].id,
            }
        )
        application = await GrantService(setup["db"]).create_application(
            setup["user"].organization_id,
            data.model_dump(exclude_unset=True),
            setup["user"].id,
        )
        assert str(application.assigned_to) == setup["user"].id
