"""
The on/off switch for NFC tracking in the inventory module.

Stored in the organization settings as ``inventory.nfc_tracking_enabled``,
beside the other inventory settings, and edited from the Inventory admin hub.
It is a module setting rather than an integration (compare
``nfc_integration.py``, which gates member ID cards) because it changes how
Inventory identifies its own items; it connects nothing outside the module.

The switch is enforced **here, on the server**. Hiding the buttons alone would
leave the endpoints reachable.

Pitfall #19: a config switch must have a reader before it has a UI. This is
that reader — every inventory NFC endpoint depends on it.
"""

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Organization

INVENTORY_SETTINGS_KEY = "inventory"
NFC_TRACKING_FLAG = "nfc_tracking_enabled"

_DISABLED_MESSAGE = (
    "NFC tag tracking is not enabled for this organization. "
    "An administrator can turn it on under Inventory → Administration."
)


def nfc_tracking_enabled_in(settings: Any) -> bool:
    """Read the flag out of an organization's settings JSON.

    Absent means off, and that is also "current behaviour": no installation
    had NFC inventory tracking before this setting existed, so an upgrade that
    leaves the key unset changes nothing. Only a literal ``True`` turns it on —
    the JSON is unvalidated, and a stray ``"false"`` string must not read as
    enabled.
    """
    if not isinstance(settings, dict):
        return False
    section = settings.get(INVENTORY_SETTINGS_KEY)
    if not isinstance(section, dict):
        return False
    return section.get(NFC_TRACKING_FLAG) is True


async def inventory_nfc_enabled(db: AsyncSession, organization_id: str) -> bool:
    """True when this organization has switched on NFC inventory tracking."""
    result = await db.execute(
        select(Organization.settings).where(Organization.id == str(organization_id))
    )
    return nfc_tracking_enabled_in(result.scalar_one_or_none())


async def require_inventory_nfc(db: AsyncSession, organization_id: str) -> None:
    """Raise 403 unless the organization has NFC inventory tracking on."""
    if not await inventory_nfc_enabled(db, organization_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=_DISABLED_MESSAGE
        )
