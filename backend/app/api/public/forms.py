"""
Public Forms API Endpoints

Public endpoints for viewing and submitting forms that are marked as public.
No authentication required - these are accessible by anyone with the form's public URL slug.

Security measures:
- Rate limiting per IP (10 submissions per minute, 60 views per minute)
- Honeypot field detection for bot filtering
- Input sanitization on all submitted data (HTML escape, length limits, type validation)
- Slug validation to prevent path traversal
"""

import re

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security_middleware import get_client_ip, rate_limiter
from app.models.user import Organization
from app.schemas.forms import (
    PublicFormFieldResponse,
    PublicFormResponse,
    PublicFormSubmissionCreate,
    PublicFormSubmissionResponse,
)
from app.services.forms_service import FormsService

router = APIRouter(prefix="/public/v1/forms", tags=["public-forms"])

# Slug format: exactly 12 hex characters
SLUG_PATTERN = re.compile(r"^[a-f0-9]{12}$")


def _validate_slug(slug: str) -> str:
    """Validate the form slug format to prevent path traversal or injection."""
    if not SLUG_PATTERN.match(slug):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Form not found or not available",
        )
    return slug


async def _rate_limit_view(request: Request) -> None:
    """Rate limit public form views: 60 per minute per IP."""
    client_ip = get_client_ip(request)
    is_limited, reason = rate_limiter.is_rate_limited(
        key=f"pub_form_view:{client_ip}",
        max_requests=60,
        window_seconds=60,
        lockout_seconds=300,  # 5 minute lockout
    )
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please try again later.",
        )


async def _rate_limit_submit(request: Request) -> None:
    """Rate limit public form submissions: 10 per minute per IP."""
    client_ip = get_client_ip(request)
    is_limited, reason = rate_limiter.is_rate_limited(
        key=f"pub_form_submit:{client_ip}",
        max_requests=10,
        window_seconds=60,
        lockout_seconds=600,  # 10 minute lockout
    )
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many submissions. Please try again later.",
        )


@router.get(
    "/{slug}",
    response_model=PublicFormResponse,
    dependencies=[Depends(_rate_limit_view)],
)
async def get_public_form(
    slug: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get a public form by its URL slug.

    No authentication required.
    Only returns published forms that have public access enabled.
    """
    _validate_slug(slug)

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
        category=(
            form.category.value if hasattr(form.category, "value") else form.category
        ),
        allow_multiple_submissions=form.allow_multiple_submissions,
        fields=fields,
        organization_name=org_name,
    )


@router.post(
    "/{slug}/submit",
    response_model=PublicFormSubmissionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_rate_limit_submit)],
)
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
    Includes rate limiting, honeypot detection, and input sanitization.
    """
    _validate_slug(slug)

    service = FormsService(db)

    # Get IP and user agent for tracking
    ip_address = get_client_ip(request)
    user_agent = request.headers.get("user-agent", "")[:500]

    result, error = await service.submit_public_form(
        slug=slug,
        data=submission.data,
        submitter_name=submission.submitter_name,
        submitter_email=submission.submitter_email,
        ip_address=ip_address,
        user_agent=user_agent,
        honeypot_value=submission.hp_website,
    )

    # Honeypot triggered - bot detected, return fake success
    if result is None and error is None:
        import uuid
        from datetime import datetime, timezone

        return PublicFormSubmissionResponse(
            id=uuid.uuid4(),
            form_name="Form",
            submitted_at=datetime.now(timezone.utc),
            message="Thank you for your submission!",
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
