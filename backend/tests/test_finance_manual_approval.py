"""Manual approve/deny for finance requests that no approval chain applies to.

``submit_purchase_request`` / ``submit_expense_report`` /
``submit_check_request`` put a request in PENDING_APPROVAL with no approval
step records when no chain matches, or the matching chain has no steps. Before
the manual path existed nothing could move such a request: every approve/deny
endpoint acts on a step record, and there were none.
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.routing import Match

from app.api.v1.endpoints.finance import _manual_decision_error, router
from app.models.document import Document
from app.models.finance import (
    ApprovalEntityType,
    ApprovalStepType,
    ApproverType,
    CheckRequestStatus,
    ExpenseReportStatus,
    PurchaseRequestStatus,
)
from app.schemas.finance import ManualDenyRequest
from app.services.finance_service import (
    BudgetLimitExceededError,
    FinanceEntityNotFoundError,
    FinanceService,
    ManualApprovalConflictError,
)
from app.services.separation_of_duties import SeparationOfDutiesError

PR = ApprovalEntityType.PURCHASE_REQUEST
ER = ApprovalEntityType.EXPENSE_REPORT
CR = ApprovalEntityType.CHECK_REQUEST


async def _make_org(db: AsyncSession, label: str) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": f"{label} Dept", "slug": f"man-{org_id[:8]}"},
    )
    return org_id


async def _make_user(db: AsyncSession, org_id: str, first: str) -> str:
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'Tester', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first.lower()}-{user_id[:8]}",
            "fn": first,
            "em": f"{first.lower()}-{user_id[:8]}@test.com",
        },
    )
    return user_id


@pytest.fixture
async def setup(db_session: AsyncSession):
    org_id = await _make_org(db_session, "Manual")
    other_org_id = await _make_org(db_session, "Other")
    requester = await _make_user(db_session, org_id, "Requester")
    approver = await _make_user(db_session, org_id, "Approver")
    other_user = await _make_user(db_session, other_org_id, "Outsider")
    await db_session.flush()

    service = FinanceService(db_session)
    fy = await service.create_fiscal_year(
        org_id=org_id,
        created_by=approver,
        name="FY2026",
        start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
        end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
    )
    cat = await service.create_budget_category(org_id=org_id, name="Equipment")
    budget = await service.create_budget(
        org_id=org_id,
        created_by=approver,
        fiscal_year_id=fy.id,
        category_id=cat.id,
        amount_budgeted=50000.00,
    )
    receipt = Document(
        organization_id=org_id, name="Hotel receipt", file_name="hotel.pdf"
    )
    db_session.add(receipt)
    await db_session.flush()
    other_fy = await service.create_fiscal_year(
        org_id=other_org_id,
        created_by=other_user,
        name="FY2026",
        start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
        end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
    )
    return {
        "service": service,
        "org_id": org_id,
        "other_org_id": other_org_id,
        "requester": requester,
        "approver": approver,
        "other_user": other_user,
        "fy_id": fy.id,
        "budget_id": budget.id,
        "other_fy_id": other_fy.id,
        "receipt_document_id": receipt.id,
    }


async def _submitted_pr(s, *, org_key="org_id", fy_key="fy_id", user_key="requester"):
    service = s["service"]
    kwargs = {"budget_id": s["budget_id"]} if org_key == "org_id" else {}
    pr = await service.create_purchase_request(
        org_id=s[org_key],
        requested_by=s[user_key],
        fiscal_year_id=s[fy_key],
        title="Hose couplings",
        estimated_amount=1200.00,
        **kwargs,
    )
    return await service.submit_purchase_request(pr.id, s[org_key])


async def _submitted_er(s):
    service = s["service"]
    er = await service.create_expense_report(
        org_id=s["org_id"],
        submitted_by=s["requester"],
        fiscal_year_id=s["fy_id"],
        title="Conference travel",
        line_items=[
            {
                "description": "Hotel",
                "amount": 300.00,
                "date_incurred": datetime(2026, 3, 1, tzinfo=timezone.utc),
                "expense_type": "travel",
                # Every line needs a receipt to be submitted; these tests are
                # about routing, not the file, so the document has no file.
                "receipt_document_id": s["receipt_document_id"],
            }
        ],
    )
    return await service.submit_expense_report(er.id, s["org_id"])


async def _submitted_cr(s):
    service = s["service"]
    cr = await service.create_check_request(
        org_id=s["org_id"],
        requested_by=s["requester"],
        fiscal_year_id=s["fy_id"],
        payee_name="Acme Supply",
        amount=450.00,
    )
    return await service.submit_check_request(cr.id, s["org_id"])


async def _chain_for(s, entity_type):
    await s["service"].create_approval_chain(
        org_id=s["org_id"],
        created_by=s["approver"],
        name="Officer review",
        applies_to=entity_type,
        min_amount=0,
        is_default=True,
        steps=[
            {
                "step_order": 1,
                "name": "Officer review",
                "step_type": ApprovalStepType.APPROVAL,
                "approver_type": ApproverType.PERMISSION,
                "approver_value": "finance.approve",
            }
        ],
    )


@pytest.mark.integration
class TestManualApprove:
    async def test_a_stranded_purchase_request_is_approved_and_encumbered(self, setup):
        s = setup
        pr = await _submitted_pr(s)
        assert pr.status == PurchaseRequestStatus.PENDING_APPROVAL

        await s["service"].manual_approve(PR, pr.id, s["approver"], org_id=s["org_id"])

        assert pr.status == PurchaseRequestStatus.APPROVED
        assert pr.approved_by == s["approver"]
        assert pr.approved_at is not None
        budget = await s["service"].get_budget(s["budget_id"], s["org_id"])
        assert Decimal(budget.amount_encumbered) == Decimal("1200.00")

    async def test_expense_report_and_check_request(self, setup):
        s = setup
        er = await _submitted_er(s)
        cr = await _submitted_cr(s)

        await s["service"].manual_approve(ER, er.id, s["approver"], org_id=s["org_id"])
        await s["service"].manual_approve(CR, cr.id, s["approver"], org_id=s["org_id"])

        assert er.status == ExpenseReportStatus.APPROVED
        assert er.approved_by == s["approver"]
        assert cr.status == CheckRequestStatus.APPROVED
        assert cr.approved_by == s["approver"]

    async def test_refuses_a_request_that_has_approval_steps(self, setup):
        s = setup
        await _chain_for(s, PR)
        pr = await _submitted_pr(s)
        assert pr.status == PurchaseRequestStatus.PENDING_APPROVAL

        with pytest.raises(ManualApprovalConflictError, match="approval steps"):
            await s["service"].manual_approve(
                PR, pr.id, s["approver"], org_id=s["org_id"]
            )
        assert pr.status == PurchaseRequestStatus.PENDING_APPROVAL

    async def test_refuses_a_request_not_waiting_for_approval(self, setup):
        s = setup
        pr = await _submitted_pr(s)
        await s["service"].manual_approve(PR, pr.id, s["approver"], org_id=s["org_id"])

        # A second approval would encumber the budget twice.
        with pytest.raises(ManualApprovalConflictError, match="not waiting"):
            await s["service"].manual_approve(
                PR, pr.id, s["approver"], org_id=s["org_id"]
            )
        budget = await s["service"].get_budget(s["budget_id"], s["org_id"])
        assert Decimal(budget.amount_encumbered) == Decimal("1200.00")

    async def test_refuses_another_organizations_request(self, setup):
        s = setup
        foreign = await _submitted_pr(
            s, org_key="other_org_id", fy_key="other_fy_id", user_key="other_user"
        )

        with pytest.raises(FinanceEntityNotFoundError):
            await s["service"].manual_approve(
                PR, foreign.id, s["approver"], org_id=s["org_id"]
            )
        assert foreign.status == PurchaseRequestStatus.PENDING_APPROVAL

    async def test_refuses_self_approval(self, setup):
        s = setup
        pr = await _submitted_pr(s)

        with pytest.raises(SeparationOfDutiesError):
            await s["service"].manual_approve(
                PR, pr.id, s["requester"], org_id=s["org_id"]
            )
        assert pr.status == PurchaseRequestStatus.PENDING_APPROVAL


@pytest.mark.integration
class TestManualDeny:
    async def test_deny_records_the_reason_and_the_denier(self, setup):
        s = setup
        pr = await _submitted_pr(s)

        await s["service"].manual_deny(
            PR, pr.id, s["approver"], "  Not in this year's plan ", org_id=s["org_id"]
        )

        assert pr.status == PurchaseRequestStatus.DENIED
        assert pr.denial_reason == "Not in this year's plan"
        assert pr.approved_by == s["approver"]
        budget = await s["service"].get_budget(s["budget_id"], s["org_id"])
        assert Decimal(budget.amount_encumbered) == Decimal("0")

    async def test_the_requester_may_deny_their_own_request(self, setup):
        s = setup
        cr = await _submitted_cr(s)

        await s["service"].manual_deny(
            CR, cr.id, s["requester"], "Withdrawn", org_id=s["org_id"]
        )

        assert cr.status == CheckRequestStatus.DENIED

    async def test_deny_requires_a_reason(self, setup):
        s = setup
        er = await _submitted_er(s)

        with pytest.raises(ValueError, match="reason is required"):
            await s["service"].manual_deny(
                ER, er.id, s["approver"], "   ", org_id=s["org_id"]
            )
        assert er.status == ExpenseReportStatus.PENDING_APPROVAL

    async def test_refuses_a_request_that_has_approval_steps(self, setup):
        s = setup
        await _chain_for(s, CR)
        cr = await _submitted_cr(s)

        with pytest.raises(ManualApprovalConflictError, match="approval steps"):
            await s["service"].manual_deny(
                CR, cr.id, s["approver"], "No", org_id=s["org_id"]
            )
        assert cr.status == CheckRequestStatus.PENDING_APPROVAL

    async def test_refuses_another_organizations_request(self, setup):
        s = setup
        foreign = await _submitted_pr(
            s, org_key="other_org_id", fy_key="other_fy_id", user_key="other_user"
        )

        with pytest.raises(FinanceEntityNotFoundError):
            await s["service"].manual_deny(
                PR, foreign.id, s["approver"], "No", org_id=s["org_id"]
            )


@pytest.mark.integration
class TestUnroutedListing:
    async def test_lists_only_stranded_requests_in_the_callers_org(self, setup):
        s = setup
        stranded_pr = await _submitted_pr(s)
        stranded_er = await _submitted_er(s)
        await _chain_for(s, CR)
        routed_cr = await _submitted_cr(s)
        decided = await _submitted_pr(s)
        await s["service"].manual_deny(
            PR, decided.id, s["approver"], "No", org_id=s["org_id"]
        )
        draft = await s["service"].create_purchase_request(
            org_id=s["org_id"],
            requested_by=s["requester"],
            fiscal_year_id=s["fy_id"],
            title="Draft",
            estimated_amount=10.00,
        )
        foreign = await _submitted_pr(
            s, org_key="other_org_id", fy_key="other_fy_id", user_key="other_user"
        )

        rows = await s["service"].get_unrouted_approvals(s["org_id"])

        ids = {row["entity_id"] for row in rows}
        assert ids == {stranded_pr.id, stranded_er.id}
        assert routed_cr.id not in ids
        assert draft.id not in ids
        assert foreign.id not in ids
        pr_row = next(r for r in rows if r["entity_id"] == stranded_pr.id)
        assert pr_row["entity_type"] == "purchase_request"
        assert pr_row["entity_title"] == "Hose couplings"
        assert Decimal(pr_row["entity_amount"]) == Decimal("1200.00")
        assert pr_row["requester_name"] == "Requester Tester"
        assert pr_row["submitted_at"] is not None


@pytest.mark.unit
class TestDenyRequestSchema:
    def test_a_blank_reason_is_rejected(self):
        with pytest.raises(ValidationError):
            ManualDenyRequest(reason="   ")

    def test_a_missing_reason_is_rejected(self):
        with pytest.raises(ValidationError):
            ManualDenyRequest()

    def test_the_reason_is_trimmed(self):
        assert ManualDenyRequest(reason=" Over budget ").reason == "Over budget"


@pytest.mark.unit
class TestErrorMapping:
    @pytest.mark.parametrize(
        ("exc", "status"),
        [
            (FinanceEntityNotFoundError("Purchase request not found"), 404),
            (ManualApprovalConflictError("not waiting"), 409),
            (BudgetLimitExceededError(), 409),
            (SeparationOfDutiesError("own request"), 400),
            (ValueError("bad"), 400),
            (RuntimeError("boom"), 500),
        ],
    )
    def test_status_codes(self, exc, status):
        error = _manual_decision_error(exc)
        assert isinstance(error, HTTPException)
        assert error.status_code == status


@pytest.mark.unit
class TestRouteResolution:
    """The manual routes must not be captured by ``/approvals/{step_record_id}``."""

    @staticmethod
    def _resolves_to(path: str, method: str) -> str:
        scope = {"type": "http", "path": path, "method": method}
        for route in router.routes:
            if route.matches(scope)[0] == Match.FULL:
                return route.endpoint.__name__
        raise AssertionError(f"no route matches {method} {path}")

    def test_unrouted_listing(self):
        assert self._resolves_to("/approvals/unrouted", "GET") == (
            "get_unrouted_approvals"
        )

    def test_manual_actions(self):
        base = "/approvals/manual/purchase_request/00000000-0000-0000-0000-000000000001"
        assert self._resolves_to(f"{base}/approve", "POST") == "manual_approve"
        assert self._resolves_to(f"{base}/deny", "POST") == "manual_deny"

    def test_step_actions_still_resolve(self):
        rec = "00000000-0000-0000-0000-000000000001"
        assert self._resolves_to(f"/approvals/{rec}/approve", "POST") == (
            "approve_step"
        )
        assert self._resolves_to(f"/approvals/{rec}/deny", "POST") == "deny_step"
