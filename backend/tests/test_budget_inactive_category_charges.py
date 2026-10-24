"""A deactivated budget category's lines take no new charges.

``delete_budget_category`` deactivates a category that is in use. Owner
decision (2026-10-22): its lines then refuse new spending -- a new purchase
request, check request or expense line, a request repointed at the line, or a
draft submitted into approval -- while a request already submitted or
approved finishes normally and its spend still counts.
"""

from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import (
    ApprovalEntityType,
    Budget,
    BudgetCategory,
    CheckRequestStatus,
    ExpenseReportStatus,
    FiscalYearStatus,
    PurchaseRequestStatus,
)
from app.services.finance_service import FinanceService
from tests.test_finance_budget_owners import _org, _position, _user, _year

pytestmark = pytest.mark.integration

PR = ApprovalEntityType.PURCHASE_REQUEST
ER = ApprovalEntityType.EXPENSE_REPORT
CR = ApprovalEntityType.CHECK_REQUEST


@pytest.fixture
async def dept(db_session: AsyncSession):
    org_id = await _org(db_session, "inactcat")
    treasurer_pos = await _position(
        db_session,
        org_id,
        "Treasurer",
        ["finance.view", "finance.manage", "finance.approve"],
    )
    member_pos = await _position(db_session, org_id, "Member", ["finance.request"])
    treasurer = await _user(db_session, org_id, "treasurer", [treasurer_pos])
    member = await _user(db_session, org_id, "member", [member_pos])
    year = _year(org_id, "FY2026", FiscalYearStatus.ACTIVE, treasurer.id, 2026)
    db_session.add(year)
    await db_session.flush()

    gear = BudgetCategory(organization_id=org_id, name="Gear")
    open_cat = BudgetCategory(organization_id=org_id, name="Training")
    db_session.add_all([gear, open_cat])
    await db_session.flush()
    gear_line = Budget(
        organization_id=org_id,
        fiscal_year_id=year.id,
        category_id=gear.id,
        amount_budgeted=Decimal("5000.00"),
        created_by=treasurer.id,
    )
    open_line = Budget(
        organization_id=org_id,
        fiscal_year_id=year.id,
        category_id=open_cat.id,
        amount_budgeted=Decimal("5000.00"),
        created_by=treasurer.id,
    )
    db_session.add_all([gear_line, open_line])
    await db_session.flush()
    return {
        "db": db_session,
        "service": FinanceService(db_session),
        "org_id": org_id,
        "treasurer": treasurer,
        "member": member,
        "year": year,
        "gear": gear,
        "gear_line": gear_line,
        "open_line": open_line,
    }


async def _deactivate(dept) -> None:
    dept["gear"].is_active = False
    await dept["db"].flush()


def _pr_fields(dept, budget_id) -> dict:
    return {
        "fiscal_year_id": dept["year"].id,
        "budget_id": budget_id,
        "title": "Gloves",
        "estimated_amount": Decimal("120.00"),
    }


def _cr_fields(dept, budget_id) -> dict:
    return {
        "fiscal_year_id": dept["year"].id,
        "budget_id": budget_id,
        "payee_name": "Supply Co",
        "amount": Decimal("80.00"),
        "purpose": "Hose couplings",
    }


def _er_item(budget_id) -> dict:
    return {
        "description": "Boots",
        "amount": Decimal("60.00"),
        "budget_id": budget_id,
        "date_incurred": datetime(2026, 3, 1, tzinfo=timezone.utc),
    }


class TestNewChargesAreRefused:
    async def test_new_purchase_request(self, dept):
        await _deactivate(dept)
        with pytest.raises(ValueError, match='"Gear" is inactive'):
            await dept["service"].create_purchase_request(
                dept["org_id"],
                dept["member"].id,
                charger_id=dept["member"].id,
                **_pr_fields(dept, dept["gear_line"].id),
            )

    async def test_finance_manage_is_refused_too(self, dept):
        """Not an access rule: the line is closed for everyone."""
        await _deactivate(dept)
        with pytest.raises(ValueError, match="inactive"):
            await dept["service"].create_purchase_request(
                dept["org_id"],
                dept["treasurer"].id,
                charger_id=None,
                **_pr_fields(dept, dept["gear_line"].id),
            )

    async def test_new_check_request(self, dept):
        await _deactivate(dept)
        with pytest.raises(ValueError, match='"Gear" is inactive'):
            await dept["service"].create_check_request(
                dept["org_id"],
                dept["member"].id,
                charger_id=dept["member"].id,
                **_cr_fields(dept, dept["gear_line"].id),
            )

    async def test_new_expense_report_with_a_line_on_it(self, dept):
        await _deactivate(dept)
        with pytest.raises(ValueError, match='"Gear" is inactive'):
            await dept["service"].create_expense_report(
                dept["org_id"],
                dept["member"].id,
                line_items=[
                    _er_item(dept["open_line"].id),
                    _er_item(dept["gear_line"].id),
                ],
                charger_id=dept["member"].id,
                fiscal_year_id=dept["year"].id,
                title="Conference",
            )

    async def test_adding_an_expense_line_on_it(self, dept):
        er = await dept["service"].create_expense_report(
            dept["org_id"],
            dept["member"].id,
            line_items=[],
            charger_id=dept["member"].id,
            fiscal_year_id=dept["year"].id,
            title="Conference",
        )
        await _deactivate(dept)
        with pytest.raises(ValueError, match="inactive"):
            await dept["service"].add_expense_line_item(
                er.id,
                dept["org_id"],
                requester_id=dept["member"].id,
                **_er_item(dept["gear_line"].id),
            )

    async def test_repointing_a_draft_at_it(self, dept):
        pr = await dept["service"].create_purchase_request(
            dept["org_id"],
            dept["member"].id,
            charger_id=dept["member"].id,
            **_pr_fields(dept, dept["open_line"].id),
        )
        cr = await dept["service"].create_check_request(
            dept["org_id"],
            dept["member"].id,
            charger_id=dept["member"].id,
            **_cr_fields(dept, dept["open_line"].id),
        )
        await _deactivate(dept)
        with pytest.raises(ValueError, match="inactive"):
            await dept["service"].update_purchase_request(
                pr.id,
                dept["org_id"],
                requester_id=dept["member"].id,
                budget_id=dept["gear_line"].id,
            )
        with pytest.raises(ValueError, match="inactive"):
            await dept["service"].update_check_request(
                cr.id,
                dept["org_id"],
                requester_id=dept["member"].id,
                budget_id=dept["gear_line"].id,
            )

    async def test_an_active_line_is_still_accepted(self, dept):
        await _deactivate(dept)
        pr = await dept["service"].create_purchase_request(
            dept["org_id"],
            dept["member"].id,
            charger_id=dept["member"].id,
            **_pr_fields(dept, dept["open_line"].id),
        )
        assert pr.budget_id == dept["open_line"].id


class TestADraftAlreadyOnTheLine:
    """Editing is allowed; submitting it into approval is the new charge."""

    async def test_purchase_request_edits_but_cannot_submit(self, dept):
        service, org_id = dept["service"], dept["org_id"]
        pr = await service.create_purchase_request(
            org_id,
            dept["member"].id,
            charger_id=dept["member"].id,
            **_pr_fields(dept, dept["gear_line"].id),
        )
        await _deactivate(dept)

        await service.update_purchase_request(
            pr.id, org_id, requester_id=dept["member"].id, title="Winter gloves"
        )
        assert pr.title == "Winter gloves"
        with pytest.raises(ValueError, match="inactive"):
            await service.submit_purchase_request(
                pr.id, org_id, requester_id=dept["member"].id
            )
        assert pr.status == PurchaseRequestStatus.DRAFT

        # Pointing the draft at an open line lets it go.
        await service.update_purchase_request(
            pr.id,
            org_id,
            requester_id=dept["member"].id,
            budget_id=dept["open_line"].id,
        )
        await service.submit_purchase_request(
            pr.id, org_id, requester_id=dept["member"].id
        )
        assert pr.status == PurchaseRequestStatus.PENDING_APPROVAL

    async def test_check_request_cannot_submit(self, dept):
        service, org_id = dept["service"], dept["org_id"]
        cr = await service.create_check_request(
            org_id,
            dept["member"].id,
            charger_id=dept["member"].id,
            **_cr_fields(dept, dept["gear_line"].id),
        )
        await _deactivate(dept)
        with pytest.raises(ValueError, match="inactive"):
            await service.submit_check_request(
                cr.id, org_id, requester_id=dept["member"].id
            )

    async def test_expense_report_cannot_submit(self, dept):
        service, org_id = dept["service"], dept["org_id"]
        er = await service.create_expense_report(
            org_id,
            dept["member"].id,
            line_items=[_er_item(dept["gear_line"].id)],
            charger_id=dept["member"].id,
            fiscal_year_id=dept["year"].id,
            title="Conference",
        )
        await _deactivate(dept)
        with pytest.raises(ValueError, match="inactive"):
            await service.submit_expense_report(
                er.id, org_id, requester_id=dept["member"].id
            )


class TestRequestsInFlightFinish:
    async def test_purchase_request_approves_and_pays(self, dept):
        db, service, org_id = dept["db"], dept["service"], dept["org_id"]
        pr = await service.create_purchase_request(
            org_id,
            dept["member"].id,
            charger_id=dept["member"].id,
            **_pr_fields(dept, dept["gear_line"].id),
        )
        await service.submit_purchase_request(
            pr.id, org_id, requester_id=dept["member"].id
        )
        await _deactivate(dept)

        await service.manual_approve(PR, pr.id, dept["treasurer"].id, org_id=org_id)
        assert pr.status == PurchaseRequestStatus.APPROVED
        await service.mark_pr_paid(pr.id, org_id, acted_by=dept["treasurer"].id)
        assert pr.status == PurchaseRequestStatus.PAID
        line = dept["gear_line"]
        await db.refresh(line)
        assert line.amount_spent == Decimal("120.00")

    async def test_check_request_approves_and_issues(self, dept):
        db, service, org_id = dept["db"], dept["service"], dept["org_id"]
        cr = await service.create_check_request(
            org_id,
            dept["member"].id,
            charger_id=dept["member"].id,
            **_cr_fields(dept, dept["gear_line"].id),
        )
        await service.submit_check_request(
            cr.id, org_id, requester_id=dept["member"].id
        )
        await _deactivate(dept)

        await service.manual_approve(CR, cr.id, dept["treasurer"].id, org_id=org_id)
        assert cr.status == CheckRequestStatus.APPROVED
        await service.issue_check(cr.id, org_id, "1001", acted_by=dept["treasurer"].id)
        assert cr.status == CheckRequestStatus.ISSUED
        line = dept["gear_line"]
        await db.refresh(line)
        assert line.amount_spent == Decimal("80.00")

    async def test_expense_report_approves_and_pays(self, dept):
        service, org_id = dept["service"], dept["org_id"]
        er = await service.create_expense_report(
            org_id,
            dept["member"].id,
            line_items=[_er_item(dept["gear_line"].id)],
            charger_id=dept["member"].id,
            fiscal_year_id=dept["year"].id,
            title="Conference",
        )
        # Submitted before the category closed. Submission also wants a
        # receipt per line, which is not what this test is about.
        er.status = ExpenseReportStatus.PENDING_APPROVAL
        await dept["db"].flush()
        await _deactivate(dept)

        await service.manual_approve(ER, er.id, dept["treasurer"].id, org_id=org_id)
        assert er.status == ExpenseReportStatus.APPROVED
        await service.mark_expense_paid(er.id, org_id, acted_by=dept["treasurer"].id)
        assert er.status == ExpenseReportStatus.PAID


class TestBudgetPicker:
    async def test_an_inactive_categorys_line_is_flagged(self, dept):
        await _deactivate(dept)
        options = await dept["service"].list_budget_options(
            dept["org_id"], dept["year"].id
        )
        flags = {option["id"]: option["category_active"] for option in options}
        assert flags == {
            dept["gear_line"].id: False,
            dept["open_line"].id: True,
        }
