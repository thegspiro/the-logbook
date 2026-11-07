"""What a member sees of their own dues, and who recorded each dues payment.

Owner decisions of 2026-11-01: "My dues view" — a member reads their own dues
(owed, paid, due dates, late fees) without any finance permission, the way
Finance › My Budgets answers only about the caller; and "Show the name" — the
payment history names who recorded each payment.

The status and the late fee a member is shown come from the same rules the
Treasurer's screen and the late-fee task use (``effective_dues_status``,
``late_fee_deadline``), so the two screens cannot disagree about one record
(CLAUDE.md pitfall #29).
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.finance import DuesPayment, DuesSchedule, DuesStatus, MemberDues
from app.models.user import User
from app.services.dues_terms import OWING_STATUSES, late_fee_deadline, terms_apply
from app.utils.member_names import format_display_name

# A member's dues are a handful of records a year; this bounds a pathological
# account rather than paging a real one.
MAX_ROWS = 200


async def recorder_names(
    db: AsyncSession, org_id: str, payments: Iterable[DuesPayment]
) -> dict[str, Optional[str]]:
    """The display name of whoever recorded each payment, by user id.

    Confined to the organization; a recorder whose account is gone (the
    column is SET NULL) has no entry and reads as unnamed.
    """
    ids = {str(p.recorded_by) for p in payments if p.recorded_by}
    if not ids:
        return {}
    rows = await db.execute(
        select(
            User.id,
            User.first_name,
            User.last_name,
            User.preferred_name,
            User.username,
        ).where(User.organization_id == org_id, User.id.in_(ids))
    )
    return {
        str(user_id): format_display_name(first, last, preferred) or username or None
        for user_id, first, last, preferred, username in rows.all()
    }


async def list_my_dues(db: AsyncSession, org_id: str, user_id: str) -> list[dict]:
    """The caller's dues records, newest due date first, with their payments."""
    from app.services.finance_service import effective_dues_status

    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(MemberDues, DuesSchedule)
        .join(DuesSchedule, DuesSchedule.id == MemberDues.dues_schedule_id)
        .options(selectinload(MemberDues.payments))
        .where(
            MemberDues.organization_id == org_id,
            DuesSchedule.organization_id == org_id,
            MemberDues.user_id == user_id,
        )
        .order_by(MemberDues.due_date.desc(), MemberDues.id)
        .limit(MAX_ROWS)
    )
    rows = []
    for dues, schedule in result.all():
        status = effective_dues_status(
            dues.status, dues.due_date, dues.amount_paid, dues.amount_due, now
        )
        owing = status in OWING_STATUSES
        balance = (
            max(dues.amount_due - dues.amount_paid, Decimal("0"))
            if owing
            else Decimal("0")
        )
        # A fee not yet charged, and from when it will be: only while the
        # schedule's terms are in effect and the dues still owe money.
        pending_fee = None
        fee_after = None
        if (
            owing
            and balance > 0
            and dues.late_fee_applied is None
            and terms_apply(schedule)
            and schedule.late_fee_amount
            and Decimal(schedule.late_fee_amount) > 0
        ):
            pending_fee = schedule.late_fee_amount
            fee_after = late_fee_deadline(dues.due_date, schedule.grace_period_days)
        rows.append(
            {
                "id": dues.id,
                "schedule_name": schedule.name,
                "amount_due": dues.amount_due,
                "amount_paid": dues.amount_paid,
                "balance": balance,
                "status": status,
                "due_date": dues.due_date,
                "paid_date": dues.paid_date,
                "late_fee_applied": dues.late_fee_applied,
                "late_fee_amount": pending_fee,
                "late_fee_after": fee_after,
                "waive_reason": (
                    dues.waive_reason if status == DuesStatus.WAIVED else None
                ),
                "payments": [
                    {
                        "id": p.id,
                        "amount": p.amount,
                        "payment_method": p.payment_method,
                        "received_at": p.received_at,
                    }
                    for p in dues.payments
                ],
            }
        )
    return rows
