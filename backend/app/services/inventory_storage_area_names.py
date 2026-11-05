"""
How a list names the storage area an item is recorded on.

One rule, so two screens describing the same item cannot disagree about where
it is (Pitfall #29, W44-4): only an **active** storage area is named, as
``Name (Label)`` when it has a label. Deleting a storage area only deactivates
it and leaves its items pointing at it; the item's own page then shows no
area, because it resolves the id against ``GET /inventory/storage-areas``,
which lists active areas only, and formats the name the same way
(``ItemDetailPage.tsx`` → ``loadItem``). Any change here must be made there too.

Used by the Items Not Seen report and Tag Items in Bulk.
"""

from typing import Dict, Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inventory import StorageArea


def storage_area_display_name(name: str, label: Optional[str]) -> str:
    return f"{name} ({label})" if label else name


async def active_storage_area_names(
    db: AsyncSession, organization_id: str, area_ids: Iterable[Optional[str]]
) -> Dict[str, str]:
    """Display names of the given areas that are active and in the org.

    An id that is missing from the result is a deleted area (or another
    organization's), and the caller shows no area for it.
    """
    ids = {str(a) for a in area_ids if a}
    if not ids:
        return {}
    result = await db.execute(
        select(StorageArea.id, StorageArea.name, StorageArea.label).where(
            StorageArea.id.in_(ids),
            StorageArea.organization_id == str(organization_id),
            StorageArea.is_active.is_(True),
        )
    )
    return {row.id: storage_area_display_name(row.name, row.label) for row in result}
