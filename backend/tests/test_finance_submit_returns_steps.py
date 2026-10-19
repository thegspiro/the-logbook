"""Submitting a finance request returns it with its approval steps.

Workflow review W63: the submit endpoints returned the bare document, whose
``approval_steps`` the schema leaves empty because ``ApprovalStepRecord`` has
no ORM relationship to read from. The detail screen puts the submit response
in place of the request, so straight after "Submit for Approval" its Approval
Timeline read "This request has no approval steps" until a reload.
"""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints.finance import (
    submit_check_request,
    submit_expense_report,
    submit_purchase_request,
)
from app.models.document import Document
from app.models.finance import ApprovalEntityType, ApprovalStepType, ApproverType
from app.models.user import Organization, Position, User, user_positions
from app.services.finance_service import FinanceService

pytestmark = pytest.mark.integration


async def _member(db: AsyncSession, org_id: str) -> User:
    name = f"member-{uuid.uuid4().hex[:8]}"
    user = User(
        organization_id=org_id,
        username=name,
        first_name="Member",
        last_name="Tester",
        email=f"{name}@example.com",
    )
    db.add(user)
    await db.flush()
    position = Position(
        organization_id=org_id, name=name, slug=name, permissions=["finance.request"]
    )
    db.add(position)
    await db.flush()
    await db.execute(
        user_positions.insert().values(user_id=user.id, position_id=position.id)
    )
    await db.flush()
    return (
        await db.execute(
            select(User)
            .where(User.id == user.id)
            .options(selectinload(User.positions))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


@pytest.fixture
async def setup(db_session: AsyncSession):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Submit VFD",
        slug=f"submit-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    member = await _member(db_session, org.id)

    service = FinanceService(db_session)
    fy = await service.create_fiscal_year(
        org_id=org.id,
        created_by=member.id,
        name="FY2026",
        start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
        end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
    )
    for entity_type in (
        ApprovalEntityType.PURCHASE_REQUEST,
        ApprovalEntityType.EXPENSE_REPORT,
        ApprovalEntityType.CHECK_REQUEST,
    ):
        await service.create_approval_chain(
            org_id=org.id,
            created_by=member.id,
            name=f"{entity_type.value} review",
            applies_to=entity_type,
            is_default=True,
            steps=[
                {
                    "step_order": 1,
                    "name": "Treasurer review",
                    "step_type": ApprovalStepType.APPROVAL,
                    "approver_type": ApproverType.PERMISSION,
                    "approver_value": "finance.approve",
                }
            ],
        )
    receipt = Document(organization_id=org.id, name="Receipt", file_name="r.pdf")
    db_session.add(receipt)
    await db_session.flush()
    return {
        "db": db_session,
        "service": service,
        "org_id": org.id,
        "member": member,
        "fy_id": fy.id,
        "receipt_id": receipt.id,
    }


def _step_names(response) -> list[str]:
    return [step.step_name for step in response.approval_steps]


class TestSubmitReturnsSteps:
    async def test_purchase_request(self, setup):
        pr = await setup["service"].create_purchase_request(
            org_id=setup["org_id"],
            requested_by=setup["member"].id,
            fiscal_year_id=setup["fy_id"],
            title="Thermal imaging camera",
            estimated_amount=1500.00,
        )
        response = await submit_purchase_request(
            pr_id=pr.id, db=setup["db"], current_user=setup["member"]
        )
        assert _step_names(response) == ["Treasurer review"]

    async def test_expense_report(self, setup):
        er = await setup["service"].create_expense_report(
            org_id=setup["org_id"],
            submitted_by=setup["member"].id,
            fiscal_year_id=setup["fy_id"],
            title="Conference travel",
            line_items=[
                {
                    "description": "Hotel",
                    "amount": 300.00,
                    "date_incurred": datetime(2026, 3, 1, tzinfo=timezone.utc),
                    "expense_type": "travel",
                    "receipt_document_id": setup["receipt_id"],
                }
            ],
        )
        response = await submit_expense_report(
            er_id=er.id, db=setup["db"], current_user=setup["member"]
        )
        assert _step_names(response) == ["Treasurer review"]

    async def test_check_request(self, setup):
        cr = await setup["service"].create_check_request(
            org_id=setup["org_id"],
            requested_by=setup["member"].id,
            fiscal_year_id=setup["fy_id"],
            payee_name="Acme Supply",
            amount=450.00,
        )
        response = await submit_check_request(
            cr_id=cr.id, db=setup["db"], current_user=setup["member"]
        )
        assert _step_names(response) == ["Treasurer review"]
