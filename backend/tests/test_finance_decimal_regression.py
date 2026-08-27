"""Regression coverage for exact base-10 finance arithmetic."""

import csv
import io
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError

from app.models.finance import ApprovalEntityType, DuesStatus
from app.schemas.finance import BudgetCreate, MemberDuesPayment
from app.services.finance_service import FinanceService, _apply_payment_totals


def test_fractional_cent_inputs_are_rejected() -> None:
    with pytest.raises(ValidationError, match="decimal places"):
        BudgetCreate(
            fiscal_year_id="fy", category_id="category", amount_budgeted="1.001"
        )
    with pytest.raises(ValidationError, match="decimal places"):
        MemberDuesPayment(amount_paid="0.001")


def test_repeated_decimal_payments_add_without_binary_drift() -> None:
    dues = SimpleNamespace(
        payments=[
            SimpleNamespace(
                amount=Decimal("0.10"),
                received_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
                payment_method=None,
                transaction_reference="one",
                notes=None,
            ),
            SimpleNamespace(
                amount=Decimal("0.20"),
                received_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
                payment_method=None,
                transaction_reference="two",
                notes=None,
            ),
        ],
        amount_due=Decimal("0.30"),
        status=DuesStatus.PENDING,
    )

    _apply_payment_totals(dues)

    assert dues.amount_paid == Decimal("0.30")
    assert dues.status == DuesStatus.PAID


@pytest.mark.asyncio
@pytest.mark.parametrize("amount", [Decimal("10.00"), Decimal("20.00")])
async def test_approval_amount_range_includes_exact_boundaries(amount: Decimal) -> None:
    chain = SimpleNamespace(
        applies_to=ApprovalEntityType.PURCHASE_REQUEST,
        min_amount=Decimal("10.00"),
        max_amount=Decimal("20.00"),
        budget_category_id=None,
        is_default=False,
    )
    result = MagicMock()
    result.scalars.return_value.unique.return_value.all.return_value = [chain]
    db = AsyncMock()
    db.execute.return_value = result

    resolved = await FinanceService(db).resolve_approval_chain(
        "org", ApprovalEntityType.PURCHASE_REQUEST, amount
    )

    assert resolved is chain


@pytest.mark.asyncio
async def test_dues_summary_totals_use_decimal() -> None:
    rows = [
        SimpleNamespace(
            amount_due=Decimal("0.10"),
            amount_paid=Decimal("0.10"),
            status=DuesStatus.PAID,
        ),
        SimpleNamespace(
            amount_due=Decimal("0.20"),
            amount_paid=Decimal("0.20"),
            status=DuesStatus.PAID,
        ),
    ]
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    db = AsyncMock()
    db.execute.return_value = result

    summary = await FinanceService(db).get_dues_summary("org")

    assert summary["total_expected"] == Decimal("0.30")
    assert summary["total_collected"] == Decimal("0.30")
    assert summary["total_outstanding"] == Decimal("0.00")
    assert summary["collection_rate"] == 100.0


@pytest.mark.asyncio
async def test_csv_export_preserves_two_decimal_money_strings() -> None:
    paid_at = datetime(2026, 8, 1, tzinfo=timezone.utc)
    purchase = SimpleNamespace(
        paid_at=paid_at,
        request_number="PR-1",
        vendor="Vendor",
        title="Exact decimal",
        actual_amount=Decimal("0.30"),
        estimated_amount=Decimal("0.30"),
    )
    purchases = MagicMock()
    purchases.scalars.return_value = [purchase]
    empty = MagicMock()
    empty.scalars.return_value = []
    db = AsyncMock()
    db.add = MagicMock()
    # Three counts (purchase requests, check requests, expense lines) precede
    # the stream; the stream then pages purchases, then check requests.
    db.scalar.side_effect = [1, 0, 0]
    db.execute.side_effect = [purchases, empty]

    stream = await FinanceService(db).generate_export("org", "user", paid_at, paid_at)
    contents = "".join([chunk async for chunk in stream])
    rows = list(csv.reader(io.StringIO(contents)))

    log = db.add.call_args[0][0]
    assert log.record_count == 1
    assert rows[1][6] == "0.30"
