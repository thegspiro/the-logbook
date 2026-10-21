"""Cancelling a purchase request closes its approval chain.

Cancellation set the request's status and nothing else: its step records
stayed PENDING, an email approver's link stayed live, the request stayed in
every approver's queue, and approving the last step finalized the cancelled
request as APPROVED and encumbered budget against it.

Two halves are asserted: cancellation now skips the pending steps and revokes
their tokens, and the approve path refuses a request that is no longer
awaiting approval, which holds for requests cancelled before this fix whose
steps are still PENDING in the database.
"""

from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models.finance import (
    ApprovalEntityType,
    ApprovalStepRecord,
    ApprovalStepStatus,
    ApprovalStepType,
    ApproverType,
    Budget,
    BudgetCategory,
    FiscalYearStatus,
    PurchaseRequest,
    PurchaseRequestStatus,
)
from app.services.finance_service import FinanceService
from tests.test_finance_budget_owners import _org, _position, _user, _year

pytestmark = pytest.mark.integration

PR = ApprovalEntityType.PURCHASE_REQUEST


@pytest.fixture
async def dept(db_session):
    org_id = await _org(db_session, "cancel")
    member_pos = await _position(db_session, org_id, "Member", ["finance.request"])
    approver_pos = await _position(
        db_session,
        org_id,
        "Officer",
        ["finance.request", "finance.view", "finance.approve"],
    )
    people = {
        "alice": await _user(db_session, org_id, "alice", [member_pos]),
        "chief": await _user(db_session, org_id, "chief", [approver_pos]),
        "captain": await _user(db_session, org_id, "captain", [approver_pos]),
    }
    year = _year(org_id, "FY2026", FiscalYearStatus.ACTIVE, people["chief"].id, 2026)
    gear = BudgetCategory(organization_id=org_id, name="Gear")
    db_session.add_all([year, gear])
    await db_session.flush()
    line = Budget(
        organization_id=org_id,
        fiscal_year_id=year.id,
        category_id=gear.id,
        amount_budgeted=Decimal("50000.00"),
        created_by=people["chief"].id,
    )
    db_session.add(line)
    await db_session.flush()
    return {"org_id": org_id, "fy_id": year.id, "budget_id": line.id, **people}


async def _chain(db, dept, steps):
    await FinanceService(db).create_approval_chain(
        org_id=dept["org_id"],
        created_by=dept["chief"].id,
        name="Officer review",
        applies_to=PR,
        min_amount=0,
        is_default=True,
        steps=[
            {"step_order": n, "name": f"Review {n}", **step}
            for n, step in enumerate(steps, start=1)
        ],
    )


_BY_PERMISSION = {
    "step_type": ApprovalStepType.APPROVAL,
    "approver_type": ApproverType.PERMISSION,
    "approver_value": "finance.approve",
}
_BY_EMAIL = {
    "step_type": ApprovalStepType.APPROVAL,
    "approver_type": ApproverType.EMAIL,
    "approver_value": "trustee@outside.example",
}


async def _submitted(db, dept) -> str:
    service = FinanceService(db)
    pr = await service.create_purchase_request(
        org_id=dept["org_id"],
        requested_by=dept["alice"].id,
        fiscal_year_id=dept["fy_id"],
        budget_id=dept["budget_id"],
        title="Turnout gear",
        estimated_amount=1200.00,
    )
    submitted = await service.submit_purchase_request(pr.id, dept["org_id"])
    assert submitted.status == PurchaseRequestStatus.PENDING_APPROVAL
    return submitted.id


async def _records(db, pr_id) -> list[ApprovalStepRecord]:
    result = await db.execute(
        select(ApprovalStepRecord)
        .where(ApprovalStepRecord.entity_id == pr_id)
        .execution_options(populate_existing=True)
    )
    return list(result.scalars().all())


async def _encumbered(db, budget_id) -> Decimal:
    result = await db.execute(
        select(Budget.amount_encumbered)
        .where(Budget.id == budget_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


class TestCancellingClosesTheChain:
    async def test_cancel_then_approve_is_refused(self, db_session, dept):
        await _chain(db_session, dept, [_BY_PERMISSION, _BY_PERMISSION])
        pr_id = await _submitted(db_session, dept)
        org_id = dept["org_id"]
        service = FinanceService(db_session)

        first = await service.get_current_pending_step(PR, pr_id, org_id)
        assert first is not None
        await service.approve_step(first.id, dept["chief"], org_id=org_id)
        second = await service.get_current_pending_step(PR, pr_id, org_id)
        assert second is not None
        second_id = second.id

        await service.cancel_purchase_request(pr_id, org_id)

        with pytest.raises(ValueError, match="not pending approval"):
            await service.approve_step(second_id, dept["captain"], org_id=org_id)

        statuses = {r.id: r.status for r in await _records(db_session, pr_id)}
        assert statuses[second_id] == ApprovalStepStatus.SKIPPED
        assert ApprovalStepStatus.PENDING not in statuses.values()
        pr = await db_session.get(PurchaseRequest, pr_id, populate_existing=True)
        assert pr.status == PurchaseRequestStatus.CANCELLED
        assert await _encumbered(db_session, dept["budget_id"]) == Decimal("0")

    async def test_a_cancelled_request_leaves_the_pending_list(self, db_session, dept):
        await _chain(db_session, dept, [_BY_PERMISSION])
        pr_id = await _submitted(db_session, dept)
        service = FinanceService(db_session)
        before = await service.get_pending_approvals(dept["chief"], dept["org_id"])
        assert pr_id in {row["entity_id"] for row in before}

        await service.cancel_purchase_request(pr_id, dept["org_id"])

        after = await service.get_pending_approvals(dept["chief"], dept["org_id"])
        assert pr_id not in {row["entity_id"] for row in after}

    async def test_cancel_revokes_the_email_approvers_link(self, db_session, dept):
        await _chain(db_session, dept, [_BY_EMAIL])
        pr_id = await _submitted(db_session, dept)
        service = FinanceService(db_session)
        (record,) = await _records(db_session, pr_id)
        token = record.approval_token
        assert token is not None

        await service.cancel_purchase_request(pr_id, dept["org_id"])

        (record,) = await _records(db_session, pr_id)
        assert record.approval_token is None
        assert record.token_expires_at is None
        with pytest.raises(ValueError, match="Invalid approval token"):
            await service.approve_by_token(token)
        pr = await db_session.get(PurchaseRequest, pr_id, populate_existing=True)
        assert pr.status == PurchaseRequestStatus.CANCELLED


class TestRequestsCancelledBeforeTheFix:
    """A cancelled request whose steps were left PENDING by the old code."""

    async def _legacy(self, db_session, dept) -> str:
        await _chain(db_session, dept, [_BY_PERMISSION])
        pr_id = await _submitted(db_session, dept)
        pr = await db_session.get(PurchaseRequest, pr_id)
        pr.status = PurchaseRequestStatus.CANCELLED
        await db_session.flush()
        return pr_id

    async def test_its_last_step_cannot_approve_it(self, db_session, dept):
        pr_id = await self._legacy(db_session, dept)
        service = FinanceService(db_session)
        step = await service.get_current_pending_step(PR, pr_id, dept["org_id"])
        assert step is not None
        step_id = step.id

        with pytest.raises(ValueError, match="no longer awaiting approval"):
            await service.approve_step(step_id, dept["chief"], org_id=dept["org_id"])

        db_session.expire_all()
        pr = await db_session.get(PurchaseRequest, pr_id)
        assert pr.status == PurchaseRequestStatus.CANCELLED
        record = await db_session.get(ApprovalStepRecord, step_id)
        assert record.status == ApprovalStepStatus.PENDING
        assert await _encumbered(db_session, dept["budget_id"]) == Decimal("0")

    async def test_it_is_not_listed_as_awaiting_approval(self, db_session, dept):
        pr_id = await self._legacy(db_session, dept)
        pending = await FinanceService(db_session).get_pending_approvals(
            dept["chief"], dept["org_id"]
        )
        assert pr_id not in {row["entity_id"] for row in pending}
