"""Deleting a budget category that anything uses deactivates it instead.

A budget line cascades away with its category — in every fiscal year, and
with it the budget link on every purchase request charged to it. An approval
chain naming the category fell to NULL, which ``pick_approval_chain`` reads as
"any category", so a chain meant for one category started routing all of
them. A category in use is now deactivated instead; an unused one is still
deleted. The endpoint keeps its 204 and reports which in ``X-Delete-Outcome``.
"""

from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import (
    ApprovalChain,
    ApprovalEntityType,
    Budget,
    BudgetCategory,
    FiscalYearStatus,
    PurchaseRequest,
    PurchaseRequestStatus,
)
from app.services.finance_budget_request_service import FinanceBudgetRequestService
from app.services.finance_service import FinanceService
from tests.test_finance_budget_owners import _client, _org, _position, _user, _year

pytestmark = pytest.mark.integration


@pytest.fixture
async def dept(db_session: AsyncSession):
    org_id = await _org(db_session, "catdel")
    treasurer_pos = await _position(
        db_session, org_id, "Treasurer", ["finance.view", "finance.manage"]
    )
    treasurer = await _user(db_session, org_id, "treasurer", [treasurer_pos])
    year = _year(org_id, "FY2026", FiscalYearStatus.ACTIVE, treasurer.id, 2026)
    draft = _year(org_id, "FY2027", FiscalYearStatus.DRAFT, treasurer.id, 2027)
    db_session.add_all([year, draft])
    await db_session.flush()
    return {
        "db": db_session,
        "org_id": org_id,
        "treasurer": treasurer,
        "year": year,
        "draft": draft,
    }


async def _category(db: AsyncSession, org_id: str, name: str) -> BudgetCategory:
    category = BudgetCategory(organization_id=org_id, name=name)
    db.add(category)
    await db.flush()
    return category


class TestServiceDelete:
    async def test_a_category_with_a_line_and_a_request_is_deactivated(self, dept):
        db, org_id = dept["db"], dept["org_id"]
        gear = await _category(db, org_id, "Gear")
        line = Budget(
            organization_id=org_id,
            fiscal_year_id=dept["year"].id,
            category_id=gear.id,
            amount_budgeted=Decimal("1000.00"),
            created_by=dept["treasurer"].id,
        )
        db.add(line)
        await db.flush()
        request = PurchaseRequest(
            organization_id=org_id,
            fiscal_year_id=dept["year"].id,
            request_number="PR-2026-0001",
            budget_id=line.id,
            requested_by=dept["treasurer"].id,
            title="Gloves",
            estimated_amount=Decimal("120.00"),
            status=PurchaseRequestStatus.DRAFT,
        )
        db.add(request)
        await db.flush()

        deleted = await FinanceService(db).delete_budget_category(gear.id, org_id)

        assert deleted is False
        await db.refresh(gear)
        assert gear.is_active is False
        assert await db.get(Budget, line.id) is not None
        await db.refresh(request)
        assert request.budget_id == line.id

    async def test_a_category_an_approval_chain_names_is_deactivated(self, dept):
        db, org_id = dept["db"], dept["org_id"]
        gear = await _category(db, org_id, "Gear")
        chain = ApprovalChain(
            organization_id=org_id,
            name="Gear purchases",
            applies_to=ApprovalEntityType.PURCHASE_REQUEST,
            budget_category_id=gear.id,
            created_by=dept["treasurer"].id,
        )
        db.add(chain)
        await db.flush()

        assert await FinanceService(db).delete_budget_category(gear.id, org_id) is False
        await db.refresh(chain)
        # Still specific to this category, not a catch-all.
        assert chain.budget_category_id == gear.id

    async def test_an_unused_category_is_deleted(self, dept):
        db, org_id = dept["db"], dept["org_id"]
        spare = await _category(db, org_id, "Spare")

        assert await FinanceService(db).delete_budget_category(spare.id, org_id) is True
        found = await db.execute(
            select(BudgetCategory).where(BudgetCategory.id == spare.id)
        )
        assert found.scalar_one_or_none() is None

    async def test_another_orgs_line_does_not_count(self, dept):
        """The in-use check is org-scoped like every other query."""
        db, org_id = dept["db"], dept["org_id"]
        other_org = await _org(db, "catdel-other")
        spare = await _category(db, org_id, "Spare")
        assert await FinanceService(db).budget_category_in_use(spare.id, other_org) is (
            False
        )


class TestInactiveCategoryIsNotOfferedForNewWork:
    async def test_a_new_line_cannot_use_an_inactive_category(self, dept):
        db, org_id = dept["db"], dept["org_id"]
        retired = await _category(db, org_id, "Retired")
        retired.is_active = False
        await db.flush()

        with pytest.raises(ValueError, match="inactive"):
            await FinanceService(db).create_budget(
                org_id,
                dept["treasurer"].id,
                fiscal_year_id=dept["year"].id,
                category_id=retired.id,
                amount_budgeted=Decimal("0"),
            )

    async def test_a_proposal_cannot_name_an_inactive_category(self, dept):
        db, org_id = dept["db"], dept["org_id"]
        retired = await _category(db, org_id, "Retired")
        retired.is_active = False
        await db.flush()

        with pytest.raises(ValueError, match="inactive"):
            await FinanceBudgetRequestService(db).create_request(
                org_id,
                dept["treasurer"].id,
                True,
                fiscal_year_id=dept["draft"].id,
                category_id=retired.id,
                requested_amount=Decimal("500.00"),
            )


class TestEndpoint:
    async def test_reports_the_outcome_and_keeps_204(self, dept):
        db, org_id = dept["db"], dept["org_id"]
        used = await _category(db, org_id, "Used")
        db.add(
            Budget(
                organization_id=org_id,
                fiscal_year_id=dept["year"].id,
                category_id=used.id,
                amount_budgeted=Decimal("10.00"),
                created_by=dept["treasurer"].id,
            )
        )
        spare = await _category(db, org_id, "Spare")
        await db.flush()

        async with _client(db, dept["treasurer"]) as client:
            kept = await client.delete(f"/finance/budget-categories/{used.id}")
            gone = await client.delete(f"/finance/budget-categories/{spare.id}")

        assert kept.status_code == 204
        assert kept.headers["X-Delete-Outcome"] == "deactivated"
        assert gone.status_code == 204
        assert gone.headers["X-Delete-Outcome"] == "deleted"
