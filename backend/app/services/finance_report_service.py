"""
Board reports for the finance module.

Three reports a treasurer takes to a board meeting:

* **Budget vs actual** — every budget line in a fiscal year, through a chosen
  date: the budget as it stood then (the original plus the amendments
  confirmed by then), what was spent through that date, and what is left.
* **Amendment log** — every amendment entered against the year's lines, with
  who approved, entered and confirmed it, including pending and rejected ones.
* **Payments register** — every payment made in a period: paid purchase
  requests, issued checks (and the voiding of one) and paid expense reports.

"Spent through a date" is summed from the payments dated on or before it,
using the same amounts that move ``budgets.amount_spent`` when each is paid
(``mark_pr_paid``, ``issue_check``, ``mark_expense_paid``, ``void_check``),
so the budget-vs-actual figure for a period reconciles with the payments
register for the same period. A line's running total cannot answer "as of
September 30" once October's payments are in it. When the report is run for
today, each line also carries that running total and whether it agrees, so a
drift between the two is shown rather than hidden.

Dates are the department's calendar days (``resolve_scheduling_timezone``):
"through September 30" ends at midnight where the department is.
"""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.facilities import Facility
from app.models.finance import (
    AdvanceReturn,
    Budget,
    BudgetAmendment,
    BudgetAmendmentStatus,
    BudgetCategory,
    CheckRequest,
    CheckRequestStatus,
    ExpenseLineItem,
    ExpenseReport,
    ExpenseReportStatus,
    FiscalYear,
    FunctionalClass,
    PurchaseRequest,
    PurchaseRequestStatus,
)
from app.models.user import User
from app.services.expense_substantiation import incurred_day
from app.services.functional_expenses import FunctionalClassifier
from app.services.restricted_funds import fund_balances
from app.utils.member_names import format_display_name
from app.utils.org_timezone import resolve_scheduling_timezone

ZERO = Decimal("0.00")

# The longest period the payments register covers in one run: a fiscal year
# and change. Longer is refused rather than paged, since a board report is
# read whole.
MAX_REGISTER_DAYS = 366


class ReportNotFoundError(Exception):
    """The fiscal year is not the department's (-> 404)."""


@dataclass(frozen=True)
class _Window:
    """A department-calendar date range as UTC instants, end exclusive."""

    start: datetime
    end: datetime


def _day_start(day: date, tz: ZoneInfo) -> datetime:
    return datetime.combine(day, time.min, tzinfo=tz).astimezone(timezone.utc)


def _money(value) -> Decimal:
    return Decimal(value or 0).quantize(Decimal("0.01"))


def _name(first, last, preferred, username) -> str:
    return format_display_name(first, last, preferred) or username or "Unknown"


class FinanceReportService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _year(self, fiscal_year_id: str, org_id: str) -> FiscalYear:
        year = (
            await self.db.execute(
                select(FiscalYear).where(
                    FiscalYear.id == fiscal_year_id,
                    FiscalYear.organization_id == org_id,
                )
            )
        ).scalar_one_or_none()
        if year is None:
            raise ReportNotFoundError("Fiscal year not found")
        return year

    async def _lines(self, fiscal_year_id: str, org_id: str) -> list:
        station = aliased(Facility)
        result = await self.db.execute(
            select(
                Budget.id,
                Budget.amount_budgeted,
                Budget.amount_spent,
                Budget.amount_encumbered,
                BudgetCategory.name.label("category_name"),
                station.name.label("station_name"),
            )
            .join(
                BudgetCategory,
                and_(
                    BudgetCategory.id == Budget.category_id,
                    BudgetCategory.organization_id == org_id,
                ),
            )
            .outerjoin(
                station,
                and_(
                    station.id == Budget.station_id, station.organization_id == org_id
                ),
            )
            .where(
                Budget.organization_id == org_id,
                Budget.fiscal_year_id == fiscal_year_id,
            )
            .order_by(BudgetCategory.name, station.name, Budget.id)
        )
        return list(result.all())

    # ------------------------------------------------------------------
    # Budget vs actual
    # ------------------------------------------------------------------

    async def budget_vs_actual(
        self, org_id: str, fiscal_year_id: str, as_of: Optional[date] = None
    ) -> dict:
        year = await self._year(fiscal_year_id, org_id)
        tz = await resolve_scheduling_timezone(self.db, org_id)
        today = datetime.now(tz).date()
        as_of = as_of or today
        through = _day_start(as_of + timedelta(days=1), tz)
        is_today = as_of == today

        lines = await self._lines(fiscal_year_id, org_id)
        ids = [line.id for line in lines]
        confirmed_total = await self._sum_by_line(
            select(BudgetAmendment.budget_id, func.sum(BudgetAmendment.amount))
            .where(
                BudgetAmendment.organization_id == org_id,
                BudgetAmendment.status == BudgetAmendmentStatus.CONFIRMED,
                BudgetAmendment.budget_id.in_(ids),
            )
            .group_by(BudgetAmendment.budget_id)
        )
        # An amendment confirmed before confirmation was recorded has no
        # decision time; it took effect when it was entered.
        effective = func.coalesce(
            BudgetAmendment.decided_at, BudgetAmendment.created_at
        )
        confirmed_by_then = await self._sum_by_line(
            select(BudgetAmendment.budget_id, func.sum(BudgetAmendment.amount))
            .where(
                BudgetAmendment.organization_id == org_id,
                BudgetAmendment.status == BudgetAmendmentStatus.CONFIRMED,
                BudgetAmendment.budget_id.in_(ids),
                effective < through,
            )
            .group_by(BudgetAmendment.budget_id)
        )
        spent = await self._spent_through(org_id, ids, through)

        rows = []
        totals = {
            "original_budget": ZERO,
            "amendments": ZERO,
            "budget": ZERO,
            "spent": ZERO,
            "committed": ZERO,
            "remaining": ZERO,
        }
        for line in lines:
            original = _money(line.amount_budgeted) - confirmed_total.get(line.id, ZERO)
            amendments = confirmed_by_then.get(line.id, ZERO)
            budget = original + amendments
            line_spent = spent.get(line.id, ZERO)
            # Open commitments are only known now: what was committed on a
            # past date is not recorded.
            committed = _money(line.amount_encumbered) if is_today else None
            remaining = budget - line_spent - (committed or ZERO)
            running = _money(line.amount_spent) if is_today else None
            rows.append(
                {
                    "budget_id": line.id,
                    "category_name": line.category_name,
                    "station_name": line.station_name,
                    "original_budget": original,
                    "amendments": amendments,
                    "budget": budget,
                    "spent": line_spent,
                    "committed": committed,
                    "remaining": remaining,
                    "percent_used": (
                        float((line_spent + (committed or ZERO)) / budget * 100)
                        if budget > 0
                        else None
                    ),
                    "running_spent": running,
                    "running_spent_differs": (
                        running is not None and running != line_spent
                    ),
                }
            )
            totals["original_budget"] += original
            totals["amendments"] += amendments
            totals["budget"] += budget
            totals["spent"] += line_spent
            totals["committed"] += committed or ZERO
            totals["remaining"] += remaining

        return {
            "fiscal_year_id": year.id,
            "fiscal_year_name": year.name,
            "as_of": as_of,
            "includes_committed": is_today,
            "rows": rows,
            "totals": {
                **totals,
                "committed": totals["committed"] if is_today else None,
            },
        }

    async def _sum_by_line(self, statement) -> dict[str, Decimal]:
        return {
            budget_id: _money(total)
            for budget_id, total in (await self.db.execute(statement)).all()
            if budget_id is not None
        }

    async def _spent_through(
        self, org_id: str, budget_ids: list[str], through: datetime
    ) -> dict[str, Decimal]:
        """Payments dated before ``through``, per line, as they moved spent."""
        spent: dict[str, Decimal] = {}
        if not budget_ids:
            return spent

        def add(totals: dict[str, Decimal]) -> None:
            for budget_id, amount in totals.items():
                spent[budget_id] = spent.get(budget_id, ZERO) + amount

        add(
            await self._sum_by_line(
                select(
                    PurchaseRequest.budget_id,
                    func.sum(
                        func.coalesce(
                            PurchaseRequest.actual_amount,
                            PurchaseRequest.estimated_amount,
                        )
                    ),
                )
                .where(
                    PurchaseRequest.organization_id == org_id,
                    PurchaseRequest.status == PurchaseRequestStatus.PAID,
                    PurchaseRequest.budget_id.in_(budget_ids),
                    PurchaseRequest.paid_at < through,
                )
                .group_by(PurchaseRequest.budget_id)
            )
        )
        # A check counts from its date until it is voided.
        add(
            await self._sum_by_line(
                select(CheckRequest.budget_id, func.sum(CheckRequest.amount))
                .where(
                    CheckRequest.organization_id == org_id,
                    CheckRequest.budget_id.in_(budget_ids),
                    CheckRequest.check_date < through,
                    or_(
                        CheckRequest.status == CheckRequestStatus.ISSUED,
                        and_(
                            CheckRequest.status == CheckRequestStatus.VOIDED,
                            CheckRequest.voided_at >= through,
                        ),
                    ),
                )
                .group_by(CheckRequest.budget_id)
            )
        )
        add(
            await self._sum_by_line(
                select(ExpenseLineItem.budget_id, func.sum(ExpenseLineItem.amount))
                .join(
                    ExpenseReport,
                    ExpenseReport.id == ExpenseLineItem.expense_report_id,
                )
                .where(
                    ExpenseReport.organization_id == org_id,
                    ExpenseReport.status == ExpenseReportStatus.PAID,
                    ExpenseLineItem.budget_id.in_(budget_ids),
                    ExpenseReport.paid_at < through,
                )
                .group_by(ExpenseLineItem.budget_id)
            )
        )
        return spent

    # ------------------------------------------------------------------
    # Amendment log
    # ------------------------------------------------------------------

    async def amendment_log(self, org_id: str, fiscal_year_id: str) -> dict:
        year = await self._year(fiscal_year_id, org_id)
        entered_by = aliased(User)
        decided_by = aliased(User)
        station = aliased(Facility)
        result = await self.db.execute(
            select(
                BudgetAmendment,
                BudgetCategory.name.label("category_name"),
                station.name.label("station_name"),
                entered_by.first_name.label("e_first"),
                entered_by.last_name.label("e_last"),
                entered_by.preferred_name.label("e_preferred"),
                entered_by.username.label("e_username"),
                decided_by.first_name.label("d_first"),
                decided_by.last_name.label("d_last"),
                decided_by.preferred_name.label("d_preferred"),
                decided_by.username.label("d_username"),
            )
            .join(
                Budget,
                and_(
                    Budget.id == BudgetAmendment.budget_id,
                    Budget.organization_id == org_id,
                ),
            )
            .join(
                BudgetCategory,
                and_(
                    BudgetCategory.id == Budget.category_id,
                    BudgetCategory.organization_id == org_id,
                ),
            )
            .outerjoin(
                station,
                and_(
                    station.id == Budget.station_id, station.organization_id == org_id
                ),
            )
            .outerjoin(
                entered_by,
                and_(
                    entered_by.id == BudgetAmendment.created_by,
                    entered_by.organization_id == org_id,
                ),
            )
            .outerjoin(
                decided_by,
                and_(
                    decided_by.id == BudgetAmendment.decided_by,
                    decided_by.organization_id == org_id,
                ),
            )
            .where(
                BudgetAmendment.organization_id == org_id,
                Budget.fiscal_year_id == fiscal_year_id,
            )
            .order_by(BudgetAmendment.created_at, BudgetAmendment.id)
        )
        rows = []
        confirmed_net = ZERO
        for row in result.all():
            amendment: BudgetAmendment = row[0]
            status = amendment.status.value
            if amendment.status == BudgetAmendmentStatus.CONFIRMED:
                confirmed_net += _money(amendment.amount)
            rows.append(
                {
                    "amendment_id": amendment.id,
                    "budget_id": amendment.budget_id,
                    "category_name": row.category_name,
                    "station_name": row.station_name,
                    "amount": _money(amendment.amount),
                    "is_reversal": amendment.reverses_amendment_id is not None
                    or amendment.amount < 0,
                    "reason": amendment.reason,
                    "approved_by": amendment.approved_by,
                    "approved_on": amendment.approved_on,
                    "entered_by_name": (
                        _name(row.e_first, row.e_last, row.e_preferred, row.e_username)
                        if amendment.created_by
                        else None
                    ),
                    "entered_at": amendment.created_at,
                    "status": status,
                    "decided_by_name": (
                        _name(row.d_first, row.d_last, row.d_preferred, row.d_username)
                        if amendment.decided_by
                        else None
                    ),
                    "decided_at": amendment.decided_at,
                    "decision_note": amendment.decision_note,
                }
            )
        return {
            "fiscal_year_id": year.id,
            "fiscal_year_name": year.name,
            "rows": rows,
            "confirmed_net": confirmed_net,
        }

    # ------------------------------------------------------------------
    # Payments register
    # ------------------------------------------------------------------

    async def payments_register(self, org_id: str, start: date, end: date) -> dict:
        if end < start:
            raise ValueError("The period's end must be on or after its start.")
        if (end - start).days + 1 > MAX_REGISTER_DAYS:
            raise ValueError(
                f"The payments register covers at most {MAX_REGISTER_DAYS} days; "
                "choose a shorter period."
            )
        tz = await resolve_scheduling_timezone(self.db, org_id)
        window = _Window(_day_start(start, tz), _day_start(end + timedelta(days=1), tz))

        def local_day(value: datetime) -> date:
            aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
            return aware.astimezone(tz).date()

        labels = await self._line_labels(org_id)

        def line_label(budget_id: Optional[str]) -> Optional[str]:
            return labels.get(budget_id) if budget_id else None

        rows: list[dict] = []

        purchases = await self.db.execute(
            select(PurchaseRequest).where(
                PurchaseRequest.organization_id == org_id,
                PurchaseRequest.status == PurchaseRequestStatus.PAID,
                PurchaseRequest.paid_at >= window.start,
                PurchaseRequest.paid_at < window.end,
            )
        )
        for pr in purchases.scalars():
            if pr.paid_at is None:  # excluded by the query; narrows the type
                continue
            rows.append(
                {
                    "paid_on": local_day(pr.paid_at),
                    "kind": "purchase_request",
                    "entity_id": pr.id,
                    "number": pr.request_number,
                    "payee": pr.vendor or "",
                    "description": pr.title,
                    "budget_line": line_label(pr.budget_id),
                    "check_number": None,
                    "amount": _money(pr.actual_amount or pr.estimated_amount),
                }
            )

        checks = await self.db.execute(
            select(CheckRequest).where(
                CheckRequest.organization_id == org_id,
                or_(
                    and_(
                        CheckRequest.status.in_(
                            [CheckRequestStatus.ISSUED, CheckRequestStatus.VOIDED]
                        ),
                        CheckRequest.check_date >= window.start,
                        CheckRequest.check_date < window.end,
                    ),
                    and_(
                        CheckRequest.status == CheckRequestStatus.VOIDED,
                        CheckRequest.voided_at >= window.start,
                        CheckRequest.voided_at < window.end,
                    ),
                ),
            )
        )
        for cr in checks.scalars():
            line = line_label(cr.budget_id)
            if (
                cr.check_date is not None
                and window.start <= _aware(cr.check_date) < window.end
            ):
                rows.append(
                    {
                        "paid_on": local_day(cr.check_date),
                        "kind": "cash_advance" if cr.is_advance else "check_request",
                        "entity_id": cr.id,
                        "number": cr.request_number,
                        "payee": cr.payee_name,
                        "description": cr.memo or cr.purpose or "",
                        "budget_line": line,
                        "check_number": cr.check_number,
                        "amount": _money(cr.amount),
                    }
                )
            if (
                cr.status == CheckRequestStatus.VOIDED
                and cr.voided_at is not None
                and window.start <= _aware(cr.voided_at) < window.end
            ):
                rows.append(
                    {
                        "paid_on": local_day(cr.voided_at),
                        "kind": "check_void",
                        "entity_id": cr.id,
                        "number": cr.request_number,
                        "payee": cr.payee_name,
                        "description": "Check voided",
                        "budget_line": line,
                        "check_number": cr.check_number,
                        "amount": -_money(cr.amount),
                    }
                )

        submitter = aliased(User)
        reports = await self.db.execute(
            select(
                ExpenseReport,
                submitter.first_name,
                submitter.last_name,
                submitter.preferred_name,
                submitter.username,
            )
            .outerjoin(
                submitter,
                and_(
                    submitter.id == ExpenseReport.submitted_by,
                    submitter.organization_id == org_id,
                ),
            )
            .where(
                ExpenseReport.organization_id == org_id,
                ExpenseReport.status == ExpenseReportStatus.PAID,
                ExpenseReport.paid_at >= window.start,
                ExpenseReport.paid_at < window.end,
            )
        )
        report_rows = reports.all()
        line_items = await self._line_items([r[0].id for r in report_rows])
        advance_numbers = await self._request_numbers(
            org_id, [r[0].advance_id for r in report_rows if r[0].advance_applied]
        )
        for er, first, last, preferred, username in report_rows:
            if er.paid_at is None:  # excluded by the query; narrows the type
                continue
            items = line_items.get(er.id, [])
            line_names = sorted(
                {labels[i.budget_id] for i in items if i.budget_id in labels}
            )
            total = _money(sum((i.amount for i in items), ZERO))
            description = er.title
            # The cash advance this report accounts for went out when its
            # check did; only what the member is paid beyond it moves now.
            covered = _money(er.advance_applied) if er.advance_id else ZERO
            if covered:
                number = advance_numbers.get(er.advance_id or "", "")
                description = f"{er.title} ({covered:,.2f} from advance {number})"
            rows.append(
                {
                    "paid_on": local_day(er.paid_at),
                    "kind": "expense_report",
                    "entity_id": er.id,
                    "number": er.report_number,
                    "payee": _name(first, last, preferred, username),
                    "description": description,
                    "budget_line": ", ".join(line_names) or None,
                    "check_number": None,
                    "amount": total - covered,
                }
            )

        returns = await self.db.execute(
            select(AdvanceReturn, CheckRequest.request_number, CheckRequest.payee_name)
            .join(
                CheckRequest,
                and_(
                    CheckRequest.id == AdvanceReturn.advance_id,
                    CheckRequest.organization_id == org_id,
                ),
            )
            .where(
                AdvanceReturn.organization_id == org_id,
                AdvanceReturn.returned_at >= window.start,
                AdvanceReturn.returned_at < window.end,
            )
        )
        for entry, number, payee_name in returns.all():
            rows.append(
                {
                    "paid_on": local_day(entry.returned_at),
                    "kind": "advance_return",
                    "entity_id": entry.id,
                    "number": number,
                    "payee": payee_name,
                    "description": "Unspent advance returned",
                    "budget_line": None,
                    "check_number": None,
                    "amount": -_money(entry.amount),
                }
            )

        rows.sort(key=lambda r: (r["paid_on"], r["number"], r["kind"]))
        return {
            "start": start,
            "end": end,
            "rows": rows,
            "total": sum((r["amount"] for r in rows), ZERO),
        }

    # ------------------------------------------------------------------
    # Outside the accountable plan
    # ------------------------------------------------------------------

    async def late_substantiation(self, org_id: str, start: date, end: date) -> dict:
        """Reimbursements paid in the period for lines submitted too late.

        A line submitted after the department's substantiation deadline was
        reimbursed outside the accountable plan, so the department may have to
        treat it as wages. One row per such line on an expense report paid in
        the period, for the treasurer to hand to whoever runs payroll.
        """
        if end < start:
            raise ValueError("The period's end must be on or after its start.")
        if (end - start).days + 1 > MAX_REGISTER_DAYS:
            raise ValueError(
                f"This report covers at most {MAX_REGISTER_DAYS} days; "
                "choose a shorter period."
            )
        tz = await resolve_scheduling_timezone(self.db, org_id)
        window = _Window(_day_start(start, tz), _day_start(end + timedelta(days=1), tz))
        labels = await self._line_labels(org_id)

        submitter = aliased(User)
        acknowledger = aliased(User)
        result = await self.db.execute(
            select(
                ExpenseReport,
                ExpenseLineItem,
                submitter.first_name,
                submitter.last_name,
                submitter.preferred_name,
                submitter.username,
                acknowledger.first_name,
                acknowledger.last_name,
                acknowledger.preferred_name,
                acknowledger.username,
            )
            .join(
                ExpenseLineItem,
                and_(
                    ExpenseLineItem.expense_report_id == ExpenseReport.id,
                    ExpenseLineItem.substantiated_late.is_(True),
                ),
            )
            .outerjoin(
                submitter,
                and_(
                    submitter.id == ExpenseReport.submitted_by,
                    submitter.organization_id == org_id,
                ),
            )
            .outerjoin(
                acknowledger,
                and_(
                    acknowledger.id == ExpenseReport.late_acknowledged_by,
                    acknowledger.organization_id == org_id,
                ),
            )
            .where(
                ExpenseReport.organization_id == org_id,
                ExpenseReport.status == ExpenseReportStatus.PAID,
                ExpenseReport.paid_at >= window.start,
                ExpenseReport.paid_at < window.end,
            )
        )

        rows: list[dict[str, Any]] = []
        for er, item, *names in result.all():
            if er.paid_at is None:  # excluded by the query; narrows the type
                continue
            incurred = incurred_day(item.date_incurred)
            submitted = (
                _aware(er.submitted_at).astimezone(tz).date()
                if er.submitted_at is not None
                else None
            )
            rows.append(
                {
                    "paid_on": _aware(er.paid_at).astimezone(tz).date(),
                    "report_id": er.id,
                    "report_number": er.report_number,
                    "member_name": _name(*names[:4]),
                    "description": item.description,
                    "budget_line": (
                        labels.get(item.budget_id) if item.budget_id else None
                    ),
                    "incurred_on": incurred,
                    "submitted_on": submitted,
                    "days_to_submit": (
                        (submitted - incurred).days if submitted is not None else None
                    ),
                    "amount": _money(item.amount),
                    "acknowledged_by_name": (
                        _name(*names[4:]) if er.late_acknowledged_by else None
                    ),
                }
            )
        rows.sort(key=lambda r: (r["paid_on"], r["report_number"], r["incurred_on"]))
        return {
            "start": start,
            "end": end,
            "rows": rows,
            "total": sum((r["amount"] for r in rows), ZERO),
        }

    # ------------------------------------------------------------------
    # Functional expenses
    # ------------------------------------------------------------------

    async def functional_expenses(self, org_id: str, start: date, end: date) -> dict:
        """Payments in the period by function, then by budget category.

        The same payments as the payments register for the period — paid
        purchase requests, issued checks less the checks voided in it, and
        paid expense reports line by line — so the two total alike, except
        for cash advances. An advance is not an expense: it is money the
        member owes back until a report accounts for it, so its check and any
        cash returned are left out here, and the report's lines are counted
        whole when it is paid. The two then differ by the advances paid in the
        period and not yet accounted for. Each payment is classified by
        ``FunctionalClassifier``; one with no class is reported as
        unclassified, and one with no budget line under no category.
        """
        if end < start:
            raise ValueError("The period's end must be on or after its start.")
        if (end - start).days + 1 > MAX_REGISTER_DAYS:
            raise ValueError(
                f"This report covers at most {MAX_REGISTER_DAYS} days; "
                "choose a shorter period."
            )
        tz = await resolve_scheduling_timezone(self.db, org_id)
        window = _Window(_day_start(start, tz), _day_start(end + timedelta(days=1), tz))
        classifier = await FunctionalClassifier.load(self.db, org_id)

        sums: dict[tuple[Optional[str], Optional[str]], Decimal] = {}

        def add(override, budget_id: Optional[str], amount) -> None:
            fc = classifier.resolve(override, budget_id)
            key = (fc.value if fc else None, classifier.category_of(budget_id))
            sums[key] = sums.get(key, ZERO) + _money(amount)

        purchases = await self.db.execute(
            select(
                PurchaseRequest.functional_class,
                PurchaseRequest.budget_id,
                func.coalesce(
                    PurchaseRequest.actual_amount, PurchaseRequest.estimated_amount
                ),
            ).where(
                PurchaseRequest.organization_id == org_id,
                PurchaseRequest.status == PurchaseRequestStatus.PAID,
                PurchaseRequest.paid_at >= window.start,
                PurchaseRequest.paid_at < window.end,
            )
        )
        for override, budget_id, amount in purchases.all():
            add(override, budget_id, amount)

        checks = await self.db.execute(
            select(CheckRequest).where(
                CheckRequest.organization_id == org_id,
                or_(
                    and_(
                        CheckRequest.status.in_(
                            [CheckRequestStatus.ISSUED, CheckRequestStatus.VOIDED]
                        ),
                        CheckRequest.check_date >= window.start,
                        CheckRequest.check_date < window.end,
                    ),
                    and_(
                        CheckRequest.status == CheckRequestStatus.VOIDED,
                        CheckRequest.voided_at >= window.start,
                        CheckRequest.voided_at < window.end,
                    ),
                ),
            )
        )
        for cr in checks.scalars():
            if cr.is_advance:
                continue
            if (
                cr.check_date is not None
                and window.start <= _aware(cr.check_date) < window.end
            ):
                add(cr.functional_class, cr.budget_id, cr.amount)
            if (
                cr.status == CheckRequestStatus.VOIDED
                and cr.voided_at is not None
                and window.start <= _aware(cr.voided_at) < window.end
            ):
                add(cr.functional_class, cr.budget_id, -_money(cr.amount))

        lines = await self.db.execute(
            select(
                ExpenseLineItem.functional_class,
                ExpenseLineItem.budget_id,
                ExpenseLineItem.amount,
            )
            .join(ExpenseReport, ExpenseReport.id == ExpenseLineItem.expense_report_id)
            .where(
                ExpenseReport.organization_id == org_id,
                ExpenseReport.status == ExpenseReportStatus.PAID,
                ExpenseReport.paid_at >= window.start,
                ExpenseReport.paid_at < window.end,
            )
        )
        for override, budget_id, amount in lines.all():
            add(override, budget_id, amount)

        classes: list[dict[str, Any]] = []
        for fc_value in [fc.value for fc in FunctionalClass] + [None]:
            categories: list[dict[str, Any]] = [
                {
                    "category_id": category_id,
                    "category_name": classifier.category_name(category_id),
                    "amount": amount,
                }
                for (key, category_id), amount in sums.items()
                if key == fc_value
            ]
            if not categories and fc_value is None:
                continue
            categories.sort(
                key=lambda c: (c["category_name"] is None, c["category_name"] or "")
            )
            classes.append(
                {
                    "functional_class": fc_value,
                    "categories": categories,
                    "total": sum((c["amount"] for c in categories), ZERO),
                }
            )
        return {
            "start": start,
            "end": end,
            "classes": classes,
            "total": sum((c["total"] for c in classes), ZERO),
        }

    # ------------------------------------------------------------------
    # Restricted fund balances
    # ------------------------------------------------------------------

    async def fund_balances(self, org_id: str) -> dict:
        """Every restricted fund's balance today, by name, and their totals.

        A fund is a fundraising campaign marked restricted; a deleted one is
        still listed, since what was charged to it still has to be accounted
        for (app/services/restricted_funds.py)."""
        balances = sorted(
            (await fund_balances(self.db, org_id)).values(),
            key=lambda f: (f.name.lower(), f.campaign_id),
        )
        funds = [
            {
                "campaign_id": f.campaign_id,
                "name": f.name,
                "purpose": f.purpose,
                "active": f.active,
                "received": f.received,
                "spent": f.spent,
                "committed": f.committed,
                "awaiting_approval": f.awaiting_approval,
                "available": f.available,
            }
            for f in balances
        ]
        totals = {
            key: sum((getattr(f, key) for f in balances), ZERO)
            for key in (
                "received",
                "spent",
                "committed",
                "awaiting_approval",
                "available",
            )
        }
        return {"funds": funds, **totals}

    async def _line_labels(self, org_id: str) -> dict[str, str]:
        station = aliased(Facility)
        result = await self.db.execute(
            select(
                Budget.id,
                BudgetCategory.name,
                station.name,
                FiscalYear.name,
            )
            .join(
                BudgetCategory,
                and_(
                    BudgetCategory.id == Budget.category_id,
                    BudgetCategory.organization_id == org_id,
                ),
            )
            .join(
                FiscalYear,
                and_(
                    FiscalYear.id == Budget.fiscal_year_id,
                    FiscalYear.organization_id == org_id,
                ),
            )
            .outerjoin(
                station,
                and_(
                    station.id == Budget.station_id, station.organization_id == org_id
                ),
            )
            .where(Budget.organization_id == org_id)
        )
        labels = {}
        for budget_id, category, station_name, year_name in result.all():
            label = f"{category} ({station_name})" if station_name else category
            labels[budget_id] = f"{label}, {year_name}"
        return labels

    async def _request_numbers(
        self, org_id: str, check_ids: list[Optional[str]]
    ) -> dict[str, str]:
        wanted = sorted({i for i in check_ids if i})
        if not wanted:
            return {}
        result = await self.db.execute(
            select(CheckRequest.id, CheckRequest.request_number).where(
                CheckRequest.organization_id == org_id,
                CheckRequest.id.in_(wanted),
            )
        )
        return {cid: number for cid, number in result.all()}

    async def _line_items(self, report_ids: list[str]) -> dict[str, list]:
        if not report_ids:
            return {}
        result = await self.db.execute(
            select(ExpenseLineItem).where(
                ExpenseLineItem.expense_report_id.in_(report_ids)
            )
        )
        items: dict[str, list] = {}
        for item in result.scalars():
            items.setdefault(item.expense_report_id, []).append(item)
        return items


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
