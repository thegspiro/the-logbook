"""
The on/off switch for member NFC ID cards.

Card issuing is an opt-in integration rather than an always-present feature:
a department that has not bought cards and readers should not be offered a
credential surface at all, and one that stops using them wants the cards it
already handed out to stop working without deleting the records that say who
held them.

The switch is enforced **here, on the server**, not only by hiding the UI.
Hiding a screen leaves its endpoints reachable, and these endpoints issue and
consume credentials.

Pitfall #19: a config switch must have a reader before it has a UI. This is
that reader — every NFC endpoint depends on it.
"""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import Integration

NFC_INTEGRATION_TYPE = "nfc-id-cards"

_DISABLED_MESSAGE = (
    "NFC ID cards are not enabled for this organization. "
    "An administrator can turn them on under Settings → Integrations."
)


async def nfc_id_cards_enabled(db: AsyncSession, organization_id: str) -> bool:
    """True when this organization has connected the NFC ID Cards integration.

    Fails **closed**: an organization whose catalog row has not been seeded yet
    (a fresh install that has never opened the integrations screen) has not
    turned anything on, and treating a missing row as "on" would hand every
    such department a live credential surface nobody asked for.
    """
    result = await db.execute(
        select(Integration.enabled, Integration.status).where(
            Integration.organization_id == str(organization_id),
            Integration.integration_type == NFC_INTEGRATION_TYPE,
        )
    )
    row = result.first()
    if row is None:
        return False
    enabled, integration_status = row
    return bool(enabled) and integration_status == "connected"


async def require_nfc_id_cards(db: AsyncSession, organization_id: str) -> None:
    """Raise 403 unless the organization has NFC ID cards turned on."""
    if not await nfc_id_cards_enabled(db, organization_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=_DISABLED_MESSAGE
        )
