"""Who a request would wait on, shown to the member raising it.

``GET /finance/approval-chains/route-preview`` answers from the same resolver
submission uses (``FinanceService._request_chain``), so the route a form
shows is the route the request takes. It names approvers as a submitted
request's timeline would, and returns no approver configuration.

The department is make_books' (Training and Fuel lines).
"""

import copy
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.models.finance import (
    ApprovalChain,
    ApprovalChainStep,
    ApprovalEntityType,
    ApprovalStepRecord,
    ApprovalStepType,
    ApproverType,
    Budget,
    PurchaseRequest,
    PurchaseRequestStatus,
)
from app.models.user import Organization
from app.services.finance_service import FinanceService
from tests.test_finance_quickbooks_export import _user, make_books
from tests.test_finance_reimbursement_flow import _client_as

pytestmark = [pytest.mark.integration]

ROUTE = "/finance/approval-chains/route-preview"


@pytest.fixture
async def dept(db_session):
    books = await make_books(db_session)
    lines = (
        await db_session.execute(
            select(Budget).where(Budget.organization_id == books["org_id"])
        )
    ).scalars()
    budgets = {b.category_id: b for b in lines}
    books["training_line"] = budgets[books["training"].id]
    books["fy_id"] = books["training_line"].fiscal_year_id
    books["member_id"] = await _user(db_session, books["org_id"])
    return books


async def _chain(db, dept, entity_type, steps, *, name="Standard", category_id=None):
    chain = ApprovalChain(
        organization_id=dept["org_id"],
        name=name,
        applies_to=entity_type,
        budget_category_id=category_id,
        created_by=dept["user_id"],
    )
    db.add(chain)
    await db.flush()
    for order, step in enumerate(steps, start=1):
        db.add(ApprovalChainStep(chain_id=chain.id, step_order=order, **step))
    await db.flush()
    await db.refresh(chain, ["steps"])
    return chain


def _approver(name, value="treasurer", **extra):
    return {
        "name": name,
        "step_type": ApprovalStepType.APPROVAL,
        "approver_type": ApproverType.PERMISSION,
        "approver_value": value,
        **extra,
    }


async def _threshold(db, org_id, amount):
    org = await db.get(Organization, org_id)
    settings = copy.deepcopy(org.settings or {})
    settings.setdefault("finance", {})["dual_approval_threshold"] = amount
    org.settings = settings
    await db.flush()


class TestTheRoute:
    async def test_no_chain_means_a_manual_decision(self, db_session, dept):
        route = await FinanceService(db_session).preview_request_route(
            dept["org_id"], "purchase_request", Decimal("100.00")
        )

        assert route["manual"] is True
        assert route["steps"] == []
        assert route["second_approver_required"] is False

    async def test_steps_are_named_as_the_timeline_names_them(self, db_session, dept):
        await _chain(
            db_session,
            dept,
            ApprovalEntityType.PURCHASE_REQUEST,
            [
                _approver("Officer review", "finance.approve"),
                {
                    "name": "Tell the accountant",
                    "step_type": ApprovalStepType.NOTIFICATION,
                    "approver_type": ApproverType.EMAIL,
                    "approver_value": "books@example.test",
                },
            ],
        )

        route = await FinanceService(db_session).preview_request_route(
            dept["org_id"], "purchase_request", Decimal("100.00")
        )

        assert route["chain_name"] == "Standard"
        assert route["manual"] is False
        assert [
            (s["name"], s["step_type"], s["assignee_label"]) for s in route["steps"]
        ] == [
            ("Officer review", "approval", "members with finance.approve"),
            ("Tell the accountant", "notification", None),
        ]

    async def test_a_step_under_its_limit_auto_approves(self, db_session, dept):
        await _chain(
            db_session,
            dept,
            ApprovalEntityType.CHECK_REQUEST,
            [_approver("Treasurer", auto_approve_under=Decimal("50.00"))],
        )
        service = FinanceService(db_session)

        small = await service.preview_request_route(
            dept["org_id"], "check_request", Decimal("49.99")
        )
        large = await service.preview_request_route(
            dept["org_id"], "check_request", Decimal("50.00")
        )

        assert small["steps"][0]["auto_approved"] is True
        assert large["steps"][0]["auto_approved"] is False

    async def test_the_budget_lines_category_picks_the_chain(self, db_session, dept):
        await _chain(
            db_session,
            dept,
            ApprovalEntityType.PURCHASE_REQUEST,
            [_approver("General")],
            name="General",
        )
        await _chain(
            db_session,
            dept,
            ApprovalEntityType.PURCHASE_REQUEST,
            [_approver("Training officer")],
            name="Training",
            category_id=dept["training"].id,
        )
        service = FinanceService(db_session)

        on_training = await service.preview_request_route(
            dept["org_id"],
            "purchase_request",
            Decimal("100.00"),
            dept["training_line"].id,
        )
        no_line = await service.preview_request_route(
            dept["org_id"], "purchase_request", Decimal("100.00")
        )

        assert on_training["chain_name"] == "Training"
        assert no_line["chain_name"] == "General"

    async def test_an_expense_report_ignores_the_budget_line(self, db_session, dept):
        await _chain(
            db_session,
            dept,
            ApprovalEntityType.EXPENSE_REPORT,
            [_approver("Training officer")],
            name="Training",
            category_id=dept["training"].id,
        )

        route = await FinanceService(db_session).preview_request_route(
            dept["org_id"],
            "expense_report",
            Decimal("100.00"),
            dept["training_line"].id,
        )

        # Submission routes a report on its total alone, so neither does this.
        assert route["manual"] is True

    async def test_another_departments_budget_line_is_ignored(self, db_session, dept):
        other = await make_books(db_session)
        await _chain(
            db_session,
            dept,
            ApprovalEntityType.PURCHASE_REQUEST,
            [_approver("Training officer")],
            name="Training",
            category_id=dept["training"].id,
        )
        other_line = (
            (
                await db_session.execute(
                    select(Budget).where(Budget.organization_id == other["org_id"])
                )
            )
            .scalars()
            .first()
        )

        route = await FinanceService(db_session).preview_request_route(
            dept["org_id"], "purchase_request", Decimal("100.00"), other_line.id
        )

        assert route["manual"] is True

    async def test_the_dual_approval_threshold_is_reported(self, db_session, dept):
        # Stored in whole dollars.
        await _threshold(db_session, dept["org_id"], 1000)
        service = FinanceService(db_session)

        under = await service.preview_request_route(
            dept["org_id"], "purchase_request", Decimal("999.99")
        )
        at = await service.preview_request_route(
            dept["org_id"], "purchase_request", Decimal("1000.00")
        )

        assert under["second_approver_required"] is False
        assert at["second_approver_required"] is True

    async def test_an_unknown_type_is_refused(self, db_session, dept):
        with pytest.raises(ValueError, match="Invalid entity type"):
            await FinanceService(db_session).preview_request_route(
                dept["org_id"], "bogus", Decimal("1.00")
            )


class TestItMatchesSubmission:
    async def test_the_submitted_request_waits_on_the_previewed_steps(
        self, db_session, dept
    ):
        await _chain(
            db_session,
            dept,
            ApprovalEntityType.PURCHASE_REQUEST,
            [_approver("General")],
            name="General",
        )
        await _chain(
            db_session,
            dept,
            ApprovalEntityType.PURCHASE_REQUEST,
            [_approver("Training officer"), _approver("Chief")],
            name="Training",
            category_id=dept["training"].id,
        )
        service = FinanceService(db_session)
        route = await service.preview_request_route(
            dept["org_id"],
            "purchase_request",
            Decimal("100.00"),
            dept["training_line"].id,
        )
        pr = PurchaseRequest(
            organization_id=dept["org_id"],
            request_number="PR-2026-0300",
            fiscal_year_id=dept["fy_id"],
            budget_id=dept["training_line"].id,
            requested_by=dept["member_id"],
            title="Mannequins",
            estimated_amount=Decimal("100.00"),
            status=PurchaseRequestStatus.DRAFT,
        )
        db_session.add(pr)
        await db_session.flush()

        await service.submit_purchase_request(pr.id, dept["org_id"])

        rows = await db_session.execute(
            select(ApprovalChainStep.step_order, ApprovalChainStep.name)
            .join(
                ApprovalStepRecord, ApprovalStepRecord.step_id == ApprovalChainStep.id
            )
            .where(ApprovalStepRecord.entity_id == pr.id)
        )
        submitted = sorted(rows.all())
        assert [tuple(r) for r in submitted] == [
            (s["step_order"], s["name"]) for s in route["steps"]
        ]


class TestTheEndpoint:
    async def test_a_member_can_ask_in_camel_case(self, db_session, dept):
        await _chain(
            db_session,
            dept,
            ApprovalEntityType.CHECK_REQUEST,
            [_approver("Treasurer", "finance.approve")],
        )
        async with await _client_as(
            db_session, dept["org_id"], dept["member_id"], ["finance.request"]
        ) as client:
            response = await client.get(
                ROUTE, params={"entity_type": "check_request", "amount": "75.00"}
            )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["chainName"] == "Standard"
        assert body["secondApproverRequired"] is False
        assert body["steps"] == [
            {
                "name": "Treasurer",
                "stepOrder": 1,
                "stepType": "approval",
                "assigneeLabel": "members with finance.approve",
                "autoApproved": False,
            }
        ]
        # Nothing of the chain's configuration comes back.
        assert "approverValue" not in response.text

    async def test_a_negative_amount_is_refused(self, db_session, dept):
        async with await _client_as(
            db_session, dept["org_id"], dept["member_id"], ["finance.request"]
        ) as client:
            response = await client.get(
                ROUTE, params={"entity_type": "check_request", "amount": "-1"}
            )

        assert response.status_code == 422

    async def test_it_needs_a_finance_grant(self, db_session, dept):
        async with await _client_as(
            db_session, dept["org_id"], dept["member_id"], []
        ) as client:
            response = await client.get(
                ROUTE, params={"entity_type": "check_request", "amount": "1"}
            )

        assert response.status_code == 403
