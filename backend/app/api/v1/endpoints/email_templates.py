"""
Email Template Admin Endpoints

CRUD endpoints for managing email templates.
Accessible by admins via the membership module admin area.
"""

import os
import uuid


from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from loguru import logger
from sqlalchemy.exc import DataError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.database import get_db
from app.models.email_template import (
    EmailAttachment,
    EmailTemplate,
    EmailTemplateType,
    ScheduledEmail,
    ScheduledEmailStatus,
)
from app.models.user import User
from app.schemas.email_template import (
    EmailAttachmentResponse,
    EmailTemplatePreviewRequest,
    EmailTemplatePreviewResponse,
    EmailTemplateResponse,
    EmailTemplateUpdate,
    ScheduledEmailCreate,
    ScheduledEmailResponse,
    ScheduledEmailUpdate,
)
from app.services.email_template_service import SAMPLE_CONTEXT, EmailTemplateService

router = APIRouter()


@router.get("", response_model=list[EmailTemplateResponse])
async def list_email_templates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """
    List all email templates for the current user's organization.

    Requires: settings.manage or organization.update_settings permission.
    """
    service = EmailTemplateService(db)

    # Ensure default templates exist
    try:
        await service.ensure_default_templates(
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
        await db.commit()
    except DataError as e:
        logger.error(f"Failed to create default email templates: {e}")
        await db.rollback()

    templates = await service.list_templates(current_user.organization_id)
    return templates


@router.get("/scheduled", response_model=list[ScheduledEmailResponse])
async def list_scheduled_emails(
    status_filter: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """List scheduled emails for the current organization."""
    from sqlalchemy import select

    q = (
        select(ScheduledEmail)
        .where(ScheduledEmail.organization_id == current_user.organization_id)
        .order_by(ScheduledEmail.scheduled_at.desc())
    )
    if status_filter:
        try:
            s = ScheduledEmailStatus(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status: {status_filter}",
            )
        q = q.where(ScheduledEmail.status == s)

    result = await db.execute(q)
    return list(result.scalars().all())


@router.get("/{template_id}", response_model=EmailTemplateResponse)
async def get_email_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """Get a specific email template by ID"""
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(EmailTemplate)
        .where(
            EmailTemplate.id == template_id,
            EmailTemplate.organization_id == current_user.organization_id,
        )
        .options(selectinload(EmailTemplate.attachments))
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Email template not found"
        )
    return template


@router.put("/{template_id}", response_model=EmailTemplateResponse)
async def update_email_template(
    template_id: str,
    update_data: EmailTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """
    Update an email template's content, subject, CSS, or settings.

    Admins use this to customize the welcome email message, styling, etc.
    """
    service = EmailTemplateService(db)
    template = await service.update_template(
        template_id=template_id,
        organization_id=current_user.organization_id,
        updated_by=current_user.id,
        **update_data.model_dump(exclude_none=True),
    )
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Email template not found"
        )
    await db.commit()
    return template


@router.post("/{template_id}/preview", response_model=EmailTemplatePreviewResponse)
async def preview_email_template(
    template_id: str,
    preview_data: EmailTemplatePreviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """
    Preview a rendered email template with sample or live data.

    Accepts optional override fields (subject, html_body, css_styles) so the
    admin can preview unsaved edits. If not provided, uses the stored template.

    Live data sources:
    - Organization name/logo are always pulled from the real org record.
    - If ``member_id`` is set, the selected member's name/email replaces
      static sample values in the preview context.
    """
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from app.models.user import Organization

    result = await db.execute(
        select(EmailTemplate)
        .where(
            EmailTemplate.id == template_id,
            EmailTemplate.organization_id == current_user.organization_id,
        )
        .options(selectinload(EmailTemplate.attachments))
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Email template not found"
        )

    service = EmailTemplateService(db)

    # Build context: start with per-type sample data, overlay any
    # explicit values the admin sent so preview always looks realistic.
    template_type_key = (
        template.template_type.value
        if hasattr(template.template_type, "value")
        else str(template.template_type)
    )
    context = {**SAMPLE_CONTEXT.get(template_type_key, {}), **preview_data.context}

    # --- Inject live organization data ---
    org_result = await db.execute(
        select(Organization).where(Organization.id == current_user.organization_id)
    )
    organization = org_result.scalar_one_or_none()
    if organization:
        context["organization_name"] = organization.name or context.get(
            "organization_name", ""
        )
        context["organization_logo"] = getattr(organization, "logo", None) or ""

    # --- Inject live member data if member_id provided ---
    if preview_data.member_id:
        member_result = await db.execute(
            select(User).where(
                User.id == preview_data.member_id,
                User.organization_id == current_user.organization_id,
            )
        )
        member = member_result.scalar_one_or_none()
        if member:
            first = getattr(member, "first_name", "") or ""
            last = getattr(member, "last_name", "") or ""
            full = getattr(member, "full_name", None) or f"{first} {last}".strip()
            # Populate all common name/email variables used across templates
            context["first_name"] = first
            context["last_name"] = last
            context["full_name"] = full
            context["recipient_name"] = full
            context["member_name"] = full
            context["coordinator_name"] = full
            context["contact_name"] = full
            context["user_name"] = full
            context["username"] = getattr(member, "username", "") or ""
            if getattr(member, "email", None):
                context["user_email"] = member.email

    # Apply overrides for preview if provided
    preview_template = EmailTemplate(
        subject=preview_data.subject or template.subject,
        html_body=preview_data.html_body or template.html_body,
        text_body=preview_data.text_body or template.text_body,
        css_styles=preview_data.css_styles or template.css_styles,
    )

    subject, html_body, text_body = service.render(
        preview_template, context, organization=organization
    )

    return EmailTemplatePreviewResponse(
        subject=subject,
        html_body=html_body,
        text_body=text_body,
    )


@router.post("/{template_id}/attachments", response_model=EmailAttachmentResponse)
async def upload_attachment(
    template_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """
    Upload a file attachment for an email template.

    Files are stored locally (or in MinIO when configured).
    Max file size: 10MB.
    """
    from sqlalchemy import select

    # Verify template exists and belongs to this org
    result = await db.execute(
        select(EmailTemplate).where(
            EmailTemplate.id == template_id,
            EmailTemplate.organization_id == current_user.organization_id,
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Email template not found"
        )

    if not template.allow_attachments:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This template does not allow attachments",
        )

    # Read file and enforce size limit (10MB)
    contents = await file.read()
    max_size = 10 * 1024 * 1024
    if len(contents) > max_size:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File exceeds 10MB limit",
        )

    # Validate file extension — block executable and script types
    ALLOWED_EXTENSIONS = {
        ".pdf",
        ".doc",
        ".docx",
        ".xls",
        ".xlsx",
        ".ppt",
        ".pptx",
        ".txt",
        ".csv",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".bmp",
        ".svg",
        ".zip",
        ".ics",
    }
    _, ext = os.path.splitext(file.filename or "attachment")
    ext = ext.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type '{ext}' is not allowed. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    # SEC: Validate actual file content via magic bytes, not just extension
    ALLOWED_EMAIL_MIME_TYPES = {
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "text/plain",
        "text/csv",
        "text/calendar",
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/bmp",
        "image/svg+xml",
        "application/zip",
        "application/x-zip-compressed",
    }
    try:
        import magic

        detected_mime = magic.from_buffer(contents[:2048], mime=True)
        if detected_mime not in ALLOWED_EMAIL_MIME_TYPES:
            logger.warning(
                f"Email attachment rejected: detected MIME '{detected_mime}' "
                f"(claimed: '{file.content_type}') for file '{file.filename}'"
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File content type '{detected_mime}' is not allowed.",
            )
    except ImportError:
        pass  # magic library optional — fall back to extension check only

    # Store file with UUID name (prevents path traversal)
    attachment_dir = os.path.join(
        "storage", "email_attachments", current_user.organization_id
    )
    os.makedirs(attachment_dir, exist_ok=True)

    file_id = str(uuid.uuid4())
    storage_filename = f"{file_id}{ext}"
    storage_path = os.path.join(attachment_dir, storage_filename)

    with open(storage_path, "wb") as f:
        f.write(contents)

    # Human-readable file size
    size = len(contents)
    if size < 1024:
        file_size = f"{size} B"
    elif size < 1024 * 1024:
        file_size = f"{size / 1024:.1f} KB"
    else:
        file_size = f"{size / (1024 * 1024):.1f} MB"

    attachment = EmailAttachment(
        id=file_id,
        template_id=template_id,
        filename=file.filename or "attachment",
        content_type=file.content_type or "application/octet-stream",
        file_size=file_size,
        storage_path=storage_path,
        uploaded_by=current_user.id,
    )
    db.add(attachment)
    await db.commit()
    await db.refresh(attachment)

    logger.info(f"Attachment uploaded: {file.filename} for template {template_id}")
    return attachment


@router.delete(
    "/{template_id}/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_attachment(
    template_id: str,
    attachment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """Delete an attachment from an email template"""
    from sqlalchemy import select

    result = await db.execute(
        select(EmailAttachment)
        .join(EmailTemplate)
        .where(
            EmailAttachment.id == attachment_id,
            EmailAttachment.template_id == template_id,
            EmailTemplate.organization_id == current_user.organization_id,
        )
    )
    attachment = result.scalar_one_or_none()
    if not attachment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found"
        )

    # Remove file from disk
    if os.path.isfile(attachment.storage_path):
        os.remove(attachment.storage_path)

    await db.delete(attachment)
    await db.commit()
    logger.info(
        f"Attachment deleted: {attachment.filename} from template {template_id}"
    )


# ---------------------------------------------------------------------------
# Scheduled Emails
# ---------------------------------------------------------------------------


@router.post("/schedule", response_model=ScheduledEmailResponse)
async def schedule_email(
    body: ScheduledEmailCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """Schedule an email to be sent at a specific date/time."""
    from app.core.utils import generate_uuid

    if body.scheduled_at.tzinfo is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="scheduled_at must include timezone info (UTC recommended)",
        )

    # Validate template_type
    try:
        ttype = EmailTemplateType(body.template_type)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid template_type: {body.template_type}",
        )

    scheduled = ScheduledEmail(
        id=generate_uuid(),
        organization_id=current_user.organization_id,
        template_id=body.template_id,
        template_type=ttype,
        to_emails=body.to_emails,
        cc_emails=body.cc_emails,
        bcc_emails=body.bcc_emails,
        context=body.context,
        scheduled_at=body.scheduled_at,
        status=ScheduledEmailStatus.PENDING,
        created_by=current_user.id,
    )
    db.add(scheduled)
    await db.commit()
    await db.refresh(scheduled)

    logger.info(
        f"Scheduled email created id={scheduled.id} "
        f"type={body.template_type} at={body.scheduled_at}"
    )
    return scheduled


@router.patch("/scheduled/{scheduled_id}", response_model=ScheduledEmailResponse)
async def update_scheduled_email(
    scheduled_id: str,
    body: ScheduledEmailUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """Update or reschedule a pending scheduled email."""
    from sqlalchemy import select

    result = await db.execute(
        select(ScheduledEmail).where(
            ScheduledEmail.id == scheduled_id,
            ScheduledEmail.organization_id == current_user.organization_id,
        )
    )
    scheduled = result.scalar_one_or_none()
    if not scheduled:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Scheduled email not found",
        )

    if scheduled.status != ScheduledEmailStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only pending emails can be updated",
        )

    if body.scheduled_at is not None:
        if body.scheduled_at.tzinfo is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="scheduled_at must include timezone info (UTC recommended)",
            )
        scheduled.scheduled_at = body.scheduled_at
    if body.status == "cancelled":
        scheduled.status = ScheduledEmailStatus.CANCELLED

    await db.commit()
    await db.refresh(scheduled)
    return scheduled


@router.delete("/scheduled/{scheduled_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_scheduled_email(
    scheduled_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """Cancel (delete) a pending scheduled email."""
    from sqlalchemy import select

    result = await db.execute(
        select(ScheduledEmail).where(
            ScheduledEmail.id == scheduled_id,
            ScheduledEmail.organization_id == current_user.organization_id,
        )
    )
    scheduled = result.scalar_one_or_none()
    if not scheduled:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Scheduled email not found",
        )

    if scheduled.status == ScheduledEmailStatus.SENT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete an already-sent email",
        )

    await db.delete(scheduled)
    await db.commit()
