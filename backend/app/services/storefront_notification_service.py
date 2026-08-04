"""
Storefront Notification Service

Builds and sends the storefront's outbound email: order confirmations, order
updates, payment reminders and receipts, and the order-window announcements
(open / closing soon / closed).

Emails are composed inline with ``wrap_email_body`` — the same approach the
scheduled inventory alerts use — rather than through the customizable
``EmailTemplate`` system, because each of these bodies is a rendered table of
order lines rather than a fixed block of prose an admin would edit.
"""

import html as _html
from decimal import Decimal
from typing import Any, Dict, List, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.storefront import (
    StoreOrder,
    StoreOrderWindow,
    StorePaymentMethod,
    StoreSettings,
)
from app.models.user import Organization, User
from app.services.email_service import EmailService, wrap_email_body
from app.utils.storefront_payments import build_paypal_url, build_venmo_url

# Colors used for the email header banner, by notice kind.
_HEADER_BLUE = "#1d4ed8"
_HEADER_GREEN = "#047857"
_HEADER_AMBER = "#b45309"
_HEADER_RED = "#b91c1c"

_METHOD_LABELS = {
    StorePaymentMethod.VENMO: "Venmo",
    StorePaymentMethod.PAYPAL: "PayPal",
    StorePaymentMethod.CASH: "Cash",
    StorePaymentMethod.CHECK: "Check",
    StorePaymentMethod.PAYROLL_DEDUCTION: "Payroll deduction",
    StorePaymentMethod.OTHER: "Other",
}


def _money(value: Optional[Decimal], currency: str = "USD") -> str:
    """Render a Decimal as a currency string for email bodies."""
    amount = Decimal(value or 0).quantize(Decimal("0.01"))
    symbol = "$" if currency == "USD" else f"{currency} "
    return f"{symbol}{amount:,.2f}"


def _cell(content: str, align: str = "left", bold: bool = False) -> str:
    weight = "font-weight:600;" if bold else ""
    return (
        f'<td style="padding:6px 12px;border-bottom:1px solid #eee;'
        f'text-align:{align};{weight}">{content}</td>'
    )


class StorefrontNotificationService:
    """Sends the storefront's member- and admin-facing email."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Recipients
    # ------------------------------------------------------------------

    async def _get_organization(self, organization_id: str) -> Optional[Organization]:
        result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def get_member_recipients(self, organization_id: str) -> List[str]:
        """Every active member of the org with an email address."""
        result = await self.db.execute(
            select(User.email).where(
                User.organization_id == str(organization_id),
                User.is_active.is_(True),
                User.email.isnot(None),
            )
        )
        return [email for email in result.scalars().all() if email]

    async def get_admin_recipients(
        self, organization_id: str, settings: Optional[StoreSettings]
    ) -> List[str]:
        """Store managers plus any extra addresses configured in settings."""
        result = await self.db.execute(
            select(User).where(
                User.organization_id == str(organization_id),
                User.is_active.is_(True),
                User.email.isnot(None),
            )
        )
        recipients = {
            user.email
            for user in result.scalars().all()
            if user.email and user.role in ("admin", "owner", "quartermaster")
        }
        for extra in (settings.notify_emails if settings else None) or []:
            if isinstance(extra, str) and extra.strip():
                recipients.add(extra.strip())
        return sorted(recipients)

    # ------------------------------------------------------------------
    # Shared body fragments
    # ------------------------------------------------------------------

    def _items_table(self, order: StoreOrder, currency: str) -> str:
        rows = ""
        for item in order.items:
            name = _html.escape(item.product_name or "")
            if item.variant_label:
                name += (
                    '<br><span style="color:#6b7280;font-size:12px;">'
                    f"{_html.escape(item.variant_label)}</span>"
                )
            rows += (
                "<tr>"
                + _cell(name)
                + _cell(str(item.quantity), align="center")
                + _cell(_money(item.unit_price, currency), align="right")
                + _cell(_money(item.line_total, currency), align="right")
                + "</tr>"
            )

        totals = ""
        if Decimal(order.tax_amount or 0) > 0:
            totals += (
                '<tr><td colspan="3" style="padding:4px 12px;text-align:right;">Tax</td>'
                f'<td style="padding:4px 12px;text-align:right;">'
                f"{_money(order.tax_amount, currency)}</td></tr>"
            )
        if Decimal(order.shipping_amount or 0) > 0:
            totals += (
                '<tr><td colspan="3" style="padding:4px 12px;text-align:right;">'
                "Shipping</td>"
                f'<td style="padding:4px 12px;text-align:right;">'
                f"{_money(order.shipping_amount, currency)}</td></tr>"
            )
        if Decimal(order.discount_amount or 0) > 0:
            totals += (
                '<tr><td colspan="3" style="padding:4px 12px;text-align:right;">'
                "Discount</td>"
                f'<td style="padding:4px 12px;text-align:right;">'
                f"-{_money(order.discount_amount, currency)}</td></tr>"
            )
        totals += (
            '<tr><td colspan="3" style="padding:8px 12px;text-align:right;'
            'font-weight:700;border-top:2px solid #e5e7eb;">Total</td>'
            '<td style="padding:8px 12px;text-align:right;font-weight:700;'
            f'border-top:2px solid #e5e7eb;">{_money(order.total, currency)}</td></tr>'
        )

        return (
            '<table style="width:100%;border-collapse:collapse;margin:16px 0;">'
            '<thead><tr style="background:#f3f4f6;">'
            '<th style="padding:8px 12px;text-align:left;">Item</th>'
            '<th style="padding:8px 12px;text-align:center;">Qty</th>'
            '<th style="padding:8px 12px;text-align:right;">Price</th>'
            '<th style="padding:8px 12px;text-align:right;">Total</th>'
            f"</tr></thead><tbody>{rows}{totals}</tbody></table>"
        )

    def _payment_block(
        self,
        order: StoreOrder,
        settings: Optional[StoreSettings],
        currency: str,
    ) -> str:
        """Render 'how to pay' with a prefilled Venmo/PayPal link when possible."""
        balance = Decimal(order.total or 0) - Decimal(order.amount_paid or 0)
        if balance <= 0 or not settings:
            return ""

        method = order.payment_method
        lines: List[str] = [
            f"<p><strong>Balance due: {_money(balance, currency)}</strong></p>"
        ]

        link: Optional[str] = None
        if method == StorePaymentMethod.VENMO:
            link = build_venmo_url(
                settings.venmo_handle, balance, f"{order.order_number}"
            )
            if settings.venmo_handle:
                lines.append(
                    "<p>Send payment on Venmo to "
                    f"<strong>@{_html.escape(settings.venmo_handle)}</strong> and put "
                    f"<strong>{_html.escape(order.order_number)}</strong> in the note."
                    "</p>"
                )
        elif method == StorePaymentMethod.PAYPAL:
            link = build_paypal_url(settings.paypal_me_url, balance)
            target = settings.paypal_me_url or settings.paypal_email
            if target:
                lines.append(
                    "<p>Send payment on PayPal to "
                    f"<strong>{_html.escape(target)}</strong> and reference "
                    f"<strong>{_html.escape(order.order_number)}</strong>.</p>"
                )
        elif method == StorePaymentMethod.CHECK and settings.check_payable_to:
            lines.append(
                "<p>Make the check payable to "
                f"<strong>{_html.escape(settings.check_payable_to)}</strong> and "
                f"reference <strong>{_html.escape(order.order_number)}</strong>.</p>"
            )
            if settings.check_mailing_address:
                lines.append(
                    '<p style="white-space:pre-line;">'
                    f"{_html.escape(settings.check_mailing_address)}</p>"
                )
        elif method == StorePaymentMethod.CASH and settings.cash_instructions:
            lines.append(
                '<p style="white-space:pre-line;">'
                f"{_html.escape(settings.cash_instructions)}</p>"
            )
        elif (
            method == StorePaymentMethod.PAYROLL_DEDUCTION
            and settings.payroll_deduction_instructions
        ):
            lines.append(
                '<p style="white-space:pre-line;">'
                f"{_html.escape(settings.payroll_deduction_instructions)}</p>"
            )
        elif method == StorePaymentMethod.OTHER and settings.other_payment_instructions:
            lines.append(
                '<p style="white-space:pre-line;">'
                f"{_html.escape(settings.other_payment_instructions)}</p>"
            )

        if link:
            lines.append(
                f'<p><a href="{_html.escape(link, quote=True)}" '
                'style="display:inline-block;background:#1d4ed8;color:#ffffff;'
                "padding:10px 18px;border-radius:6px;text-decoration:none;"
                'font-weight:600;">Pay '
                f"{_money(balance, currency)} now</a></p>"
            )

        if settings.payment_instructions:
            lines.append(
                '<p style="white-space:pre-line;color:#6b7280;">'
                f"{_html.escape(settings.payment_instructions)}</p>"
            )

        return "".join(lines)

    # ------------------------------------------------------------------
    # Delivery
    # ------------------------------------------------------------------

    async def _send(
        self,
        organization: Optional[Organization],
        recipients: List[str],
        subject: str,
        title: str,
        body_html: str,
        text_body: str,
        template_type: str,
        header_color: str = _HEADER_BLUE,
        bcc: bool = False,
    ) -> int:
        """Send one composed notice; returns the number of successful sends."""
        addresses = [address for address in recipients if address]
        if not addresses:
            return 0
        try:
            email_service = EmailService(organization=organization)
            html_body = wrap_email_body(
                organization, title, body_html, header_color=header_color
            )
            if bcc:
                # Store-wide announcements go out BCC so one member's email
                # address is never disclosed to the rest of the department.
                success, _ = await email_service.send_email(
                    to_emails=addresses[:1],
                    bcc_emails=addresses[1:],
                    subject=subject,
                    html_body=html_body,
                    text_body=text_body,
                    db=self.db,
                    template_type=template_type,
                )
            else:
                success, _ = await email_service.send_email(
                    to_emails=addresses,
                    subject=subject,
                    html_body=html_body,
                    text_body=text_body,
                    db=self.db,
                    template_type=template_type,
                )
            return success
        except Exception as exc:
            # A failed notice must never roll back the order it describes.
            logger.error(f"Storefront notification '{template_type}' failed: {exc}")
            return 0

    # ------------------------------------------------------------------
    # Order notices
    # ------------------------------------------------------------------

    async def send_order_confirmation(
        self,
        order: StoreOrder,
        settings: Optional[StoreSettings],
        organization: Optional[Organization] = None,
    ) -> int:
        """Receipt + payment instructions, sent when an order is submitted."""
        if not order.customer_email:
            return 0
        org = organization or await self._get_organization(order.organization_id)
        currency = (settings.currency if settings else None) or "USD"
        store_name = (settings.store_name if settings else None) or "Department Store"

        body = (
            f"<p>Hi {_html.escape((order.customer_name or '').split(' ')[0])},</p>"
            f"<p>Thanks for your order from the {_html.escape(store_name)}. "
            f"Your order number is <strong>{_html.escape(order.order_number)}</strong>."
            "</p>"
            f"{self._items_table(order, currency)}"
            f"{self._payment_block(order, settings, currency)}"
        )
        if settings and settings.receipt_footer:
            body += (
                '<p style="color:#6b7280;white-space:pre-line;">'
                f"{_html.escape(settings.receipt_footer)}</p>"
            )

        return await self._send(
            org,
            [order.customer_email],
            f"Order {order.order_number} received",
            "Order Confirmation",
            body,
            (
                f"Order {order.order_number} received. "
                f"Total {_money(order.total, currency)}."
            ),
            "storefront_order_confirmation",
        )

    async def send_admin_new_order(
        self,
        order: StoreOrder,
        settings: Optional[StoreSettings],
        organization: Optional[Organization] = None,
    ) -> int:
        """Heads-up to the quartermaster that an order landed."""
        recipients = await self.get_admin_recipients(order.organization_id, settings)
        if not recipients:
            return 0
        org = organization or await self._get_organization(order.organization_id)
        currency = (settings.currency if settings else None) or "USD"

        body = (
            f"<p><strong>{_html.escape(order.customer_name or '')}</strong> placed "
            f"order <strong>{_html.escape(order.order_number)}</strong>.</p>"
            f"{self._items_table(order, currency)}"
        )
        if order.member_notes:
            body += (
                "<p><strong>Member notes:</strong><br>"
                f'<span style="white-space:pre-line;">'
                f"{_html.escape(order.member_notes)}</span></p>"
            )

        return await self._send(
            org,
            recipients,
            f"New store order {order.order_number}",
            "New Store Order",
            body,
            (
                f"{order.customer_name} placed order {order.order_number} "
                f"for {_money(order.total, currency)}."
            ),
            "storefront_new_order_admin",
        )

    async def send_order_update(
        self,
        order: StoreOrder,
        message: str,
        settings: Optional[StoreSettings],
        organization: Optional[Organization] = None,
        status_label: Optional[str] = None,
    ) -> int:
        """A status change or a note the department wants the member to see."""
        if not order.customer_email:
            return 0
        org = organization or await self._get_organization(order.organization_id)
        currency = (settings.currency if settings else None) or "USD"

        body = (
            f"<p>Update on your order "
            f"<strong>{_html.escape(order.order_number)}</strong>"
            + (f" — {_html.escape(status_label)}" if status_label else "")
            + ".</p>"
            f'<p style="white-space:pre-line;">{_html.escape(message)}</p>'
        )
        balance = Decimal(order.total or 0) - Decimal(order.amount_paid or 0)
        if balance > 0:
            body += self._payment_block(order, settings, currency)

        subject = f"Order {order.order_number} update"
        if status_label:
            subject = f"Order {order.order_number}: {status_label}"

        return await self._send(
            org,
            [order.customer_email],
            subject,
            "Order Update",
            body,
            f"Order {order.order_number}: {message}",
            "storefront_order_update",
        )

    async def send_payment_reminder(
        self,
        order: StoreOrder,
        settings: Optional[StoreSettings],
        organization: Optional[Organization] = None,
    ) -> int:
        """Nudge for an order that is still carrying a balance."""
        if not order.customer_email:
            return 0
        org = organization or await self._get_organization(order.organization_id)
        currency = (settings.currency if settings else None) or "USD"
        balance = Decimal(order.total or 0) - Decimal(order.amount_paid or 0)

        body = (
            f"<p>Your order <strong>{_html.escape(order.order_number)}</strong> "
            f"still has a balance of <strong>{_money(balance, currency)}</strong>.</p>"
            f"{self._items_table(order, currency)}"
            f"{self._payment_block(order, settings, currency)}"
        )

        return await self._send(
            org,
            [order.customer_email],
            f"Payment reminder — order {order.order_number}",
            "Payment Reminder",
            body,
            (
                f"Order {order.order_number} has a balance of "
                f"{_money(balance, currency)}."
            ),
            "storefront_payment_reminder",
            header_color=_HEADER_AMBER,
        )

    async def send_payment_received(
        self,
        order: StoreOrder,
        settings: Optional[StoreSettings],
        organization: Optional[Organization] = None,
        amount: Optional[Decimal] = None,
    ) -> int:
        """Receipt for a payment a quartermaster verified."""
        if not order.customer_email:
            return 0
        org = organization or await self._get_organization(order.organization_id)
        currency = (settings.currency if settings else None) or "USD"
        balance = Decimal(order.total or 0) - Decimal(order.amount_paid or 0)

        method_label = _METHOD_LABELS.get(order.payment_method or "", "")
        body = (
            "<p>We received "
            f"<strong>{_money(amount if amount is not None else order.amount_paid, currency)}</strong>"
            + (f" via {_html.escape(method_label)}" if method_label else "")
            + f" for order <strong>{_html.escape(order.order_number)}</strong>.</p>"
        )
        if balance > 0:
            body += (
                "<p>Remaining balance: "
                f"<strong>{_money(balance, currency)}</strong>.</p>"
                f"{self._payment_block(order, settings, currency)}"
            )
        else:
            body += "<p>Your order is paid in full. Thank you!</p>"

        return await self._send(
            org,
            [order.customer_email],
            f"Payment received — order {order.order_number}",
            "Payment Received",
            body,
            f"Payment received for order {order.order_number}.",
            "storefront_payment_received",
            header_color=_HEADER_GREEN,
        )

    async def send_order_cancelled(
        self,
        order: StoreOrder,
        reason: Optional[str],
        settings: Optional[StoreSettings],
        organization: Optional[Organization] = None,
    ) -> int:
        """Notice that an order was cancelled."""
        if not order.customer_email:
            return 0
        org = organization or await self._get_organization(order.organization_id)
        body = (
            f"<p>Your order <strong>{_html.escape(order.order_number)}</strong> "
            "has been cancelled.</p>"
        )
        if reason:
            body += f'<p style="white-space:pre-line;">{_html.escape(reason)}</p>'
        if Decimal(order.amount_paid or 0) > 0:
            body += (
                "<p>A refund of the amount already paid will be arranged by the "
                "department.</p>"
            )

        return await self._send(
            org,
            [order.customer_email],
            f"Order {order.order_number} cancelled",
            "Order Cancelled",
            body,
            f"Order {order.order_number} was cancelled.",
            "storefront_order_update",
            header_color=_HEADER_RED,
        )

    # ------------------------------------------------------------------
    # Window notices
    # ------------------------------------------------------------------

    def _window_body(
        self,
        window: StoreOrderWindow,
        settings: Optional[StoreSettings],
        lead: str,
        extra: Optional[str] = None,
    ) -> str:
        store_name = (settings.store_name if settings else None) or "Department Store"
        body = f"<p>{lead}</p>"
        body += (
            f"<p><strong>{_html.escape(window.name)}</strong> — "
            f"{_html.escape(store_name)}</p>"
        )
        if window.description:
            body += (
                '<p style="white-space:pre-line;">'
                f"{_html.escape(window.description)}</p>"
            )
        if extra:
            body += extra
        if window.pickup_instructions:
            body += (
                '<p style="white-space:pre-line;color:#6b7280;">'
                f"{_html.escape(window.pickup_instructions)}</p>"
            )
        return body

    async def send_window_opened(
        self,
        window: StoreOrderWindow,
        settings: Optional[StoreSettings],
        organization: Optional[Organization] = None,
        message: Optional[str] = None,
        recipients: Optional[List[str]] = None,
    ) -> int:
        """Announce that ordering is open."""
        org = organization or await self._get_organization(window.organization_id)
        to = (
            recipients
            if recipients is not None
            else await self.get_member_recipients(window.organization_id)
        )
        extra = ""
        if window.closes_at:
            extra += (
                "<p>Orders close "
                f'<strong>{window.closes_at.strftime("%B %d, %Y at %I:%M %p UTC")}'
                "</strong>.</p>"
            )
        if message:
            extra += f'<p style="white-space:pre-line;">{_html.escape(message)}</p>'

        body = self._window_body(
            window, settings, "The department store is now taking orders.", extra
        )
        return await self._send(
            org,
            to,
            f"Store orders are open — {window.name}",
            "Ordering Is Open",
            body,
            f"Store orders are open for {window.name}.",
            "storefront_window_open",
            header_color=_HEADER_GREEN,
            bcc=True,
        )

    async def send_window_closing_soon(
        self,
        window: StoreOrderWindow,
        settings: Optional[StoreSettings],
        organization: Optional[Organization] = None,
        recipients: Optional[List[str]] = None,
    ) -> int:
        """Last-call reminder ahead of the window's close time."""
        org = organization or await self._get_organization(window.organization_id)
        to = (
            recipients
            if recipients is not None
            else await self.get_member_recipients(window.organization_id)
        )
        extra = ""
        if window.closes_at:
            extra += (
                "<p>Ordering closes "
                f'<strong>{window.closes_at.strftime("%B %d, %Y at %I:%M %p UTC")}'
                "</strong>.</p>"
            )
        body = self._window_body(
            window, settings, "Last call — the store order window closes soon.", extra
        )
        return await self._send(
            org,
            to,
            f"Last call — {window.name} closes soon",
            "Order Window Closing",
            body,
            f"The {window.name} order window closes soon.",
            "storefront_window_closing",
            header_color=_HEADER_AMBER,
            bcc=True,
        )

    async def send_window_closed(
        self,
        window: StoreOrderWindow,
        settings: Optional[StoreSettings],
        recipients: List[str],
        organization: Optional[Organization] = None,
        message: Optional[str] = None,
    ) -> int:
        """Tell everyone who ordered that the window is closed and what's next."""
        org = organization or await self._get_organization(window.organization_id)
        extra = ""
        if window.expected_delivery_date:
            extra += (
                "<p>Expected delivery: "
                f'<strong>{window.expected_delivery_date.strftime("%B %d, %Y")}'
                "</strong>.</p>"
            )
        if message:
            extra += f'<p style="white-space:pre-line;">{_html.escape(message)}</p>'

        body = self._window_body(
            window,
            settings,
            "Ordering has closed and the department is placing the order.",
            extra,
        )
        return await self._send(
            org,
            recipients,
            f"Ordering closed — {window.name}",
            "Order Window Closed",
            body,
            f"The {window.name} order window has closed.",
            "storefront_window_closed",
            bcc=True,
        )

    async def summarize(self, sent: int, kind: str) -> Dict[str, Any]:
        """Small helper so callers can log a consistent result shape."""
        return {"notification": kind, "sent": sent}
