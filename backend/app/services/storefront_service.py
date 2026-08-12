"""
Storefront Service

Business logic for the optional department storefront that lives alongside the
inventory (logistics) module: catalog products, time-boxed order windows,
member orders, out-of-band payment reconciliation, and the order-update
timeline that drives member email.

Money handling: every price is recomputed server-side from the catalog at order
time. The client never supplies a price — it names products, variants, and
quantities only.
"""

import csv
import io
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Sequence, Tuple

from loguru import logger
from sqlalchemy import case, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.utils import generate_uuid
from app.models.inventory import InventoryItem
from app.models.storefront import (
    StoreFulfillmentMethod,
    StoreOrder,
    StoreOrderEvent,
    StoreOrderEventType,
    StoreOrderItem,
    StoreOrderStatus,
    StoreOrderWindow,
    StorePaymentEvent,
    StorePaymentEventStatus,
    StorePaymentMethod,
    StorePaymentPolicy,
    StorePaymentStatus,
    StoreProduct,
    StoreProductImage,
    StoreProductStatus,
    StoreProductVariant,
    StoreSettings,
    StoreWindowProduct,
    StoreWindowStatus,
)
from app.models.user import Organization, User
from app.services.separation_of_duties import assert_different_person
from app.services.storefront_notification_service import StorefrontNotificationService
from app.utils.csv_export import SafeCsvWriter
from app.utils.model_updates import apply_updates
from app.utils.org_scoping import assert_in_org
from app.utils.sql_search import LIKE_ESCAPE_CHAR, like_pattern
from app.utils.storefront_payments import (
    build_payment_option,
    build_payment_options,
)

_CENTS = Decimal("0.01")

# Rows pulled per round trip when streaming a full export. Large enough
# that a typical window is one query, small enough not to hold a whole
# department's order history in memory at once.
_EXPORT_PAGE_SIZE = 200

# Order numbers are allocated as ORD-YYYY-NNNN. Matching a payment reference
# looks for that exact shape rather than any digit run, so a payer typing their
# phone number into the note cannot accidentally name an order.
_ORDER_NUMBER_RE = re.compile(r"ORD-\d{4}-\d{4,}")

# Inbound payments that still need somebody to look at them. MATCHED is in the
# list on purpose: it means the money is attributable but nothing has been
# applied yet, which is exactly the queue an administrator works through.
# The transitions a payment policy can block. Everything else — messaging the
# member, moving back to awaiting payment, cancelling — runs under every rule.
_PAYMENT_GATED_STATUSES = (
    StoreOrderStatus.ORDERED,
    StoreOrderStatus.READY_FOR_PICKUP,
    StoreOrderStatus.FULFILLED,
)

# Under BEFORE_VENDOR_ORDER the goods were never bought, so neither claim can
# be made about them. Under BEFORE_PICKUP they exist and are on the shelf.
_NO_GOODS_STATUSES = (StoreOrderStatus.ORDERED, StoreOrderStatus.READY_FOR_PICKUP)

# Where a new store starts. Cash alone, because it is the only method that
# works with nothing configured — ticking Venmo before entering a handle would
# show the quartermaster a method that is switched on and does nothing.
_DEFAULT_PAYMENT_METHODS = (StorePaymentMethod.CASH.value,)

_UNRESOLVED_PAYMENT_STATUSES = (
    StorePaymentEventStatus.UNMATCHED,
    StorePaymentEventStatus.AMBIGUOUS,
    StorePaymentEventStatus.MATCHED,
)

# Orders in these states are no longer claiming stock or counting against a
# member's per-product limit.
_INACTIVE_ORDER_STATUSES = (StoreOrderStatus.CANCELLED,)

# Fulfillment states from which an order can still be edited or cancelled by
# the member who placed it.
_MEMBER_CANCELLABLE_STATUSES = (
    StoreOrderStatus.SUBMITTED,
    StoreOrderStatus.AWAITING_PAYMENT,
)

_STATUS_LABELS = {
    StoreOrderStatus.SUBMITTED: "Submitted",
    StoreOrderStatus.AWAITING_PAYMENT: "Awaiting payment",
    StoreOrderStatus.PAID: "Paid",
    StoreOrderStatus.ORDERED: "Ordered from vendor",
    StoreOrderStatus.READY_FOR_PICKUP: "Ready for pickup",
    StoreOrderStatus.FULFILLED: "Fulfilled",
    StoreOrderStatus.CANCELLED: "Cancelled",
}


def _money(value: Any) -> Decimal:
    """Coerce to a 2-decimal Decimal; None becomes 0.00."""
    return Decimal(value or 0).quantize(_CENTS)


def _payment_gate_error(
    order: StoreOrder,
    status: StoreOrderStatus,
    policy: StorePaymentPolicy,
) -> Optional[str]:
    """Why this unpaid order may not advance to ``status``, or None.

    Two transitions are gated, and each maps to one half of the rule the
    department chose:

    * ORDERED and READY_FOR_PICKUP — only under BEFORE_VENDOR_ORDER, where
      the item was held out of the purchase order and so does not exist.
      Neither claim can be made about goods nobody bought, and "ready for
      pickup" is worse than merely inaccurate: it emails the member to come
      and collect something that was never ordered.
    * FULFILLED — under both gated policies. Handing the goods over is the
      last irreversible step from the member's side.

    Callers check :data:`_PAYMENT_GATED_STATUSES` first, so this is only asked
    about the transitions that can be blocked.
    """
    if policy == StorePaymentPolicy.NONE:
        return None

    balance = _money(Decimal(order.total or 0) - Decimal(order.amount_paid or 0))
    owed = f"Order {order.order_number} still owes {balance}."
    fix = "Record the payment, or waive the balance, first."

    if status in _NO_GOODS_STATUSES:
        if policy != StorePaymentPolicy.BEFORE_VENDOR_ORDER:
            return None
        claim = (
            "marked ordered"
            if status == StoreOrderStatus.ORDERED
            else "marked ready for pickup"
        )
        return (
            f"{owed} This store holds unpaid orders out of the vendor order, "
            f"so nothing was bought for it and it cannot be {claim}. {fix}"
        )

    return (
        f"{owed} This store requires payment before pickup, so it cannot be "
        f"handed over. {fix}"
    )


def _settled_clause(settled: bool):
    """The SQL twin of :func:`_is_settled`, for filtering rollups."""
    is_settled = or_(
        StoreOrder.payment_status.in_(
            [StorePaymentStatus.PAID, StorePaymentStatus.WAIVED]
        ),
        (StoreOrder.total - StoreOrder.amount_paid) <= 0,
    )
    return is_settled if settled else ~is_settled


def _is_settled(order: StoreOrder) -> bool:
    """True when nothing more is owed on this order."""
    if order.payment_status in (StorePaymentStatus.PAID, StorePaymentStatus.WAIVED):
        return True
    return _money(Decimal(order.total or 0) - Decimal(order.amount_paid or 0)) <= 0


def _as_enum(enum_cls, value, default, label):
    """Coerce a caller-supplied value to its enum member.

    Callers legitimately pass either form: the API hands over Pydantic-parsed
    enums, while scripts, importers and tests naturally pass the wire strings.
    Both are accepted, but only one is stored — a bare string survives on the
    instance (the session does not expire on commit) and blows up later on a
    `.value` access far from where it was set.
    """
    if value is None or value == "":
        return default
    if isinstance(value, enum_cls):
        return value
    try:
        return enum_cls(str(value).lower())
    except ValueError:
        raise ValueError(f"Unknown {label}: {value}")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(value: Optional[datetime]) -> Optional[datetime]:
    """MySQL DATETIME comes back naive; compare it as UTC, not local."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class StorefrontService:
    """Service for the department storefront."""

    _NUMBER_ALLOC_ATTEMPTS = 5

    def __init__(self, db: AsyncSession):
        self.db = db
        self.notifications = StorefrontNotificationService(db)

    # ==================================================================
    # Settings
    # ==================================================================

    async def get_settings(self, organization_id: str) -> StoreSettings:
        """Fetch the org's store settings, creating defaults on first use."""
        result = await self.db.execute(
            select(StoreSettings).where(
                StoreSettings.organization_id == str(organization_id)
            )
        )
        settings = result.scalar_one_or_none()
        if settings:
            return settings

        settings = StoreSettings(
            id=generate_uuid(),
            organization_id=str(organization_id),
            is_enabled=False,
            store_name="Department Store",
            currency="USD",
            accepted_payment_methods=list(_DEFAULT_PAYMENT_METHODS),
            tax_rate=Decimal("0"),
        )
        self.db.add(settings)
        try:
            await self.db.commit()
        except IntegrityError:
            # Two concurrent first-time reads both tried to seed the row; the
            # unique org constraint arbitrates and the loser re-reads.
            await self.db.rollback()
            result = await self.db.execute(
                select(StoreSettings).where(
                    StoreSettings.organization_id == str(organization_id)
                )
            )
            existing = result.scalar_one_or_none()
            if existing is None:
                raise
            return existing
        await self.db.refresh(settings)
        return settings

    async def update_settings(
        self, organization_id: str, data: Dict[str, Any]
    ) -> StoreSettings:
        """Apply a partial settings update.

        `data` is an ``exclude_unset`` dump, so a null here is the treasurer
        clearing a field (a stale Venmo handle, a mailing address) — it is
        written through, not skipped.
        """
        settings = await self.get_settings(organization_id)
        normalized = dict(data)

        if "accepted_payment_methods" in normalized:
            raw = normalized["accepted_payment_methods"] or []
            chosen = [m.value if hasattr(m, "value") else str(m) for m in raw]
            # A store has to accept something, and cash is the one method that
            # needs no setup to work. Un-ticking everything therefore lands
            # back here rather than leaving a store nobody can pay.
            normalized["accepted_payment_methods"] = chosen or list(
                _DEFAULT_PAYMENT_METHODS
            )

        if "notify_emails" in normalized:
            raw_emails = normalized["notify_emails"] or []
            normalized["notify_emails"] = [
                str(e).strip() for e in raw_emails if str(e).strip()
            ]

        apply_updates(settings, normalized)
        await self.db.commit()
        await self.db.refresh(settings)
        return settings

    # ==================================================================
    # Products
    # ==================================================================

    async def list_products(
        self,
        organization_id: str,
        status: Optional[str] = None,
        search: Optional[str] = None,
        include_archived: bool = False,
    ) -> List[StoreProduct]:
        query = (
            select(StoreProduct)
            .options(selectinload(StoreProduct.variants))
            .where(StoreProduct.organization_id == str(organization_id))
        )
        if status:
            query = query.where(StoreProduct.status == status)
        elif not include_archived:
            query = query.where(StoreProduct.status != StoreProductStatus.ARCHIVED)
        if search:
            # Escape LIKE wildcards: an unescaped "%" in a member's search
            # string matches the whole catalog instead of nothing.
            pattern = like_pattern(search)
            query = query.where(
                or_(
                    StoreProduct.name.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
                    StoreProduct.sku.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
                    StoreProduct.category.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
                )
            )
        query = query.order_by(StoreProduct.sort_order, StoreProduct.name)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_product(
        self, product_id: str, organization_id: str
    ) -> Optional[StoreProduct]:
        result = await self.db.execute(
            select(StoreProduct)
            .options(selectinload(StoreProduct.variants))
            .where(
                StoreProduct.id == str(product_id),
                StoreProduct.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def create_product(
        self, organization_id: str, data: Dict[str, Any], created_by: Optional[str]
    ) -> StoreProduct:
        variants = data.pop("variants", []) or []
        inventory_item_id = data.get("inventory_item_id")
        if inventory_item_id:
            await assert_in_org(
                self.db,
                InventoryItem,
                inventory_item_id,
                organization_id,
                label="inventory item",
            )

        product = StoreProduct(
            id=generate_uuid(),
            organization_id=str(organization_id),
            created_by=created_by,
            **{k: v for k, v in data.items() if hasattr(StoreProduct, k)},
        )
        self.db.add(product)
        await self.db.flush()

        for index, variant in enumerate(variants):
            self.db.add(self._build_variant(product, variant, default_sort=index))

        try:
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            raise ValueError(self._integrity_message(exc)) from exc
        refreshed = await self.get_product(product.id, organization_id)
        return refreshed or product

    async def update_product(
        self, product_id: str, organization_id: str, data: Dict[str, Any]
    ) -> StoreProduct:
        product = await self.get_product(product_id, organization_id)
        if not product:
            raise ValueError("Product not found")

        variants = data.pop("variants", None)
        if data.get("inventory_item_id"):
            await assert_in_org(
                self.db,
                InventoryItem,
                data["inventory_item_id"],
                organization_id,
                label="inventory item",
            )

        apply_updates(product, data)

        if variants is not None:
            await self._replace_variants(product, variants)

        try:
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            raise ValueError(self._integrity_message(exc)) from exc
        refreshed = await self.get_product(product_id, organization_id)
        return refreshed or product

    async def archive_product(self, product_id: str, organization_id: str) -> None:
        """Archive rather than delete: past orders still reference the row."""
        product = await self.get_product(product_id, organization_id)
        if not product:
            raise ValueError("Product not found")
        product.status = StoreProductStatus.ARCHIVED
        await self.db.commit()

    def _build_variant(
        self, product: StoreProduct, data: Dict[str, Any], default_sort: int = 0
    ) -> StoreProductVariant:
        return StoreProductVariant(
            id=generate_uuid(),
            organization_id=product.organization_id,
            product_id=product.id,
            label=data.get("label"),
            sku=data.get("sku"),
            price_delta=_money(data.get("price_delta")),
            stock_quantity=data.get("stock_quantity"),
            is_active=data.get("is_active", True),
            sort_order=data.get("sort_order") or default_sort,
        )

    async def _replace_variants(
        self, product: StoreProduct, variants: Sequence[Dict[str, Any]]
    ) -> None:
        """Upsert the supplied variants; deactivate the ones left out.

        Variants are never hard-deleted here — an order line references the
        variant id, and dropping the row would blank the size on a receipt.
        """
        existing = {variant.id: variant for variant in product.variants}
        seen: set = set()

        for index, payload in enumerate(variants):
            variant_id = payload.get("id")
            current = existing.get(variant_id) if variant_id else None
            if current is not None:
                current.label = payload.get("label", current.label)
                current.sku = payload.get("sku")
                current.price_delta = _money(payload.get("price_delta"))
                current.stock_quantity = payload.get("stock_quantity")
                current.is_active = payload.get("is_active", True)
                current.sort_order = payload.get("sort_order") or index
                seen.add(current.id)
            else:
                new_variant = self._build_variant(product, payload, default_sort=index)
                self.db.add(new_variant)
                seen.add(new_variant.id)

        for variant_id, variant in existing.items():
            if variant_id not in seen:
                variant.is_active = False

    @staticmethod
    def _integrity_message(exc: IntegrityError) -> str:
        detail = str(getattr(exc, "orig", exc))
        if "org_sku" in detail:
            return "Another product already uses that SKU"
        if "product_label" in detail:
            return "Variant labels must be unique within a product"
        if "window_product" in detail:
            return "That product is already offered in this window"
        return "The change conflicts with an existing record"

    # ==================================================================
    # Product photos
    # ==================================================================

    async def products_with_images(
        self, organization_id: str, product_ids: Sequence[str]
    ) -> set:
        """Ids of products that have an uploaded photo.

        Selects only the id column: the whole point of the separate table is
        that listing a catalog never pulls image bytes through the ORM.
        """
        ids = [str(pid) for pid in product_ids if pid]
        if not ids:
            return set()
        result = await self.db.execute(
            select(StoreProductImage.product_id).where(
                StoreProductImage.product_id.in_(ids),
                StoreProductImage.organization_id == str(organization_id),
            )
        )
        return set(result.scalars().all())

    @staticmethod
    def resolve_image_url(product: StoreProduct, has_image: bool) -> Optional[str]:
        """The URL a client should render for this product.

        An uploaded photo wins over an externally-hosted ``image_url``. The
        ``v=`` cache-buster is the row's update time, so replacing the photo
        invalidates whatever the browser cached without a no-store header.
        """
        if has_image:
            updated = _as_aware(product.updated_at)
            version = int(updated.timestamp()) if updated else 0
            return f"/api/v1/store/products/{product.id}/image?v={version}"
        return product.image_url

    async def get_product_image(
        self, product_id: str, organization_id: str
    ) -> Optional[StoreProductImage]:
        """Fetch the stored photo bytes for one product, org-scoped."""
        result = await self.db.execute(
            select(StoreProductImage).where(
                StoreProductImage.product_id == str(product_id),
                StoreProductImage.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def set_product_image(
        self,
        product_id: str,
        organization_id: str,
        data: bytes,
        content_type: str,
        uploaded_by: Optional[str],
    ) -> StoreProductImage:
        """Store (or replace) a product photo."""
        product = await self.get_product(product_id, organization_id)
        if not product:
            raise ValueError("Product not found")

        existing = await self.get_product_image(product_id, organization_id)
        if existing is not None:
            existing.data = data
            existing.content_type = content_type
            existing.byte_size = len(data)
            existing.uploaded_by = uploaded_by
            image = existing
        else:
            image = StoreProductImage(
                id=generate_uuid(),
                organization_id=str(organization_id),
                product_id=product.id,
                data=data,
                content_type=content_type,
                byte_size=len(data),
                uploaded_by=uploaded_by,
            )
            self.db.add(image)

        # Touch the product so resolve_image_url's cache-buster advances and
        # clients stop serving the previous photo from cache.
        product.updated_at = _utcnow()
        await self.db.commit()
        await self.db.refresh(image)
        return image

    async def delete_product_image(self, product_id: str, organization_id: str) -> None:
        """Remove a product photo, falling back to any external image_url."""
        image = await self.get_product_image(product_id, organization_id)
        if image is None:
            return
        await self.db.delete(image)
        product = await self.get_product(product_id, organization_id)
        if product is not None:
            product.updated_at = _utcnow()
        await self.db.commit()

    # ==================================================================
    # Order windows
    # ==================================================================

    async def list_windows(
        self, organization_id: str, status: Optional[str] = None
    ) -> List[StoreOrderWindow]:
        query = (
            select(StoreOrderWindow)
            .options(
                selectinload(StoreOrderWindow.offerings).selectinload(
                    StoreWindowProduct.product
                )
            )
            .where(StoreOrderWindow.organization_id == str(organization_id))
        )
        if status:
            query = query.where(StoreOrderWindow.status == status)
        query = query.order_by(StoreOrderWindow.created_at.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_window(
        self, window_id: str, organization_id: str
    ) -> Optional[StoreOrderWindow]:
        result = await self.db.execute(
            select(StoreOrderWindow)
            .options(
                selectinload(StoreOrderWindow.offerings).selectinload(
                    StoreWindowProduct.product
                )
            )
            .where(
                StoreOrderWindow.id == str(window_id),
                StoreOrderWindow.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def create_window(
        self, organization_id: str, data: Dict[str, Any], created_by: Optional[str]
    ) -> StoreOrderWindow:
        offerings = data.pop("offerings", []) or []
        window = StoreOrderWindow(
            id=generate_uuid(),
            organization_id=str(organization_id),
            created_by=created_by,
            status=(
                StoreWindowStatus.SCHEDULED
                if data.get("opens_at")
                else StoreWindowStatus.DRAFT
            ),
            **{k: v for k, v in data.items() if hasattr(StoreOrderWindow, k)},
        )
        self.db.add(window)
        await self.db.flush()
        await self._replace_offerings(window, offerings, organization_id)
        try:
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            raise ValueError(self._integrity_message(exc)) from exc
        refreshed = await self.get_window(window.id, organization_id)
        return refreshed or window

    async def update_window(
        self, window_id: str, organization_id: str, data: Dict[str, Any]
    ) -> StoreOrderWindow:
        window = await self.get_window(window_id, organization_id)
        if not window:
            raise ValueError("Order window not found")

        offerings = data.pop("offerings", None)
        apply_updates(window, data)

        opens_at = _as_aware(window.opens_at)
        closes_at = _as_aware(window.closes_at)
        if opens_at and closes_at and closes_at <= opens_at:
            raise ValueError("Window close time must be after the open time")

        if offerings is not None:
            await self._replace_offerings(window, offerings, organization_id)

        try:
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            raise ValueError(self._integrity_message(exc)) from exc
        refreshed = await self.get_window(window_id, organization_id)
        return refreshed or window

    async def _replace_offerings(
        self,
        window: StoreOrderWindow,
        offerings: Sequence[Dict[str, Any]],
        organization_id: str,
    ) -> None:
        # Delete by query rather than iterating window.offerings: on a window
        # that was just flushed the collection is unloaded, and touching it
        # under asyncio raises MissingGreenlet instead of lazy-loading.
        await self.db.execute(
            delete(StoreWindowProduct).where(
                StoreWindowProduct.window_id == window.id,
                StoreWindowProduct.organization_id == str(organization_id),
            )
        )
        await self.db.flush()

        for index, payload in enumerate(offerings):
            product_id = payload.get("product_id")
            await assert_in_org(
                self.db, StoreProduct, product_id, organization_id, label="product"
            )
            self.db.add(
                StoreWindowProduct(
                    id=generate_uuid(),
                    organization_id=str(organization_id),
                    window_id=window.id,
                    product_id=product_id,
                    price_override=(
                        _money(payload["price_override"])
                        if payload.get("price_override") is not None
                        else None
                    ),
                    quantity_limit=payload.get("quantity_limit"),
                    max_per_member=payload.get("max_per_member"),
                    sort_order=payload.get("sort_order") or index,
                )
            )

    async def open_window(
        self,
        window_id: str,
        organization_id: str,
        notify_members: bool = True,
        message: Optional[str] = None,
    ) -> StoreOrderWindow:
        window = await self.get_window(window_id, organization_id)
        if not window:
            raise ValueError("Order window not found")
        if window.status == StoreWindowStatus.OPEN:
            return window
        if window.status in (StoreWindowStatus.FULFILLED, StoreWindowStatus.CANCELLED):
            raise ValueError("A fulfilled or cancelled window cannot be reopened")

        window.status = StoreWindowStatus.OPEN
        window.opened_at = _utcnow()
        window.closed_at = None
        window.close_notice_sent_at = None
        window.closing_reminder_sent_at = None
        await self.db.commit()
        await self.db.refresh(window)

        settings = await self.get_settings(organization_id)
        if notify_members and window.notify_on_open and settings.send_window_opened:
            sent = await self.notifications.send_window_opened(
                window, settings, message=message
            )
            if sent:
                window.open_notice_sent_at = _utcnow()
                await self.db.commit()
        return window

    async def record_vendor_order(
        self,
        window_id: str,
        organization_id: str,
        actor_id: Optional[str],
        vendor_name: Optional[str] = None,
        vendor_reference: Optional[str] = None,
        expected_delivery_date: Optional[date] = None,
        advance_orders: bool = True,
        notify_members: bool = True,
        message: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Log that the bulk order has gone to the vendor, and move the orders.

        This is the step between "ordering closed" and "come pick it up", and
        it is the one members chase. Recording it does three things at once so
        the quartermaster is not left doing them separately and forgetting the
        third: it stamps who the order went to and when, it advances the paid
        orders to ORDERED, and it tells the members it went.

        Orders the payment policy holds back are skipped rather than advanced —
        they were not on the sheet the vendor received, so saying they were
        ordered would be a lie the member later discovers at pickup.
        """
        window = await self.get_window(window_id, organization_id)
        if not window:
            raise ValueError("Order window not found")
        if window.status in (StoreWindowStatus.DRAFT, StoreWindowStatus.SCHEDULED):
            raise ValueError("Open the window before recording a vendor order")
        if window.status == StoreWindowStatus.CANCELLED:
            raise ValueError("A cancelled window has nothing to order")

        if vendor_name is not None:
            window.vendor_name = vendor_name.strip() or None
        if vendor_reference is not None:
            window.vendor_reference = vendor_reference.strip() or None
        if expected_delivery_date is not None:
            window.expected_delivery_date = expected_delivery_date
        window.vendor_ordered_at = _utcnow()
        window.vendor_ordered_by = actor_id
        await self.db.commit()
        await self.db.refresh(window)

        advanced = 0
        skipped: List[Dict[str, str]] = []
        if advance_orders:
            orders, _ = await self.list_orders(
                organization_id, window_id=window.id, page_size=_EXPORT_PAGE_SIZE
            )
            result = await self.bulk_update_status(
                organization_id,
                [
                    o.id
                    for o in orders
                    if o.status
                    not in (StoreOrderStatus.CANCELLED, StoreOrderStatus.FULFILLED)
                ],
                StoreOrderStatus.ORDERED,
                actor_id,
                notify_members=False,
            )
            advanced = result["updated"]
            skipped = result["errors"]

        notified = 0
        settings = await self.get_settings(organization_id)
        if notify_members and settings.send_vendor_order_updates:
            recipients = await self._window_customer_emails(window.id, organization_id)
            if recipients:
                notified = await self.notifications.send_vendor_order_placed(
                    window, settings, recipients, message=message
                )

        return {
            "window": window,
            "advanced": advanced,
            "skipped": skipped,
            "notified": notified,
        }

    async def close_window(
        self,
        window_id: str,
        organization_id: str,
        notify_members: bool = True,
        message: Optional[str] = None,
        closed_by: Optional[str] = None,
    ) -> StoreOrderWindow:
        window = await self.get_window(window_id, organization_id)
        if not window:
            raise ValueError("Order window not found")
        if window.status == StoreWindowStatus.CLOSED:
            return window
        if window.status in (StoreWindowStatus.FULFILLED, StoreWindowStatus.CANCELLED):
            raise ValueError("That window is already finished")

        window.status = StoreWindowStatus.CLOSED
        window.closed_at = _utcnow()
        window.closed_by = closed_by
        await self.db.commit()
        await self.db.refresh(window)

        settings = await self.get_settings(organization_id)
        if notify_members and settings.send_window_closed:
            recipients = await self._window_customer_emails(window_id, organization_id)
            if recipients:
                sent = await self.notifications.send_window_closed(
                    window, settings, recipients, message=message
                )
                if sent:
                    window.close_notice_sent_at = _utcnow()
                    await self.db.commit()
        return window

    async def set_window_status(
        self, window_id: str, organization_id: str, status: StoreWindowStatus
    ) -> StoreOrderWindow:
        window = await self.get_window(window_id, organization_id)
        if not window:
            raise ValueError("Order window not found")
        window.status = status
        if status == StoreWindowStatus.CANCELLED:
            window.cancelled_at = _utcnow()
        await self.db.commit()
        await self.db.refresh(window)
        return window

    async def delete_window(self, window_id: str, organization_id: str) -> None:
        window = await self.get_window(window_id, organization_id)
        if not window:
            raise ValueError("Order window not found")
        order_count = await self.db.scalar(
            select(func.count(StoreOrder.id)).where(
                StoreOrder.window_id == str(window_id),
                StoreOrder.organization_id == str(organization_id),
            )
        )
        if order_count:
            raise ValueError(
                "This window already has orders — cancel it instead of deleting"
            )
        await self.db.delete(window)
        await self.db.commit()

    async def _window_customer_emails(
        self, window_id: str, organization_id: str
    ) -> List[str]:
        result = await self.db.execute(
            select(StoreOrder.customer_email).where(
                StoreOrder.window_id == str(window_id),
                StoreOrder.organization_id == str(organization_id),
                StoreOrder.status != StoreOrderStatus.CANCELLED,
                StoreOrder.customer_email.isnot(None),
            )
        )
        return sorted({email for email in result.scalars().all() if email})

    # ==================================================================
    # Shopper view
    # ==================================================================

    async def get_open_windows(self, organization_id: str) -> List[StoreOrderWindow]:
        result = await self.db.execute(
            select(StoreOrderWindow)
            .where(
                StoreOrderWindow.organization_id == str(organization_id),
                StoreOrderWindow.status == StoreWindowStatus.OPEN,
            )
            .order_by(StoreOrderWindow.closes_at.is_(None), StoreOrderWindow.closes_at)
        )
        return list(result.scalars().all())

    async def get_storefront(
        self,
        organization_id: str,
        user_id: Optional[str] = None,
        window_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Assemble everything the member-facing store needs in one payload."""
        settings = await self.get_settings(organization_id)
        open_windows = await self.get_open_windows(organization_id)

        window: Optional[StoreOrderWindow] = None
        if window_id:
            window = next((w for w in open_windows if w.id == str(window_id)), None)
            if window is None:
                raise ValueError("That order window is not open")
        elif open_windows:
            window = open_windows[0]

        products: List[Dict[str, Any]] = []
        if window is not None and settings.is_enabled:
            products = await self._build_offers(organization_id, window, user_id)

        return {
            "settings": settings,
            "window": window,
            "other_open_windows": [
                w for w in open_windows if window and w.id != window.id
            ],
            "products": products,
        }

    async def _build_offers(
        self,
        organization_id: str,
        window: StoreOrderWindow,
        user_id: Optional[str],
    ) -> List[Dict[str, Any]]:
        """Resolve which products a window offers, at what price and limit."""
        offering_result = await self.db.execute(
            select(StoreWindowProduct).where(
                StoreWindowProduct.window_id == window.id,
                StoreWindowProduct.organization_id == str(organization_id),
            )
        )
        offerings = {o.product_id: o for o in offering_result.scalars().all()}

        product_query = (
            select(StoreProduct)
            .options(selectinload(StoreProduct.variants))
            .where(
                StoreProduct.organization_id == str(organization_id),
                StoreProduct.status == StoreProductStatus.ACTIVE,
            )
        )
        if not window.include_all_products:
            if not offerings:
                return []
            product_query = product_query.where(StoreProduct.id.in_(offerings.keys()))
        product_result = await self.db.execute(
            product_query.order_by(StoreProduct.sort_order, StoreProduct.name)
        )
        products = list(product_result.scalars().all())
        if not products:
            return []

        window_totals = await self._ordered_quantities(window.id, organization_id)
        member_totals = (
            await self._ordered_quantities(window.id, organization_id, user_id=user_id)
            if user_id
            else {}
        )
        products_with_images = await self.products_with_images(
            organization_id, [product.id for product in products]
        )

        offers: List[Dict[str, Any]] = []
        for product in products:
            offering = offerings.get(product.id)
            price = _money(
                offering.price_override
                if offering is not None and offering.price_override is not None
                else product.price
            )
            max_per_member = (
                offering.max_per_member
                if offering is not None and offering.max_per_member is not None
                else product.max_per_member
            )

            available = self._remaining_units(
                product=product,
                offering=offering,
                window_totals=window_totals,
                member_totals=member_totals,
                max_per_member=max_per_member,
            )

            variants = []
            for variant in product.variants:
                if not variant.is_active:
                    continue
                variant_remaining = self._variant_remaining(
                    variant, window_totals, available
                )
                variants.append(
                    {
                        "id": variant.id,
                        "label": variant.label,
                        "price": _money(price + _money(variant.price_delta)),
                        "available_quantity": variant_remaining,
                        "is_available": variant_remaining is None
                        or variant_remaining > 0,
                    }
                )

            if product.requires_variant and not variants:
                continue

            offers.append(
                {
                    "id": product.id,
                    "name": product.name,
                    "description": product.description,
                    "image_url": self.resolve_image_url(
                        product, product.id in products_with_images
                    ),
                    "category": product.category,
                    "price": price,
                    "is_taxable": product.is_taxable,
                    "requires_variant": product.requires_variant,
                    "max_per_member": max_per_member,
                    "personalization_enabled": product.personalization_enabled,
                    "personalization_required": product.personalization_required,
                    "personalization_label": product.personalization_label,
                    "personalization_max_length": (
                        product.personalization_max_length or 30
                    ),
                    "personalization_price": _money(product.personalization_price),
                    "available_quantity": available,
                    "is_available": available is None or available > 0,
                    "variants": variants,
                }
            )
        return offers

    def _remaining_units(
        self,
        product: StoreProduct,
        offering: Optional[StoreWindowProduct],
        window_totals: Dict[Tuple[str, Optional[str]], int],
        member_totals: Dict[Tuple[str, Optional[str]], int],
        max_per_member: Optional[int],
    ) -> Optional[int]:
        """Tightest of stock / window cap / per-member cap; None means unlimited."""
        caps: List[int] = []

        product_ordered = sum(
            qty for (pid, _vid), qty in window_totals.items() if pid == product.id
        )
        if product.track_stock and product.stock_quantity is not None:
            caps.append(max(product.stock_quantity - product_ordered, 0))
        if offering is not None and offering.quantity_limit is not None:
            caps.append(max(offering.quantity_limit - product_ordered, 0))
        if max_per_member is not None:
            already = sum(
                qty for (pid, _vid), qty in member_totals.items() if pid == product.id
            )
            caps.append(max(max_per_member - already, 0))

        return min(caps) if caps else None

    def _variant_remaining(
        self,
        variant: StoreProductVariant,
        window_totals: Dict[Tuple[str, Optional[str]], int],
        product_remaining: Optional[int],
    ) -> Optional[int]:
        if variant.stock_quantity is None:
            return product_remaining
        ordered = sum(
            qty for (_pid, vid), qty in window_totals.items() if vid == variant.id
        )
        remaining = max(variant.stock_quantity - ordered, 0)
        if product_remaining is None:
            return remaining
        return min(remaining, product_remaining)

    async def _ordered_quantities(
        self,
        window_id: str,
        organization_id: str,
        user_id: Optional[str] = None,
        exclude_order_id: Optional[str] = None,
    ) -> Dict[Tuple[str, Optional[str]], int]:
        """Units already claimed in a window, keyed by (product_id, variant_id)."""
        query = (
            select(
                StoreOrderItem.product_id,
                StoreOrderItem.variant_id,
                func.sum(StoreOrderItem.quantity),
            )
            .join(StoreOrder, StoreOrder.id == StoreOrderItem.order_id)
            .where(
                StoreOrder.window_id == str(window_id),
                StoreOrder.organization_id == str(organization_id),
                StoreOrder.status.notin_(_INACTIVE_ORDER_STATUSES),
            )
            .group_by(StoreOrderItem.product_id, StoreOrderItem.variant_id)
        )
        if user_id:
            query = query.where(StoreOrder.user_id == str(user_id))
        if exclude_order_id:
            query = query.where(StoreOrder.id != str(exclude_order_id))

        result = await self.db.execute(query)
        return {
            (product_id, variant_id): int(total or 0)
            for product_id, variant_id, total in result.all()
        }

    # ==================================================================
    # Orders
    # ==================================================================

    async def _generate_order_number(
        self, organization_id: str, offset: int = 0
    ) -> str:
        """Allocate ORD-YYYY-NNNN from the max existing suffix for the org.

        MAX (not count) so a deleted order never causes a number to repeat;
        ``offset`` lets the retry allocator step past a number a concurrent
        transaction just took, which REPEATABLE READ would otherwise hide.
        """
        year = _utcnow().year
        prefix = f"ORD-{year}-"
        result = await self.db.execute(
            select(StoreOrder.order_number).where(
                StoreOrder.organization_id == str(organization_id),
                StoreOrder.order_number.like(f"{prefix}%"),
            )
        )
        highest = 0
        for number in result.scalars().all():
            suffix = (number or "").rsplit("-", 1)[-1]
            if suffix.isdigit():
                highest = max(highest, int(suffix))
        return f"{prefix}{highest + 1 + offset:04d}"

    async def _flush_with_unique_number(
        self, order: StoreOrder, organization_id: str
    ) -> None:
        """Assign an order number and flush, retrying on collision.

        Each retry runs inside a SAVEPOINT so a collision never poisons the
        caller's outer transaction.
        """
        for attempt in range(self._NUMBER_ALLOC_ATTEMPTS):
            order.order_number = await self._generate_order_number(
                organization_id, offset=attempt
            )
            nested = await self.db.begin_nested()
            try:
                self.db.add(order)
                await self.db.flush()
                await nested.commit()
                return
            except IntegrityError as exc:
                await nested.rollback()
                if "org_number" not in str(getattr(exc, "orig", exc)):
                    raise
                logger.warning(
                    "Store order number collision on {} (attempt {}), retrying",
                    order.order_number,
                    attempt + 1,
                )
        raise ValueError(
            "Could not allocate a unique order number after "
            f"{self._NUMBER_ALLOC_ATTEMPTS} attempts; please retry"
        )

    async def create_order(
        self,
        organization_id: str,
        user: User,
        data: Dict[str, Any],
    ) -> StoreOrder:
        """Place a member order against an open window."""
        settings = await self.get_settings(organization_id)
        if not settings.is_enabled:
            raise ValueError("The store is not currently open")

        open_windows = await self.get_open_windows(organization_id)
        if not open_windows:
            raise ValueError("There is no open order window")

        requested_window_id = data.get("window_id")
        if requested_window_id:
            window = next(
                (w for w in open_windows if w.id == str(requested_window_id)), None
            )
            if window is None:
                raise ValueError("That order window is not open")
        else:
            window = open_windows[0]

        # Normalized at the boundary rather than stored as given. Comparisons
        # below work on either form because these are (str, Enum), so an
        # un-coerced string would pass validation and then fail much later on
        # a `.value` access — the session keeps what was assigned
        # (expire_on_commit is off), so the mismatch outlives the write.
        fulfillment = _as_enum(
            StoreFulfillmentMethod,
            data.get("fulfillment_method"),
            StoreFulfillmentMethod.PICKUP,
            "delivery option",
        )
        if (
            fulfillment == StoreFulfillmentMethod.SHIP and not settings.allow_shipping
        ) or (
            fulfillment == StoreFulfillmentMethod.PICKUP and not settings.allow_pickup
        ):
            raise ValueError("That delivery option is not offered by this store")

        payment_method = _as_enum(
            StorePaymentMethod, data.get("payment_method"), None, "payment method"
        )
        accepted = settings.accepted_payment_methods or []
        if payment_method is not None:
            if accepted and payment_method.value not in accepted:
                raise ValueError("That payment method is not accepted by this store")

        lines = await self._price_lines(
            organization_id, window, data.get("items") or [], str(user.id)
        )

        subtotal = _money(sum(line["line_total"] for line in lines))
        tax_base = _money(
            sum(line["line_total"] for line in lines if line["is_taxable"])
        )
        tax_amount = _money(tax_base * Decimal(settings.tax_rate or 0))
        shipping = (
            _money(settings.shipping_flat_rate)
            if fulfillment == StoreFulfillmentMethod.SHIP
            and settings.shipping_flat_rate is not None
            else Decimal("0.00")
        )
        total = _money(subtotal + tax_amount + shipping)

        order = StoreOrder(
            id=generate_uuid(),
            organization_id=str(organization_id),
            window_id=window.id,
            user_id=str(user.id),
            customer_name=user.full_name or user.email or "Member",
            customer_email=user.email,
            customer_phone=user.phone,
            status=(
                StoreOrderStatus.AWAITING_PAYMENT
                if total > 0
                else StoreOrderStatus.PAID
            ),
            payment_status=(
                StorePaymentStatus.UNPAID if total > 0 else StorePaymentStatus.PAID
            ),
            payment_method=payment_method,
            subtotal=subtotal,
            tax_amount=tax_amount,
            shipping_amount=shipping,
            discount_amount=Decimal("0.00"),
            total=total,
            amount_paid=Decimal("0.00"),
            fulfillment_method=fulfillment,
            shipping_address=data.get("shipping_address"),
            member_notes=data.get("member_notes"),
            submitted_at=_utcnow(),
        )
        if total <= 0:
            order.paid_at = _utcnow()

        await self._flush_with_unique_number(order, organization_id)

        for line in lines:
            self.db.add(
                StoreOrderItem(
                    id=generate_uuid(),
                    organization_id=str(organization_id),
                    order_id=order.id,
                    product_id=line["product_id"],
                    variant_id=line["variant_id"],
                    product_name=line["product_name"],
                    variant_label=line["variant_label"],
                    sku=line["sku"],
                    personalization_text=line["personalization_text"],
                    unit_price=line["unit_price"],
                    quantity=line["quantity"],
                    line_total=line["line_total"],
                )
            )

        self.db.add(
            StoreOrderEvent(
                id=generate_uuid(),
                organization_id=str(organization_id),
                order_id=order.id,
                event_type=StoreOrderEventType.CREATED,
                to_status=order.status.value,
                message="Order submitted",
                is_member_visible=True,
                created_by=str(user.id),
            )
        )
        await self.db.commit()

        full_order = await self.get_order(order.id, organization_id)
        if full_order is None:
            return order

        organization = await self._get_organization(organization_id)
        if settings.send_order_confirmation:
            await self.notifications.send_order_confirmation(
                full_order, settings, organization
            )
        if settings.notify_admins_on_order:
            await self.notifications.send_admin_new_order(
                full_order, settings, organization
            )
        return full_order

    async def _lock_products(
        self, product_ids: Sequence[str], organization_id: str
    ) -> None:
        """Take a row lock on each product being ordered.

        Availability is a read-then-write: we count what has already been
        ordered, then insert. Without a lock two members submitting at the
        same moment both see the last unit as free and both get it. Locking
        the product row serializes concurrent orders for that product, so the
        second submission's count includes the first. Ids are locked in a
        stable order because two carts holding the same pair of products in
        opposite orders would otherwise deadlock.
        """
        ordered_ids = sorted({str(pid) for pid in product_ids if pid})
        if not ordered_ids:
            return
        await self.db.execute(
            select(StoreProduct.id)
            .where(
                StoreProduct.id.in_(ordered_ids),
                StoreProduct.organization_id == str(organization_id),
            )
            .order_by(StoreProduct.id)
            .with_for_update()
        )

    @staticmethod
    def _normalize_personalization(
        product: StoreProduct, raw: Optional[str]
    ) -> Optional[str]:
        """Validate and clean the per-line personalization text.

        Returns ``None`` when the product does not offer personalization, so a
        client cannot smuggle arbitrary text onto a line the department never
        agreed to customize.
        """
        text = (raw or "").strip()
        if not product.personalization_enabled:
            return None
        if not text:
            if product.personalization_required:
                label = product.personalization_label or "personalization"
                raise ValueError(f"'{product.name}' requires {label}")
            return None
        limit = product.personalization_max_length or 30
        if len(text) > limit:
            raise ValueError(
                f"Personalization for '{product.name}' is limited to "
                f"{limit} characters"
            )
        return text

    async def _price_lines(
        self,
        organization_id: str,
        window: StoreOrderWindow,
        items: Sequence[Dict[str, Any]],
        user_id: str,
    ) -> List[Dict[str, Any]]:
        """Validate the cart and price every line from the catalog."""
        if not items:
            raise ValueError("An order must contain at least one item")

        offering_result = await self.db.execute(
            select(StoreWindowProduct).where(
                StoreWindowProduct.window_id == window.id,
                StoreWindowProduct.organization_id == str(organization_id),
            )
        )
        offerings = {o.product_id: o for o in offering_result.scalars().all()}

        # Lock first, then count: the counts below must not be able to change
        # under a concurrent order between here and the insert.
        await self._lock_products(
            [item["product_id"] for item in items], organization_id
        )

        window_totals = await self._ordered_quantities(window.id, organization_id)
        member_totals = await self._ordered_quantities(
            window.id, organization_id, user_id=user_id
        )

        # Collapse duplicate cart lines so per-product limits see the true ask.
        # Personalization is part of the key: two shirts with different names
        # are different goods and must stay separate lines.
        merged: Dict[Tuple[str, Optional[str], Optional[str]], int] = {}
        for item in items:
            key = (
                str(item["product_id"]),
                item.get("variant_id"),
                (item.get("personalization_text") or "").strip() or None,
            )
            merged[key] = merged.get(key, 0) + int(item["quantity"])

        lines: List[Dict[str, Any]] = []
        requested_per_product: Dict[str, int] = {}
        for (product_id, _variant_id, _text), quantity in merged.items():
            requested_per_product[product_id] = (
                requested_per_product.get(product_id, 0) + quantity
            )

        for (product_id, variant_id, personalization), quantity in merged.items():
            product = await self.get_product(product_id, organization_id)
            if product is None or product.status != StoreProductStatus.ACTIVE:
                raise ValueError("One of the items is no longer available")

            offering = offerings.get(product.id)
            if not window.include_all_products and offering is None:
                raise ValueError(f"'{product.name}' is not offered in this window")

            variant: Optional[StoreProductVariant] = None
            if variant_id:
                variant = next(
                    (
                        v
                        for v in product.variants
                        if v.id == str(variant_id) and v.is_active
                    ),
                    None,
                )
                if variant is None:
                    raise ValueError(f"Selected option for '{product.name}' is invalid")
            elif product.requires_variant:
                raise ValueError(f"Choose an option for '{product.name}'")

            price = _money(
                offering.price_override
                if offering is not None and offering.price_override is not None
                else product.price
            )
            unit_price = _money(price + _money(variant.price_delta if variant else 0))

            personalization_text = self._normalize_personalization(
                product, personalization
            )
            if personalization_text:
                unit_price = _money(unit_price + _money(product.personalization_price))

            max_per_member = (
                offering.max_per_member
                if offering is not None and offering.max_per_member is not None
                else product.max_per_member
            )
            remaining = self._remaining_units(
                product=product,
                offering=offering,
                window_totals=window_totals,
                member_totals=member_totals,
                max_per_member=max_per_member,
            )
            # The cap applies to the product as a whole, so compare it against
            # the combined ask across every variant of that product in the cart.
            if remaining is not None and requested_per_product[product.id] > remaining:
                raise ValueError(
                    f"Only {remaining} of '{product.name}' remain available"
                )

            if variant is not None and variant.stock_quantity is not None:
                variant_remaining = self._variant_remaining(
                    variant, window_totals, None
                )
                if variant_remaining is not None and quantity > variant_remaining:
                    raise ValueError(
                        f"Only {variant_remaining} of "
                        f"'{product.name} — {variant.label}' remain available"
                    )

            lines.append(
                {
                    "product_id": product.id,
                    "variant_id": variant.id if variant else None,
                    "product_name": product.name,
                    "variant_label": variant.label if variant else None,
                    "sku": (variant.sku if variant and variant.sku else product.sku),
                    "personalization_text": personalization_text,
                    "unit_price": unit_price,
                    "quantity": quantity,
                    "line_total": _money(unit_price * quantity),
                    "is_taxable": product.is_taxable,
                }
            )
        return lines

    async def get_order(
        self, order_id: str, organization_id: str, user_id: Optional[str] = None
    ) -> Optional[StoreOrder]:
        """Fetch one order, always org-scoped; ``user_id`` narrows to the owner."""
        query = (
            select(StoreOrder)
            .options(
                selectinload(StoreOrder.items),
                selectinload(StoreOrder.events).selectinload(StoreOrderEvent.author),
                selectinload(StoreOrder.window),
            )
            .where(
                StoreOrder.id == str(order_id),
                StoreOrder.organization_id == str(organization_id),
            )
        )
        if user_id:
            query = query.where(StoreOrder.user_id == str(user_id))
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def list_orders(
        self,
        organization_id: str,
        window_id: Optional[str] = None,
        status: Optional[str] = None,
        payment_status: Optional[str] = None,
        payment_method: Optional[str] = None,
        user_id: Optional[str] = None,
        search: Optional[str] = None,
        page: int = 1,
        page_size: int = 25,
    ) -> Tuple[List[StoreOrder], int]:
        filters = [StoreOrder.organization_id == str(organization_id)]
        if window_id:
            filters.append(StoreOrder.window_id == str(window_id))
        if status:
            filters.append(StoreOrder.status == status)
        if payment_status:
            filters.append(StoreOrder.payment_status == payment_status)
        if payment_method:
            # "Who paid by Zelle?" is the reconciliation question this answers:
            # every app settles separately, so the quartermaster works one
            # payout at a time.
            filters.append(StoreOrder.payment_method == payment_method)
        if user_id:
            filters.append(StoreOrder.user_id == str(user_id))
        if search:
            pattern = like_pattern(search)
            filters.append(
                or_(
                    StoreOrder.order_number.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
                    StoreOrder.customer_name.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
                    StoreOrder.customer_email.ilike(pattern, escape=LIKE_ESCAPE_CHAR),
                )
            )

        total = await self.db.scalar(select(func.count(StoreOrder.id)).where(*filters))
        page = max(page, 1)
        page_size = max(min(page_size, 200), 1)
        result = await self.db.execute(
            select(StoreOrder)
            .options(
                selectinload(StoreOrder.items),
                selectinload(StoreOrder.events).selectinload(StoreOrderEvent.author),
                selectinload(StoreOrder.window),
            )
            .where(*filters)
            .order_by(StoreOrder.submitted_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(result.scalars().all()), int(total or 0)

    async def update_order_status(
        self,
        order_id: str,
        organization_id: str,
        status: StoreOrderStatus,
        actor_id: Optional[str],
        message: Optional[str] = None,
        notify_member: bool = True,
    ) -> StoreOrder:
        order = await self.get_order(order_id, organization_id)
        if not order:
            raise ValueError("Order not found")
        if order.status == StoreOrderStatus.CANCELLED:
            raise ValueError("A cancelled order cannot be advanced")

        if status in _PAYMENT_GATED_STATUSES and not _is_settled(order):
            settings = await self.get_settings(organization_id)
            blocked = _payment_gate_error(order, status, settings.payment_policy)
            if blocked:
                raise ValueError(blocked)

        previous = order.status
        order.status = status
        if status == StoreOrderStatus.FULFILLED:
            order.fulfilled_at = _utcnow()
            order.fulfilled_by = actor_id
            for item in order.items:
                item.fulfilled_quantity = item.quantity
        elif status == StoreOrderStatus.PAID and order.payment_status not in (
            StorePaymentStatus.PAID,
            StorePaymentStatus.WAIVED,
        ):
            # Marking an order "paid" from the fulfillment side means the money
            # landed; keep the payment ledger consistent with it.
            order.payment_status = StorePaymentStatus.PAID
            order.amount_paid = _money(order.total)
            order.paid_at = _utcnow()

        label = _STATUS_LABELS.get(status, status.value)
        self.db.add(
            StoreOrderEvent(
                id=generate_uuid(),
                organization_id=str(organization_id),
                order_id=order.id,
                event_type=StoreOrderEventType.STATUS_CHANGED,
                from_status=previous.value if previous else None,
                to_status=status.value,
                message=message or f"Status changed to {label}",
                is_member_visible=True,
                notified=False,
                created_by=actor_id,
            )
        )
        await self.db.commit()

        refreshed = await self.get_order(order_id, organization_id)
        if refreshed and notify_member:
            settings = await self.get_settings(organization_id)
            if settings.send_status_updates:
                await self.notifications.send_order_update(
                    refreshed,
                    message or f"Your order is now: {label}.",
                    settings,
                    status_label=label,
                )
        return refreshed or order

    async def record_payment(
        self,
        order_id: str,
        organization_id: str,
        amount: Decimal,
        actor_id: Optional[str],
        payment_method: Optional[StorePaymentMethod] = None,
        reference: Optional[str] = None,
        mark_paid: bool = True,
        notify_member: bool = True,
    ) -> StoreOrder:
        """Record money the department has actually confirmed receiving."""
        order = await self.get_order(order_id, organization_id)
        if not order:
            raise ValueError("Order not found")
        if order.status == StoreOrderStatus.CANCELLED:
            raise ValueError("A cancelled order cannot take a payment")
        if order.payment_status == StorePaymentStatus.WAIVED:
            raise ValueError("A waived order cannot take a payment")

        applied = _money(amount)
        if applied <= 0:
            raise ValueError("Payment amount must be greater than zero")

        order.amount_paid = _money(Decimal(order.amount_paid or 0) + applied)
        if payment_method is not None:
            order.payment_method = payment_method
        if reference:
            order.payment_reference = reference

        balance = _money(Decimal(order.total or 0) - Decimal(order.amount_paid or 0))
        if balance <= 0:
            order.payment_status = StorePaymentStatus.PAID
            order.paid_at = _utcnow()
            order.payment_verified_by = actor_id
            if mark_paid and order.status in (
                StoreOrderStatus.SUBMITTED,
                StoreOrderStatus.AWAITING_PAYMENT,
            ):
                order.status = StoreOrderStatus.PAID
        else:
            order.payment_status = StorePaymentStatus.PARTIAL

        self.db.add(
            StoreOrderEvent(
                id=generate_uuid(),
                organization_id=str(organization_id),
                order_id=order.id,
                event_type=StoreOrderEventType.PAYMENT_RECORDED,
                message=f"Payment of {applied} recorded",
                is_member_visible=True,
                created_by=actor_id,
            )
        )
        await self.db.commit()

        refreshed = await self.get_order(order_id, organization_id)
        if refreshed and notify_member:
            settings = await self.get_settings(organization_id)
            if settings.send_payment_receipts:
                await self.notifications.send_payment_received(
                    refreshed, settings, amount=applied
                )
        return refreshed or order

    async def mark_order_paid(
        self,
        order_id: str,
        organization_id: str,
        actor_id: Optional[str],
        payment_method: Optional[StorePaymentMethod] = None,
        reference: Optional[str] = None,
        notify_member: bool = True,
    ) -> StoreOrder:
        """Settle an order's whole remaining balance in one step.

        The common case by far: money arrived out-of-band (a Venmo transfer, a
        cash handoff at drill) for exactly the amount owed, and whoever is
        working the orders just needs to say so. Typing the amount in adds a
        chance to fat-finger it, so this reads the balance off the order.
        """
        order = await self.get_order(order_id, organization_id)
        if not order:
            raise ValueError("Order not found")
        if order.status == StoreOrderStatus.CANCELLED:
            raise ValueError("A cancelled order cannot take a payment")
        # SoD: a manager must not settle their own order (the storefront
        # equivalent of the finance/admin-hours approve-your-own control). The
        # reconciliation path passes actor_id=None and is exempt.
        assert_different_person(
            actor_id, order.user_id, action="mark paid", record="order"
        )

        if _is_settled(order):
            # Already settled (or waived) — not an error, just nothing to do,
            # so a bulk run over a mixed selection doesn't fail on it.
            return order

        balance = _money(Decimal(order.total or 0) - Decimal(order.amount_paid or 0))

        return await self.record_payment(
            order_id,
            organization_id,
            balance,
            actor_id,
            payment_method=payment_method or order.payment_method,
            reference=reference,
            mark_paid=True,
            notify_member=notify_member,
        )

    async def waive_order_payment(
        self,
        order_id: str,
        organization_id: str,
        actor_id: Optional[str],
        reason: Optional[str] = None,
        notify_member: bool = True,
    ) -> StoreOrder:
        """Comp an order — the department is not collecting on it.

        Distinct from recording a payment: no money moved, so ``amount_paid``
        stays where it is and the sales rollup still reports the order's value
        as uncollected rather than inventing revenue.
        """
        order = await self.get_order(order_id, organization_id)
        if not order:
            raise ValueError("Order not found")
        if order.status == StoreOrderStatus.CANCELLED:
            raise ValueError("A cancelled order cannot be waived")
        # SoD: a manager must not waive the balance on their own order.
        assert_different_person(actor_id, order.user_id, action="waive", record="order")

        order.payment_status = StorePaymentStatus.WAIVED
        order.paid_at = _utcnow()
        order.payment_verified_by = actor_id
        if order.status in (
            StoreOrderStatus.SUBMITTED,
            StoreOrderStatus.AWAITING_PAYMENT,
        ):
            order.status = StoreOrderStatus.PAID

        self.db.add(
            StoreOrderEvent(
                id=generate_uuid(),
                organization_id=str(organization_id),
                order_id=order.id,
                event_type=StoreOrderEventType.PAYMENT_RECORDED,
                message=reason or "Payment waived by the department",
                is_member_visible=True,
                created_by=actor_id,
            )
        )
        await self.db.commit()

        refreshed = await self.get_order(order_id, organization_id)
        if refreshed and notify_member:
            settings = await self.get_settings(organization_id)
            if settings.send_payment_receipts:
                await self.notifications.send_order_update(
                    refreshed,
                    reason or "No payment is due on this order.",
                    settings,
                )
        return refreshed or order

    async def bulk_mark_paid(
        self,
        organization_id: str,
        order_ids: Sequence[str],
        actor_id: Optional[str],
        payment_method: Optional[StorePaymentMethod] = None,
        reference: Optional[str] = None,
        notify_members: bool = True,
    ) -> Dict[str, Any]:
        """Settle many orders at once — reconciling a payout statement.

        Orders that already carry no balance are counted as skipped rather
        than failing the run, so a treasurer can select a whole window
        without first weeding out the ones already handled.
        """
        updated = 0
        skipped = 0
        errors: List[Dict[str, str]] = []
        for order_id in order_ids:
            try:
                before = await self.get_order(order_id, organization_id)
                if before is None:
                    raise ValueError("Order not found")
                if _is_settled(before):
                    skipped += 1
                    continue
                await self.mark_order_paid(
                    order_id,
                    organization_id,
                    actor_id,
                    payment_method=payment_method,
                    reference=reference,
                    notify_member=notify_members,
                )
                updated += 1
            except ValueError as exc:
                skipped += 1
                errors.append({"order_id": str(order_id), "error": str(exc)})
        return {"updated": updated, "skipped": skipped, "errors": errors}

    async def report_payment(
        self,
        order_id: str,
        organization_id: str,
        user_id: str,
        payment_method: StorePaymentMethod,
        reference: Optional[str] = None,
        note: Optional[str] = None,
    ) -> StoreOrder:
        """A member declaring they sent payment; an admin still has to verify.

        This deliberately does NOT move ``amount_paid`` — nothing self-reported
        is allowed to settle the ledger.
        """
        order = await self.get_order(order_id, organization_id, user_id=user_id)
        if not order:
            raise ValueError("Order not found")
        if order.status == StoreOrderStatus.CANCELLED:
            raise ValueError("This order was cancelled")
        if order.payment_status in (StorePaymentStatus.PAID, StorePaymentStatus.WAIVED):
            return order

        order.payment_method = payment_method
        order.payment_reference = reference
        order.payment_reported_at = _utcnow()
        order.payment_status = StorePaymentStatus.PENDING_VERIFICATION

        self.db.add(
            StoreOrderEvent(
                id=generate_uuid(),
                organization_id=str(organization_id),
                order_id=order.id,
                event_type=StoreOrderEventType.PAYMENT_REPORTED,
                message=note or f"Member reported payment via {payment_method.value}",
                is_member_visible=True,
                created_by=str(user_id),
            )
        )
        await self.db.commit()

        settings = await self.get_settings(organization_id)
        refreshed = await self.get_order(order_id, organization_id)
        if refreshed and settings.notify_admins_on_order:
            await self.notifications.send_admin_new_order(refreshed, settings)
        return refreshed or order

    async def refund_order(
        self,
        order_id: str,
        organization_id: str,
        actor_id: Optional[str],
        amount: Optional[Decimal] = None,
        reason: Optional[str] = None,
        notify_member: bool = True,
    ) -> StoreOrder:
        order = await self.get_order(order_id, organization_id)
        if not order:
            raise ValueError("Order not found")
        # SoD: a manager must not refund their own order.
        assert_different_person(
            actor_id, order.user_id, action="refund", record="order"
        )
        paid = _money(order.amount_paid)
        if paid <= 0:
            raise ValueError("There is nothing to refund on this order")

        refunded = _money(amount) if amount is not None else paid
        if refunded > paid:
            raise ValueError("Refund cannot exceed the amount paid")

        order.amount_paid = _money(paid - refunded)
        order.payment_status = (
            StorePaymentStatus.REFUNDED
            if order.amount_paid <= 0
            else StorePaymentStatus.PARTIAL
        )

        self.db.add(
            StoreOrderEvent(
                id=generate_uuid(),
                organization_id=str(organization_id),
                order_id=order.id,
                event_type=StoreOrderEventType.REFUNDED,
                message=reason or f"Refund of {refunded} recorded",
                is_member_visible=True,
                created_by=actor_id,
            )
        )
        await self.db.commit()

        refreshed = await self.get_order(order_id, organization_id)
        if refreshed and notify_member:
            settings = await self.get_settings(organization_id)
            if settings.send_payment_receipts:
                await self.notifications.send_order_update(
                    refreshed,
                    reason or f"A refund of {refunded} has been recorded.",
                    settings,
                )
        return refreshed or order

    async def cancel_order(
        self,
        order_id: str,
        organization_id: str,
        actor_id: Optional[str],
        reason: Optional[str] = None,
        notify_member: bool = True,
        user_id: Optional[str] = None,
    ) -> StoreOrder:
        """Cancel an order. ``user_id`` restricts this to the member's own order."""
        order = await self.get_order(order_id, organization_id, user_id=user_id)
        if not order:
            raise ValueError("Order not found")
        if order.status == StoreOrderStatus.CANCELLED:
            return order
        if user_id and order.status not in _MEMBER_CANCELLABLE_STATUSES:
            raise ValueError(
                "This order is already being fulfilled — contact the "
                "quartermaster to cancel it"
            )

        order.status = StoreOrderStatus.CANCELLED
        order.cancelled_at = _utcnow()
        order.cancellation_reason = reason

        self.db.add(
            StoreOrderEvent(
                id=generate_uuid(),
                organization_id=str(organization_id),
                order_id=order.id,
                event_type=StoreOrderEventType.CANCELLED,
                to_status=StoreOrderStatus.CANCELLED.value,
                message=reason or "Order cancelled",
                is_member_visible=True,
                created_by=actor_id,
            )
        )
        await self.db.commit()

        refreshed = await self.get_order(order_id, organization_id)
        if refreshed and notify_member:
            settings = await self.get_settings(organization_id)
            # A cancellation is a status change, and rides the same switch.
            if settings.send_status_updates:
                await self.notifications.send_order_cancelled(
                    refreshed, reason, settings
                )
        return refreshed or order

    async def add_order_message(
        self,
        order_id: str,
        organization_id: str,
        actor_id: Optional[str],
        message: str,
        is_member_visible: bool = True,
        notify_member: bool = True,
    ) -> StoreOrder:
        order = await self.get_order(order_id, organization_id)
        if not order:
            raise ValueError("Order not found")

        self.db.add(
            StoreOrderEvent(
                id=generate_uuid(),
                organization_id=str(organization_id),
                order_id=order.id,
                event_type=(
                    StoreOrderEventType.MESSAGE
                    if is_member_visible
                    else StoreOrderEventType.NOTE
                ),
                message=message,
                is_member_visible=is_member_visible,
                created_by=actor_id,
            )
        )
        await self.db.commit()

        refreshed = await self.get_order(order_id, organization_id)
        if refreshed and is_member_visible and notify_member:
            # Deliberately not behind a notification switch: this is a message
            # a quartermaster typed to one member and asked to send. The
            # switches govern the notices the module raises on its own.
            settings = await self.get_settings(organization_id)
            await self.notifications.send_order_update(refreshed, message, settings)
        return refreshed or order

    async def set_admin_notes(
        self, order_id: str, organization_id: str, notes: Optional[str]
    ) -> StoreOrder:
        order = await self.get_order(order_id, organization_id)
        if not order:
            raise ValueError("Order not found")
        order.admin_notes = notes
        await self.db.commit()
        refreshed = await self.get_order(order_id, organization_id)
        return refreshed or order

    async def bulk_update_status(
        self,
        organization_id: str,
        order_ids: Sequence[str],
        status: StoreOrderStatus,
        actor_id: Optional[str],
        message: Optional[str] = None,
        notify_members: bool = True,
    ) -> Dict[str, Any]:
        updated = 0
        skipped = 0
        errors: List[Dict[str, str]] = []
        for order_id in order_ids:
            try:
                await self.update_order_status(
                    order_id,
                    organization_id,
                    status,
                    actor_id,
                    message=message,
                    notify_member=notify_members,
                )
                updated += 1
            except ValueError as exc:
                skipped += 1
                errors.append({"order_id": str(order_id), "error": str(exc)})
        return {"updated": updated, "skipped": skipped, "errors": errors}

    # ==================================================================
    # External payment reconciliation
    # ==================================================================

    async def find_order_by_reference(
        self, organization_id: str, *references: Optional[str]
    ) -> Optional[StoreOrder]:
        """Locate an order from whatever reference a payment carried.

        Matching is on the order number only, and only when it appears as a
        recognisable token. Fuzzy matching on payer name or amount was
        considered and rejected: applying money to the wrong member's order is
        worse than leaving it for a human, and two members can easily owe the
        same amount in the same window.
        """
        candidates: List[str] = []
        for reference in references:
            if not reference:
                continue
            candidates.extend(_ORDER_NUMBER_RE.findall(str(reference).upper()))
        if not candidates:
            return None

        result = await self.db.execute(
            select(StoreOrder)
            .options(selectinload(StoreOrder.items), selectinload(StoreOrder.window))
            .where(
                StoreOrder.organization_id == str(organization_id),
                StoreOrder.order_number.in_(candidates),
            )
            .limit(2)
        )
        orders = list(result.scalars().all())
        # More than one hit means the reference named several orders; that is
        # not something to guess at.
        return orders[0] if len(orders) == 1 else None

    async def record_external_payment(
        self,
        organization_id: str,
        provider: str,
        capture: Dict[str, Any],
        raw_payload: Optional[Dict[str, Any]] = None,
        auto_apply: bool = True,
    ) -> StorePaymentEvent:
        """Record a payment a provider reports receiving, and try to match it.

        Always writes a row, whatever the outcome. A payment that cannot be
        matched is the case that most needs to reach a person: the money has
        left the member's account, so silently discarding the notification
        would leave them chasing an order that still says unpaid.
        """
        external_id = str(capture.get("capture_id") or capture.get("event_id") or "")
        if not external_id:
            raise ValueError("Payment notification carried no identifier")

        existing = await self.db.execute(
            select(StorePaymentEvent).where(
                StorePaymentEvent.organization_id == str(organization_id),
                StorePaymentEvent.provider == provider,
                StorePaymentEvent.external_id == external_id,
            )
        )
        already = existing.scalar_one_or_none()
        if already is not None:
            # Providers retry until they get a 2xx, so redelivery is normal
            # traffic rather than an error — acknowledge without re-applying.
            return already

        amount = _money(capture.get("amount"))
        reference = (
            capture.get("invoice_id") or capture.get("custom_id") or capture.get("note")
        )

        event = StorePaymentEvent(
            id=generate_uuid(),
            organization_id=str(organization_id),
            provider=provider,
            external_id=external_id,
            event_id=capture.get("event_id"),
            amount=amount,
            currency=(capture.get("currency") or "USD")[:3],
            payer_name=capture.get("payer_name"),
            payer_email=capture.get("payer_email"),
            reference=(str(reference)[:255] if reference else None),
            raw_payload=raw_payload,
            status=StorePaymentEventStatus.UNMATCHED,
        )

        order = await self.find_order_by_reference(
            organization_id,
            capture.get("invoice_id"),
            capture.get("custom_id"),
            capture.get("note"),
        )

        if order is None:
            event.note = "No order number found in the payment reference."
        else:
            event.matched_order_id = order.id
            store_currency = (
                (await self.get_settings(organization_id)).currency or "USD"
            ).upper()
            balance = _money(
                Decimal(order.total or 0) - Decimal(order.amount_paid or 0)
            )
            if order.status == StoreOrderStatus.CANCELLED:
                event.status = StorePaymentEventStatus.AMBIGUOUS
                event.note = f"Order {order.order_number} is cancelled."
            elif (event.currency or "USD").upper() != store_currency:
                # A capture whose currency differs from the store currency must
                # never auto-settle: the numeric amount can equal the balance
                # while being worth materially more or less (StoreOrder has no
                # currency column to catch it downstream). Route to a human.
                event.status = StorePaymentEventStatus.AMBIGUOUS
                event.note = (
                    f"Payment currency {event.currency} does not match the store "
                    f"currency {store_currency} on order {order.order_number}."
                )
            elif balance <= 0:
                event.status = StorePaymentEventStatus.AMBIGUOUS
                event.note = f"Order {order.order_number} already has no balance due."
            elif amount != balance:
                # A short or over payment is a conversation with the member,
                # not something to resolve by guessing which way to round.
                event.status = StorePaymentEventStatus.AMBIGUOUS
                event.note = (
                    f"Amount {amount} does not match the {balance} balance on "
                    f"order {order.order_number}."
                )
            elif not auto_apply:
                event.status = StorePaymentEventStatus.MATCHED
                event.note = "Automatic application is turned off for this integration."
            else:
                event.status = StorePaymentEventStatus.MATCHED

        self.db.add(event)
        await self.db.commit()
        await self.db.refresh(event)

        if event.status == StorePaymentEventStatus.MATCHED and auto_apply and order:
            return await self.apply_payment_event(
                event.id, organization_id, actor_id=None
            )
        return event

    async def apply_payment_event(
        self,
        event_id: str,
        organization_id: str,
        actor_id: Optional[str],
        order_id: Optional[str] = None,
    ) -> StorePaymentEvent:
        """Settle the matched order from a recorded payment.

        ``order_id`` lets an administrator attach an unmatched payment to the
        order it belongs to — the manual half of reconciliation.
        """
        event = await self.get_payment_event(event_id, organization_id)
        if event is None:
            raise ValueError("Payment not found")
        if event.status == StorePaymentEventStatus.APPLIED:
            return event

        target_id = order_id or event.matched_order_id
        if not target_id:
            raise ValueError("Choose an order to apply this payment to")

        order = await self.get_order(target_id, organization_id)
        if order is None:
            raise ValueError("Order not found")

        await self.record_payment(
            order.id,
            organization_id,
            _money(event.amount),
            actor_id,
            payment_method=(
                StorePaymentMethod.PAYPAL
                if event.provider == "paypal"
                else order.payment_method
            ),
            reference=event.external_id,
            mark_paid=True,
            notify_member=True,
        )

        event.matched_order_id = order.id
        event.status = StorePaymentEventStatus.APPLIED
        event.resolved_at = _utcnow()
        event.resolved_by = actor_id
        event.note = f"Applied to order {order.order_number}."
        await self.db.commit()
        # Re-read rather than refresh: the caller serializes the matched order
        # alongside the event, and refresh() would leave that relationship
        # expired for a lazy load asyncio cannot service.
        refreshed = await self.get_payment_event(event.id, organization_id)
        return refreshed or event

    async def ignore_payment_event(
        self,
        event_id: str,
        organization_id: str,
        actor_id: Optional[str],
        reason: Optional[str] = None,
    ) -> StorePaymentEvent:
        """Dismiss a payment that does not belong to any store order."""
        event = await self.get_payment_event(event_id, organization_id)
        if event is None:
            raise ValueError("Payment not found")
        if event.status == StorePaymentEventStatus.APPLIED:
            raise ValueError("An applied payment cannot be dismissed")

        event.status = StorePaymentEventStatus.IGNORED
        event.resolved_at = _utcnow()
        event.resolved_by = actor_id
        if reason:
            event.note = reason
        await self.db.commit()
        refreshed = await self.get_payment_event(event.id, organization_id)
        return refreshed or event

    async def get_payment_event(
        self, event_id: str, organization_id: str
    ) -> Optional[StorePaymentEvent]:
        result = await self.db.execute(
            select(StorePaymentEvent)
            .options(selectinload(StorePaymentEvent.matched_order))
            .where(
                StorePaymentEvent.id == str(event_id),
                StorePaymentEvent.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def count_unresolved_payment_events(self, organization_id: str) -> int:
        """How many inbound payments still need somebody to look at them."""
        result = await self.db.execute(
            select(func.count(StorePaymentEvent.id)).where(
                StorePaymentEvent.organization_id == str(organization_id),
                StorePaymentEvent.status.in_(_UNRESOLVED_PAYMENT_STATUSES),
            )
        )
        return int(result.scalar() or 0)

    async def list_payment_events(
        self,
        organization_id: str,
        status: Optional[str] = None,
        unresolved_only: bool = False,
        limit: int = 100,
    ) -> List[StorePaymentEvent]:
        filters = [StorePaymentEvent.organization_id == str(organization_id)]
        if status:
            try:
                wanted = StorePaymentEventStatus(str(status).lower())
            except ValueError:
                raise ValueError(f"Unknown payment status: {status}")
            filters.append(StorePaymentEvent.status == wanted)
        elif unresolved_only:
            filters.append(StorePaymentEvent.status.in_(_UNRESOLVED_PAYMENT_STATUSES))
        result = await self.db.execute(
            select(StorePaymentEvent)
            .options(selectinload(StorePaymentEvent.matched_order))
            .where(*filters)
            .order_by(StorePaymentEvent.received_at.desc())
            .limit(max(min(limit, 500), 1))
        )
        return list(result.scalars().all())

    # ==================================================================
    # Reporting
    # ==================================================================

    async def _order_rollup(
        self,
        organization_id: str,
        window_ids: Optional[Sequence[str]] = None,
    ) -> Dict[Optional[str], Dict[str, Any]]:
        """Money and order counters per window, computed in SQL.

        Aggregating in the database rather than loading orders and summing in
        Python is not just faster: the previous page-and-sum approach silently
        stopped at the first page, so a window with more orders than the page
        size reported a short tally, a wrong outstanding balance, and sent the
        department to the vendor with the wrong quantities.

        ``window_ids`` of ``None`` rolls up every window (plus orphaned orders
        under the ``None`` key); an empty sequence returns ``{}``.
        """
        if window_ids is not None and len(window_ids) == 0:
            return {}

        paid = Decimal("0")
        filters = [
            StoreOrder.organization_id == str(organization_id),
            StoreOrder.status != StoreOrderStatus.CANCELLED,
        ]
        if window_ids is not None:
            filters.append(StoreOrder.window_id.in_([str(w) for w in window_ids]))

        balance = case(
            (StoreOrder.payment_status == StorePaymentStatus.WAIVED, paid),
            else_=StoreOrder.total - StoreOrder.amount_paid,
        )
        result = await self.db.execute(
            select(
                StoreOrder.window_id,
                func.count(StoreOrder.id),
                func.count(func.distinct(StoreOrder.user_id)),
                func.coalesce(func.sum(StoreOrder.total), paid),
                func.coalesce(func.sum(StoreOrder.amount_paid), paid),
                func.coalesce(func.sum(case((balance > 0, balance), else_=paid)), paid),
                func.sum(
                    case(
                        (
                            StoreOrder.payment_status.in_(
                                [
                                    StorePaymentStatus.UNPAID,
                                    StorePaymentStatus.PARTIAL,
                                ]
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ),
                func.sum(
                    case(
                        (
                            StoreOrder.payment_status
                            == StorePaymentStatus.PENDING_VERIFICATION,
                            1,
                        ),
                        else_=0,
                    )
                ),
                func.sum(
                    case(
                        (
                            StoreOrder.status == StoreOrderStatus.READY_FOR_PICKUP,
                            1,
                        ),
                        else_=0,
                    )
                ),
                func.sum(
                    case(
                        (
                            StoreOrder.status.notin_(
                                [
                                    StoreOrderStatus.FULFILLED,
                                    StoreOrderStatus.CANCELLED,
                                ]
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ),
            )
            .where(*filters)
            .group_by(StoreOrder.window_id)
        )

        rollups: Dict[Optional[str], Dict[str, Any]] = {}
        for row in result.all():
            (
                window_id,
                order_count,
                member_count,
                gross,
                collected,
                outstanding,
                unpaid,
                pending,
                ready,
                open_count,
            ) = row
            rollups[window_id] = {
                "order_count": int(order_count or 0),
                "member_count": int(member_count or 0),
                "gross_sales": _money(gross),
                "collected": _money(collected),
                "outstanding": _money(outstanding),
                "unpaid_order_count": int(unpaid or 0),
                "pending_verification_count": int(pending or 0),
                "ready_for_pickup_count": int(ready or 0),
                "open_order_count": int(open_count or 0),
            }
        return rollups

    @staticmethod
    def _empty_rollup() -> Dict[str, Any]:
        return {
            "order_count": 0,
            "member_count": 0,
            "gross_sales": Decimal("0.00"),
            "collected": Decimal("0.00"),
            "outstanding": Decimal("0.00"),
            "unpaid_order_count": 0,
            "pending_verification_count": 0,
            "ready_for_pickup_count": 0,
            "open_order_count": 0,
        }

    async def _window_size_totals(
        self,
        window_id: str,
        organization_id: str,
        settled_only: Optional[bool] = None,
    ) -> List[Dict[str, Any]]:
        """How many of each size to buy — the purchase order itself.

        Deliberately ignores personalization, which is what separates this from
        ``_window_tallies``. On a personalized product every line carries a
        different name, so the per-name sheet degenerates into one row per
        order and answering "how many larges?" means adding them up by hand —
        the spreadsheet this module exists to replace. The two views answer
        different questions: this one is what the vendor gets ordered, the
        other is what they embroider on it.
        """
        result = await self.db.execute(
            select(
                StoreOrderItem.product_id,
                StoreOrderItem.product_name,
                StoreOrderItem.variant_label,
                StoreOrderItem.sku,
                func.sum(StoreOrderItem.quantity),
                func.coalesce(func.sum(StoreOrderItem.line_total), Decimal("0")),
            )
            .join(StoreOrder, StoreOrder.id == StoreOrderItem.order_id)
            .where(
                StoreOrder.window_id == str(window_id),
                StoreOrder.organization_id == str(organization_id),
                StoreOrder.status != StoreOrderStatus.CANCELLED,
                *(() if settled_only is None else (_settled_clause(settled_only),)),
            )
            .group_by(
                StoreOrderItem.product_id,
                StoreOrderItem.product_name,
                StoreOrderItem.variant_label,
                StoreOrderItem.sku,
            )
            .order_by(StoreOrderItem.product_name, StoreOrderItem.variant_label)
        )
        return [
            {
                "product_id": product_id,
                "product_name": product_name,
                "variant_label": variant_label,
                "sku": sku,
                "quantity": int(quantity or 0),
                "line_total": _money(line_total),
            }
            for (
                product_id,
                product_name,
                variant_label,
                sku,
                quantity,
                line_total,
            ) in result.all()
        ]

    async def _window_tallies(
        self,
        window_id: str,
        organization_id: str,
        settled_only: Optional[bool] = None,
    ) -> List[Dict[str, Any]]:
        """The vendor purchase-order sheet for a window, grouped in SQL.

        Personalized lines are grouped separately from plain ones: the vendor
        needs one row per distinct name to embroider, not a merged count.
        """
        result = await self.db.execute(
            select(
                StoreOrderItem.product_id,
                StoreOrderItem.product_name,
                StoreOrderItem.variant_label,
                StoreOrderItem.sku,
                StoreOrderItem.personalization_text,
                func.sum(StoreOrderItem.quantity),
                func.max(StoreOrderItem.unit_price),
                func.coalesce(func.sum(StoreOrderItem.line_total), Decimal("0")),
            )
            .join(StoreOrder, StoreOrder.id == StoreOrderItem.order_id)
            .where(
                StoreOrder.window_id == str(window_id),
                StoreOrder.organization_id == str(organization_id),
                StoreOrder.status != StoreOrderStatus.CANCELLED,
                *(() if settled_only is None else (_settled_clause(settled_only),)),
            )
            .group_by(
                StoreOrderItem.product_id,
                StoreOrderItem.product_name,
                StoreOrderItem.variant_label,
                StoreOrderItem.sku,
                StoreOrderItem.personalization_text,
            )
            .order_by(
                StoreOrderItem.product_name,
                StoreOrderItem.variant_label,
                StoreOrderItem.personalization_text,
            )
        )
        return [
            {
                "product_id": product_id,
                "product_name": product_name,
                "variant_label": variant_label,
                "sku": sku,
                "personalization_text": personalization_text,
                "quantity": int(quantity or 0),
                "unit_price": _money(unit_price),
                "line_total": _money(line_total),
            }
            for (
                product_id,
                product_name,
                variant_label,
                sku,
                personalization_text,
                quantity,
                unit_price,
                line_total,
            ) in result.all()
        ]

    async def get_window_summary(
        self, window_id: str, organization_id: str
    ) -> Dict[str, Any]:
        window = await self.get_window(window_id, organization_id)
        if not window:
            raise ValueError("Order window not found")

        rollups = await self._order_rollup(organization_id, [window_id])
        rollup = rollups.get(window.id, self._empty_rollup())
        settings = await self.get_settings(organization_id)
        holds_unpaid = settings.payment_policy == StorePaymentPolicy.BEFORE_VENDOR_ORDER
        settled_only = True if holds_unpaid else None

        return {
            "window_id": window.id,
            "window_name": window.name,
            "status": window.status,
            "order_count": rollup["order_count"],
            "member_count": rollup["member_count"],
            "gross_sales": rollup["gross_sales"],
            "collected": rollup["collected"],
            "outstanding": rollup["outstanding"],
            "unpaid_order_count": rollup["unpaid_order_count"],
            "pending_verification_count": rollup["pending_verification_count"],
            "payment_policy": settings.payment_policy,
            # Under BEFORE_VENDOR_ORDER the purchase order covers only settled
            # orders, and the rest are reported separately rather than dropped:
            # the quartermaster still has to see who is being left out, and
            # chase them, before the order goes in.
            "size_totals": await self._window_size_totals(
                window.id, organization_id, settled_only=settled_only
            ),
            "held_totals": (
                await self._window_size_totals(
                    window.id, organization_id, settled_only=False
                )
                if holds_unpaid
                else []
            ),
            "held_order_count": (rollup["unpaid_order_count"] if holds_unpaid else 0),
            "tallies": await self._window_tallies(
                window.id, organization_id, settled_only=settled_only
            ),
        }

    async def get_window_rollups(
        self, organization_id: str, window_ids: Sequence[str]
    ) -> Dict[str, Dict[str, Any]]:
        """Counters for many windows in one query (the admin windows list)."""
        rollups = await self._order_rollup(organization_id, window_ids)
        return {
            str(window_id): rollups.get(str(window_id), self._empty_rollup())
            for window_id in window_ids
        }

    async def get_dashboard(self, organization_id: str) -> Dict[str, Any]:
        settings = await self.get_settings(organization_id)
        open_windows = await self.get_open_windows(organization_id)
        active_window = open_windows[0] if open_windows else None

        org_totals = await self._order_rollup(organization_id)
        combined = self._empty_rollup()
        for rollup in org_totals.values():
            for key in (
                "order_count",
                "unpaid_order_count",
                "pending_verification_count",
                "ready_for_pickup_count",
                "open_order_count",
            ):
                combined[key] += rollup[key]
            combined["outstanding"] = _money(
                combined["outstanding"] + rollup["outstanding"]
            )

        collected = Decimal("0.00")
        if active_window is not None:
            collected = org_totals.get(active_window.id, self._empty_rollup())[
                "collected"
            ]

        product_count = await self.db.scalar(
            select(func.count(StoreProduct.id)).where(
                StoreProduct.organization_id == str(organization_id),
                StoreProduct.status == StoreProductStatus.ACTIVE,
            )
        )

        recent_orders, _ = await self.list_orders(organization_id, page=1, page_size=10)

        return {
            "is_enabled": settings.is_enabled,
            "active_window": active_window,
            "open_order_count": combined["open_order_count"],
            "awaiting_payment_count": combined["unpaid_order_count"],
            "pending_verification_count": combined["pending_verification_count"],
            "ready_for_pickup_count": combined["ready_for_pickup_count"],
            "outstanding_balance": combined["outstanding"],
            "collected_this_window": collected,
            "active_product_count": int(product_count or 0),
            "recent_orders": recent_orders,
        }

    async def export_orders_csv(
        self,
        organization_id: str,
        window_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> str:
        """Order export for the vendor purchase order / treasurer hand-off.

        Written with SafeCsvWriter — member names and notes are free text and
        would otherwise execute as formulas when opened in Excel/Sheets.

        Pages through the whole result set rather than taking the first page:
        an export that silently stopped at the page size would send the
        department to the vendor with the wrong quantities.

        Every order is included, unpaid ones too, because this doubles as the
        treasurer's record. Under a policy that holds unpaid orders back, the
        "Held From Vendor Order" column marks the ones the on-screen tally
        excluded — without it a quartermaster could mail this sheet to the
        vendor and undo the very rule they set.
        """
        settings = await self.get_settings(organization_id)
        holds_unpaid = settings.payment_policy == StorePaymentPolicy.BEFORE_VENDOR_ORDER
        orders: List[StoreOrder] = []
        page = 1
        while True:
            batch, total = await self.list_orders(
                organization_id,
                window_id=window_id,
                status=status,
                page=page,
                page_size=_EXPORT_PAGE_SIZE,
            )
            orders.extend(batch)
            if len(orders) >= total or not batch:
                break
            page += 1
        output = io.StringIO()
        writer = SafeCsvWriter(output, quoting=csv.QUOTE_MINIMAL)
        writer.writerow(
            [
                "Order Number",
                "Submitted",
                "Member",
                "Email",
                "Item",
                "Option",
                "Personalization",
                "SKU",
                "Quantity",
                "Unit Price",
                "Line Total",
                "Order Total",
                "Amount Paid",
                "Balance Due",
                "Order Status",
                "Payment Status",
                "Held From Vendor Order",
                "Payment Method",
                "Payment Reference",
                "Fulfillment",
                "Member Notes",
            ]
        )
        for order in orders:
            balance = _money(
                Decimal(order.total or 0) - Decimal(order.amount_paid or 0)
            )
            submitted = _as_aware(order.submitted_at)
            for item in order.items:
                writer.writerow(
                    [
                        order.order_number,
                        submitted.strftime("%Y-%m-%d %H:%M UTC") if submitted else "",
                        order.customer_name,
                        order.customer_email or "",
                        item.product_name,
                        item.variant_label or "",
                        item.personalization_text or "",
                        item.sku or "",
                        item.quantity,
                        f"{_money(item.unit_price)}",
                        f"{_money(item.line_total)}",
                        f"{_money(order.total)}",
                        f"{_money(order.amount_paid)}",
                        f"{balance}",
                        order.status.value if order.status else "",
                        order.payment_status.value if order.payment_status else "",
                        ("yes" if holds_unpaid and not _is_settled(order) else "no"),
                        order.payment_method.value if order.payment_method else "",
                        order.payment_reference or "",
                        (
                            order.fulfillment_method.value
                            if order.fulfillment_method
                            else ""
                        ),
                        order.member_notes or "",
                    ]
                )
        return output.getvalue()

    # ==================================================================
    # Payment instructions
    # ==================================================================

    def build_payment_options(
        self, settings: StoreSettings, balance: Decimal, reference: str
    ) -> List[Dict[str, Any]]:
        """Every configured way to settle, in the order the department listed."""
        return build_payment_options(settings, balance, reference)

    def build_payment_instructions(
        self, order: StoreOrder, settings: StoreSettings
    ) -> Optional[Dict[str, Any]]:
        """Where the member should send the balance, with a prefilled link."""
        if _is_settled(order):
            return None
        balance = _money(Decimal(order.total or 0) - Decimal(order.amount_paid or 0))
        if balance <= 0:
            return None

        method = order.payment_method
        options = self.build_payment_options(settings, balance, order.order_number)
        # The method chosen at checkout leads, but the rest stay available —
        # see build_payment_options.
        chosen = next(
            (o for o in options if method and o["method"] == method.value), None
        )
        if chosen is not None:
            options = [chosen] + [o for o in options if o is not chosen]
        elif method is not None:
            # The department may have stopped accepting this method since the
            # order was placed. The member still owes the balance and still
            # needs somewhere to send it, so their own method is rebuilt even
            # though it is no longer offered to new orders.
            chosen = build_payment_option(method, settings, balance, order.order_number)
            if chosen is not None:
                options = [chosen] + options

        payload: Dict[str, Any] = {
            "method": (
                chosen["method"] if chosen else (method.value if method else None)
            ),
            "label": chosen["label"] if chosen else None,
            "payment_url": chosen["payment_url"] if chosen else None,
            "handle": chosen["handle"] if chosen else None,
            "instructions": (chosen and chosen["instructions"])
            or settings.payment_instructions,
            "reference": order.order_number,
            "amount_due": balance,
            "options": options,
        }
        return payload

    # ==================================================================
    # Scheduled maintenance
    # ==================================================================

    async def _get_organization(self, organization_id: str) -> Optional[Organization]:
        result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def run_window_lifecycle(self, organization_id: str) -> int:
        """Open/close windows that have reached their scheduled time.

        Returns the number of state transitions and reminders performed.
        """
        settings = await self.get_settings(organization_id)
        now = _utcnow()
        actions = 0

        result = await self.db.execute(
            select(StoreOrderWindow).where(
                StoreOrderWindow.organization_id == str(organization_id),
                StoreOrderWindow.status.in_(
                    [
                        StoreWindowStatus.SCHEDULED,
                        StoreWindowStatus.OPEN,
                    ]
                ),
            )
        )
        windows = list(result.scalars().all())

        for window in windows:
            opens_at = _as_aware(window.opens_at)
            closes_at = _as_aware(window.closes_at)

            if (
                window.status == StoreWindowStatus.SCHEDULED
                and window.auto_open
                and opens_at
                and opens_at <= now
            ):
                await self.open_window(
                    window.id, organization_id, notify_members=window.notify_on_open
                )
                actions += 1
                continue

            if window.status != StoreWindowStatus.OPEN:
                continue

            if window.auto_close and closes_at and closes_at <= now:
                await self.close_window(window.id, organization_id, notify_members=True)
                actions += 1
                continue

            if (
                closes_at
                and settings.send_window_closing_reminder
                and not window.closing_reminder_sent_at
                and settings.window_reminder_hours
                and now
                >= closes_at - timedelta(hours=int(settings.window_reminder_hours))
            ):
                sent = await self.notifications.send_window_closing_soon(
                    window, settings
                )
                window.closing_reminder_sent_at = now
                await self.db.commit()
                if sent:
                    actions += 1

        return actions

    async def run_payment_reminders(self, organization_id: str) -> int:
        """Nudge members whose orders still carry a balance."""
        settings = await self.get_settings(organization_id)
        if not settings.send_payment_reminders:
            return 0

        cutoff = _utcnow() - timedelta(days=int(settings.payment_reminder_days or 3))
        result = await self.db.execute(
            select(StoreOrder)
            .options(selectinload(StoreOrder.items))
            .where(
                StoreOrder.organization_id == str(organization_id),
                StoreOrder.status.notin_(
                    [StoreOrderStatus.CANCELLED, StoreOrderStatus.FULFILLED]
                ),
                StoreOrder.payment_status.in_(
                    [StorePaymentStatus.UNPAID, StorePaymentStatus.PARTIAL]
                ),
                StoreOrder.submitted_at <= cutoff,
                StoreOrder.payment_reminder_sent_at.is_(None),
                StoreOrder.customer_email.isnot(None),
            )
            .limit(200)
        )
        orders = list(result.scalars().all())
        if not orders:
            return 0

        organization = await self._get_organization(organization_id)
        sent_count = 0
        for order in orders:
            if _money(order.total) <= _money(order.amount_paid):
                continue
            sent = await self.notifications.send_payment_reminder(
                order, settings, organization
            )
            order.payment_reminder_sent_at = _utcnow()
            if sent:
                sent_count += 1
        await self.db.commit()
        return sent_count
