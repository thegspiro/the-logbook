"""A budget subcategory posts to QuickBooks where its parent does.

Owner decision, 2026-10-14: a category with no QuickBooks account of its own,
or no paid-from (offset) account, takes the missing one from its nearest
ancestor that has it, so the treasurer maps Operations once rather than every
line under it. The readiness report says where each account came from, and the
export posts with the same resolution.
"""

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.models.finance import (
    Budget,
    BudgetCategory,
    CheckRequest,
    CheckRequestStatus,
    ExportMapping,
    ExportMappingType,
    FiscalYear,
)
from app.services.finance_service import FinanceService, _resolve_category_accounts
from tests.test_finance_quickbooks_export import (
    PAID,
    _client_with,
    _export,
    _logs,
    make_books,
)


def _cat(cid, name, *, parent=None, account=None):
    return SimpleNamespace(
        id=cid, name=name, parent_category_id=parent, qb_account_name=account
    )


def _map(account, offset):
    return SimpleNamespace(qb_account_name=account, qb_offset_account_name=offset)


# ============================================
# The resolver, no database
# ============================================


@pytest.mark.unit
class TestTheResolver:
    def test_a_child_takes_both_accounts_from_its_parent(self):
        accounts = _resolve_category_accounts(
            [_cat("ops", "Operations"), _cat("gear", "Gear", parent="ops")],
            {"operations": [_map("Operations Expense", "Checking")]},
        )

        gear = accounts["gear"]
        assert (gear.account, gear.offset, gear.problem) == (
            "Operations Expense",
            "Checking",
            None,
        )
        assert gear.account_source == "parent"
        assert (gear.account_inherited_from, gear.offset_inherited_from) == (
            "Operations",
            "Operations",
        )

    def test_a_grandchild_names_where_the_account_really_came_from(self):
        accounts = _resolve_category_accounts(
            [
                _cat("ops", "Operations"),
                _cat("gear", "Gear", parent="ops"),
                _cat("boots", "Boots", parent="gear"),
            ],
            {"operations": [_map("Operations Expense", "Checking")]},
        )

        assert accounts["boots"].account_inherited_from == "Operations"
        assert accounts["boots"].offset_inherited_from == "Operations"

    def test_its_own_account_wins_and_only_the_missing_offset_is_inherited(self):
        accounts = _resolve_category_accounts(
            [
                _cat("ops", "Operations"),
                _cat("gear", "Gear", parent="ops", account="Gear Expense"),
            ],
            {"operations": [_map("Operations Expense", "Checking")]},
        )

        gear = accounts["gear"]
        assert (gear.account, gear.offset) == ("Gear Expense", "Checking")
        assert gear.account_source == "category"
        assert gear.account_inherited_from is None
        assert gear.offset_inherited_from == "Operations"

    def test_a_child_with_several_mappings_inherits_nothing(self):
        accounts = _resolve_category_accounts(
            [_cat("ops", "Operations"), _cat("gear", "Gear", parent="ops")],
            {
                "operations": [_map("Operations Expense", "Checking")],
                "gear": [_map("A", "Checking"), _map("B", "Checking")],
            },
        )

        assert accounts["gear"].problem == "duplicate_mappings"
        assert accounts["gear"].account == ""

    def test_a_parent_with_several_mappings_passes_nothing_down(self):
        accounts = _resolve_category_accounts(
            [_cat("ops", "Operations"), _cat("gear", "Gear", parent="ops")],
            {"operations": [_map("A", "Checking"), _map("B", "Checking")]},
        )

        assert accounts["gear"].problem == "no_account"

    def test_a_cycle_written_by_hand_ends(self):
        accounts = _resolve_category_accounts(
            [_cat("a", "A", parent="b"), _cat("b", "B", parent="a")], {}
        )

        assert accounts["a"].problem == "no_account"
        assert accounts["b"].problem == "no_account"

    def test_a_parent_it_was_not_given_is_not_followed(self):
        # The export loads only the department's own categories, so a parent
        # id pointing at another department's category resolves to nothing.
        accounts = _resolve_category_accounts(
            [_cat("gear", "Gear", parent="someone-elses")], {}
        )

        assert accounts["gear"].problem == "no_account"

    def test_payable_inherited_is_still_refused(self):
        accounts = _resolve_category_accounts(
            [_cat("ops", "Operations"), _cat("gear", "Gear", parent="ops")],
            {"operations": [_map("Accounts Payable (A/P)", "Checking")]},
        )

        assert accounts["gear"].problem == "payable_receivable"


# ============================================
# The export and the readiness report
# ============================================


async def _diesel(db_session, books, *, account=None):
    """A Diesel subcategory under Fuel, with a line and an issued check."""
    fuel = (
        await db_session.execute(
            BudgetCategory.__table__.select().where(
                BudgetCategory.organization_id == books["org_id"],
                BudgetCategory.name == "Fuel",
            )
        )
    ).first()
    diesel = BudgetCategory(
        organization_id=books["org_id"],
        name="Diesel",
        parent_category_id=fuel.id,
        qb_account_name=account,
    )
    db_session.add(diesel)
    await db_session.flush()
    year = (
        await db_session.execute(
            FiscalYear.__table__.select().where(
                FiscalYear.organization_id == books["org_id"]
            )
        )
    ).first()
    line = Budget(
        organization_id=books["org_id"],
        fiscal_year_id=year.id,
        category_id=diesel.id,
        amount_budgeted=Decimal("300.00"),
        created_by=books["user_id"],
    )
    db_session.add(line)
    await db_session.flush()
    db_session.add(
        CheckRequest(
            organization_id=books["org_id"],
            request_number="CR-2026-0009",
            requested_by=books["user_id"],
            fiscal_year_id=year.id,
            budget_id=line.id,
            payee_name="Diesel Depot",
            amount=Decimal("60.00"),
            purpose="Engine 2 diesel",
            check_number="1043",
            status=CheckRequestStatus.ISSUED,
            check_date=PAID,
        )
    )
    await db_session.flush()
    return diesel


@pytest.mark.integration
class TestTheExport:
    async def test_a_subcategory_posts_to_its_parents_accounts(self, db_session, books):
        await _diesel(db_session, books)

        rows = await _export(db_session, books)

        diesel = [r for r in rows if r[0] == "CR-2026-0009"]
        assert [(r[3], r[4], r[5]) for r in diesel] == [
            ("Vehicle Expense:Fuel", "60.00", ""),
            ("Operating Checking", "", "60.00"),
        ]

    async def test_its_own_account_is_used_with_the_parents_offset(
        self, db_session, books
    ):
        await _diesel(db_session, books, account="Vehicle Expense:Diesel")

        rows = await _export(db_session, books)

        diesel = [r for r in rows if r[0] == "CR-2026-0009"]
        assert [r[3] for r in diesel] == [
            "Vehicle Expense:Diesel",
            "Operating Checking",
        ]

    async def test_still_refused_when_no_ancestor_has_an_account(
        self, db_session, books
    ):
        await _diesel(db_session, books)
        books["fuel_map"].internal_category = "Not a category"
        await db_session.flush()

        with pytest.raises(ValueError, match="'Diesel' has no account"):
            await FinanceService(db_session).generate_export(
                books["org_id"],
                books["user_id"],
                datetime(2026, 3, 1, tzinfo=timezone.utc),
                datetime(2026, 3, 31, tzinfo=timezone.utc),
            )
        assert await _logs(db_session, books["org_id"]) == []

    async def test_readiness_says_where_the_accounts_came_from(self, db_session, books):
        await _diesel(db_session, books)

        report = await FinanceService(db_session).get_export_readiness(books["org_id"])
        rows = {row["category_name"]: row for row in report["categories"]}

        diesel = rows["Diesel"]
        assert diesel["status"] == "ready"
        assert diesel["account_source"] == "parent"
        assert diesel["account_name"] == "Vehicle Expense:Fuel"
        assert diesel["account_inherited_from"] == "Fuel"
        assert diesel["offset_inherited_from"] == "Fuel"
        assert diesel["mapping_ids"] == []
        # The parent itself is unchanged.
        assert rows["Fuel"]["account_source"] == "mapping"
        assert rows["Fuel"]["account_inherited_from"] is None

    async def test_a_subcategory_with_its_own_mapping_keeps_it(self, db_session, books):
        await _diesel(db_session, books)
        db_session.add(
            ExportMapping(
                organization_id=books["org_id"],
                internal_category="Diesel",
                qb_account_name="Diesel Expense",
                qb_offset_account_name="Fuel Card",
                mapping_type=ExportMappingType.EXPENSE,
            )
        )
        await db_session.flush()

        rows = await _export(db_session, books)

        diesel = [r for r in rows if r[0] == "CR-2026-0009"]
        assert [r[3] for r in diesel] == ["Diesel Expense", "Fuel Card"]


@pytest.mark.integration
class TestTheDownload:
    async def test_the_file_is_named_for_the_days_it_covers(self, db_session, books):
        async with await _client_with(
            db_session, books["org_id"], ["finance.manage"]
        ) as client:
            response = await client.post(
                "/finance/export/transactions",
                json={
                    "dateRangeStart": "2026-03-01T00:00:00Z",
                    "dateRangeEnd": "2026-03-31T23:59:59Z",
                },
            )

        assert response.status_code == 200, response.text
        assert response.headers["content-disposition"] == (
            'attachment; filename="quickbooks-journal_2026-03-01_2026-03-31.csv"'
        )
        assert "PR-2026-0001" in response.text


@pytest.fixture
async def books(db_session):
    return await make_books(db_session)
