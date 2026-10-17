"""The grant detail page's create forms, and the application's assignee.

The budget item, expenditure, compliance task and note create schemas each
required an ``application_id`` in the body, while the page (correctly) sent it
only in the URL path — so every one of those four forms was refused with a 422
before the endpoint could read the path. The note form also sent a note type
the API does not have.

The application's Assigned To was a free-text name box: the update schema
types it as a member id, so an edit with a name was refused, and the create
schema had no such field, so a create silently dropped it.
"""

import uuid

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.models.grant import GrantApplication
from app.models.user import Organization, User
from app.schemas.grant import (
    GrantApplicationCreate,
    GrantBudgetItemCreate,
    GrantComplianceTaskCreate,
    GrantExpenditureCreate,
    GrantNoteCreate,
)
from app.services.grant_service import GrantService

# The bodies GrantDetailPage.tsx posts, verbatim: the application id is in the
# URL path only.
BUDGET_ITEM = {
    "category": "equipment",
    "description": "Portable radios",
    "amountBudgeted": 1200.5,
}
EXPENDITURE = {
    "description": "Radio order",
    "amount": 400,
    "expenditureDate": "2026-09-01",
    "vendor": None,
    "invoiceNumber": None,
    "budgetItemId": None,
}
COMPLIANCE_TASK = {
    "taskType": "performance_report",
    "title": "Quarterly report",
    "description": None,
    "dueDate": "2026-12-31",
    "priority": "medium",
    "reportTemplate": None,
}
NOTE = {"noteType": "general", "content": "Spoke with the program officer."}


@pytest.mark.unit
class TestDetailPageBodies:
    @pytest.mark.parametrize(
        ("schema", "body"),
        [
            (GrantBudgetItemCreate, BUDGET_ITEM),
            (GrantExpenditureCreate, EXPENDITURE),
            (GrantComplianceTaskCreate, COMPLIANCE_TASK),
            (GrantNoteCreate, NOTE),
        ],
    )
    def test_the_page_body_validates_without_an_application_id(self, schema, body):
        dumped = schema.model_validate(body).model_dump(exclude_unset=True)

        assert "application_id" not in dumped

    @pytest.mark.parametrize(
        ("schema", "body"),
        [
            (GrantBudgetItemCreate, BUDGET_ITEM),
            (GrantExpenditureCreate, EXPENDITURE),
            (GrantComplianceTaskCreate, COMPLIANCE_TASK),
            (GrantNoteCreate, NOTE),
        ],
    )
    def test_a_body_application_id_cannot_redirect_the_write(self, schema, body):
        # The path is the only source of the parent: an id in the body must
        # not reach the service, where it would override the path's.
        dumped = schema.model_validate(
            {**body, "applicationId": str(uuid.uuid4())}
        ).model_dump(exclude_unset=True)

        assert "application_id" not in dumped

    def test_the_note_type_the_page_sends_is_accepted(self):
        assert GrantNoteCreate.model_validate(NOTE).note_type == "general"

    def test_an_unknown_note_type_is_refused(self):
        with pytest.raises(ValidationError):
            GrantNoteCreate.model_validate({**NOTE, "noteType": "comment"})


@pytest.mark.unit
class TestAssigneeOnCreate:
    def test_create_carries_the_assigned_member_id(self):
        member_id = uuid.uuid4()
        dumped = GrantApplicationCreate.model_validate(
            {
                "grantProgramName": "AFG",
                "grantAgency": "FEMA",
                "assignedTo": str(member_id),
            }
        ).model_dump(exclude_unset=True)

        assert dumped["assigned_to"] == member_id

    def test_a_name_is_not_a_member_id(self):
        with pytest.raises(ValidationError):
            GrantApplicationCreate.model_validate(
                {"grantProgramName": "AFG", "assignedTo": "John Smith"}
            )


def _user(org_id: str, first_name: str) -> User:
    return User(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        username=f"member-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.test",
        first_name=first_name,
        last_name="Quinn",
        password_hash="x",
    )


@pytest.mark.integration
class TestCreateApplicationAssignee:
    async def _orgs(self, db):
        home = Organization(name="Home FD", slug=f"home-{uuid.uuid4().hex[:8]}")
        other = Organization(name="Other FD", slug=f"other-{uuid.uuid4().hex[:8]}")
        db.add_all([home, other])
        await db.flush()
        member = _user(home.id, "Pat")
        outsider = _user(other.id, "Sam")
        db.add_all([member, outsider])
        await db.flush()
        return home.id, member.id, outsider.id

    async def test_the_assigned_member_is_stored(self, db_session):
        org_id, member_id, _outsider_id = await self._orgs(db_session)
        service = GrantService(db_session)
        data = GrantApplicationCreate.model_validate(
            {
                "grantProgramName": "AFG",
                "grantAgency": "FEMA",
                "assignedTo": member_id,
            }
        ).model_dump(exclude_unset=True)

        created = await service.create_application(org_id, data, member_id)
        app_id = created.id
        await db_session.flush()
        db_session.expire_all()

        stored = await service.get_application(app_id, org_id)
        assert stored is not None
        assert stored.assigned_to == member_id

    async def test_a_member_of_another_org_is_refused(self, db_session):
        org_id, member_id, outsider_id = await self._orgs(db_session)
        service = GrantService(db_session)
        data = GrantApplicationCreate.model_validate(
            {"grantProgramName": "AFG", "assignedTo": outsider_id}
        ).model_dump(exclude_unset=True)

        with pytest.raises(ValueError, match="Assigned user"):
            await service.create_application(org_id, data, member_id)

        rows = await db_session.execute(
            select(GrantApplication.id).where(
                GrantApplication.organization_id == org_id
            )
        )
        assert rows.scalars().all() == []
