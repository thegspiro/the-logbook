"""
Who counts, and who is told, under the dual-approval threshold.

A request at or above its type's threshold (``FinanceSettings.threshold_for``)
is approved only once two different people have approved it. Three owner
decisions of 2026-11-01 refine that rule, and this module is where each lives:

**One person, however they approved.** An approval from an emailed link
records no member, only the address the step names. When a member of the
department has that address, the approval counts as that member
(``email_identity``), so one person cannot give both approvals by approving
once in the app and once from the link. An address no member has is a person
of its own, as before.

**The named office.** A department may name the position whose holder must be
one of the two approvers (``second_approver_position``). A request the office
has not yet approved waits for a holder of it, and an approver outside it is
refused rather than silently not counted (``office_among``).

**The notice.** When a request is first held for its second approval, the
members who could give it are emailed (``notify_second_approval_needed``):
active ``finance.approve`` holders — narrowed to the office's holders while
the office has not yet approved — who have not already approved it and did
not raise it. Email only, under the ``FINANCE_DUTIES`` kind a member may turn
off; never SMS, because a request waiting for an officer's signature is an
administrative notice and is not in ``SmsAlert`` (CLAUDE.md pitfall #18). A
notice that fails is logged and dropped: it never fails the approval.

Idempotency (pitfall #36): the request's ``second_approval_requested_at`` is
the key. It is claimed with a conditional ``UPDATE ... WHERE ... IS NULL`` in
the approval's own transaction, and only the claim that changes a row queues
an ``ApprovalNotice`` (``SECOND_APPROVAL``) on the service. The endpoint sends
the queue after the commit, as every other approval email is sent
(``finance_approval_notifications``): "stamp, commit, then send". A rollback
takes the stamp and the queued notice with it, so nothing announces a hold
that did not happen, and a retry that holds the request again finds the stamp
taken and queues nothing. The cost of that order is at most once: a crash
between the commit and the send loses the email, and the Approvals screen
still lists the request as waiting for a second approver.

The notice is worked out again at send time (``notify_held_request``) from
the committed request, so one decided in the meantime is not announced.
"""

from __future__ import annotations

import html
from datetime import datetime, timezone
from typing import Iterable, Optional

from loguru import logger
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import user_has_permission
from app.core.config import settings
from app.core.security import email_fingerprints
from app.models.finance import ApprovalEntityType
from app.models.user import Organization, Position, User
from app.services.email_policy import EmailKind
from app.services.email_theme import ACCENT_AMBER, action, fact, facts
from app.services.finance_approver_matching import FINANCE_APPROVE, ApproverDirectory
from app.services.finance_budget_request_notifications import (
    _send,
    _who_receive,
    money,
)
from app.utils.member_names import format_display_name

EMAIL_PREFIX = "email:"
APPROVALS_PATH = "/finance/approvals"

_TYPE_LABELS = {
    ApprovalEntityType.PURCHASE_REQUEST: "Purchase request",
    ApprovalEntityType.EXPENSE_REPORT: "Expense report",
    ApprovalEntityType.CHECK_REQUEST: "Check request",
}


def _clean(value: Optional[str]) -> str:
    return (value or "").strip()


async def email_identity(db: AsyncSession, org_id: str, address: str) -> str:
    """The person an emailed-link approval counts as.

    The member of the department whose account email is the address
    (case-insensitive), else the address itself. A deactivated member is still
    the same person, so only deleted accounts are passed over.
    """
    wanted = _clean(address).lower()
    fingerprints = email_fingerprints(wanted)
    if not fingerprints:
        return EMAIL_PREFIX + wanted
    # User.email is encrypted with a randomised IV, so it can never be compared
    # in SQL; the fingerprint column is the one built to be matched.
    result = await db.execute(
        select(User.id)
        .where(
            User.organization_id == str(org_id),
            User.deleted_at.is_(None),
            User.email_hash.in_(fingerprints),
        )
        .order_by(User.id)
    )
    member_id = result.scalars().first()
    return str(member_id) if member_id else EMAIL_PREFIX + wanted


async def office_holders(
    db: AsyncSession, org_id: str, slug: str, user_ids: Iterable[str]
) -> set[str]:
    """Which of ``user_ids`` are active members holding the position ``slug``.

    Matched as an approval chain matches a position step
    (``finance_approver_matching.user_matches_step``): by slug,
    case-insensitively, in the department, active members only.
    """
    ids = {str(u) for u in user_ids if u and not str(u).startswith(EMAIL_PREFIX)}
    wanted = _clean(slug).lower()
    if not ids or not wanted:
        return set()
    result = await db.execute(
        select(User.id)
        .join(User.positions)
        .where(
            User.id.in_(ids),
            User.organization_id == str(org_id),
            User.is_active,
            Position.organization_id == str(org_id),
            func.lower(Position.slug) == wanted,
        )
    )
    return {str(u) for u in result.scalars().all()}


async def office_among(
    db: AsyncSession, org_id: str, slug: Optional[str], people: Iterable[str]
) -> bool:
    """Whether the named office is among ``people``; trivially so when no
    office is named."""
    if not _clean(slug):
        return True
    return bool(await office_holders(db, org_id, slug or "", people))


async def office_label(db: AsyncSession, org_id: str, slug: Optional[str]) -> str:
    position = await ApproverDirectory(db, org_id).position(slug)
    if position is None:
        return f"the {_clean(slug)} position, which no longer exists"
    return f"the {position.name} position"


async def eligible_second_approvers(
    db: AsyncSession,
    org_id: str,
    *,
    people: set[str],
    requester_id: Optional[str],
    office_slug: Optional[str],
) -> list[User]:
    """The members who could give the second approval now.

    The rule ``manual_approve`` applies, read for the notice (pitfall #29):
    ``finance.approve``, not already counted among ``people``, not the
    requester, and a holder of the office while the office is still owed.
    """
    members = await ApproverDirectory(db, org_id).active_members()
    candidates = [
        m
        for m in members
        if user_has_permission(m, FINANCE_APPROVE)
        and str(m.id) not in people
        and str(m.id) != str(requester_id or "")
    ]
    if not await office_among(db, org_id, office_slug, people):
        holders = await office_holders(
            db, org_id, office_slug or "", [str(m.id) for m in candidates]
        )
        candidates = [m for m in candidates if str(m.id) in holders]
    return candidates


async def _names(db: AsyncSession, org_id: str, people: set[str]) -> list[str]:
    ids = [p for p in people if not p.startswith(EMAIL_PREFIX)]
    names: list[str] = []
    if ids:
        result = await db.execute(
            select(User).where(User.id.in_(ids), User.organization_id == str(org_id))
        )
        for user in result.scalars().all():
            names.append(
                format_display_name(
                    user.first_name, user.last_name, user.preferred_name
                )
                or user.username
                or "A member"
            )
    names.extend(p[len(EMAIL_PREFIX) :] for p in people if p.startswith(EMAIL_PREFIX))
    return sorted(names)


async def claim_second_approval_notice(db: AsyncSession, model, entity) -> bool:
    """Stamp ``second_approval_requested_at``; True only for the first claim."""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        update(model)
        .where(
            model.id == entity.id,
            model.organization_id == entity.organization_id,
            model.second_approval_requested_at.is_(None),
        )
        .values(second_approval_requested_at=now)
        .execution_options(synchronize_session=False)
    )
    # An UPDATE answers with a CursorResult; the rows it changed decide.
    claimed = bool(getattr(result, "rowcount", 0))
    if claimed:
        entity.second_approval_requested_at = now
    return claimed


async def notify_second_approval_needed(
    db: AsyncSession,
    org_id: str,
    *,
    entity_type: ApprovalEntityType,
    title: str,
    amount,
    requester_id: Optional[str],
    people: set[str],
    office_slug: Optional[str],
) -> int:
    """Email the members who could give the second approval. Never raises;
    returns how many the mailer accepted."""
    try:
        org = await db.get(Organization, str(org_id))
        recipients = _who_receive(
            await eligible_second_approvers(
                db,
                org_id,
                people=people,
                requester_id=requester_id,
                office_slug=office_slug,
            ),
            EmailKind.FINANCE_DUTIES,
            org,
        )
        if not recipients:
            logger.info(
                "{} held for a second approval in org {}: nobody to email",
                entity_type.value,
                org_id,
            )
            return 0
        label = _TYPE_LABELS.get(entity_type, "Request")
        shown_amount = money(amount)
        approved_by = ", ".join(await _names(db, org_id, people)) or "its chain"
        link = f"{settings.FRONTEND_URL.rstrip('/')}{APPROVALS_PATH}"
        office_note = ""
        if not await office_among(db, org_id, office_slug, people):
            office_note = (
                "<p>Your department asks for the second approval to come from "
                f"{html.escape(await office_label(db, org_id, office_slug))}.</p>"
            )
        body = (
            f"<p>A {html.escape(label.lower())} at or above your department's "
            "dual-approval threshold has its first approval and is waiting for "
            "a second approval from someone else.</p>"
            + facts(
                [
                    [fact(label, html.escape(title or ""))],
                    [
                        fact("Amount", html.escape(shown_amount)),
                        fact("Approved so far by", html.escape(approved_by)),
                    ],
                ]
            )
            + office_note
            + action(html.escape(link), "Open approvals")
        )
        text = (
            f"A {label.lower()} is waiting for a second approval.\n\n"
            f"{label}: {title or ''}\nAmount: {shown_amount}\n"
            f"Approved so far by: {approved_by}\n\n"
            f"Open approvals: {link}\n"
        )
        sent = await _send(
            db,
            org,
            recipients,
            subject=f"Second approval needed: {title or label} ({shown_amount})",
            title="Second approval needed",
            body_html=body,
            text_body=text,
            chip="Approval needed",
            accent=ACCENT_AMBER,
            template_type="finance_second_approval_needed",
        )
        return len(sent)
    except Exception as exc:
        logger.warning(
            "Second-approval notice for a {} failed: {}", entity_type.value, exc
        )
        return 0


async def notify_held_request(
    db: AsyncSession,
    org_id: str,
    entity_type: ApprovalEntityType,
    entity_id: str,
) -> int:
    """Send the queued notice for a request held for its second approval.

    Called after the commit. Reads the request again, org-scoped, and sends
    nothing if it is no longer waiting for approval.
    """
    # finance_service imports this module, so it cannot be imported at the top.
    from app.services.finance_service import FinanceService
    from app.utils.finance_settings import load_finance_settings

    service = FinanceService(db)
    model, pending_status, _label = service._unrouted_mapping(entity_type)
    entity = (
        await db.execute(
            select(model).where(
                model.id == str(entity_id), model.organization_id == str(org_id)
            )
        )
    ).scalar_one_or_none()
    if entity is None or entity.status != pending_status:
        return 0
    people = await service._approvers_so_far(entity_type, entity, str(org_id))
    rules = await load_finance_settings(db, str(org_id))
    return await notify_second_approval_needed(
        db,
        str(org_id),
        entity_type=entity_type,
        title=(
            f"Check to {entity.payee_name}"
            if entity_type == ApprovalEntityType.CHECK_REQUEST
            else entity.title
        ),
        amount=service._approval_amount(entity_type, entity),
        requester_id=await service._entity_creator_id(
            entity_type, str(entity_id), str(org_id)
        ),
        people=people,
        office_slug=rules.second_approver_position,
    )
