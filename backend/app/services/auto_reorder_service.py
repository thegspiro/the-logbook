"""
Automatic reorder requests raised when ready stock drops to its reorder point.

The trigger is the equipment-check lot swap: a crew moving units from the
shelf onto an apparatus is the moment storeroom stock goes down, and before
this the only signal was the next morning's low-stock email, which nobody had
to act on. A reorder request in the quartermaster's queue is something to
approve or cancel, not something to remember.

Two rules shape it:

* **One open request per item.** A run of swaps on the same item would
  otherwise file a request each. Any request still pending, approved, ordered
  or partially received counts as open.
* **It runs after the swap commits, in its own transaction.** The swap locks
  the lot; ``add_lot`` locks the item and then its lots. Taking the item lock
  inside the swap would order those two the other way round and let InnoDB
  abort a crew's swap as a deadlock victim. Here the item row is the only lock
  taken, and it is what serializes two swaps of different lots of the same
  item that would otherwise both find no open request.
"""

import html
from typing import Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.inventory import (
    MEDICAL_ITEM_TYPES,
    InventoryItem,
    ReorderRequest,
    ReorderStatus,
    ReorderUrgency,
)
from app.models.user import Organization
from app.services.inventory_service import InventoryService

OPEN_REORDER_STATUSES = (
    ReorderStatus.PENDING,
    ReorderStatus.APPROVED,
    ReorderStatus.ORDERED,
    ReorderStatus.PARTIALLY_RECEIVED,
)


def reorder_quantity(on_hand: int, reorder_point: int) -> int:
    """Enough to bring ready stock back to twice the reorder point.

    The department's decision (2026-10-11): the reorder point is the floor,
    and an order sized only to clear it would trip the next swap straight back
    into another request. Whoever approves the request can still edit it.
    """
    return max(1, 2 * reorder_point - on_hand)


class AutoReorderService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def raise_if_low(
        self, organization_id: str, item_id: str, requested_by: Optional[str]
    ) -> Optional[ReorderRequest]:
        """File a reorder for this item if it is low and none is open.

        Commits its own transaction. Returns the new request, or None when the
        item has no reorder point, is not low, or already has one open.
        """
        item = await self.db.scalar(
            select(InventoryItem)
            .where(
                InventoryItem.id == str(item_id),
                InventoryItem.organization_id == str(organization_id),
            )
            .options(selectinload(InventoryItem.category))
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if item is None or not item.active or item.reorder_point is None:
            await self.db.rollback()
            return None

        inventory = InventoryService(self.db)
        ready = await inventory.ready_on_hand(str(organization_id), [item])
        on_hand, _ = ready[item.id]
        if not inventory.is_at_or_below_reorder_point(on_hand, item.reorder_point):
            await self.db.rollback()
            return None

        # A locking read, not a plain one (CLAUDE.md pitfall #27): a plain
        # SELECT answers from this transaction's snapshot, which could predate
        # a request the swap ahead of us committed while we waited on the item
        # lock above.
        already_open = await self.db.scalar(
            select(ReorderRequest.id)
            .where(
                ReorderRequest.organization_id == str(organization_id),
                ReorderRequest.item_id == item.id,
                ReorderRequest.status.in_(OPEN_REORDER_STATUSES),
            )
            .limit(1)
            .with_for_update()
        )
        if already_open:
            await self.db.rollback()
            return None

        quantity = reorder_quantity(on_hand, item.reorder_point)
        reorder = ReorderRequest(
            organization_id=str(organization_id),
            item_id=item.id,
            category_id=item.category_id,
            item_name=item.name[:255],
            quantity_requested=quantity,
            vendor=item.vendor,
            vendor_id=item.vendor_id,
            urgency=ReorderUrgency.HIGH if on_hand == 0 else ReorderUrgency.NORMAL,
            notes=(
                "Raised automatically when stock was swapped onto an apparatus: "
                f"{on_hand} ready on the shelf against a reorder point of "
                f"{item.reorder_point}."
            ),
            requested_by=requested_by,
        )
        self.db.add(reorder)
        await self.db.commit()
        logger.info(
            "Auto reorder {} raised for item {} in org {} ({} on hand, point {})",
            reorder.id,
            item.id,
            organization_id,
            on_hand,
            item.reorder_point,
        )

        await self._notify(str(organization_id), item, reorder, on_hand)
        return reorder

    async def _notify(
        self,
        organization_id: str,
        item: InventoryItem,
        reorder: ReorderRequest,
        on_hand: int,
    ) -> None:
        """Email the people who run this item's stock that a request was filed.

        Recipients come from the low-stock alert's own audience resolution, so
        a medical-only officer hears about medical items and never about gear.
        Each of them also gets a bell entry, so an officer who turned off
        inventory-duty emails still hears; the email goes to the rest. No text,
        as with the low-stock alert (CLAUDE.md pitfall #18).
        """
        # Imported here: scheduled_tasks imports the services that import
        # this module.
        from app.services.email_policy import department_required_kinds
        from app.services.email_service import EmailService, wrap_email_body
        from app.services.officer_alert_copies import add_in_app_copies
        from app.services.scheduled_tasks import (
            DOMAIN_GEAR,
            DOMAIN_MEDICAL,
            _quartermaster_emails,
            _stock_alert_audiences,
        )

        org = await self.db.scalar(
            select(Organization).where(Organization.id == organization_id)
        )
        if org is None:
            return

        category = item.category
        is_medical = category is not None and category.item_type in MEDICAL_ITEM_TYPES
        domain = DOMAIN_MEDICAL if is_medical else DOMAIN_GEAR

        audiences = {
            domains: users
            for domains, users in (
                await _stock_alert_audiences(self.db, organization_id)
            ).items()
            if domain in domains
        }

        for domains, users in audiences.items():
            # The reorder queue needs inventory.manage, which is what puts gear
            # in an audience; a medical-only officer is pointed at the supply
            # instead (see KNOWN_LIMITATIONS, Medical Supplies).
            await add_in_app_copies(
                self.db,
                organization_id=organization_id,
                recipient_ids=[str(u.id) for u in users],
                category="inventory_reorder",
                subject=f"Reorder requested — {item.name}"[:200],
                message=(
                    f"A reorder request for {item.name} was filed automatically: "
                    f"{on_hand} ready on the shelf, reorder point "
                    f"{item.reorder_point}, {reorder.quantity_requested} requested."
                ),
                action_url=(
                    "/inventory/admin/reorder"
                    if DOMAIN_GEAR in domains
                    else "/medical-supplies"
                ),
                metadata={"reorder_request_id": str(reorder.id)},
            )
        await self.db.commit()

        required = department_required_kinds(org)
        recipients = sorted(
            {
                email
                for users in audiences.values()
                for email in _quartermaster_emails(users, required)
            }
        )
        if not recipients:
            return

        name = html.escape(item.name)
        body = wrap_email_body(
            org,
            "Reorder Requested",
            f"<p>A reorder request was filed automatically for <strong>{name}"
            "</strong> after stock was swapped onto an apparatus.</p>"
            "<ul>"
            f"<li>Ready on the shelf: {on_hand}</li>"
            f"<li>Reorder point: {item.reorder_point}</li>"
            f"<li>Quantity requested: {reorder.quantity_requested}</li>"
            "</ul>"
            "<p>It is waiting in the reorder queue for approval. The quantity "
            "can be changed there before it is ordered.</p>",
        )
        await EmailService(organization=org).send_email(
            to_emails=recipients,
            subject=f"Reorder requested — {item.name}"[:200],
            html_body=body,
            text_body=(
                f"A reorder request for {item.name} was filed automatically: "
                f"{on_hand} ready, reorder point {item.reorder_point}, "
                f"{reorder.quantity_requested} requested. It is waiting in the "
                "reorder queue for approval."
            ),
        )
