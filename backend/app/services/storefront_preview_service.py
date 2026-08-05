"""
Storefront Notification Previews

Renders any of the store's nine notices against a sample order or window so a
quartermaster can see what a member receives before switching it on — and,
more usefully, before wording the payment instructions and receipt footer that
sit inside it.

Two decisions worth knowing about:

**The preview runs the real ``send_*`` method.** ``StorefrontNotificationService``
takes a capture list that diverts the composed message instead of delivering
it, so what is shown here is byte-for-byte what would be sent. A preview built
from a parallel "roughly what it looks like" renderer drifts from the email the
moment either side changes, and the quartermaster who approved it would have
been approving something else.

**The order and window are sample data; the settings are real.** The parts a
department controls — payment handles and instructions, the receipt footer,
currency, store name, branding — come from its own saved configuration, since
those are what the preview exists to check. Sample data is never written to
the database; the objects below are constructed and thrown away.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.storefront import (
    StoreFulfillmentMethod,
    StoreOrder,
    StoreOrderItem,
    StoreOrderStatus,
    StoreOrderWindow,
    StorePaymentMethod,
    StorePaymentStatus,
    StoreSettings,
    StoreWindowStatus,
)
from app.models.user import Organization
from app.services.storefront_notification_service import (
    StorefrontNotificationService,
)

# Sample recipients. Real addresses are never resolved for a preview: the
# roster is irrelevant to what the email looks like, and a store with no
# members yet would otherwise render nothing at all.
_SAMPLE_MEMBER = "sam.member@example.org"
_SAMPLE_ADMIN = "quartermaster@example.org"


class PreviewNotAvailable(ValueError):
    """Raised for a notice name the store does not send."""


def _sample_order(
    settings: StoreSettings,
    *,
    paid: bool = False,
    status: StoreOrderStatus = StoreOrderStatus.AWAITING_PAYMENT,
) -> StoreOrder:
    """A job shirt with a name on it — the order this module was built for."""
    total = Decimal("53.00")
    order = StoreOrder(
        id="preview-order",
        organization_id=str(settings.organization_id),
        order_number="ORD-2026-0042",
        customer_name="Sam Member",
        customer_email=_SAMPLE_MEMBER,
        status=status,
        payment_status=(StorePaymentStatus.PAID if paid else StorePaymentStatus.UNPAID),
        payment_method=StorePaymentMethod.VENMO,
        fulfillment_method=StoreFulfillmentMethod.PICKUP,
        subtotal=total,
        tax_amount=Decimal("0.00"),
        shipping_amount=Decimal("0.00"),
        discount_amount=Decimal("0.00"),
        total=total,
        amount_paid=total if paid else Decimal("0.00"),
        member_notes="Happy to collect at drill.",
    )
    order.items = [
        StoreOrderItem(
            id="preview-item",
            organization_id=str(settings.organization_id),
            order_id=order.id,
            product_name="Department Job Shirt",
            variant_label="Large",
            personalization_text="GARCIA",
            quantity=1,
            unit_price=total,
            line_total=total,
        )
    ]
    return order


def _sample_window(settings: StoreSettings) -> StoreOrderWindow:
    now = datetime.now(timezone.utc)
    return StoreOrderWindow(
        id="preview-window",
        organization_id=str(settings.organization_id),
        name="Fall job shirts",
        description="Navy job shirts with your name embroidered on the chest.",
        status=StoreWindowStatus.OPEN,
        opens_at=now - timedelta(days=3),
        closes_at=now + timedelta(days=4),
        expected_delivery_date=(now + timedelta(days=42)).date(),
        vendor_name="Acme Apparel",
        pickup_instructions="Collect at the station office after Tuesday drill.",
    )


class StorefrontPreviewService:
    """Renders one storefront notice for the settings screen."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # Notice key → the switch that governs it, who receives it, and the other
    # emails that same switch turns off. The last column is why this table
    # exists rather than a bare list: a quartermaster unticking "status
    # changes" to stop the "ready for pickup" mail has no way to guess it also
    # silences the cancellation notice.
    CATALOG: Dict[str, Dict[str, Any]] = {
        "order_confirmation": {
            "label": "Order confirmation",
            "setting": "send_order_confirmation",
            "audience": "The member who ordered",
            "also_governs": [],
        },
        "status_change": {
            "label": "Status change",
            "setting": "send_status_updates",
            "audience": "The member who ordered",
            "also_governs": ["The cancellation notice"],
        },
        "payment_receipt": {
            "label": "Payment receipt",
            "setting": "send_payment_receipts",
            "audience": "The member who ordered",
            "also_governs": ["Waived balances", "Refunds"],
        },
        "payment_reminder": {
            "label": "Payment reminder",
            "setting": "send_payment_reminders",
            "audience": "Members still carrying a balance",
            "also_governs": [],
        },
        "admin_new_order": {
            "label": "New order alert",
            "setting": "notify_admins_on_order",
            "audience": "Store managers and the extra notification recipients",
            "also_governs": [],
        },
        "window_opened": {
            "label": "Ordering is open",
            "setting": "send_window_opened",
            "audience": "Every active member (BCC)",
            "also_governs": [],
        },
        "window_closing": {
            "label": "Last call",
            "setting": "send_window_closing_reminder",
            "audience": "Every active member (BCC)",
            "also_governs": [],
        },
        "window_closed": {
            "label": "Ordering has closed",
            "setting": "send_window_closed",
            "audience": "Everyone who ordered in that window (BCC)",
            "also_governs": [],
        },
        "vendor_order_placed": {
            "label": "Order placed with the vendor",
            "setting": "send_vendor_order_updates",
            "audience": "Everyone who ordered in that window (BCC)",
            "also_governs": [],
        },
    }

    async def render(self, notice: str, organization_id: str) -> Dict[str, Any]:
        """Compose *notice* against sample data and the store's real settings."""
        entry = self.CATALOG.get(notice)
        if entry is None:
            raise PreviewNotAvailable(f"There is no '{notice}' notice to preview")

        # Imported here rather than at module scope: StorefrontService imports
        # the notification service, which this module also imports, and a
        # top-level import would close the cycle.
        from app.services.storefront_service import StorefrontService

        service = StorefrontService(self.db)
        settings = await service.get_settings(organization_id)
        result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        organization = result.scalar_one_or_none()

        captured: List[Dict[str, Any]] = []
        notifier = StorefrontNotificationService(self.db, capture=captured)
        await self._compose(notice, notifier, settings, organization)

        if not captured:
            # Defensive: every branch above composes exactly one message.
            raise PreviewNotAvailable(f"The '{notice}' notice produced no preview")
        message = captured[0]

        return {
            "notice": notice,
            "label": entry["label"],
            "setting": entry["setting"],
            "audience": entry["audience"],
            "also_governs": entry["also_governs"],
            "enabled": bool(getattr(settings, entry["setting"], True)),
            "subject": message["subject"],
            "html_body": message["html_body"],
            "text_body": message["text_body"],
        }

    async def _compose(
        self,
        notice: str,
        notifier: StorefrontNotificationService,
        settings: StoreSettings,
        organization: Optional[Organization],
    ) -> None:
        window = _sample_window(settings)
        to = [_SAMPLE_MEMBER]

        if notice == "order_confirmation":
            await notifier.send_order_confirmation(
                _sample_order(settings), settings, organization
            )
        elif notice == "status_change":
            await notifier.send_order_update(
                _sample_order(
                    settings, paid=True, status=StoreOrderStatus.READY_FOR_PICKUP
                ),
                "Your order has arrived and is ready to collect.",
                settings,
                organization,
                status_label="Ready for pickup",
            )
        elif notice == "payment_receipt":
            await notifier.send_payment_received(
                _sample_order(settings, paid=True, status=StoreOrderStatus.PAID),
                settings,
                organization,
                amount=Decimal("53.00"),
            )
        elif notice == "payment_reminder":
            await notifier.send_payment_reminder(
                _sample_order(settings), settings, organization
            )
        elif notice == "admin_new_order":
            await notifier.send_admin_new_order(
                _sample_order(settings),
                settings,
                organization,
                recipients=[_SAMPLE_ADMIN],
            )
        elif notice == "window_opened":
            await notifier.send_window_opened(
                window,
                settings,
                organization,
                message="Sizing samples are in the day room.",
                recipients=to,
            )
        elif notice == "window_closing":
            await notifier.send_window_closing_soon(
                window, settings, organization, recipients=to
            )
        elif notice == "window_closed":
            window.status = StoreWindowStatus.CLOSED
            await notifier.send_window_closed(
                window,
                settings,
                to,
                organization,
                message="The order goes to the vendor on Monday.",
            )
        elif notice == "vendor_order_placed":
            window.vendor_ordered_at = datetime.now(timezone.utc)
            await notifier.send_vendor_order_placed(window, settings, to, organization)


__all__ = ["PreviewNotAvailable", "StorefrontPreviewService"]
