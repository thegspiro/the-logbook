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

# Custom legal text is unbounded free text in a JSON settings column; cap what
# the anonymous endpoint will echo back so a stray paste cannot turn the public
# page into a multi-megabyte response.
_MAX_LEGAL_TEXT_CHARS = 100_000
_MAX_LEGAL_DATE_CHARS = 64


def _clean_text(value: object, max_chars: int = _MAX_LEGAL_TEXT_CHARS) -> str | None:
    """Coerce a free-form settings value to plain text, or None.

    ``settings["legal"]`` is unvalidated JSON an administrator may have written
    by hand or through a future settings screen. A number, list, or null there
    must degrade to the built-in defaults rather than 500 a public page.
    """
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    return text[:max_chars]


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
    last_updated = None
    # This endpoint has no org context (anonymous caller, no api key, no
    # subdomain routing) -- `limit(2)` + `len(orgs) == 1` is the only thing
    # standing between "serve the single deployment's text" and "guess which
    # org's text to leak" on a multi-org deployment. Do not replace this with
    # .first(): that would serve an arbitrary organization's legal text to
    # every caller once a second org exists.
    if len(orgs) == 1:
        org = orgs[0]
        organization_name = org.name
        settings = org.settings if isinstance(org.settings, dict) else {}
        legal = settings.get("legal")
        if not isinstance(legal, dict):
            legal = {}
        # Plain text only — rendered as text paragraphs client-side, never
        # as HTML, so org admins cannot inject markup into a public page.
        privacy_policy = _clean_text(legal.get("privacy_policy"))
        terms_of_service = _clean_text(legal.get("terms_of_service"))
        # Revision date shown above custom text. The built-in defaults carry
        # their own date in the frontend, so this applies to custom text only.
        last_updated = _clean_text(legal.get("last_updated"), _MAX_LEGAL_DATE_CHARS)

    return {
        "organizationName": organization_name,
        "privacyPolicy": privacy_policy,
        "termsOfService": terms_of_service,
        "lastUpdated": last_updated,
    }
