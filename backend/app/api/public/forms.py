"""
Public Forms API Endpoints

Public endpoints for viewing and submitting forms that are marked as public.
Viewing is anonymous; submission policy is enforced from each form's settings.

Security measures:
- Rate limiting per IP (10 submissions per minute, 60 views per minute)
- Honeypot field detection for bot filtering
- Input sanitization on all submitted data (HTML escape, length limits, type validation)
- Slug validation to prevent path traversal
"""

import re

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_optional_current_user
from app.api.public import responses as public_responses
from app.core.captcha import require_captcha
from app.core.database import get_db
from app.core.security_middleware import (
    get_client_ip,
    public_rate_limit,
)
from app.models.user import Organization, User
from app.schemas.forms import (
    EmbedPolicyResponse,
    PublicFormFieldResponse,
    PublicFormResponse,
    PublicFormSubmissionCreate,
    PublicFormSubmissionResponse,
)
from app.services.forms_service import FormsService
from app.utils.embed_origins import valid_embed_origins

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
    is_limited, reason = await public_rate_limit(
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
    is_limited, reason = await public_rate_limit(
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

    No authentication is required to view a published public form.
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
        require_authentication=form.require_authentication,
        fields=fields,
        organization_name=org_name,
    )


# The header nginx copies into ``frame-ancestors`` for /embed/f/<slug>.
EMBED_ANCESTORS_HEADER = "X-Embed-Frame-Ancestors"
NO_EMBED = "'none'"


@router.get(
    "/{slug}/embed-policy",
    response_model=EmbedPolicyResponse,
    dependencies=[Depends(_rate_limit_view)],
)
async def get_embed_policy(
    slug: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Which websites may show this form in an iframe (public, no auth).

    Asked by nginx (``auth_request``) each time ``/embed/f/<slug>`` is served,
    and copied into that page's ``Content-Security-Policy: frame-ancestors``.
    The answer is the department's own websites only when the form is
    published, public and has ``allow_embed`` on, and the department has listed
    at least one; anything else — including a slug that matches nothing — is
    ``'none'``, still with a 200, so the page renders and simply cannot be
    framed rather than nginx turning a refusal into a 500.
    """
    origins: list[str] = []
    if SLUG_PATTERN.match(slug):
        form = await FormsService(db).get_form_by_slug(slug)
        if form is not None and form.allow_embed:
            org_settings = (
                await db.execute(
                    select(Organization.settings).where(
                        Organization.id == form.organization_id
                    )
                )
            ).scalar_one_or_none()
            forms_settings = (org_settings or {}).get("forms")
            stored = (
                forms_settings.get("embed_allowed_origins")
                if isinstance(forms_settings, dict)
                else None
            )
            # Re-checked on the way out: the stored list is free-form JSON,
            # and this value is written into a response header.
            origins = valid_embed_origins(stored if isinstance(stored, list) else [])

    frame_ancestors = " ".join(origins) if origins else NO_EMBED
    response.headers[EMBED_ANCESTORS_HEADER] = frame_ancestors
    response.headers["Cache-Control"] = "no-store"
    return EmbedPolicyResponse(frame_ancestors=frame_ancestors)


@router.post(
    "/{slug}/submit",
    response_model=PublicFormSubmissionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_rate_limit_submit), Depends(require_captcha)],
    # 401 is route-level rather than router-level: the view routes cannot
    # emit it, and over-declaring is its own form of wrong documentation.
    responses=public_responses.FORM_AUTH,
)
async def submit_public_form(
    slug: str,
    submission: PublicFormSubmissionCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    """
    Submit a public form.

    Authentication is enforced when required by the form policy.
    Only works for published forms with public access enabled.
    Includes rate limiting, honeypot detection, and input sanitization.
    """
    _validate_slug(slug)

    service = FormsService(db)
    form = await service.get_form_by_slug(slug)
    if not form:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Form not found or not available",
        )

    # These are authorization/workflow policies, not UI hints. A form that
    # disallows repeat submissions also needs a stable authenticated identity;
    # IP addresses and client-supplied email addresses are trivially bypassed.
    if (
        form.require_authentication or not form.allow_multiple_submissions
    ) and not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication is required to submit this form.",
        )
    if current_user and str(current_user.organization_id) != str(form.organization_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Form not found or not available",
        )

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
        submitted_by=str(current_user.id) if current_user else None,
        enforce_daily_cap=True,
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

    if error or result is None:
        if error == FormsService.PUBLIC_DAILY_CAP_ERROR:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=error or "An unexpected error occurred",
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error or "An unexpected error occurred",
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
