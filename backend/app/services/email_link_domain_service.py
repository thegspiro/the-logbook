"""
The link domain an IT administrator saves from Settings → Email.

Every emailed link is built from ``settings.FRONTEND_URL`` at the moment it is
sent, from 29 call sites, several of them synchronous helpers with no database
session. Rather than thread a lookup through each of them, the saved value is
applied to ``settings.FRONTEND_URL`` itself in every worker (see
app.core.link_domain_sync), the same way resolve_frontend_url already replaces
a loopback value at startup.

The value belongs to the deployment, not to whichever organization happens to
ask, so it is stored on the organization this deployment serves — the oldest
active one, as branding_service resolves it — under ``email_link_domain``.
"""

import copy
from datetime import datetime, timezone
from typing import Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user import Organization

SETTINGS_KEY = "email_link_domain"


async def _primary_organization(db: AsyncSession) -> Optional[Organization]:
    result = await db.execute(
        select(Organization)
        .where(Organization.active.is_(True))
        .order_by(Organization.created_at.asc())
        .limit(1)
    )
    return result.scalar_one_or_none()


def _stored_url(org: Optional[Organization]) -> str:
    section = (org.settings or {}).get(SETTINGS_KEY) if org else None
    if not isinstance(section, dict):
        return ""
    value = section.get("url")
    return value if isinstance(value, str) else ""


async def load_into_settings(db: AsyncSession) -> Optional[str]:
    """Apply the saved link domain to this worker, returning what was applied.

    A saved value that no longer validates — its host was since removed from
    TRUSTED_HOSTS or ALLOWED_ORIGINS — is ignored rather than trusted, so
    emails fall back to the deployment's own address. No saved value means
    the deployment's address, never "no links".
    """
    stored = _stored_url(await _primary_organization(db))
    applied: Optional[str] = None
    if stored:
        try:
            applied = settings.validate_link_domain(stored)
        except ValueError as e:
            logger.warning(
                "Ignoring the saved email link domain {!r}: {} Emails will use "
                "{} until it is changed.",
                stored,
                e,
                settings._frontend_url_deployment or settings.FRONTEND_URL,
            )
    settings.apply_link_domain_override(applied)
    return applied


async def _writable_primary(db: AsyncSession, organization_id: str) -> Organization:
    org = await _primary_organization(db)
    # SEC: the value applies to the whole deployment, so only the organization
    # the deployment serves may set it.
    if org is None or str(org.id) != str(organization_id):
        raise PermissionError(
            "The email link address can only be changed by the organization "
            "this server is set up for."
        )
    return org


async def set_link_domain(
    db: AsyncSession, organization_id: str, url: str, user_id: str
) -> tuple[str, str]:
    """Save and apply a link domain, returning ``(previous, new)``.

    Raises ValueError for an address this server does not serve.
    """
    normalized = settings.validate_link_domain(url)
    org = await _writable_primary(db, organization_id)
    previous = settings.FRONTEND_URL
    updated = copy.deepcopy(org.settings or {})
    updated[SETTINGS_KEY] = {
        "url": normalized,
        "updated_by": str(user_id),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    org.settings = updated
    await db.commit()
    settings.apply_link_domain_override(normalized)
    return previous, normalized


async def clear_link_domain(db: AsyncSession, organization_id: str) -> tuple[str, str]:
    """Remove the saved link domain, returning ``(previous, new)``."""
    org = await _writable_primary(db, organization_id)
    previous = settings.FRONTEND_URL
    updated = copy.deepcopy(org.settings or {})
    updated.pop(SETTINGS_KEY, None)
    org.settings = updated
    await db.commit()
    settings.apply_link_domain_override(None)
    return previous, settings.FRONTEND_URL
