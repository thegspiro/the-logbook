"""
Public Forms API Endpoints

Public endpoints for viewing and submitting forms that are marked as public.
No authentication required - these are accessible by anyone with the form's public URL slug.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models.user import Organization
from app.schemas.forms import (
    PublicFormResponse,
    PublicFormFieldResponse,
    PublicFormSubmissionCreate,
    PublicFormSubmissionResponse,
)
from app.services.forms_service import FormsService

router = APIRouter(prefix="/public/v1/forms", tags=["public-forms"])


@router.get("/{slug}", response_model=PublicFormResponse)
async def get_public_form(
    slug: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get a public form by its URL slug.

    No authentication required.
    Only returns published forms that have public access enabled.
    """
    service = FormsService(db)
    form = await service.get_form_by_slug(slug)

    if not form:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Form not found or not available",
        )

    # Get organization name
    org_result = await db.execute(
        select(Organization).where(Organization.id == form.organization_id)
    )
    org = org_result.scalar_one_or_none()
    org_name = org.name if org else None

    # Build public response (limited fields, no internal IDs exposed)
    fields = [
        PublicFormFieldResponse.model_validate(f)
        for f in sorted(form.fields, key=lambda x: x.sort_order)
        if f.field_type != "member_lookup"  # Don't expose member_lookup to public forms
    ]

    return PublicFormResponse(
        id=form.id,
        name=form.name,
        description=form.description,
        category=form.category.value if hasattr(form.category, 'value') else form.category,
        allow_multiple_submissions=form.allow_multiple_submissions,
        fields=fields,
        organization_name=org_name,
    )


@router.post("/{slug}/submit", response_model=PublicFormSubmissionResponse, status_code=status.HTTP_201_CREATED)
async def submit_public_form(
    slug: str,
    submission: PublicFormSubmissionCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Submit a public form.

    No authentication required.
    Only works for published forms with public access enabled.
    """
    service = FormsService(db)

    # Get IP and user agent for tracking
    ip_address = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent", "")[:500]

    result, error = await service.submit_public_form(
        slug=slug,
        data=submission.data,
        submitter_name=submission.submitter_name,
        submitter_email=submission.submitter_email,
        ip_address=ip_address,
        user_agent=user_agent,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error,
        )

    # Get form name for response
    form = await service.get_form_by_slug(slug)
    form_name = form.name if form else "Form"

    return PublicFormSubmissionResponse(
        id=result.id,
        form_name=form_name,
        submitted_at=result.submitted_at,
        message="Thank you for your submission!",
    )
