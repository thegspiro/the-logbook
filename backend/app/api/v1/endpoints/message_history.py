"""
Message History & Test Email Endpoints

Provides:
- GET /message-history — paginated list of all emails sent by the application
- POST /message-history/test-email — send a test email to verify configuration
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.database import get_db
from app.core.utils import generate_uuid
from app.models.email_template import (
    EmailTemplate,
    MessageHistory,
    MessageHistoryStatus,
)
from app.models.user import Organization, User
from app.schemas.email_template import (
    MessageHistoryListResponse,
    MessageHistoryResponse,
    SendTestEmailRequest,
)
from app.services.email_service import EmailService

router = APIRouter()


@router.get("", response_model=MessageHistoryListResponse)
async def list_message_history(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    status_filter: str | None = Query(None),
    search: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """
    List all emails sent by the application for the current organization.

    Supports pagination, status filtering, and search by subject or recipient.
    """
    q = select(MessageHistory).where(
        MessageHistory.organization_id == current_user.organization_id
    )

    if status_filter:
        try:
            s = MessageHistoryStatus(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status filter: {status_filter}",
            )
        q = q.where(MessageHistory.status == s)

    if search:
        pattern = f"%{search}%"
        q = q.where(
            (MessageHistory.subject.ilike(pattern))
            | (MessageHistory.to_email.ilike(pattern))
        )

    # Total count
    count_q = select(func.count()).select_from(q.subquery())
    total_result = await db.execute(count_q)
    total = total_result.scalar() or 0

    # Fetch page
    q = q.order_by(MessageHistory.sent_at.desc()).offset(skip).limit(limit)
    result = await db.execute(q)
    items = list(result.scalars().all())

    return MessageHistoryListResponse(
        items=[MessageHistoryResponse.model_validate(item) for item in items],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.post("/test-email", response_model=MessageHistoryResponse)
async def send_test_email(
    body: SendTestEmailRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """
    Send a test email to verify that the email configuration is working.

    Sends a simple test message (or a rendered template preview) to the
    specified address and logs the result in message history.
    """
    # Load organization for org-specific SMTP settings
    org_result = await db.execute(
        select(Organization).where(
            Organization.id == current_user.organization_id
        )
    )
    organization = org_result.scalar_one_or_none()

    subject = "Test Email from The Logbook"
    template_type = None
    html_body = _build_test_html(organization)
    text_body = "This is a test email from The Logbook. If you received this, your email configuration is working correctly."

    # If a template_id was provided, render that template instead
    if body.template_id:
        from sqlalchemy.orm import selectinload

        from app.services.email_template_service import (
            SAMPLE_CONTEXT,
            EmailTemplateService,
        )

        tmpl_result = await db.execute(
            select(EmailTemplate)
            .where(
                EmailTemplate.id == body.template_id,
                EmailTemplate.organization_id == current_user.organization_id,
            )
            .options(selectinload(EmailTemplate.attachments))
        )
        template = tmpl_result.scalar_one_or_none()
        if not template:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Email template not found",
            )

        svc = EmailTemplateService(db)
        ttype_key = (
            template.template_type.value
            if hasattr(template.template_type, "value")
            else str(template.template_type)
        )
        context = {**SAMPLE_CONTEXT.get(ttype_key, {})}
        if organization:
            context["organization_name"] = organization.name or ""
        subject, html_body, text_body = svc.render(
            template, context, organization=organization
        )
        subject = f"[TEST] {subject}"
        template_type = ttype_key

    # Send the email
    email_svc = EmailService(organization=organization)
    success_count, failure_count = await email_svc.send_email(
        to_emails=[body.to_email],
        subject=subject,
        html_body=html_body,
        text_body=text_body,
    )

    # Log to message history
    is_success = success_count > 0
    history = MessageHistory(
        id=generate_uuid(),
        organization_id=current_user.organization_id,
        to_email=body.to_email,
        subject=subject,
        template_type=template_type,
        status=(
            MessageHistoryStatus.SENT if is_success else MessageHistoryStatus.FAILED
        ),
        error_message=None if is_success else "SMTP delivery failed",
        recipient_count=1,
        sent_by=current_user.id,
    )
    db.add(history)
    await db.commit()
    await db.refresh(history)

    if not is_success:
        logger.warning(f"Test email to {body.to_email} failed")
    else:
        logger.info(f"Test email sent to {body.to_email} by {current_user.id}")

    return history


def _build_test_html(organization: Organization | None) -> str:
    """Build a simple HTML test email body."""
    org_name = organization.name if organization else "The Logbook"
    return f"""\
<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #dc2626; padding: 20px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 22px;">{org_name}</h1>
  </div>
  <div style="background: #f9fafb; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
    <h2 style="color: #111827; margin-top: 0;">Test Email</h2>
    <p style="color: #374151; line-height: 1.6;">
      This is a test email sent from <strong>{org_name}</strong>.
      If you are reading this message, your email configuration is working correctly.
    </p>
    <div style="margin-top: 20px; padding: 16px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px;">
      <p style="color: #065f46; margin: 0; font-weight: 600;">
        Email delivery is working!
      </p>
    </div>
    <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">
      This email was sent as a configuration test and requires no action.
    </p>
  </div>
</body>
</html>"""
