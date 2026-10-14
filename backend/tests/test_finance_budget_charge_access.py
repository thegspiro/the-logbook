"""Who may charge a budget line: open and restricted sub-categories.

A Quartermaster category owns sub-categories — Boot reimbursement open to
every requester, Officer brass restricted to the Quartermaster and any
position they name (owner decisions, 2026-10-14). ``finance_budget_access``
is the one definition of the rule; pinned here:

* the rule's resolution on its own — inheritance up the tree, a top-level
  category with no setting is open, the answerable owners of the whole chain
  and the line's own owner may charge a restricted line, a cycle is bounded;
* the request-form picker lists only the lines the caller may charge,
  labelled with the category path, and ``finance.manage`` sees them all;
* purchase, check and expense requests are refused against a restricted line
  the caller may not charge, and accepted once the owner names their
  position; a request already on a line stays editable after it is
  restricted;
* the Quartermaster sets the rule on their own categories without
  ``finance.manage``; anyone else gets 404, and the Treasurer may set any;
* a category cannot be placed beneath itself.
"""

from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import Budget, BudgetCategory, ChargeAccess, FiscalYearStatus
from app.services.finance_budget_access import CategoryNode, CategoryTree
from tests.test_finance_budget_owners import _client, _org, _position, _user, _year

# ============================================
# The rule, without a database
# ============================================


def _tree(*nodes, named=None) -> CategoryTree:
    return CategoryTree([CategoryNode(*n) for n in nodes], named or {})


@pytest.mark.unit
class TestRuleResolution:
    def test_a_top_level_category_with_no_setting_is_open(self):
        tree = _tree(("a", "Admin", None, None, None))
        rule = tree.rule("a")
        assert rule.access == ChargeAccess.OPEN
        assert rule.source_category_id is None
        assert rule.allows(set(), None)

    def test_a_sub_category_inherits_its_parents_rule_and_positions(self):
        tree = _tree(
            ("qm", "Quartermaster", None, "pos-qm", "restricted"),
            ("brass", "Officer brass", "qm", None, None),
            named={"qm": {"pos-supervisor"}},
        )
        rule = tree.rule("brass")
        assert rule.access == ChargeAccess.RESTRICTED
        assert rule.source_category_id == "qm"
        assert rule.allows({"pos-supervisor"}, None)
        assert rule.allows({"pos-qm"}, None)
        assert not rule.allows({"pos-firefighter"}, None)

    def test_a_sub_category_may_open_what_its_parent_restricts(self):
        tree = _tree(
            ("qm", "Quartermaster", None, "pos-qm", "restricted"),
            ("boots", "Boot reimbursement", "qm", None, "open"),
        )
        assert tree.rule("boots").allows(set(), None)

    def test_the_owner_of_any_ancestor_and_the_lines_owner_may_charge(self):
        tree = _tree(
            ("ops", "Operations", None, "pos-chief", None),
            ("qm", "Quartermaster", "ops", "pos-qm", None),
            ("brass", "Officer brass", "qm", None, "restricted"),
        )
        rule = tree.rule("brass")
        assert rule.allows({"pos-chief"}, None)
        assert rule.allows({"pos-qm"}, None)
        assert rule.allows({"pos-line"}, "pos-line")
        assert not rule.allows({"pos-other"}, "pos-line")

    def test_named_positions_belong_to_the_category_that_restricted(self):
        # A list on a category that does not restrict is not read.
        tree = _tree(
            ("qm", "Quartermaster", None, "pos-qm", "restricted"),
            ("brass", "Officer brass", "qm", None, None),
            named={"brass": {"pos-stray"}},
        )
        assert not tree.rule("brass").allows({"pos-stray"}, None)

    def test_path_descendants_and_management(self):
        tree = _tree(
            ("qm", "Quartermaster", None, "pos-qm", None),
            ("uni", "Uniforms", "qm", None, None),
            ("brass", "Officer brass", "uni", None, None),
            ("other", "Training", None, None, None),
        )
        assert tree.path("brass") == ["Quartermaster", "Uniforms", "Officer brass"]
        assert tree.descendant_ids("qm") == {"uni", "brass"}
        assert tree.manageable_by("brass", {"pos-qm"})
        assert not tree.manageable_by("other", {"pos-qm"})

    def test_a_stored_cycle_does_not_hang_the_walk(self):
        tree = _tree(
            ("a", "A", "b", None, None),
            ("b", "B", "a", None, "restricted"),
        )
        assert tree.rule("a").access == ChargeAccess.RESTRICTED
        assert tree.path("a") == ["B", "A"]
        assert tree.descendant_ids("a") == {"b"}


# ============================================
# Against the database, through the endpoints
# ============================================


@pytest.fixture
async def dept(db_session: AsyncSession):
    org_id = await _org(db_session, "qm")
    other_org = await _org(db_session, "other")
    treasurer_pos = await _position(
        db_session, org_id, "Treasurer", ["finance.view", "finance.manage"]
    )
    qm_pos = await _position(db_session, org_id, "Quartermaster", ["finance.request"])
    supervisor_pos = await _position(
        db_session, org_id, "Support Chief", ["finance.request"]
    )
    firefighter_pos = await _position(
        db_session, org_id, "Firefighter", ["finance.request"]
    )
    foreign_pos = await _position(db_session, other_org, "Their QM", [])
    people = {
        "treasurer": await _user(db_session, org_id, "treasurer", [treasurer_pos]),
        "qm": await _user(db_session, org_id, "qm", [qm_pos]),
        "supervisor": await _user(db_session, org_id, "sup", [supervisor_pos]),
        "member": await _user(db_session, org_id, "ff", [firefighter_pos]),
    }
    treasurer_id = people["treasurer"].id
    fy = _year(org_id, "FY2026", FiscalYearStatus.ACTIVE, treasurer_id, 2026)
    qm = BudgetCategory(
        organization_id=org_id, name="Quartermaster", owner_position_id=qm_pos
    )
    db_session.add_all([fy, qm])
    await db_session.flush()
    boots = BudgetCategory(
        organization_id=org_id,
        name="Boot reimbursement",
        parent_category_id=qm.id,
        charge_access=ChargeAccess.OPEN,
    )
    brass = BudgetCategory(
        organization_id=org_id,
        name="Officer brass",
        parent_category_id=qm.id,
        charge_access=ChargeAccess.RESTRICTED,
    )
    training = BudgetCategory(organization_id=org_id, name="Training")
    db_session.add_all([boots, brass, training])
    await db_session.flush()

    def line(category):
        return Budget(
            organization_id=org_id,
            fiscal_year_id=fy.id,
            category_id=category.id,
            amount_budgeted=Decimal("1000.00"),
            created_by=treasurer_id,
        )

    lines = {
        "qm": line(qm),
        "boots": line(boots),
        "brass": line(brass),
        "training": line(training),
    }
    db_session.add_all(lines.values())
    await db_session.flush()
    return {
        "org_id": org_id,
        "fy": fy.id,
        "qm_pos": qm_pos,
        "supervisor_pos": supervisor_pos,
        "foreign_pos": foreign_pos,
        "categories": {
            "qm": qm.id,
            "boots": boots.id,
            "brass": brass.id,
            "training": training.id,
        },
        "lines": {k: v.id for k, v in lines.items()},
        **people,
    }


async def _call(db, user, method, path, json=None):
    async with _client(db, user) as client:
        return await client.request(method, path, json=json)


async def _option_labels(db, dept, who) -> dict:
    resp = await _call(
        db, dept[who], "GET", f"/finance/budgets/options?fiscal_year_id={dept['fy']}"
    )
    assert resp.status_code == 200, resp.text
    return {row["id"]: row["label"] for row in resp.json()}


def _purchase(dept, line):
    return {
        "fiscalYearId": dept["fy"],
        "budgetId": dept["lines"][line],
        "title": "Collar brass",
        "estimatedAmount": "40.00",
    }


@pytest.mark.integration
class TestTheRequestPicker:
    async def test_a_member_sees_open_lines_labelled_by_path(self, db_session, dept):
        labels = await _option_labels(db_session, dept, "member")
        lines = dept["lines"]
        assert labels == {
            lines["qm"]: "Quartermaster",
            lines["boots"]: "Quartermaster › Boot reimbursement",
            lines["training"]: "Training",
        }

    async def test_the_quartermaster_also_sees_the_restricted_line(
        self, db_session, dept
    ):
        labels = await _option_labels(db_session, dept, "qm")
        assert labels[dept["lines"]["brass"]] == "Quartermaster › Officer brass"
        assert len(labels) == 4

    async def test_the_treasurer_sees_every_line(self, db_session, dept):
        assert len(await _option_labels(db_session, dept, "treasurer")) == 4


@pytest.mark.integration
class TestRequestWrites:
    async def test_a_member_cannot_charge_the_restricted_line(self, db_session, dept):
        resp = await _call(
            db_session,
            dept["member"],
            "POST",
            "/finance/purchase-requests",
            _purchase(dept, "brass"),
        )
        assert resp.status_code == 400
        assert "restricted" in resp.json()["detail"]

    async def test_a_member_can_charge_the_open_sub_line(self, db_session, dept):
        resp = await _call(
            db_session,
            dept["member"],
            "POST",
            "/finance/purchase-requests",
            _purchase(dept, "boots"),
        )
        assert resp.status_code == 201, resp.text

    async def test_check_requests_and_expense_lines_are_refused_too(
        self, db_session, dept
    ):
        check = await _call(
            db_session,
            dept["member"],
            "POST",
            "/finance/check-requests",
            {
                "fiscalYearId": dept["fy"],
                "budgetId": dept["lines"]["brass"],
                "payeeName": "Brass Co",
                "amount": "40.00",
            },
        )
        assert check.status_code == 400
        item = {
            "budgetId": dept["lines"]["brass"],
            "description": "Brass",
            "amount": "40.00",
            "dateIncurred": datetime(2026, 3, 1, tzinfo=timezone.utc).isoformat(),
        }
        report = await _call(
            db_session,
            dept["member"],
            "POST",
            "/finance/expense-reports",
            {"fiscalYearId": dept["fy"], "title": "Brass", "lineItems": [item]},
        )
        assert report.status_code == 400
        empty = await _call(
            db_session,
            dept["member"],
            "POST",
            "/finance/expense-reports",
            {"fiscalYearId": dept["fy"], "title": "Brass"},
        )
        assert empty.status_code == 201, empty.text
        added = await _call(
            db_session,
            dept["member"],
            "POST",
            f"/finance/expense-reports/{empty.json()['id']}/items",
            item,
        )
        assert added.status_code == 400

    async def test_the_quartermaster_and_a_named_position_may_charge_it(
        self, db_session, dept
    ):
        resp = await _call(
            db_session,
            dept["qm"],
            "POST",
            "/finance/purchase-requests",
            _purchase(dept, "brass"),
        )
        assert resp.status_code == 201, resp.text

        refused = await _call(
            db_session,
            dept["supervisor"],
            "POST",
            "/finance/purchase-requests",
            _purchase(dept, "brass"),
        )
        assert refused.status_code == 400
        named = await _call(
            db_session,
            dept["qm"],
            "PUT",
            f"/finance/budget-categories/{dept['categories']['brass']}/charge-access",
            {
                "chargeAccess": "restricted",
                "chargePositionIds": [dept["supervisor_pos"]],
            },
        )
        assert named.status_code == 200, named.text
        assert named.json()["chargePositionIds"] == [dept["supervisor_pos"]]
        allowed = await _call(
            db_session,
            dept["supervisor"],
            "POST",
            "/finance/purchase-requests",
            _purchase(dept, "brass"),
        )
        assert allowed.status_code == 201, allowed.text

    async def test_a_request_filed_before_the_restriction_stays_editable(
        self, db_session, dept
    ):
        created = await _call(
            db_session,
            dept["member"],
            "POST",
            "/finance/purchase-requests",
            _purchase(dept, "boots"),
        )
        assert created.status_code == 201
        restrict = await _call(
            db_session,
            dept["qm"],
            "PUT",
            f"/finance/budget-categories/{dept['categories']['boots']}/charge-access",
            {"chargeAccess": "restricted", "chargePositionIds": []},
        )
        assert restrict.status_code == 200
        edited = await _call(
            db_session,
            dept["member"],
            "PUT",
            f"/finance/purchase-requests/{created.json()['id']}",
            {"title": "Boots, size 11", "budgetId": dept["lines"]["boots"]},
        )
        assert edited.status_code == 200, edited.text
        moved = await _call(
            db_session,
            dept["member"],
            "PUT",
            f"/finance/purchase-requests/{created.json()['id']}",
            {"budgetId": dept["lines"]["brass"]},
        )
        assert moved.status_code == 400


@pytest.mark.integration
class TestWhoSetsTheRule:
    async def test_the_quartermaster_lists_their_own_categories(self, db_session, dept):
        resp = await _call(db_session, dept["qm"], "GET", "/finance/charge-access")
        assert resp.status_code == 200
        body = resp.json()
        assert [c["path"] for c in body["categories"]] == [
            ["Quartermaster"],
            ["Quartermaster", "Boot reimbursement"],
            ["Quartermaster", "Officer brass"],
        ]
        brass = body["categories"][2]
        assert brass["chargeAccess"] == "restricted"
        assert brass["effectiveChargeAccess"] == "restricted"
        assert {p["name"] for p in body["positions"]} >= {"Quartermaster"}

    async def test_the_treasurer_who_owns_nothing_gets_empty_lists(
        self, db_session, dept
    ):
        # The Treasurer sets every rule from the category settings instead.
        resp = await _call(
            db_session, dept["treasurer"], "GET", "/finance/charge-access"
        )
        assert resp.json() == {"categories": [], "positions": []}

    async def test_a_member_who_owns_nothing_gets_empty_lists(self, db_session, dept):
        resp = await _call(db_session, dept["member"], "GET", "/finance/charge-access")
        assert resp.json() == {"categories": [], "positions": []}

    async def test_a_member_cannot_set_the_rule(self, db_session, dept):
        resp = await _call(
            db_session,
            dept["member"],
            "PUT",
            f"/finance/budget-categories/{dept['categories']['brass']}/charge-access",
            {"chargeAccess": "open", "chargePositionIds": []},
        )
        assert resp.status_code == 404

    async def test_the_quartermaster_cannot_set_another_category(
        self, db_session, dept
    ):
        resp = await _call(
            db_session,
            dept["qm"],
            "PUT",
            f"/finance/budget-categories/{dept['categories']['training']}/charge-access",
            {"chargeAccess": "restricted", "chargePositionIds": []},
        )
        assert resp.status_code == 404

    async def test_the_treasurer_may_set_any_and_inheritance_is_reported(
        self, db_session, dept
    ):
        resp = await _call(
            db_session,
            dept["treasurer"],
            "PUT",
            f"/finance/budget-categories/{dept['categories']['brass']}/charge-access",
            {"chargeAccess": None, "chargePositionIds": []},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["chargeAccess"] is None
        assert body["effectiveChargeAccess"] == "open"
        assert body["chargeAccessInheritedFrom"] is None

    async def test_another_departments_position_is_refused(self, db_session, dept):
        resp = await _call(
            db_session,
            dept["qm"],
            "PUT",
            f"/finance/budget-categories/{dept['categories']['brass']}/charge-access",
            {"chargeAccess": "restricted", "chargePositionIds": [dept["foreign_pos"]]},
        )
        assert resp.status_code == 400


@pytest.mark.integration
class TestTheTree:
    async def test_a_category_cannot_be_placed_beneath_itself(self, db_session, dept):
        cats = dept["categories"]
        for parent in (cats["qm"], cats["brass"]):
            resp = await _call(
                db_session,
                dept["treasurer"],
                "PUT",
                f"/finance/budget-categories/{cats['qm']}",
                {"parentCategoryId": parent},
            )
            assert resp.status_code == 400, parent

    async def test_the_category_list_reports_paths_and_inherited_rules(
        self, db_session, dept
    ):
        await _call(
            db_session,
            dept["treasurer"],
            "PUT",
            f"/finance/budget-categories/{dept['categories']['qm']}",
            {
                "chargeAccess": "restricted",
                "chargePositionIds": [dept["supervisor_pos"]],
            },
        )
        resp = await _call(
            db_session, dept["treasurer"], "GET", "/finance/budget-categories"
        )
        rows = {row["id"]: row for row in resp.json()}
        brass = rows[dept["categories"]["brass"]]
        assert brass["path"] == ["Quartermaster", "Officer brass"]
        assert brass["chargeAccessInheritedFrom"] is None
        qm = rows[dept["categories"]["qm"]]
        assert qm["chargePositionIds"] == [dept["supervisor_pos"]]
        # The supervisor named on the parent may charge the parent's own line.
        labels = await _option_labels(db_session, dept, "supervisor")
        assert dept["lines"]["qm"] in labels
