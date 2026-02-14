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

from app.core.database import get_db
from app.core.audit import log_audit_event
from app.api.dependencies import get_current_user, require_permission
from app.models.user import User, UserStatus, Organization

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
    from datetime import datetime as dt
    member.status = new_status
    member.status_changed_at = dt.utcnow()
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

        # Email the report to the member
        if request.send_property_return_email and member.email:
            org_result = await db.execute(
                select(Organization).where(Organization.id == current_user.organization_id)
            )
            organization = org_result.scalar_one_or_none()

            async def _send_report():
                try:
                    from app.services.email_service import EmailService
                    email_svc = EmailService(organization)
                    org_name = organization.name if organization else "Department"
                    subject = f"Notice of Department Property Return — {org_name}"
                    await email_svc.send_email(
                        to_emails=[member.email],
                        subject=subject,
                        html_body=html_content,
                        text_body=(
                            f"Property Return Notice\n\n"
                            f"Dear {member.full_name},\n\n"
                            f"Your membership status with {org_name} has been changed to "
                            f"{report_data['drop_type_display']} effective {report_data['effective_date']}.\n\n"
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
