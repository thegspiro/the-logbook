"""A deactivated parent category closes the sub-categories beneath it.

Owner decision (2026-10-23): a category counts as inactive for new charges,
new budget lines and proposals when it **or any category above it** is
inactive. ``CategoryTree.inactive_source`` is the one definition; every check
that treats an inactive category as closed asks it. A request already in
flight still finishes on its line.

Tree used throughout: Apparatus › Pump repairs › Impellers, plus an
unrelated top-level Training.
"""

import asyncio
import re
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import (
    ApprovalEntityType,
    Budget,
    BudgetCategory,
    FiscalYearStatus,
    PurchaseRequestStatus,
)
from app.services.finance_budget_access import (
    MAX_CATEGORY_DEPTH,
    CategoryNode,
    CategoryTree,
)
from app.services.finance_budget_request_service import FinanceBudgetRequestService
from app.services.finance_service import FinanceService
from tests.test_finance_budget_owners import _org, _position, _user, _year

PR = ApprovalEntityType.PURCHASE_REQUEST

UNDER_APPARATUS = (
    'The budget category "Apparatus" is inactive, so budget lines under it '
    "take no new charges."
)


def _tree(*nodes) -> CategoryTree:
    return CategoryTree([CategoryNode(*n) for n in nodes], {})


@pytest.mark.unit
class TestTheDefinition:
    def test_an_inactive_ancestor_closes_every_descendant(self):
        tree = _tree(
            ("a", "Apparatus", None, None, None, False),
            ("p", "Pump repairs", "a", None, None, True),
            ("i", "Impellers", "p", None, None, True),
        )
        assert tree.inactive_source("p").name == "Apparatus"
        assert tree.inactive_source("i").name == "Apparatus"
        assert not tree.is_effectively_active("i")

    def test_the_nearest_inactive_category_is_named(self):
        tree = _tree(
            ("a", "Apparatus", None, None, None, False),
            ("p", "Pump repairs", "a", None, None, False),
            ("i", "Impellers", "p", None, None, True),
        )
        assert tree.inactive_source("i").name == "Pump repairs"

    def test_an_active_chain_is_open(self):
        tree = _tree(
            ("a", "Apparatus", None, None, None, True),
            ("p", "Pump repairs", "a", None, None, True),
        )
        assert tree.inactive_source("p") is None

    def test_a_cycle_ends_the_walk(self):
        tree = _tree(
            ("a", "A", "b", None, None, True),
            ("b", "B", "a", None, None, True),
        )
        assert tree.is_effectively_active("a")
        closed = _tree(
            ("a", "A", "b", None, None, True),
            ("b", "B", "a", None, None, False),
        )
        assert closed.inactive_source("a").name == "B"

    def test_an_overlong_chain_is_bounded(self):
        # The inactive root sits beyond the depth bound, so the walk stops
        # before reaching it rather than following an unbounded chain.
        depth = MAX_CATEGORY_DEPTH + 5
        nodes = [("c0", "Root", None, None, None, False)]
        nodes += [
            (f"c{n}", f"C{n}", f"c{n - 1}", None, None, True) for n in range(1, depth)
        ]
        tree = _tree(*nodes)
        assert len(tree.chain(f"c{depth - 1}")) <= MAX_CATEGORY_DEPTH + 1
        assert tree.is_effectively_active(f"c{depth - 1}")


@pytest.fixture
async def dept(db_session: AsyncSession):
    org_id = await _org(db_session, "inactparent")
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
    draft = _year(org_id, "FY2027", FiscalYearStatus.DRAFT, treasurer.id, 2027)
    db_session.add_all([year, draft])
    await db_session.flush()

    apparatus = BudgetCategory(organization_id=org_id, name="Apparatus")
    training = BudgetCategory(organization_id=org_id, name="Training")
    db_session.add_all([apparatus, training])
    await db_session.flush()
    pump = BudgetCategory(
        organization_id=org_id, name="Pump repairs", parent_category_id=apparatus.id
    )
    db_session.add(pump)
    await db_session.flush()
    impellers = BudgetCategory(
        organization_id=org_id, name="Impellers", parent_category_id=pump.id
    )
    db_session.add(impellers)
    await db_session.flush()

    def line(category: BudgetCategory) -> Budget:
        return Budget(
            organization_id=org_id,
            fiscal_year_id=year.id,
            category_id=category.id,
            amount_budgeted=Decimal("5000.00"),
            created_by=treasurer.id,
        )

    pump_line, impeller_line, training_line = (
        line(pump),
        line(impellers),
        line(training),
    )
    db_session.add_all([pump_line, impeller_line, training_line])
    await db_session.flush()
    return {
        "db": db_session,
        "service": FinanceService(db_session),
        "org_id": org_id,
        "treasurer": treasurer,
        "member": member,
        "year": year,
        "draft": draft,
        "apparatus": apparatus,
        "pump": pump,
        "impellers": impellers,
        "pump_line": pump_line,
        "impeller_line": impeller_line,
        "training_line": training_line,
    }


async def _set_parent_active(dept, active: bool) -> None:
    dept["apparatus"].is_active = active
    await dept["db"].flush()


def _pr_fields(dept, budget_id) -> dict:
    return {
        "fiscal_year_id": dept["year"].id,
        "budget_id": budget_id,
        "title": "Impeller kit",
        "estimated_amount": Decimal("120.00"),
    }


async def _new_pr(dept, budget_id):
    return await dept["service"].create_purchase_request(
        dept["org_id"],
        dept["member"].id,
        charger_id=dept["member"].id,
        **_pr_fields(dept, budget_id),
    )


@pytest.mark.integration
class TestNewChargesUnderAnInactiveParent:
    async def test_a_child_line_is_refused_naming_the_parent(self, dept):
        await _set_parent_active(dept, False)
        with pytest.raises(ValueError, match=re.escape(UNDER_APPARATUS)):
            await _new_pr(dept, dept["pump_line"].id)

    async def test_a_grandchild_line_is_refused_naming_the_parent(self, dept):
        await _set_parent_active(dept, False)
        with pytest.raises(ValueError, match=re.escape(UNDER_APPARATUS)):
            await _new_pr(dept, dept["impeller_line"].id)

    async def test_the_line_takes_charges_again_after_reactivation(self, dept):
        await _set_parent_active(dept, False)
        with pytest.raises(ValueError, match='"Apparatus" is inactive'):
            await _new_pr(dept, dept["impeller_line"].id)
        await _set_parent_active(dept, True)
        pr = await _new_pr(dept, dept["impeller_line"].id)
        assert pr.budget_id == dept["impeller_line"].id

    async def test_an_unrelated_line_is_unaffected(self, dept):
        await _set_parent_active(dept, False)
        pr = await _new_pr(dept, dept["training_line"].id)
        assert pr.budget_id == dept["training_line"].id

    async def test_submitting_a_draft_on_a_child_line_is_refused(self, dept):
        pr = await _new_pr(dept, dept["pump_line"].id)
        await _set_parent_active(dept, False)
        with pytest.raises(ValueError, match='"Apparatus" is inactive'):
            await dept["service"].submit_purchase_request(
                pr.id, dept["org_id"], requester_id=dept["member"].id
            )
        assert pr.status == PurchaseRequestStatus.DRAFT


@pytest.mark.integration
class TestARequestInFlightFinishes:
    async def test_approve_and_pay_on_a_child_line(self, dept):
        db, service, org_id = dept["db"], dept["service"], dept["org_id"]
        pr = await _new_pr(dept, dept["impeller_line"].id)
        await service.submit_purchase_request(
            pr.id, org_id, requester_id=dept["member"].id
        )
        await _set_parent_active(dept, False)

        await service.manual_approve(PR, pr.id, dept["treasurer"].id, org_id=org_id)
        assert pr.status == PurchaseRequestStatus.APPROVED
        await service.mark_pr_paid(pr.id, org_id, acted_by=dept["treasurer"].id)
        assert pr.status == PurchaseRequestStatus.PAID
        line = dept["impeller_line"]
        await db.refresh(line)
        assert line.amount_spent == Decimal("120.00")


@pytest.mark.integration
class TestPickersAndCategoryRows:
    async def test_budget_options_flag_the_child_lines(self, dept):
        await _set_parent_active(dept, False)
        options = await dept["service"].list_budget_options(
            dept["org_id"], dept["year"].id
        )
        flags = {option["id"]: option["category_active"] for option in options}
        assert flags == {
            dept["pump_line"].id: False,
            dept["impeller_line"].id: False,
            dept["training_line"].id: True,
        }

    async def test_the_category_row_reports_the_closing_parent(self, dept):
        await _set_parent_active(dept, False)
        service, org_id = dept["service"], dept["org_id"]
        child = await service.get_budget_category_detail(dept["impellers"].id, org_id)
        parent = await service.get_budget_category_detail(dept["apparatus"].id, org_id)
        assert child["inactive_through"] == "Apparatus"
        # The parent is inactive in its own right, not through anything.
        assert parent["inactive_through"] is None

    async def test_proposal_options_leave_out_the_children(self, dept):
        await _set_parent_active(dept, False)
        options = await FinanceBudgetRequestService(dept["db"]).proposal_options(
            dept["org_id"], dept["treasurer"].id
        )
        assert [c["name"] for c in options["categories"]] == ["Training"]


@pytest.mark.integration
class TestNewLinesUnderAnInactiveParent:
    async def test_a_new_budget_line_is_refused_naming_the_parent(self, dept):
        await _set_parent_active(dept, False)
        with pytest.raises(ValueError, match='"Apparatus" is inactive, so no new'):
            await dept["service"].create_budget(
                dept["org_id"],
                dept["treasurer"].id,
                fiscal_year_id=dept["draft"].id,
                category_id=dept["impellers"].id,
                amount_budgeted=Decimal("0"),
            )

    async def test_a_proposal_is_refused_naming_the_parent(self, dept):
        await _set_parent_active(dept, False)
        with pytest.raises(ValueError, match='"Apparatus" is inactive, so no new'):
            await FinanceBudgetRequestService(dept["db"]).create_request(
                dept["org_id"],
                dept["treasurer"].id,
                True,
                fiscal_year_id=dept["draft"].id,
                category_id=dept["pump"].id,
                requested_amount=Decimal("500.00"),
            )


@pytest.mark.integration
class TestAStoredCycle:
    async def test_a_cycle_does_not_hang_the_new_charge_check(self, dept):
        # The settings endpoint refuses a cycle on write
        # (_refuse_category_cycle); one stored before that guard, or
        # written directly, must still not hang the walk.
        db = dept["db"]
        dept["apparatus"].parent_category_id = dept["impellers"].id
        await db.flush()
        pr = await asyncio.wait_for(_new_pr(dept, dept["pump_line"].id), timeout=10)
        assert pr.budget_id == dept["pump_line"].id

        await _set_parent_active(dept, False)
        with pytest.raises(ValueError, match='"Apparatus" is inactive'):
            await asyncio.wait_for(_new_pr(dept, dept["impeller_line"].id), timeout=10)
