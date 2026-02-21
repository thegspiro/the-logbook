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

import logging
from datetime import datetime
from typing import Dict, Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.user import User, UserStatus, Organization
from app.core.constants import ADMIN_NOTIFY_ROLE_SLUGS
from app.models.inventory import (
    ItemAssignment,
    CheckOutRecord,
    ItemIssuance,
    DepartureClearance,
    ClearanceStatus,
)

logger = logging.getLogger(__name__)


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
    if member.status not in (UserStatus.DROPPED_VOLUNTARY, UserStatus.DROPPED_INVOLUNTARY):
        return None

    # Check for any remaining active assignments
    assign_result = await db.execute(
        select(ItemAssignment.id).where(
            ItemAssignment.organization_id == organization_id,
            ItemAssignment.user_id == user_id,
            ItemAssignment.is_active == True,
        ).limit(1)
    )
    if assign_result.scalar_one_or_none() is not None:
        return None  # Still has active assignments

    # Check for any remaining unreturned checkouts
    checkout_result = await db.execute(
        select(CheckOutRecord.id).where(
            CheckOutRecord.organization_id == organization_id,
            CheckOutRecord.user_id == user_id,
            CheckOutRecord.is_returned == False,
        ).limit(1)
    )
    if checkout_result.scalar_one_or_none() is not None:
        return None  # Still has unreturned checkouts

    # Check for any remaining unreturned pool issuances
    issuance_result = await db.execute(
        select(ItemIssuance.id).where(
            ItemIssuance.organization_id == organization_id,
            ItemIssuance.user_id == user_id,
            ItemIssuance.is_returned == False,
        ).limit(1)
    )
    if issuance_result.scalar_one_or_none() is not None:
        return None  # Still has unreturned issuances

    # Check for any open departure clearances
    clearance_result = await db.execute(
        select(DepartureClearance.id).where(
            DepartureClearance.organization_id == organization_id,
            DepartureClearance.user_id == user_id,
            DepartureClearance.status.in_([
                ClearanceStatus.INITIATED,
                ClearanceStatus.IN_PROGRESS,
            ]),
        ).limit(1)
    )
    if clearance_result.scalar_one_or_none() is not None:
        return None  # Still has an open departure clearance

    # All items returned and clearances closed — archive the member
    now = datetime.utcnow()
    previous_status = member.status.value
    member.status = UserStatus.ARCHIVED
    member.archived_at = now
    member.status_changed_at = now
    member.status_change_reason = "Auto-archived: all department property returned"
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
        org_name = org.name if org else "Department"

        from app.services.email_service import EmailService
        email_svc = EmailService(org)

        # Find admin/quartermaster/chief users to notify
        from sqlalchemy.orm import selectinload
        admin_result = await db.execute(
            select(User).where(
                User.organization_id == organization_id,
                User.status == UserStatus.ACTIVE,
                User.deleted_at.is_(None),
            ).options(selectinload(User.roles))
        )
        admins = admin_result.scalars().all()
        admin_emails = []
        for u in admins:
            role_names = [r.name for r in (u.roles or [])]
            if any(r in role_names for r in ADMIN_NOTIFY_ROLE_SLUGS):
                if u.email:
                    admin_emails.append(u.email)

        if admin_emails:
            subject = f"Member Archived: {member.full_name} — {org_name}"
            html_body = (
                f"<p><strong>{member.full_name}</strong> has been automatically archived.</p>"
                f"<p>All department property has been returned. "
                f"Previous status: {previous_status.replace('_', ' ').title()}.</p>"
                f"<p>The member's profile remains accessible for legal requests or future reactivation.</p>"
            )
            text_body = (
                f"Member Archived: {member.full_name}\n\n"
                f"All department property has been returned. "
                f"Previous status: {previous_status.replace('_', ' ').title()}.\n\n"
                f"The member's profile remains accessible for legal requests "
                f"or future reactivation."
            )
            await email_svc.send_email(
                to_emails=admin_emails,
                subject=subject,
                html_body=html_body,
                text_body=text_body,
            )
    except Exception as e:
        logger.error(f"Failed to send archive notification: {e}")

    archive_info = {
        "user_id": user_id,
        "member_name": member.full_name,
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
) -> Dict[str, Any]:
    """
    Reactivate an archived member, restoring them to ACTIVE status.

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
            f"Current status: {member.status.value}"
        )

    now = datetime.utcnow()
    previous_status = member.status.value
    member.status = UserStatus.ACTIVE
    member.status_changed_at = now
    member.status_change_reason = reason or "Reactivated by leadership"
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
            },
            user_id=reactivated_by,
            username=performer.username if performer else "unknown",
        )
    except Exception as e:
        logger.error(f"Failed to log reactivation audit event: {e}")

    return {
        "user_id": user_id,
        "member_name": member.full_name,
        "previous_status": previous_status,
        "new_status": UserStatus.ACTIVE.value,
        "reactivated_at": now.isoformat(),
        "reason": reason or "Reactivated by leadership",
    }
