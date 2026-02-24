"""
Email Template Admin Endpoints

CRUD endpoints for managing email templates.
Accessible by admins via the membership module admin area.
"""

import os
import uuid
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.database import get_db
from app.models.email_template import EmailAttachment, EmailTemplate
from app.models.user import User
from app.schemas.email_template import (
    EmailAttachmentResponse,
    EmailTemplatePreviewRequest,
    EmailTemplatePreviewResponse,
    EmailTemplateResponse,
    EmailTemplateUpdate,
)
from app.services.email_template_service import EmailTemplateService

router = APIRouter()


@router.get("", response_model=List[EmailTemplateResponse])
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
    await service.ensure_default_templates(
        organization_id=current_user.organization_id,
        created_by=current_user.id,
    )
    await db.commit()

    templates = await service.list_templates(current_user.organization_id)
    return templates


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
    Preview a rendered email template with sample data.

    Accepts optional override fields (subject, html_body, css_styles) so the
    admin can preview unsaved edits. If not provided, uses the stored template.
    """
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

    service = EmailTemplateService(db)

    # Apply overrides for preview if provided
    preview_template = EmailTemplate(
        subject=preview_data.subject or template.subject,
        html_body=preview_data.html_body or template.html_body,
        text_body=preview_data.text_body or template.text_body,
        css_styles=preview_data.css_styles or template.css_styles,
    )

    subject, html_body, text_body = service.render(
        preview_template, preview_data.context
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
