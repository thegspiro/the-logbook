"""
Inventory "Not Seen" Report Schemas

Snake-case on the wire, like the rest of the inventory API.
"""

from datetime import datetime
from typing import List, Literal, Optional

from app.models.inventory import ItemStatus
from app.schemas.base import UTCResponseBase

LastSeenSource = Literal[
    "nfc_tap",
    "assignment",
    "return",
    "checkout",
    "check_in",
    "issuance",
    "issuance_return",
]


class NotSeenItem(UTCResponseBase):
    id: str
    name: str
    serial_number: Optional[str] = None
    asset_tag: Optional[str] = None
    category_name: Optional[str] = None
    status: ItemStatus
    storage_area_name: Optional[str] = None
    # All three are null for an item with no recorded event at all.
    last_seen_at: Optional[datetime] = None
    last_seen_source: Optional[LastSeenSource] = None
    days_since_seen: Optional[int] = None


class NotSeenReportResponse(UTCResponseBase):
    items: List[NotSeenItem]
    # Every match, even when ``items`` was cut to the requested limit.
    total: int
    cutoff: datetime
