"""
Grant overspend, measured and warned about but never blocked (GF-7).

Owner decision: a grant gets a lifecycle, and spending past what was awarded
or budgeted raises a warning rather than refusing the expenditure. Money
already went out the door when an expenditure is recorded; refusing to record
it would only make the books disagree with the bank.

One definition, read by the application response (``overspent_by`` on the
grant and on each budget line) and by the expenditure endpoints (the warnings
returned with the write), so the banner on the grant and the message after a
write always agree.
"""

from decimal import Decimal
from typing import Any, Iterable, Optional


def _money(value: Any) -> Decimal:
    return Decimal(str(value or 0))


def total_expended(expenditures: Iterable[Any]) -> Decimal:
    return sum((_money(e.amount) for e in expenditures), Decimal("0"))


def application_overspend(
    amount_awarded: Any, expenditures: Iterable[Any]
) -> Optional[Decimal]:
    """How far spending exceeds the award, or None when it does not (or
    nothing has been awarded yet to compare against)."""
    if amount_awarded is None:
        return None
    over = total_expended(expenditures) - _money(amount_awarded)
    return over if over > 0 else None


def budget_item_overspend(amount_budgeted: Any, amount_spent: Any) -> Optional[Decimal]:
    over = _money(amount_spent) - _money(amount_budgeted)
    return over if over > 0 else None


def spending_warnings(
    application: Any, budget_item_id: Optional[str] = None
) -> list[str]:
    """Plain-language warnings for an application whose spending is over.

    ``budget_item_id`` narrows the line-level warning to the line a write just
    touched; the grant-level warning is always included when it applies.
    """
    warnings: list[str] = []
    over = application_overspend(application.amount_awarded, application.expenditures)
    if over is not None:
        warnings.append(
            f"Spending on this grant is now ${over:,.2f} over the "
            f"${_money(application.amount_awarded):,.2f} awarded."
        )
    for item in application.budget_items:
        if budget_item_id is not None and str(item.id) != str(budget_item_id):
            continue
        line_over = budget_item_overspend(item.amount_budgeted, item.amount_spent)
        if line_over is not None:
            warnings.append(
                f"Budget line “{item.description}” is ${line_over:,.2f} "
                f"over its ${_money(item.amount_budgeted):,.2f} budget."
            )
    return warnings
