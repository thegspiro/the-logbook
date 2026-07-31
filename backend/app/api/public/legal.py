"""
Public Legal Text API Endpoint

Unauthenticated endpoint backing the /privacy and /terms pages. Returns the
organization's configured privacy-policy / terms-of-service text (stored
under ``settings["legal"]`` on the organization) so departments can publish
their own wording; the frontend falls back to built-in defaults when no
custom text is configured.

Multi-tenant note: this endpoint is anonymous, so there is no org context to
resolve from the caller. Deployments are overwhelmingly single-department;
with exactly one organization its custom text is served, otherwise only the
defaults apply (custom text stays null).
"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security_middleware import get_client_ip, public_rate_limit
from app.models.user import Organization

router = APIRouter(prefix="/public/v1/legal", tags=["public-legal"])


async def _rate_limit_legal(request: Request) -> None:
    """Rate limit legal-text lookups: 30/minute per IP (DoS guard)."""
    client_ip = get_client_ip(request)
    is_limited, _ = await public_rate_limit(
        key=f"pub_legal:{client_ip}", max_requests=30, window_seconds=60
    )
    if is_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please try again later.",
        )


@router.get("")
async def get_legal_text(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_rate_limit_legal),
) -> dict:
    """Return org-configured legal text, or nulls for built-in defaults."""
    result = await db.execute(select(Organization).limit(2))
    orgs = result.scalars().all()

    organization_name = None
    privacy_policy = None
    terms_of_service = None
    if len(orgs) == 1:
        org = orgs[0]
        organization_name = org.name
        legal = (org.settings or {}).get("legal", {})
        # Plain text only — rendered as text paragraphs client-side, never
        # as HTML, so org admins cannot inject markup into a public page.
        privacy_policy = legal.get("privacy_policy") or None
        terms_of_service = legal.get("terms_of_service") or None

    return {
        "organizationName": organization_name,
        "privacyPolicy": privacy_policy,
        "termsOfService": terms_of_service,
    }
