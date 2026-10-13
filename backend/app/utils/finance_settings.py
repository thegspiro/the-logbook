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
