"""
RFC 9116 security.txt endpoint.

Serves ``/.well-known/security.txt`` so security researchers can discover
this deployment's vulnerability-reporting channel (ISO/IEC 29147 vulnerability
disclosure alignment). Content is configuration-driven so each department can
point researchers at its own security contact; the default falls back to the
upstream project's GitHub security-advisory intake.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from app.core.config import settings

router = APIRouter(tags=["public-security-txt"])

# RFC 9116 requires an Expires field and recommends it be under a year out.
# Regenerating it per request keeps the file from ever going stale.
_EXPIRES_DAYS = 180


def build_security_txt() -> str:
    """Render the security.txt body from current settings."""
    contact = (
        settings.SECURITY_TXT_CONTACT
        or "https://github.com/thegspiro/the-logbook/security/advisories/new"
    )
    # Bare email addresses need the mailto: scheme per RFC 9116 §2.3.
    if "@" in contact and not contact.startswith(("mailto:", "http://", "https://")):
        contact = f"mailto:{contact}"
    expires = datetime.now(timezone.utc) + timedelta(days=_EXPIRES_DAYS)
    lines = [
        f"Contact: {contact}",
        f"Expires: {expires.strftime('%Y-%m-%dT%H:%M:%SZ')}",
        f"Policy: {settings.SECURITY_TXT_POLICY_URL}",
        "Preferred-Languages: en",
    ]
    return "\n".join(lines) + "\n"


@router.get(
    "/.well-known/security.txt",
    response_class=PlainTextResponse,
    include_in_schema=False,
)
async def security_txt() -> str:
    """Serve the RFC 9116 vulnerability-disclosure pointer."""
    return build_security_txt()
