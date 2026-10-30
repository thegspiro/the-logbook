"""
Member Archive Service

Handles automatic archiving of dropped members once all assigned/checked-out
inventory has been returned, and reactivation of archived members.

Workflow:
  1. Member is dropped (voluntary/involuntary) via status change
  2. Member returns items over time (unassign / check-in)
  3. After each return, this service checks if all items are accounted for
  4. When the last item is returned the member is auto-archived
  5. Archived members can be reactivated by leadership if they return
"""

from datetime import date, datetime, timezone
from typing import Any, Dict, Optional

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import ADMIN_NOTIFY_ROLE_SLUGS
from app.models.inventory import (
    CheckOutRecord,
    ClearanceStatus,
    DepartureClearance,
    ItemAssignment,
    ItemIssuance,
)
from app.models.user import ACTIVE_ACCOUNT_STATUSES, Organization, User, UserStatus
from app.schemas.organization import RejoinServiceCredit
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
)
from app.services.member_service_history_service import MemberServiceHistoryService
from app.services.nfc_card_status_sync import sync_cards_with_member_status
from app.utils.org_timezone import resolve_org_today


async def check_and_auto_archive(
    db: AsyncSession,
    user_id: str,
    organization_id: str,
) -> Optional[Dict[str, Any]]:
    """
    Check whether a dropped member has returned all outstanding items.
    If so, transition them to ARCHIVED status automatically.

    Called after every item unassign / check-in operation.

    Returns a dict with archive details if the member was archived,
    or None if no action was taken.
    """
    # Load the member
    result = await db.execute(
        select(User).where(
            User.id == user_id,
            User.organization_id == organization_id,
            User.deleted_at.is_(None),
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        return None

    # Only auto-archive dropped members
    if member.status not in (
        UserStatus.DROPPED_VOLUNTARY,
        UserStatus.DROPPED_INVOLUNTARY,
    ):
        return None

    # Check for any remaining active assignments
    assign_result = await db.execute(
        select(ItemAssignment.id)
        .where(
            ItemAssignment.organization_id == organization_id,
            ItemAssignment.user_id == user_id,
            ItemAssignment.is_active == True,  # noqa: E712
        )
        .limit(1)
    )
    if assign_result.scalar_one_or_none() is not None:
        return None  # Still has active assignments

    # Check for any remaining unreturned checkouts
    checkout_result = await db.execute(
        select(CheckOutRecord.id)
        .where(
            CheckOutRecord.organization_id == organization_id,
            CheckOutRecord.user_id == user_id,
            CheckOutRecord.is_returned == False,  # noqa: E712
        )
        .limit(1)
    )
    if checkout_result.scalar_one_or_none() is not None:
        return None  # Still has unreturned checkouts

    # Check for any remaining unreturned pool issuances
    issuance_result = await db.execute(
        select(ItemIssuance.id)
        .where(
            ItemIssuance.organization_id == organization_id,
            ItemIssuance.user_id == user_id,
            ItemIssuance.is_returned == False,  # noqa: E712
        )
        .limit(1)
    )
    if issuance_result.scalar_one_or_none() is not None:
        return None  # Still has unreturned issuances

    # Check for any open departure clearances
    clearance_result = await db.execute(
        select(DepartureClearance.id)
        .where(
            DepartureClearance.organization_id == organization_id,
            DepartureClearance.user_id == user_id,
            DepartureClearance.status.in_(
                [
                    ClearanceStatus.INITIATED,
                    ClearanceStatus.IN_PROGRESS,
                ]
            ),
        )
        .limit(1)
    )
    if clearance_result.scalar_one_or_none() is not None:
        return None  # Still has an open departure clearance

    # All items returned and clearances closed — archive the member
    now = datetime.now(timezone.utc)
    previous_status = member.status.value
    member.status = UserStatus.ARCHIVED
    member.archived_at = now
    member.status_changed_at = now
    member.status_change_reason = "Auto-archived: all department property returned"
    await sync_cards_with_member_status(
        db,
        organization_id=organization_id,
        user_id=str(member.id),
        member_status=UserStatus.ARCHIVED,
    )
    await db.commit()

    # Audit log
    try:
        from app.core.audit import log_audit_event

        await log_audit_event(
            db=db,
            event_type="member_auto_archived",
            event_category="user_management",
            severity="info",
            event_data={
                "target_user_id": user_id,
                "member_name": member.full_name,
                "previous_status": previous_status,
                "new_status": UserStatus.ARCHIVED.value,
                "reason": "All department property returned",
            },
            user_id=user_id,
            username=member.username,
        )
    except Exception as e:
        logger.error(f"Failed to log auto-archive audit event: {e}")

    # Notify admins
    try:
        org_result = await db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org = org_result.scalar_one_or_none()

        from app.models.email_template import EmailTemplateType
        from app.services.email_service import EmailService
        from app.services.email_template_service import EmailTemplateService

        template_svc = EmailTemplateService(db)
        archived_email_off = await template_svc.is_switched_off(
            str(organization_id), EmailTemplateType.MEMBER_ARCHIVED
        )
        if archived_email_off:
            logger.info(
                "Member archived email not sent: switched off in org {}",
                organization_id,
            )
        email_svc = EmailService(org)

        # Find admin/quartermaster/chief users to notify
        from sqlalchemy.orm import selectinload

        admin_result = await db.execute(
            select(User)
            .where(
                User.organization_id == organization_id,
                User.status.in_(ACTIVE_ACCOUNT_STATUSES),
                User.deleted_at.is_(None),
            )
            .options(selectinload(User.roles))
        )
        admins = admin_result.scalars().all()
        notified = [
            u
            for u in admins
            if any(r.slug in ADMIN_NOTIFY_ROLE_SLUGS for r in (u.roles or []))
        ]
        admin_emails = [
            u.email
            for u in notified
            if u.email
            and member_receives_email(
                u.notification_preferences,
                EmailKind.MEMBERSHIP_ADMIN,
                department_required_kinds(org),
            )
        ]

        # Every officer above gets a bell entry, whatever their email choices
        # or the template switch: the email is optional, and it was this
        # notice's only copy.
        from app.services.officer_alert_copies import add_in_app_copies

        member_name = member.display_name or "A member"
        await add_in_app_copies(
            db,
            organization_id=str(organization_id),
            recipient_ids=[str(u.id) for u in notified],
            category="member_archived",
            subject=f"Member archived: {member_name}",
            message=(
                f"{member_name} was archived automatically after returning all "
                "department property."
            ),
            action_url=f"/members/{member.id}",
            metadata={"user_id": str(member.id)},
        )
        await db.commit()

        if admin_emails and not archived_email_off:
            subject, html_body, text_body = await template_svc.render_stored_or_default(
                org,
                EmailTemplateType.MEMBER_ARCHIVED,
                {
                    "member_name": member.display_name or "",
                    "previous_status": previous_status.replace("_", " ").title(),
                },
            )
            await email_svc.send_email(
                to_emails=admin_emails,
                subject=subject,
                html_body=html_body,
                text_body=text_body,
                db=db,
                template_type=EmailTemplateType.MEMBER_ARCHIVED.value,
            )
    except Exception as e:
        logger.error("Failed to send archive notification for {}: {}", user_id, e)

    archive_info = {
        "user_id": user_id,
        "member_name": member.display_name,
        "previous_status": previous_status,
        "new_status": UserStatus.ARCHIVED.value,
        "archived_at": now.isoformat(),
    }
    logger.info(f"Auto-archived member: {archive_info}")
    return archive_info


async def reactivate_member(
    db: AsyncSession,
    user_id: str,
    organization_id: str,
    reactivated_by: str,
    reason: Optional[str] = None,
    service_credit: Optional[RejoinServiceCredit] = None,
    rejoin_date: Optional[date] = None,
    previous_service_end: Optional[date] = None,
) -> Dict[str, Any]:
    """
    Reactivate an archived member, restoring them to ACTIVE status.

    A new service stint opens on ``rejoin_date`` (default today), and
    ``service_credit`` (default: the department's setting) decides whether
    their earlier stints keep counting toward length of service.

    Returns a dict with reactivation details.
    Raises ValueError if the member cannot be reactivated.
    """
    result = await db.execute(
        select(User).where(
            User.id == user_id,
            User.organization_id == organization_id,
            User.deleted_at.is_(None),
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise ValueError("Member not found")

    if member.status != UserStatus.ARCHIVED:
        raise ValueError(
            f"Only archived members can be reactivated. "
            f"Current status: {getattr(member.status, 'value', member.status)}"
        )

    # Before the status changes: unrecorded earlier service ends where the
    # member's last status change says it did.
    history = MemberServiceHistoryService(db)
    service_credit = service_credit or await history.get_rejoin_default(organization_id)
    today = await resolve_org_today(db, organization_id)
    await history.record_rejoin(
        member,
        rejoin_date or today,
        service_credit,
        reactivated_by,
        previous_service_end=previous_service_end,
        today=today,
    )

    now = datetime.now(timezone.utc)
    previous_status = member.status.value
    member.status = UserStatus.ACTIVE
    member.status_changed_at = now
    member.status_change_reason = reason or "Reactivated by leadership"

    # Restore membership number from before soft-delete/archival if it
    # was cleared and the number is still available. Deleted rows count as
    # holding it: the unique index covers them, and an anonymized member keeps
    # its number, so restoring one of those would fail at commit.
    if not member.membership_number and member.previous_membership_number:
        conflict = await db.execute(
            select(func.count())
            .select_from(User)
            .where(
                User.organization_id == organization_id,
                User.membership_number == member.previous_membership_number,
                User.id != user_id,
            )
        )
        if (conflict.scalar() or 0) == 0:
            member.membership_number = member.previous_membership_number
            member.previous_membership_number = None
        # When the old number is now held by someone else, keep
        # previous_membership_number as the record of what it was — wiping it
        # would permanently lose the member's history with nothing restored.

    await sync_cards_with_member_status(
        db,
        organization_id=organization_id,
        user_id=str(member.id),
        member_status=UserStatus.ACTIVE,
        performed_by_id=str(reactivated_by),
    )
    await db.commit()

    # Audit log
    try:
        # Look up who did this
        performer_result = await db.execute(
            select(User).where(User.id == reactivated_by)
        )
        performer = performer_result.scalar_one_or_none()

        from app.core.audit import log_audit_event

        await log_audit_event(
            db=db,
            event_type="member_reactivated",
            event_category="user_management",
            severity="info",
            event_data={
                "target_user_id": user_id,
                "member_name": member.full_name,
                "previous_status": previous_status,
                "new_status": UserStatus.ACTIVE.value,
                "reason": reason or "Reactivated by leadership",
                "reactivated_by": reactivated_by,
                "service_credit": service_credit.value,
            },
            user_id=reactivated_by,
            username=performer.username if performer else "unknown",
        )
    except Exception as e:
        logger.error(f"Failed to log reactivation audit event: {e}")

    return {
        "user_id": user_id,
        "member_name": member.display_name,
        "previous_status": previous_status,
        "new_status": UserStatus.ACTIVE.value,
        "reactivated_at": now.isoformat(),
        "reason": reason or "Reactivated by leadership",
        "service_credit": service_credit.value,
    }
