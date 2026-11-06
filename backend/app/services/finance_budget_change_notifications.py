"""Email notices when a budget line's money is changed by someone else.

Two notices, owner decisions of 2026-11-01, both **email only**:

=========================  ==========================================  ==================
Notice                     Recipients                                  Email kind
=========================  ==========================================  ==================
Amendment (or reversal)    active ``finance.budget_review`` and        ``FINANCE_DUTIES``
awaiting confirmation      ``finance.manage`` holders -- whoever may
                           confirm it -- not the member who entered it
Leadership changed a       the request's submitter and the active      ``BUDGET_REQUESTS``
request's amount           holders of the position that owns the
                           line, not the reviewer
=========================  ==========================================  ==================

Never SMS (CLAUDE.md pitfall #18): neither is in ``SmsAlert``, and both are
acted on in business hours. No bell entry either; the Finance module has none,
and the pending queue (``/finance/budget-amendments``) and the owner's screen
show the same thing. Both kinds are optional and on by default.

Recipients are resolved inside the department (#14), through the same rules
the gates use: ``user_has_permission`` for who may confirm (wildcards and
legacy aliases count as at the confirm endpoint) and ``finance_budget_ownership``
for who owns a line (#29). A notice that fails to send is logged and dropped;
it never fails the action that caused it.

**Idempotency** (#36). Each send is recorded as an email-channel
``NotificationLog`` row whose metadata names the thing it was about -- the
amendment's id, or the request's id and the time of the review -- and a
member already recorded for it is not sent it again. Entering an amendment
or a review is one transaction with its notice, so a retried request that
enters a *new* amendment rightly sends again; a second call about the *same*
one sends nothing.
"""

from __future__ import annotations

import html
from datetime import datetime, timezone
from decimal import Decimal
from typing import Iterable, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.facilities import Facility
from app.models.finance import (
    Budget,
    BudgetAmendment,
    BudgetAmendmentStatus,
    BudgetCategory,
    BudgetRequest,
)
from app.models.notification import NotificationChannel, NotificationLog
from app.models.user import Organization, User
from app.services.email_policy import EmailKind
from app.services.email_theme import ACCENT_AMBER, ACCENT_BLUE, action, fact, facts
from app.services.finance_budget_request_notifications import (
    OWNER_PATH,
    _active_member,
    _link,
    _paragraphs,
    _send,
    _unique,
    _who_receive,
    long_date,
    money,
    position_holders,
)
from app.services.finance_budget_request_service import (
    FinanceBudgetRequestService,
    _line_label,
)

PENDING_QUEUE_PATH = "/finance/budget-amendments"

AMENDMENT_PENDING_LOG_CATEGORY = "budget_amendment_pending"
LEADERSHIP_CHANGE_LOG_CATEGORY = "budget_request_leadership_change"

# The permissions the confirm endpoint admits (``require_permission`` with
# either). Kept beside the recipients rather than imported: the endpoint
# names them inline, and a test pins the two together.
CONFIRMER_PERMISSIONS = ("finance.budget_review", "finance.manage")


def _instant(value: Optional[datetime]) -> str:
    """A timestamp as an idempotency key, the same before and after a save.

    The column keeps whole seconds and may come back naive, while the value
    the review just set carries microseconds and a zone: compared raw, the
    same review would read as two.
    """
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat()


async def _already_sent(
    db: AsyncSession,
    org_id: str,
    category: str,
    users: Iterable[User],
    key: dict,
) -> set[str]:
    """Members already recorded for this notice, by the metadata ``key``."""
    ids = [str(u.id) for u in users]
    if not ids:
        return set()
    result = await db.execute(
        select(
            NotificationLog.recipient_id, NotificationLog.notification_metadata
        ).where(
            NotificationLog.organization_id == org_id,
            NotificationLog.channel == NotificationChannel.EMAIL,
            NotificationLog.category == category,
            NotificationLog.recipient_id.in_(ids),
        )
    )
    told: set[str] = set()
    for recipient_id, meta in result.all():
        if isinstance(meta, dict) and all(meta.get(k) == v for k, v in key.items()):
            told.add(str(recipient_id))
    return told


def _record(
    db: AsyncSession,
    org_id: str,
    users: list[User],
    *,
    category: str,
    subject: str,
    action_url: str,
    metadata: dict,
) -> None:
    for user in users:
        db.add(
            NotificationLog(
                organization_id=org_id,
                recipient_id=str(user.id),
                recipient_email=user.email,
                channel=NotificationChannel.EMAIL,
                category=category,
                subject=" ".join(subject.split())[:500],
                action_url=action_url,
                delivered=True,
                notification_metadata=dict(metadata),
            )
        )


async def confirmers(db: AsyncSession, org_id: str) -> list[User]:
    """Active members who may confirm an amendment: the confirm gate's holders."""
    from app.api.dependencies import user_has_permission
    from app.services.finance_approver_matching import ApproverDirectory

    members = await ApproverDirectory(db, org_id).active_members()
    return [
        m
        for m in members
        if any(user_has_permission(m, p) for p in CONFIRMER_PERMISSIONS)
    ]


# ============================================
# 1. An amendment awaits confirmation -> whoever may confirm it
# ============================================


async def notify_amendment_pending(
    db: AsyncSession, org_id: str, amendment_id: str, entered_by: Optional[str]
) -> int:
    """Tell the possible confirmers an amendment is waiting. Never raises."""
    try:
        row = (
            await db.execute(
                select(
                    BudgetAmendment,
                    BudgetCategory.name.label("category_name"),
                    Facility.name.label("station_name"),
                )
                .join(
                    Budget,
                    (Budget.id == BudgetAmendment.budget_id)
                    & (Budget.organization_id == org_id),
                )
                .outerjoin(
                    BudgetCategory,
                    (BudgetCategory.id == Budget.category_id)
                    & (BudgetCategory.organization_id == org_id),
                )
                .outerjoin(
                    Facility,
                    (Facility.id == Budget.station_id)
                    & (Facility.organization_id == org_id),
                )
                .where(
                    BudgetAmendment.id == str(amendment_id),
                    BudgetAmendment.organization_id == org_id,
                )
            )
        ).one_or_none()
        if row is None:
            return 0
        amendment: BudgetAmendment = row[0]
        if amendment.status != BudgetAmendmentStatus.PENDING:
            return 0
        org = await db.get(Organization, org_id)
        recipients = _who_receive(
            _unique(await confirmers(db, org_id), exclude=entered_by),
            EmailKind.FINANCE_DUTIES,
            org,
        )
        key = {"amendment_id": str(amendment.id)}
        told = await _already_sent(
            db, org_id, AMENDMENT_PENDING_LOG_CATEGORY, recipients, key
        )
        recipients = [u for u in recipients if str(u.id) not in told]
        if not recipients:
            return 0

        entered = await _active_member(db, org_id, entered_by)
        who = (
            " ".join(p for p in (entered.first_name, entered.last_name) if p)
            if entered is not None
            else ""
        ) or "A finance officer"
        line = _line_label(row.category_name, row.station_name)
        value = Decimal(amendment.amount)
        is_reversal = amendment.reverses_amendment_ref is not None or value < 0
        kind = "reversal" if is_reversal else "amendment"
        signed = f"-{money(-value)}" if value < 0 else f"+{money(value)}"
        effect = (
            f"lowers the line's budget by {money(-value)}"
            if value < 0
            else f"raises the line's budget by {money(value)}"
        )
        link = _link(PENDING_QUEUE_PATH)
        body = (
            f"<p>{html.escape(who)} entered a budget {kind} that needs a second "
            f"officer's confirmation. Once confirmed, it {html.escape(effect)}; "
            "until then it moves nothing.</p>"
            + facts(
                [
                    [fact("Budget line", html.escape(line))],
                    [
                        fact("Amount", html.escape(signed)),
                        fact(
                            "Approved",
                            html.escape(
                                f"{long_date(amendment.approved_on)} by "
                                f"{amendment.approved_by}"
                            ),
                        ),
                    ],
                ]
            )
            + "<p><strong>Reason</strong></p>"
            + _paragraphs(amendment.reason or "")
            + action(html.escape(link), "Review pending amendments")
        )
        text = (
            f"{who} entered a budget {kind} that needs a second officer's "
            f"confirmation. Once confirmed, it {effect}; until then it moves "
            f"nothing.\n\nBudget line: {line}\nAmount: {signed}\n"
            f"Approved: {long_date(amendment.approved_on)} by "
            f"{amendment.approved_by}\n\nReason:\n{amendment.reason or ''}\n\n"
            f"Review pending amendments: {link}\n"
        )
        subject = f"Budget {kind} to confirm: {line} ({signed})"
        sent = await _send(
            db,
            org,
            recipients,
            subject=subject,
            title=f"Budget {kind} to confirm",
            body_html=body,
            text_body=text,
            chip="Budget amendment",
            accent=ACCENT_AMBER,
            template_type="finance_budget_amendment_pending",
        )
        _record(
            db,
            org_id,
            sent,
            category=AMENDMENT_PENDING_LOG_CATEGORY,
            subject=subject,
            action_url=PENDING_QUEUE_PATH,
            metadata=key,
        )
        return len(sent)
    except Exception as exc:
        logger.warning("Budget amendment pending email failed: {}", exc)
        return 0


# ============================================
# 2. Leadership changed a request's amount -> the line's owners
# ============================================


async def notify_leadership_change(
    db: AsyncSession,
    org_id: str,
    request_id: str,
    reviewer_id: str,
    *,
    previous_amount: Optional[Decimal],
) -> int:
    """Tell a line's owners leadership changed their amount. Never raises.

    ``previous_amount`` is what the owner had before this review -- the
    Treasurer's approved amount, or an earlier review's. Saving the same
    amount again changes nothing for the owner and sends nothing.
    """
    try:
        request = (
            await db.execute(
                select(BudgetRequest).where(
                    BudgetRequest.id == str(request_id),
                    BudgetRequest.organization_id == org_id,
                )
            )
        ).scalar_one_or_none()
        if request is None or request.review_amount is None:
            return 0
        new_amount = Decimal(request.review_amount)
        if previous_amount is not None and Decimal(previous_amount) == new_amount:
            return 0
        row = (await FinanceBudgetRequestService(db).describe([request], org_id))[0]
        org = await db.get(Organization, org_id)
        candidates = []
        submitter = await _active_member(db, org_id, request.submitted_by)
        if submitter is not None:
            candidates.append(submitter)
        candidates.extend(
            await position_holders(db, org_id, row.get("owner_position_id"))
        )
        recipients = _who_receive(
            _unique(candidates, exclude=reviewer_id), EmailKind.BUDGET_REQUESTS, org
        )
        reviewed_at = _instant(request.reviewed_at)
        key = {
            "request_id": str(request.id),
            "reviewed_at": reviewed_at,
            "review_amount": str(new_amount),
        }
        told = await _already_sent(
            db, org_id, LEADERSHIP_CHANGE_LOG_CATEGORY, recipients, key
        )
        recipients = [u for u in recipients if str(u.id) not in told]
        if not recipients:
            return 0

        line = row["line_label"]
        year = row.get("fiscal_year_name") or "next year"
        before = money(previous_amount) if previous_amount is not None else None
        after = money(new_amount)
        note = (request.review_note or "").strip()
        link = _link(OWNER_PATH)
        amounts = [fact("Leadership's amount", html.escape(after))]
        if before is not None:
            amounts.insert(0, fact("Your amount was", html.escape(before)))
        body = (
            f"<p>Senior leadership changed the amount for {html.escape(line)} "
            f"in {html.escape(year)} while reviewing next year's budget.</p>"
            + facts([[fact("Budget line", html.escape(line))], amounts])
            + (
                "<p><strong>Leadership's note</strong></p>" + _paragraphs(note)
                if note
                else ""
            )
            + action(html.escape(link), "Open next year's budget")
        )
        text = (
            f"Senior leadership changed the amount for {line} in {year} while "
            "reviewing next year's budget.\n\n"
            + (f"Your amount was: {before}\n" if before is not None else "")
            + f"Leadership's amount: {after}\n"
            + (f"\nLeadership's note:\n{note}\n" if note else "")
            + f"\nOpen next year's budget: {link}\n"
        )
        subject = f"Leadership changed a budget request: {line} ({after})"
        sent = await _send(
            db,
            org,
            recipients,
            subject=subject,
            title="Leadership changed a budget request",
            body_html=body,
            text_body=text,
            chip="Budget request",
            accent=ACCENT_BLUE,
            template_type="finance_budget_request_leadership_change",
        )
        _record(
            db,
            org_id,
            sent,
            category=LEADERSHIP_CHANGE_LOG_CATEGORY,
            subject=subject,
            action_url=OWNER_PATH,
            metadata=key,
        )
        return len(sent)
    except Exception as exc:
        logger.warning("Budget request leadership change email failed: {}", exc)
        return 0
