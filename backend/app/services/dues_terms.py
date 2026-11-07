"""A dues schedule's terms: who it bills, its fiscal year, and its late fee.

Owner decision 2026-11-01 ("Build them"). ``DuesSchedule`` had stored a grace
period, a late fee, a fiscal year and a list of membership types since it was
created, and nothing read any of them (CLAUDE.md pitfall #19). They now apply,
but only to a schedule whose ``terms_effective_at`` is set — every schedule
created or saved since. A schedule from before keeps billing every active
member and charging no fee until somebody saves it, so an upgrade changes
nothing an installation already relies on (pitfall #35).

* **Membership types** — empty or absent bills everyone, as before. Otherwise
  a member is billed when their membership standing is one of the listed
  tiers, judged by ``member_holds_tier``: the same rule an event's
  "mandatory for" list uses, so the two cannot disagree about which rung a
  member stands on (pitfall #29).
* **Fiscal year** — the due date must fall within the year, on the
  department's calendar, and generation refuses a year that is closing or
  locked, the same refusal ``require_year_accepts`` gives a new request.
* **Grace period and late fee** — applied by the daily ``dues_late_fees`` task
  (``apply_late_fees``), not computed on read. On read, every screen, export,
  report and summary that totals ``amount_due`` would each need the rule, and
  the first one that forgot it would show a balance the others did not. A
  stored fee is one number everyone already reads: it is added to
  ``amount_due`` and recorded in ``late_fee_applied``.

Why a second run charges nothing (pitfall #36): the task's UPDATE carries
``late_fee_applied IS NULL`` in its WHERE clause, so the row that one run
charged no longer matches for the next, or for a run racing it — the database
decides, not a read made earlier. The fee is charged once per dues record and
never recomputed: changing the schedule's fee later does not re-price a fee
already charged.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Iterable, Optional
from zoneinfo import ZoneInfo

from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import DuesSchedule, DuesStatus, FiscalYear, MemberDues
from app.utils.membership import member_holds_tier
from app.utils.org_timezone import local_date, stored_calendar_day
from app.utils.sql_results import rows_affected

# The statuses that still owe money. A waived, exempt or paid record is never
# charged a fee.
OWING_STATUSES = (DuesStatus.PENDING, DuesStatus.OVERDUE, DuesStatus.PARTIAL)


def _aware(value: datetime) -> datetime:
    # MySQL hands DateTime(timezone=True) back naive; the column is UTC.
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def terms_apply(schedule: DuesSchedule) -> bool:
    """Whether the schedule's grace period, late fee, fiscal year and
    membership types are in effect (see the module docstring)."""
    return schedule.terms_effective_at is not None


def targeted_types(schedule: DuesSchedule) -> list[str]:
    """The membership types the schedule is limited to; empty means everyone.

    The column is untyped JSON written through the API, so anything that is
    not a list of non-blank strings reads as no limit rather than as a list
    nobody matches — a malformed value must not stop billing everyone.
    """
    stored = schedule.applies_to_membership_types
    if not isinstance(stored, list):
        return []
    return [t.strip() for t in stored if isinstance(t, str) and t.strip()]


def clean_membership_types(value: Optional[Iterable[Any]]) -> Optional[list[str]]:
    """The canonical stored shape: a de-duplicated list of trimmed ids, or
    None for "everyone" (an empty list is stored as None, so there is one
    spelling of no limit)."""
    if value is None:
        return None
    cleaned: list[str] = []
    for item in value:
        text = str(item).strip() if item is not None else ""
        if text and text not in cleaned:
            cleaned.append(text)
    return cleaned or None


def bills_member(schedule: DuesSchedule, member: Any) -> bool:
    """Whether generating ``schedule`` bills ``member``.

    A schedule whose terms are not in effect bills every member it is offered,
    exactly as before the decision.
    """
    if not terms_apply(schedule):
        return True
    types = targeted_types(schedule)
    if not types:
        return True
    return member_holds_tier(member, types)


def late_fee_deadline(due_date: datetime, grace_period_days: Optional[int]) -> datetime:
    """The instant after which unpaid dues are charged the late fee."""
    return _aware(due_date) + timedelta(days=max(int(grace_period_days or 0), 0))


def due_date_outside_year(
    due_date: datetime, year: FiscalYear, tz: ZoneInfo
) -> Optional[str]:
    """Why ``due_date`` cannot belong to ``year``, or None when it can.

    The due date is the department's midnight (the schedule form sends it so),
    so it is read on the department's calendar. A fiscal year's bounds are
    date-only values stored at UTC midnight and read as stored, the way the
    fiscal-year screen shows them; converting them would move 1 January to
    31 December west of Greenwich.
    """
    due_day: date = local_date(due_date, tz)
    start = stored_calendar_day(year.start_date)
    end = stored_calendar_day(year.end_date)
    if start is not None and due_day < start or end is not None and due_day > end:
        return (
            f"The due date ({due_day.isoformat()}) is outside {year.name} "
            f"({start.isoformat() if start else '?'} to "
            f"{end.isoformat() if end else '?'}). Choose a due date within the "
            "fiscal year, or a different fiscal year."
        )
    return None


async def apply_late_fees(db: AsyncSession, now: Optional[datetime] = None) -> int:
    """Charge each overdue dues record its schedule's late fee, once.

    A record is charged when its schedule's terms are in effect and carry a
    positive late fee, it still owes money, and its grace period ended both
    before ``now`` and after the terms took effect — so saving an old schedule
    never charges a fee for a lateness that predates the decision to charge
    one. Returns how many records were charged; commits.
    """
    now = now or datetime.now(timezone.utc)
    candidates = (
        await db.execute(
            select(
                MemberDues.id,
                MemberDues.due_date,
                DuesSchedule.grace_period_days,
                DuesSchedule.late_fee_amount,
                DuesSchedule.terms_effective_at,
            )
            .join(DuesSchedule, DuesSchedule.id == MemberDues.dues_schedule_id)
            .where(
                DuesSchedule.organization_id == MemberDues.organization_id,
                DuesSchedule.terms_effective_at.isnot(None),
                DuesSchedule.late_fee_amount > 0,
                MemberDues.late_fee_applied.is_(None),
                MemberDues.status.in_(OWING_STATUSES),
                MemberDues.amount_paid < MemberDues.amount_due,
                MemberDues.due_date < now,
            )
        )
    ).all()

    charged = 0
    for dues_id, due_date, grace, fee, effective_at in candidates:
        # The query already excludes both; narrowed here for the type checker.
        if effective_at is None or fee is None:
            continue
        deadline = late_fee_deadline(due_date, grace)
        if deadline >= now or deadline < _aware(effective_at):
            continue
        fee = Decimal(fee).quantize(Decimal("0.01"))
        # The guard columns are repeated here rather than trusted from the
        # read above: a payment, a waiver or another run may have landed in
        # between, and this statement is what decides.
        result = await db.execute(
            update(MemberDues)
            .where(
                MemberDues.id == dues_id,
                MemberDues.late_fee_applied.is_(None),
                MemberDues.status.in_(OWING_STATUSES),
                MemberDues.amount_paid < MemberDues.amount_due,
            )
            .values(
                late_fee_applied=fee,
                amount_due=MemberDues.amount_due + fee,
            )
        )
        charged += rows_affected(result) or 0
    await db.commit()
    if charged:
        logger.info("Charged the late fee on {} dues record(s)", charged)
    return charged


async def membership_type_options(db: AsyncSession, org_id: str) -> list[dict]:
    """The membership types a schedule may be limited to: the department's
    membership tiers, in ladder order — the list an event's "mandatory for"
    picker offers, read the same way, so a tier id chosen here is one
    ``member_holds_tier`` recognises."""
    from app.models.user import Organization
    from app.schemas.organization import MembershipTierSettings

    org = await db.get(Organization, org_id)
    tier_settings = MembershipTierSettings.model_validate(
        ((org.settings if org else None) or {}).get("membership_tiers", {})
    )
    return [
        {"id": tier.id, "name": tier.name}
        for tier in sorted(tier_settings.tiers, key=lambda tier: tier.sort_order)
    ]
