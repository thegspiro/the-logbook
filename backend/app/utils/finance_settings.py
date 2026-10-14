"""
Per-department finance rules.

Stored in the organization settings as the ``finance`` section and written
through ``PATCH /organization/settings`` (``settings.manage``), never by a
``finance.manage`` holder alone. The threshold below is a separation-of-duties
control on the finance officers themselves, so the person it binds must not be
the only one able to lift it — the rule ``admin_hours_settings`` follows for
self-approval.

Pitfall #19: this module is the reader. ``FinanceService`` consults it whenever
an approval would complete a request, and ``GET /finance/settings`` reports
what it resolved, so the screen shows the server's reading rather than a copy
of these defaults.

``dual_approval_threshold``
    Whole dollars. A purchase request, check request or expense report of this
    amount or more is approved only once two different people have approved
    it. Absent, ``null``, zero, negative or malformed reads as off: the rule is
    one a department turns on, and an exception here would stop every approval
    over one mistyped setting (Pitfall #19, "read free-form JSON
    defensively").

``substantiation_mode`` and ``substantiation_days``
    The accountable-plan deadline for expense reports: a line submitted more
    than ``substantiation_days`` after it was incurred is late. The mode is
    ``off`` (nothing is checked; the default), ``warn`` (the report goes
    through, and an approver must confirm reviewing the late lines before it
    can be approved) or ``block`` (the report cannot be submitted). Days run
    from 1 to 60, defaulting to 60: the IRS safe harbor for "a reasonable
    time" is 60 days, so a department may be stricter but not looser. Anything
    unreadable falls back to the default rather than raising.

``fund_overspend_mode``
    What happens when a payment charged to a restricted fund (a fundraising
    campaign marked restricted; ``app/services/restricted_funds.py``) is more
    than the fund has left. ``warn`` (the default) flags it to the requester
    and the approvers and lets the approval through; ``block`` refuses the
    approval, and a purchase paid for more than its estimate; ``off`` checks
    nothing. Warn is the default because nothing is charged to a fund until
    someone chooses one, so no existing request changes, and a restricted gift
    spent past what was given is a breach of the donor's terms a department
    should hear about without first finding the setting.

``qb_dues_income_account`` and ``qb_dues_deposit_account``
    The QuickBooks accounts a dues payment posts to when its schedule names
    none: the income account credited and the bank account debited. Unlike the
    rules above these are bookkeeping, not a control, so the finance office
    sets them (``PUT /finance/export/dues-accounts``, ``finance.manage``) beside
    the rest of the QuickBooks accounts. Absent or blank is no default.

``qb_advances_account`` and ``qb_advances_cash_account``
    Where cash advances post (``app/services/cash_advances.py``): the asset
    account an advance is owed to the department on until it is accounted
    for, and the bank account it is paid from and returned to. Set the same
    way as the dues accounts (``PUT /finance/export/advance-accounts``). An
    export carrying an advance, a report that settles one or a return is
    refused while either is blank.
"""

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Organization

FINANCE_SETTINGS_KEY = "finance"
DUAL_APPROVAL_THRESHOLD_KEY = "dual_approval_threshold"
SUBSTANTIATION_MODE_KEY = "substantiation_mode"
SUBSTANTIATION_DAYS_KEY = "substantiation_days"

SUBSTANTIATION_OFF = "off"
SUBSTANTIATION_WARN = "warn"
SUBSTANTIATION_BLOCK = "block"
SUBSTANTIATION_MODES = (SUBSTANTIATION_OFF, SUBSTANTIATION_WARN, SUBSTANTIATION_BLOCK)
FUND_OVERSPEND_MODE_KEY = "fund_overspend_mode"
FUND_OVERSPEND_OFF = "off"
FUND_OVERSPEND_WARN = "warn"
FUND_OVERSPEND_BLOCK = "block"
FUND_OVERSPEND_MODES = (FUND_OVERSPEND_OFF, FUND_OVERSPEND_WARN, FUND_OVERSPEND_BLOCK)

QB_DUES_INCOME_KEY = "qb_dues_income_account"
QB_DUES_DEPOSIT_KEY = "qb_dues_deposit_account"
QB_ADVANCES_KEY = "qb_advances_account"
QB_ADVANCES_CASH_KEY = "qb_advances_cash_account"

# The IRS safe harbor for substantiating an expense "within a reasonable time"
# under an accountable plan (Treas. Reg. 1.62-2(g)(2)).
MAX_SUBSTANTIATION_DAYS = 60

# The largest amount a request column holds (Numeric(12, 2)); a threshold above
# it could never be reached.
MAX_DUAL_APPROVAL_THRESHOLD = 9_999_999_999


@dataclass(frozen=True)
class FinanceSettings:
    dual_approval_threshold: Optional[Decimal]
    substantiation_mode: str = SUBSTANTIATION_OFF
    substantiation_days: int = MAX_SUBSTANTIATION_DAYS
    fund_overspend_mode: str = FUND_OVERSPEND_WARN


def finance_settings_in(settings: Any) -> FinanceSettings:
    """Resolve the finance rules out of an organization's settings JSON."""
    section = settings.get(FINANCE_SETTINGS_KEY) if isinstance(settings, dict) else None
    if not isinstance(section, dict):
        section = {}

    raw = section.get(DUAL_APPROVAL_THRESHOLD_KEY)
    threshold: Optional[Decimal] = None
    # bool is an int subclass; a stray ``true`` must not read as $1.
    if (
        isinstance(raw, int)
        and not isinstance(raw, bool)
        and 0 < raw <= MAX_DUAL_APPROVAL_THRESHOLD
    ):
        threshold = Decimal(raw)

    mode = section.get(SUBSTANTIATION_MODE_KEY)
    if mode not in SUBSTANTIATION_MODES:
        mode = SUBSTANTIATION_OFF
    days = section.get(SUBSTANTIATION_DAYS_KEY)
    if not (
        isinstance(days, int)
        and not isinstance(days, bool)
        and 1 <= days <= MAX_SUBSTANTIATION_DAYS
    ):
        days = MAX_SUBSTANTIATION_DAYS
    fund_mode = section.get(FUND_OVERSPEND_MODE_KEY)
    if fund_mode not in FUND_OVERSPEND_MODES:
        fund_mode = FUND_OVERSPEND_WARN
    return FinanceSettings(
        dual_approval_threshold=threshold,
        substantiation_mode=mode,
        substantiation_days=days,
        fund_overspend_mode=fund_mode,
    )


async def load_finance_settings(
    db: AsyncSession, organization_id: str
) -> FinanceSettings:
    result = await db.execute(
        select(Organization.settings).where(Organization.id == str(organization_id))
    )
    return finance_settings_in(result.scalar_one_or_none())


def _qb_accounts(settings: Any, *keys: str) -> tuple[str, ...]:
    section = settings.get(FINANCE_SETTINGS_KEY) if isinstance(settings, dict) else None
    if not isinstance(section, dict):
        return tuple("" for _ in keys)

    def read(key: str) -> str:
        value = section.get(key)
        return value.strip() if isinstance(value, str) else ""

    return tuple(read(key) for key in keys)


def dues_default_accounts(settings: Any) -> tuple[str, str]:
    """The department's default ``(income, deposit)`` QuickBooks accounts for
    dues, blank where unset."""
    income, deposit = _qb_accounts(settings, QB_DUES_INCOME_KEY, QB_DUES_DEPOSIT_KEY)
    return income, deposit


def advance_accounts(settings: Any) -> tuple[str, str]:
    """The department's ``(advances, cash)`` QuickBooks accounts for cash
    advances, blank where unset."""
    advances, cash = _qb_accounts(settings, QB_ADVANCES_KEY, QB_ADVANCES_CASH_KEY)
    return advances, cash
