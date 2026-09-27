"""
Inventory Self-Service Kiosk

A shared tablet, opened by an officer holding ``inventory.kiosk``, where
members check loaner gear out and back in themselves: tap your ID card, then
the item's tag.

Every action re-reads the member's card. The kiosk screen never sends a member
id of its own, so a tampered client cannot check gear out to somebody who did
not tap their card. The officer who opened the kiosk is recorded as
``checked_out_by`` / ``checked_in_by``; the member is the borrower.

The moves themselves are ``InventoryService.checkout_item`` / ``checkin_item``,
the same code a quartermaster's checkout uses, so a kiosk loan is an ordinary
checkout: it shows in Active Checkouts, feeds the overdue emails, and counts as
the item being seen.

What the kiosk adds on top is who may take what:

* the item's category must allow self-checkout (off by default);
* the item must be individually tracked (a pool is issued, not checked out);
* the member must clear the item's rank/position restriction, the same rule
  the request catalog applies;
* a return is accepted only from the member the item is checked out to.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.inventory import (
    CheckOutRecord,
    InventoryItem,
    ItemCondition,
    ItemStatus,
    TrackingType,
)
from app.models.user import User
from app.schemas.nfc_tag import NfcCheckInStatus
from app.services.inventory_nfc_service import (
    InventoryNfcService,
    InventoryNfcTagNotFound,
)
from app.services.inventory_service import InventoryService
from app.services.nfc_tag_service import NfcTagService

KIOSK_REASON = "Self-service kiosk"

ACTION_CHECKOUT = "checkout"
ACTION_RETURN = "return"


class KioskRefusal(Exception):
    """A tap the kiosk will not act on. The message is shown to the member."""


@dataclass
class _Tap:
    member: User
    item: InventoryItem
    # The member's open checkout of this item, when there is one.
    open_checkout: Optional[CheckOutRecord]


def _member_name(user: User) -> str:
    name = f"{user.first_name or ''} {user.last_name or ''}".strip()
    return name or user.username


class InventoryKioskService:
    """Self-service checkout and return."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.inventory = InventoryService(db)

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    async def identify(
        self, organization_id: str, card: Sequence[Optional[str]]
    ) -> Dict[str, Any]:
        """The member a tapped card belongs to, and what they have out."""
        member = await self._member(organization_id, card)
        return {
            "member_name": _member_name(member),
            "loans": await self._loans(organization_id, member),
        }

    async def preview(
        self,
        organization_id: str,
        card: Sequence[Optional[str]],
        item_tag: Sequence[Optional[str]],
    ) -> Dict[str, Any]:
        """What tapping this item would do, without doing it.

        ``return`` when the item is checked out to this member; otherwise
        ``checkout``, after every rule that would refuse it. Raises
        ``KioskRefusal`` with the reason.
        """
        tap = await self._tap(organization_id, card, item_tag)
        if tap.open_checkout is not None:
            return {
                "action": ACTION_RETURN,
                "item_id": tap.item.id,
                "item_name": tap.item.name,
                "due_at": tap.open_checkout.expected_return_at,
            }
        await self._check_checkout_allowed(organization_id, tap)
        return {
            "action": ACTION_CHECKOUT,
            "item_id": tap.item.id,
            "item_name": tap.item.name,
            "due_at": self._due_at(tap.item),
        }

    # ------------------------------------------------------------------
    # Writes
    # ------------------------------------------------------------------

    async def checkout(
        self,
        organization_id: str,
        operator_id: str,
        card: Sequence[Optional[str]],
        item_tag: Sequence[Optional[str]],
    ) -> Dict[str, Any]:
        """Check the tapped item out to the member whose card was tapped."""
        tap = await self._tap(organization_id, card, item_tag)
        if tap.open_checkout is not None:
            raise KioskRefusal(f"You already have {tap.item.name}.")
        await self._check_checkout_allowed(organization_id, tap)

        due_at = self._due_at(tap.item)
        # Read before checkout_item commits: nothing here should depend on the
        # session's expire_on_commit setting to stay readable.
        summary = self._summary(tap)
        record, error = await self.inventory.checkout_item(
            item_id=tap.item.id,
            user_id=tap.member.id,
            organization_id=organization_id,
            checked_out_by=operator_id,
            expected_return_at=due_at,
            reason=KIOSK_REASON,
        )
        if record is None:
            # The item was taken between the check above and the lock inside
            # checkout_item; its own message says why.
            raise KioskRefusal(error or "This item cannot be checked out.")
        return {
            **summary,
            "action": ACTION_CHECKOUT,
            "checkout_id": record.id,
            "due_at": due_at,
        }

    async def return_item(
        self,
        organization_id: str,
        operator_id: str,
        card: Sequence[Optional[str]],
        item_tag: Sequence[Optional[str]],
        *,
        damaged: bool,
        damage_notes: Optional[str],
    ) -> Dict[str, Any]:
        """Check the tapped item back in from the member who has it.

        Not damaged keeps the item's condition as it is; damaged marks it
        ``damaged`` with the member's note, which quartermasters then see on
        the item and the checkout.
        """
        tap = await self._tap(organization_id, card, item_tag)
        if tap.open_checkout is None:
            raise KioskRefusal(
                f"{tap.item.name} is not checked out to you. "
                "Hand it to a quartermaster."
            )
        note = (damage_notes or "").strip() or None
        if damaged and not note:
            raise KioskRefusal("Say briefly what is damaged.")

        condition = ItemCondition.DAMAGED if damaged else tap.item.condition
        summary = self._summary(tap)
        checkout_id = tap.open_checkout.id
        ok, error = await self.inventory.checkin_item(
            checkout_id=checkout_id,
            organization_id=organization_id,
            checked_in_by=operator_id,
            return_condition=condition,
            damage_notes=note if damaged else None,
        )
        if not ok:
            raise KioskRefusal(error or "This item could not be returned.")
        return {
            **summary,
            "action": ACTION_RETURN,
            "checkout_id": checkout_id,
            "damaged": damaged,
        }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _member(
        self, organization_id: str, card: Sequence[Optional[str]]
    ) -> User:
        _tag, user, refusal = await NfcTagService(self.db).resolve_tag(
            organization_id, card
        )
        if refusal == NfcCheckInStatus.UNKNOWN_CARD:
            raise KioskRefusal("This card is not registered to a member.")
        if refusal == NfcCheckInStatus.CARD_INACTIVE:
            raise KioskRefusal(
                "This card has been marked lost or replaced and no longer works."
            )
        if refusal is not None or user is None:
            raise KioskRefusal(
                "This card belongs to a member who is not currently active."
            )
        return user

    async def _tap(
        self,
        organization_id: str,
        card: Sequence[Optional[str]],
        item_tag: Sequence[Optional[str]],
    ) -> _Tap:
        member = await self._member(organization_id, card)
        try:
            _tag, item = await InventoryNfcService(self.db).resolve(
                organization_id, item_tag
            )
        except InventoryNfcTagNotFound as e:
            raise KioskRefusal(str(e))

        result = await self.db.execute(
            select(CheckOutRecord).where(
                CheckOutRecord.organization_id == str(organization_id),
                CheckOutRecord.item_id == item.id,
                CheckOutRecord.user_id == member.id,
                CheckOutRecord.is_returned.is_(False),
            )
        )
        return _Tap(member=member, item=item, open_checkout=result.scalars().first())

    async def _check_checkout_allowed(self, organization_id: str, tap: _Tap) -> None:
        item = tap.item
        category = item.category
        if category is None or not category.allow_self_checkout:
            raise KioskRefusal(
                f"{item.name} cannot be checked out at the kiosk. "
                "Ask a quartermaster."
            )
        if item.tracking_type != TrackingType.INDIVIDUAL:
            raise KioskRefusal(
                f"{item.name} is issued from stock by a quartermaster, "
                "not checked out."
            )
        if item.status != ItemStatus.AVAILABLE:
            raise KioskRefusal(
                f"{item.name} is not available "
                f"({item.status.value.replace('_', ' ')})."
            )
        if not await self.inventory.member_clears_restrictions(
            item, organization_id, tap.member
        ):
            raise KioskRefusal(
                f"{item.name} is restricted by rank or position. "
                "Ask a quartermaster."
            )

    @staticmethod
    def _summary(tap: _Tap) -> Dict[str, Any]:
        return {
            "item_id": tap.item.id,
            "item_name": tap.item.name,
            "member_id": tap.member.id,
            "member_name": _member_name(tap.member),
        }

    @staticmethod
    def _due_at(item: InventoryItem) -> Optional[datetime]:
        days = item.category.self_checkout_loan_days if item.category else None
        if not days:
            return None
        return datetime.now(timezone.utc) + timedelta(days=days)

    async def _loans(self, organization_id: str, member: User) -> List[Dict]:
        result = await self.db.execute(
            select(CheckOutRecord)
            .where(
                CheckOutRecord.organization_id == str(organization_id),
                CheckOutRecord.user_id == member.id,
                CheckOutRecord.is_returned.is_(False),
            )
            .options(selectinload(CheckOutRecord.item))
            .order_by(CheckOutRecord.checked_out_at.asc(), CheckOutRecord.id.asc())
        )
        return [
            {
                "checkout_id": record.id,
                "item_id": record.item_id,
                "item_name": record.item.name if record.item else "",
                "checked_out_at": record.checked_out_at,
                "due_at": record.expected_return_at,
            }
            for record in result.scalars().all()
        ]
