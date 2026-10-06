"""
Whether a department tracks NFPA apparatus compliance.

Stored in the organization settings as ``apparatus.nfpa_compliance_enabled``.
Fire departments are held to NFPA apparatus standards (1911 inspection and
testing, 1962 hose, 1932 ground ladders); an EMS-only agency mostly is not,
and a full compliance page there is noise. So the department chooses, and
until it does the choice follows its organization type: on for fire and
combined departments, off for EMS-only (owner decision, 2026-10-05).

Pitfall #19: this is the reader. Every NFPA compliance endpoint depends on
it, so turning the switch off withholds the data on the server rather than
only hiding a tab. Nothing is deleted; turning it back on restores it.
"""

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Organization

APPARATUS_SETTINGS_KEY = "apparatus"
NFPA_FLAG = "nfpa_compliance_enabled"

# Organization types held to NFPA apparatus standards by default.
_NFPA_BY_DEFAULT = {"fire_department", "fire_ems_combined"}

_DISABLED_MESSAGE = (
    "NFPA apparatus compliance is not turned on for this department. An "
    "administrator can turn it on under Apparatus → NFPA Compliance."
)


def _type_value(organization_type: Any) -> str:
    return str(getattr(organization_type, "value", organization_type) or "")


def nfpa_default_for(organization_type: Any) -> bool:
    """What a department gets before it has chosen."""
    return _type_value(organization_type) in _NFPA_BY_DEFAULT


def nfpa_explicit_choice(settings: Any) -> bool | None:
    """The department's stored choice, or ``None`` if it has not made one.

    Only a literal boolean counts: the JSON is unvalidated, and a stray
    ``"false"`` string must not read as a choice either way.
    """
    if not isinstance(settings, dict):
        return None
    section = settings.get(APPARATUS_SETTINGS_KEY)
    if not isinstance(section, dict):
        return None
    value = section.get(NFPA_FLAG)
    return value if isinstance(value, bool) else None


def nfpa_enabled_in(settings: Any, organization_type: Any) -> bool:
    """The department's choice, or its organization type's default."""
    choice = nfpa_explicit_choice(settings)
    return nfpa_default_for(organization_type) if choice is None else choice


async def apparatus_nfpa_state(
    db: AsyncSession, organization_id: str
) -> tuple[bool, bool, bool | None]:
    """``(enabled, default_for_type, explicit_choice)`` for the department."""
    row = (
        await db.execute(
            select(Organization.settings, Organization.organization_type).where(
                Organization.id == str(organization_id)
            )
        )
    ).first()
    if row is None:
        return False, False, None
    org_settings, organization_type = row
    choice = nfpa_explicit_choice(org_settings)
    default = nfpa_default_for(organization_type)
    return (default if choice is None else choice), default, choice


async def require_apparatus_nfpa(db: AsyncSession, organization_id: str) -> None:
    """Raise 403 unless the department tracks NFPA apparatus compliance."""
    enabled, _, _ = await apparatus_nfpa_state(db, organization_id)
    if not enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=_DISABLED_MESSAGE
        )
