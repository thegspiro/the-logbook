"""Email notices for purchase requests, expense reports and check requests.

Owner decision 2026-11-01 ("email approvers and requesters"): two notices,
both **email only**:

=====================  ============================================  ==================
Notice                 Recipients                                    Email kind
=====================  ============================================  ==================
A step reaches you     the active members the step names             ``FINANCE_DUTIES``
                       (``user_matches_step``), not the requester
Decision made          the requester, unless they decided it         ``FINANCE_REQUESTS``
                       themselves (a withdrawal)
=====================  ============================================  ==================

Never SMS: neither is in ``SmsAlert`` (CLAUDE.md pitfall #18) — a request
waits days for an approver, not minutes. No bell entry either; the Finance
module has none. Both kinds are optional and on by default (``email_policy``).

Who a step names is ``finance_approver_matching``'s answer, the same rule
approve / deny enforce (pitfall #29), so the email goes to exactly the people
who can act on the step. An emailed-link step (approver type ``email``) is not
covered here: its approval link is its notice, sent by
``FinanceService.send_approval_request_email``.

**When they are sent.** ``FinanceService`` queues an :class:`ApprovalNotice`
while it changes the request, and the endpoint sends the queue only after the
transaction commits (:func:`send_approval_notices`). Sent from inside the
transaction, a notice could announce a step or a decision that a later
failure — the fund-balance check, the budget limit — rolled back. The cost of
that order is at most once: a crash between the commit and the send loses the
email, and the request's page, the approvals queue and the requester's list
still show it (pitfall #36).

**Why a retry sends nothing twice.** A decision notice is queued only by the
call that moves the request out of pending approval, under the request's row
lock; a retried approve or deny is refused before it reaches that point. A
step notice is queued only for a step whose ``approvers_notified_at`` is
empty, and the queueing stamps it in the same transaction, so a later advance
— a sibling step's approval, a retried submit — finds it stamped.
"""

from __future__ import annotations

import html
from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.finance import (
    ApprovalChain,
    ApprovalEntityType,
    ApprovalStepRecord,
    ApprovalStepStatus,
)
from app.models.user import Organization, User
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
)
from app.services.email_theme import (
    ACCENT_AMBER,
    ACCENT_BLUE,
    ACCENT_GREEN,
    action,
    fact,
    facts,
)
from app.services.finance_approver_matching import (
    ApproverDirectory,
    user_matches_step,
)

STEP_REACHED = "step_reached"
DECIDED = "decided"
# A request held for its second approval (finance_second_approval).
SECOND_APPROVAL = "second_approval"
APPROVED = "approved"
DENIED = "denied"

# The request's own page: it shows the step, and Approve / Deny to whoever
# the step names, so the email needs no link of its own to act through.
DETAIL_PATHS = {
    ApprovalEntityType.PURCHASE_REQUEST: "/finance/purchase-requests/{}",
    ApprovalEntityType.EXPENSE_REPORT: "/finance/expenses/{}",
    ApprovalEntityType.CHECK_REQUEST: "/finance/check-requests/{}",
}

_NOUNS = {
    ApprovalEntityType.PURCHASE_REQUEST: "purchase request",
    ApprovalEntityType.EXPENSE_REPORT: "expense report",
    ApprovalEntityType.CHECK_REQUEST: "check request",
}


@dataclass(frozen=True)
class ApprovalNotice:
    """One notice, queued by the service and sent after the commit."""

    kind: str
    org_id: str
    entity_type: ApprovalEntityType
    entity_id: str
    step_record_id: Optional[str] = None
    outcome: Optional[str] = None
    actor_id: Optional[str] = None
    reason: Optional[str] = None


def _money(value) -> str:
    return f"${Decimal(value or 0).quantize(Decimal('0.01')):,.2f}"


def _subject_safe(text: str) -> str:
    # A subject is a header: a line break in a title would end it.
    return " ".join((text or "").split())


def _link(entity_type: ApprovalEntityType, entity_id: str) -> str:
    path = DETAIL_PATHS[entity_type].format(entity_id)
    return f"{settings.FRONTEND_URL.rstrip('/')}{path}"


def _who_receive(
    users: Iterable[User], kind: EmailKind, org: Optional[Organization]
) -> list[User]:
    required = department_required_kinds(org)
    return [
        u
        for u in users
        if u.email and member_receives_email(u.notification_preferences, kind, required)
    ]


async def _send(
    org: Optional[Organization],
    users: list[User],
    *,
    db: AsyncSession,
    subject: str,
    title: str,
    body_html: str,
    text_body: str,
    chip: str,
    accent: str,
    template_type: str,
) -> int:
    if not users:
        return 0
    from app.services.email_service import EmailService, wrap_email_body

    sent, _failed = await EmailService(organization=org).send_email(
        to_emails=[u.email for u in users],
        subject=_subject_safe(subject),
        html_body=wrap_email_body(
            org, title, body_html, header_color=accent, chip=chip
        ),
        text_body=text_body,
        db=db,
        template_type=template_type,
    )
    return int(sent)


async def _subject_row(
    db: AsyncSession, notice: ApprovalNotice
) -> tuple[Optional[dict], Optional[str]]:
    """The request's title, amount and requester name, and the requester id."""
    from app.services.finance_service import FinanceService

    service = FinanceService(db)
    subject = await service.approval_subject(
        notice.entity_type, notice.entity_id, notice.org_id
    )
    requester_id = await service._entity_creator_id(
        notice.entity_type, notice.entity_id, notice.org_id
    )
    return subject, requester_id


def _facts(subject: dict, step_name: Optional[str] = None) -> str:
    rows = [[fact("Request", html.escape(str(subject["title"] or "")))]]
    second = [fact("Amount", html.escape(_money(subject["amount"])))]
    if subject.get("requester_name"):
        second.append(fact("Requested by", html.escape(subject["requester_name"])))
    rows.append(second)
    if step_name:
        rows.append([fact("Step", html.escape(step_name))])
    return facts(rows)


async def _notify_step_reached(db: AsyncSession, notice: ApprovalNotice) -> int:
    result = await db.execute(
        select(ApprovalStepRecord)
        .join(ApprovalChain, ApprovalChain.id == ApprovalStepRecord.chain_id)
        .options(selectinload(ApprovalStepRecord.step))
        .where(
            ApprovalStepRecord.id == notice.step_record_id,
            ApprovalChain.organization_id == notice.org_id,
        )
    )
    record = result.scalar_one_or_none()
    # Acted on, or the request withdrawn, between the commit and now: the
    # step no longer waits on anyone, so telling them it does is wrong.
    if record is None or record.step is None:
        return 0
    if record.status != ApprovalStepStatus.PENDING:
        return 0
    subject, requester_id = await _subject_row(db, notice)
    if subject is None:
        return 0
    org = await db.get(Organization, notice.org_id)
    members = await ApproverDirectory(db, notice.org_id).active_members()
    named = [
        m
        for m in members
        if str(m.id) != str(requester_id or "")
        and await user_matches_step(db, m, record.step, notice.org_id)
    ]
    recipients = _who_receive(named, EmailKind.FINANCE_DUTIES, org)
    if not recipients:
        return 0
    noun = _NOUNS[notice.entity_type]
    link = _link(notice.entity_type, notice.entity_id)
    step_name = record.step.name or "Approval"
    title = str(subject["title"] or "")
    body = (
        f"<p>A {noun} is waiting for your approval.</p>"
        + _facts(subject, step_name)
        + action(html.escape(link), "Review and decide")
    )
    text = (
        f"A {noun} is waiting for your approval.\n\n"
        f"Request: {title}\nAmount: {_money(subject['amount'])}\n"
        + (
            f"Requested by: {subject['requester_name']}\n"
            if subject.get("requester_name")
            else ""
        )
        + f"Step: {step_name}\n\nReview and decide: {link}\n"
    )
    return await _send(
        org,
        recipients,
        db=db,
        subject=f"Approval needed: {title} ({_money(subject['amount'])})",
        title="Approval needed",
        body_html=body,
        text_body=text,
        chip="Approval needed",
        accent=ACCENT_AMBER,
        template_type="finance_approval_step_reached",
    )


async def _notify_decided(db: AsyncSession, notice: ApprovalNotice) -> int:
    subject, requester_id = await _subject_row(db, notice)
    if subject is None or not requester_id:
        return 0
    # A requester who denies their own request is withdrawing it; they know.
    if notice.actor_id and str(notice.actor_id) == str(requester_id):
        return 0
    requester = (
        await db.execute(
            select(User).where(
                User.id == str(requester_id),
                User.organization_id == notice.org_id,
                User.is_active,
            )
        )
    ).scalar_one_or_none()
    if requester is None:
        return 0
    org = await db.get(Organization, notice.org_id)
    recipients = _who_receive([requester], EmailKind.FINANCE_REQUESTS, org)
    if not recipients:
        return 0
    noun = _NOUNS[notice.entity_type]
    approved = notice.outcome == APPROVED
    word = "approved" if approved else "denied"
    link = _link(notice.entity_type, notice.entity_id)
    title = str(subject["title"] or "")
    reason = (notice.reason or "").strip()
    body = (
        f"<p>Your {noun} was {word}.</p>"
        + _facts(subject)
        + (
            "<p><strong>Reason</strong></p>"
            f'<p style="white-space:pre-line;">{html.escape(reason)}</p>'
            if reason and not approved
            else ""
        )
        + action(html.escape(link), f"Open the {noun}")
    )
    text = (
        f"Your {noun} was {word}.\n\n"
        f"Request: {title}\nAmount: {_money(subject['amount'])}\n"
        + (f"\nReason:\n{reason}\n" if reason and not approved else "")
        + f"\nOpen the {noun}: {link}\n"
    )
    heading = f"{noun[0].upper()}{noun[1:]} {word}"
    return await _send(
        org,
        recipients,
        db=db,
        subject=f"{heading}: {title}",
        title=heading,
        body_html=body,
        text_body=text,
        chip=noun[0].upper() + noun[1:],
        accent=ACCENT_GREEN if approved else ACCENT_BLUE,
        template_type=f"finance_request_{word}",
    )


async def send_approval_notices(
    db: AsyncSession, notices: Iterable[ApprovalNotice]
) -> int:
    """Send queued notices; never raises. Returns how many emails went out.

    Call after the transaction that queued them has committed (module
    docstring). One failing notice does not stop the next.
    """
    sent = 0
    for notice in notices:
        try:
            if notice.kind == STEP_REACHED:
                sent += await _notify_step_reached(db, notice)
            elif notice.kind == DECIDED:
                sent += await _notify_decided(db, notice)
            elif notice.kind == SECOND_APPROVAL:
                from app.services.finance_second_approval import (
                    notify_held_request,
                )

                sent += await notify_held_request(
                    db, notice.org_id, notice.entity_type, notice.entity_id
                )
        except Exception as exc:
            logger.warning(
                "Finance approval notice {} for {} {} failed: {}",
                notice.kind,
                notice.entity_type.value,
                notice.entity_id,
                exc,
            )
    return sent
