"""
Inventory Self-Service Kiosk Schemas

Every request carries what was read off the member's card and, for an item
action, off the item's tag. The kiosk never sends a member id: the card is the
member's say-so, read again on every action.
"""

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, model_validator

from app.schemas.base import UTCResponseBase
from app.schemas.inventory_nfc import InventoryNfcResolveRequest


class KioskIdentifyRequest(BaseModel):
    card: InventoryNfcResolveRequest


class KioskItemRequest(BaseModel):
    card: InventoryNfcResolveRequest
    item: InventoryNfcResolveRequest


class KioskReturnRequest(KioskItemRequest):
    damaged: bool = False
    damage_notes: Optional[str] = Field(None, max_length=500)

    @model_validator(mode="after")
    def _note_when_damaged(self) -> "KioskReturnRequest":
        if self.damaged and not (self.damage_notes or "").strip():
            raise ValueError("Describe the damage")
        return self


class KioskLoan(UTCResponseBase):
    checkout_id: str
    item_id: str
    item_name: str
    checked_out_at: datetime
    due_at: Optional[datetime] = None


class KioskIdentifyResponse(BaseModel):
    member_name: str
    loans: List[KioskLoan]


class KioskPreviewResponse(UTCResponseBase):
    action: Literal["checkout", "return"]
    item_id: str
    item_name: str
    # Checkout: when it will be due back. Return: when it was due.
    due_at: Optional[datetime] = None


class KioskActionResponse(UTCResponseBase):
    action: Literal["checkout", "return"]
    checkout_id: str
    item_id: str
    item_name: str
    member_name: str
    due_at: Optional[datetime] = None
    damaged: bool = False
