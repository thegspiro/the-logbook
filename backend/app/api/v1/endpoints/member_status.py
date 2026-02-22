"""
Member Status Change API Endpoints

Provides a dedicated endpoint for changing member status.
When a member is dropped (voluntarily or involuntarily), a property-return
report is automatically generated, saved to documents, and optionally emailed.
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from uuid import UUID

from datetime import datetime, timezone
from app.core.database import get_db
from app.core.audit import log_audit_event
from app.api.dependencies import get_current_user, require_permission
from app.models.user import User, UserStatus, Organization
from app.core.constants import ADMIN_NOTIFY_ROLE_SLUGS

router = APIRouter()


class MemberStatusChangeRequest(BaseModel):
    """Request body for changing a member's status."""
    new_status: str = Field(..., description="New status value (e.g. 'dropped_voluntary')")
    reason: Optional[str] = Field(None, description="Reason for the status change")
    send_property_return_email: bool = Field(True, description="Email the property return report to the member")
    return_deadline_days: int = Field(14, ge=1, le=90, description="Days to return property (1-90)")
    custom_instructions: Optional[str] = Field(None, description="Extra paragraph added to the letter")


class MemberStatusChangeResponse(BaseModel):
    """Response after a status change."""
    user_id: str
    previous_status: str
    new_status: str
    property_return_report: Optional[Dict[str, Any]] = None
    document_id: Optional[str] = None
    email_sent: Optional[bool] = None


@router.patch("/{user_id}/status", response_model=MemberStatusChangeResponse)
async def change_member_status(
    user_id: UUID,
    request: MemberStatusChangeRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Change a member's status.

    When the new status is `dropped_voluntary` or `dropped_involuntary`:
      1. A formal property-return report is generated listing all assigned items
      2. The report is saved to the Documents module (Reports folder)
      3. If send_property_return_email is True, the report is emailed to the member
      4. An audit event is logged

    Requires `members.manage` permission.
    """
    # Validate new_status is a valid UserStatus
    try:
        new_status = UserStatus(request.new_status)
    except ValueError:
        valid = [s.value for s in UserStatus]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid status '{request.new_status}'. Valid values: {valid}",
        )

    # Load the target member
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == current_user.organization_id)
        .where(User.deleted_at.is_(None))
        .options(selectinload(User.roles))
    )
    member = result.scalar_one_or_none()

    if not member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found",
        )

    previous_status = member.status.value if hasattr(member.status, 'value') else str(member.status)

    # Prevent no-op
    if member.status == new_status:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Member is already {new_status.value}",
        )

    # Update the status and record when it changed
    member.status = new_status
    member.status_changed_at = datetime.now(timezone.utc)
    member.status_change_reason = request.reason
    await db.commit()
    await db.refresh(member)

    # Audit log
    await log_audit_event(
        db=db,
        event_type="member_status_changed",
        event_category="user_management",
        severity="warning" if "dropped" in new_status.value else "info",
        event_data={
            "target_user_id": str(user_id),
            "member_name": member.full_name,
            "previous_status": previous_status,
            "new_status": new_status.value,
            "reason": request.reason,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    response = MemberStatusChangeResponse(
        user_id=str(user_id),
        previous_status=previous_status,
        new_status=new_status.value,
    )

    # --- Auto-generate property return report for drops ---
    if new_status in (UserStatus.DROPPED_VOLUNTARY, UserStatus.DROPPED_INVOLUNTARY):
        from app.services.property_return_service import PropertyReturnService

        prs = PropertyReturnService(db)
        report_data, html_content = await prs.generate_report(
            user_id=str(user_id),
            organization_id=str(current_user.organization_id),
            drop_type=new_status.value,
            performed_by=str(current_user.id),
            return_deadline_days=request.return_deadline_days,
            custom_instructions=request.custom_instructions,
            reason=request.reason,
        )

        response.property_return_report = {
            "member_name": report_data["member_name"],
            "drop_type": report_data["drop_type_display"],
            "item_count": report_data["item_count"],
            "total_value": report_data["total_value"],
            "return_deadline": report_data["return_deadline"],
        }

        # Save to documents
        doc = await prs.save_as_document(
            organization_id=str(current_user.organization_id),
            member_name=member.full_name,
            html_content=html_content,
            created_by=str(current_user.id),
        )
        if doc:
            response.document_id = str(doc.id)

        # Auto-create departure clearance so items can be tracked and resolved
        try:
            from app.services.departure_clearance_service import DepartureClearanceService
            clearance_svc = DepartureClearanceService(db)
            _clearance, _cl_err = await clearance_svc.initiate_clearance(
                user_id=str(user_id),
                organization_id=str(current_user.organization_id),
                initiated_by=str(current_user.id),
                departure_type=new_status.value,
                return_deadline_days=request.return_deadline_days,
                notes=f"Auto-created from status change to {new_status.value}",
            )
            if _cl_err:
                from loguru import logger as _lg
                _lg.warning(f"Could not auto-create departure clearance: {_cl_err}")
        except Exception as _e:
            from loguru import logger as _lg
            _lg.error(f"Failed to auto-create departure clearance: {_e}")

        # Email the report to the member (with configurable CC and personal email)
        if request.send_property_return_email and member.email:
            org_result = await db.execute(
                select(Organization).where(Organization.id == current_user.organization_id)
            )
            organization = org_result.scalar_one_or_none()

            # Load drop notification settings from organization
            org_settings = (organization.settings or {}) if organization else {}
            drop_notif_config = org_settings.get("member_drop_notifications", {})
            cc_role_names = drop_notif_config.get("cc_roles", ADMIN_NOTIFY_ROLE_SLUGS)
            cc_static_emails = drop_notif_config.get("cc_emails", [])
            include_personal = drop_notif_config.get("include_personal_email", True)

            # Build CC list from roles
            cc_emails = list(cc_static_emails)  # start with static list
            if cc_role_names:
                cc_users_result = await db.execute(
                    select(User).where(
                        User.organization_id == current_user.organization_id,
                        User.status == UserStatus.ACTIVE,
                        User.deleted_at.is_(None),
                    ).options(selectinload(User.roles))
                )
                cc_users = cc_users_result.scalars().all()
                for u in cc_users:
                    role_names = [r.name for r in (u.roles or [])]
                    if any(r in role_names for r in cc_role_names):
                        if u.email and u.email not in cc_emails and u.id != str(user_id):
                            cc_emails.append(u.email)

            # Build recipient list — primary email + optionally personal email
            to_emails = [member.email]
            if include_personal and getattr(member, 'personal_email', None):
                if member.personal_email not in to_emails:
                    to_emails.append(member.personal_email)

            async def _send_report():
                try:
                    from app.services.email_service import EmailService
                    email_svc = EmailService(organization)
                    org_name = organization.name if organization else "Department"
                    subject = f"Notice of Department Property Return — {org_name}"
                    reason_line = ""
                    if report_data.get("reason"):
                        reason_line = f"Reason: {report_data['reason']}\n\n"
                    await email_svc.send_email(
                        to_emails=to_emails,
                        subject=subject,
                        html_body=html_content,
                        text_body=(
                            f"Property Return Notice\n\n"
                            f"Dear {member.full_name},\n\n"
                            f"Your membership status with {org_name} has been changed to "
                            f"{report_data['drop_type_display']} effective {report_data['effective_date']}.\n\n"
                            f"{reason_line}"
                            f"You have {report_data['item_count']} department item(s) "
                            f"valued at ${report_data['total_value']:,.2f} that must be returned "
                            f"by {report_data['return_deadline']}.\n\n"
                            f"Please see the attached HTML version of this letter for the full "
                            f"item listing and return instructions.\n\n"
                            f"Respectfully,\n"
                            f"{report_data['performed_by_name']}\n"
                            f"{report_data['performed_by_title']}\n"
                            f"{org_name}"
                        ),
                        cc_emails=cc_emails if cc_emails else None,
                    )
                except Exception as e:
                    from loguru import logger
                    logger.error(f"Failed to send property return email to {member.email}: {e}")

            background_tasks.add_task(_send_report)
            response.email_sent = True

    return response


@router.get("/{user_id}/property-return-report")
async def get_property_return_preview(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Preview the property-return report for a member without changing their status.
    Useful for reviewing what items are assigned before performing a drop.

    Requires `members.manage` permission.
    """
    from app.services.property_return_service import PropertyReturnService

    # Verify member exists in same org
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == current_user.organization_id)
        .where(User.deleted_at.is_(None))
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")

    prs = PropertyReturnService(db)
    report_data, html_content = await prs.generate_report(
        user_id=str(user_id),
        organization_id=str(current_user.organization_id),
        drop_type="dropped_voluntary",
        performed_by=str(current_user.id),
    )

    return {
        "member_name": report_data["member_name"],
        "item_count": report_data["item_count"],
        "total_value": report_data["total_value"],
        "items": report_data["items"],
        "html": html_content,
    }


# ==================== Property Return Reminders ====================


@router.post("/property-return-reminders/process")
async def process_property_return_reminders(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Process property-return reminders for the organization.

    Scans all dropped members and sends 30-day and 90-day reminder emails
    to members who still have outstanding inventory items. Each reminder
    type is sent only once per member. Admin/quartermaster users also
    receive a notification for each reminder sent.

    This endpoint is designed to be called daily (via cron, scheduler,
    or manual trigger). Duplicate reminders are prevented automatically.

    Requires `members.manage` permission.
    """
    from app.services.property_return_reminder_service import PropertyReturnReminderService

    service = PropertyReturnReminderService(db)
    result = await service.process_reminders(
        organization_id=str(current_user.organization_id),
    )
    return result


@router.get("/property-return-reminders/overdue")
async def get_overdue_property_returns(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Get a list of all dropped members who still have outstanding
    inventory items, sorted by oldest drop date first.

    Each entry includes: member name, drop date, days since drop,
    items outstanding with values, and which reminders have been sent.

    Requires `members.manage` permission.
    """
    from app.services.property_return_reminder_service import PropertyReturnReminderService

    service = PropertyReturnReminderService(db)
    overdue_list = await service.get_overdue_returns(
        organization_id=str(current_user.organization_id),
    )
    return {
        "organization_id": str(current_user.organization_id),
        "overdue_count": len(overdue_list),
        "members": overdue_list,
    }


# ==================== Member Archive & Reactivation ====================


class ArchiveMemberRequest(BaseModel):
    """Request body for manually archiving a dropped member."""
    reason: Optional[str] = Field(None, description="Reason for archiving")


class ReactivateMemberRequest(BaseModel):
    """Request body for reactivating an archived member."""
    reason: Optional[str] = Field(None, description="Reason for reactivation")


@router.post("/{user_id}/archive")
async def archive_member(
    user_id: UUID,
    request: ArchiveMemberRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Manually archive a dropped member.

    Members are automatically archived when they return all outstanding
    items. This endpoint allows leadership to manually archive a dropped
    member (e.g. items were written off, or the member had no items).

    Only members with a dropped status (`dropped_voluntary` or
    `dropped_involuntary`) can be archived. Use the reactivation
    endpoint to restore an archived member.

    Requires `members.manage` permission.
    """
    # Load the target member
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == current_user.organization_id)
        .where(User.deleted_at.is_(None))
    )
    member = result.scalar_one_or_none()

    if not member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found",
        )

    if member.status not in (UserStatus.DROPPED_VOLUNTARY, UserStatus.DROPPED_INVOLUNTARY):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Only dropped members can be archived. Current status: {member.status.value}",
        )

    previous_status = member.status.value
    now = datetime.now(timezone.utc)
    member.status = UserStatus.ARCHIVED
    member.archived_at = now
    member.status_changed_at = now
    member.status_change_reason = request.reason or "Manually archived by leadership"
    await db.commit()

    # Audit log
    await log_audit_event(
        db=db,
        event_type="member_archived",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(user_id),
            "member_name": member.full_name,
            "previous_status": previous_status,
            "new_status": UserStatus.ARCHIVED.value,
            "reason": request.reason or "Manually archived by leadership",
            "archived_by": str(current_user.id),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "user_id": str(user_id),
        "member_name": member.full_name,
        "previous_status": previous_status,
        "new_status": UserStatus.ARCHIVED.value,
        "archived_at": now.isoformat(),
    }


@router.post("/{user_id}/reactivate")
async def reactivate_member(
    user_id: UUID,
    request: ReactivateMemberRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Reactivate an archived member, restoring them to ACTIVE status.

    Use this when a former member returns to the department and needs
    their account restored. The member's full profile history is
    preserved during archiving, so all prior data is still accessible.

    Requires `members.manage` permission.
    """
    from app.services.member_archive_service import reactivate_member as do_reactivate

    try:
        result = await do_reactivate(
            db=db,
            user_id=str(user_id),
            organization_id=str(current_user.organization_id),
            reactivated_by=str(current_user.id),
            reason=request.reason,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    return result


@router.get("/archived")
async def get_archived_members(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    List all archived members in the organization.

    Returns archived members sorted by archive date (most recent first).
    Useful for leadership to review former members for legal requests
    or to identify members eligible for reactivation.

    Requires `members.manage` permission.
    """
    result = await db.execute(
        select(User)
        .where(
            User.organization_id == current_user.organization_id,
            User.status == UserStatus.ARCHIVED,
            User.deleted_at.is_(None),
        )
        .order_by(User.archived_at.desc())
    )
    members = result.scalars().all()

    return {
        "organization_id": str(current_user.organization_id),
        "archived_count": len(members),
        "members": [
            {
                "user_id": str(m.id),
                "name": m.full_name,
                "email": m.email,
                "membership_number": m.membership_number,
                "rank": m.rank,
                "archived_at": m.archived_at.isoformat() if m.archived_at else None,
                "status_change_reason": m.status_change_reason,
            }
            for m in members
        ],
    }


# ==================== Membership Tier Management ====================


class MembershipTypeChangeRequest(BaseModel):
    """Request body for changing a member's membership tier."""
    membership_type: str = Field(..., min_length=1, max_length=50, description="New tier ID (e.g. 'senior', 'life')")
    reason: Optional[str] = Field(None, description="Reason for the tier change")


@router.patch("/{user_id}/membership-type")
async def change_membership_type(
    user_id: UUID,
    request: MembershipTypeChangeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Change a member's membership tier.

    Leadership can promote or adjust a member's tier (e.g. probationary -> active,
    active -> life). The available tiers are configured in Organization Settings >
    membership_tiers.

    Requires `members.manage` permission.
    """
    result = await db.execute(
        select(User)
        .where(User.id == str(user_id))
        .where(User.organization_id == current_user.organization_id)
        .where(User.deleted_at.is_(None))
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")

    # Validate the tier exists in org settings
    org_result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    organization = org_result.scalar_one_or_none()
    tier_config = (organization.settings or {}).get("membership_tiers", {})
    valid_tier_ids = [t["id"] for t in tier_config.get("tiers", [])]
    # Allow the change even if no tiers are configured (freeform)
    if valid_tier_ids and request.membership_type not in valid_tier_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid membership tier '{request.membership_type}'. Valid tiers: {valid_tier_ids}",
        )

    previous_type = member.membership_type or "active"
    if previous_type == request.membership_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Member is already at tier '{request.membership_type}'",
        )

    now = datetime.now(timezone.utc)
    member.membership_type = request.membership_type
    member.membership_type_changed_at = now
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="membership_type_changed",
        event_category="user_management",
        severity="info",
        event_data={
            "target_user_id": str(user_id),
            "member_name": member.full_name,
            "previous_type": previous_type,
            "new_type": request.membership_type,
            "reason": request.reason,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "user_id": str(user_id),
        "member_name": member.full_name,
        "previous_membership_type": previous_type,
        "new_membership_type": request.membership_type,
        "changed_at": now.isoformat(),
    }


@router.post("/advance-membership-tiers")
async def advance_membership_tiers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Auto-advance all eligible members to their next membership tier.

    Scans every active/probationary member, calculates their years of
    service from `hire_date`, and promotes them to the highest tier they
    qualify for based on the organization's `membership_tiers` settings.

    This endpoint is idempotent and designed to be called periodically
    (e.g. daily, monthly, or on-demand by leadership).

    Requires `members.manage` permission.
    """
    from app.services.membership_tier_service import MembershipTierService

    service = MembershipTierService(db)
    result = await service.advance_all(
        organization_id=str(current_user.organization_id),
        performed_by=str(current_user.id),
    )
    return result


@router.get("/membership-tiers/config")
async def get_membership_tier_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Get the current membership tier configuration.

    Returns all tiers with their benefits (training exemptions, voting rules,
    attendance requirements, etc.).

    **Requires permission: members.manage**
    """
    org_result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    organization = org_result.scalar_one_or_none()
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")

    tier_config = (organization.settings or {}).get("membership_tiers", {})
    return tier_config


@router.put("/membership-tiers/config")
async def update_membership_tier_config(
    config: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage")),
):
    """
    Update membership tier configuration.

    The training officer, compliance officer, or secretary can edit the
    membership requirements for each tier/stage including:
    - `voting_eligible` — whether members at this tier can vote
    - `voting_requires_meeting_attendance` — require attendance % to vote
    - `voting_min_attendance_pct` — minimum attendance percentage (e.g. 50.0)
    - `voting_attendance_period_months` — look-back window for attendance
    - `training_exempt` / `training_exempt_types` — training exemptions
    - `can_hold_office` — office eligibility
    - `years_required` — years of service for auto-advancement

    **Requires permission: members.manage**
    """
    org_result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    organization = org_result.scalar_one_or_none()
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Validate config structure
    tiers = config.get("tiers", [])
    if not isinstance(tiers, list):
        raise HTTPException(status_code=400, detail="'tiers' must be a list")

    for tier in tiers:
        if not tier.get("id") or not tier.get("name"):
            raise HTTPException(status_code=400, detail="Each tier must have 'id' and 'name'")
        benefits = tier.get("benefits", {})
        if not isinstance(benefits, dict):
            raise HTTPException(status_code=400, detail=f"Tier '{tier['id']}' benefits must be a dict")
        # Validate attendance percentage range
        min_pct = benefits.get("voting_min_attendance_pct", 0.0)
        if not (0 <= min_pct <= 100):
            raise HTTPException(
                status_code=400,
                detail=f"Tier '{tier['id']}' voting_min_attendance_pct must be 0-100",
            )

    # Update org settings
    settings = dict(organization.settings or {})
    settings["membership_tiers"] = config
    organization.settings = settings
    await db.commit()

    await log_audit_event(
        db=db,
        event_type="membership_tier_config_updated",
        event_category="user_management",
        severity="warning",
        event_data={
            "tier_count": len(tiers),
            "tier_ids": [t["id"] for t in tiers],
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )

    return {
        "message": "Membership tier configuration updated",
        "tiers": tiers,
    }
