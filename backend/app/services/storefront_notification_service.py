"""
Storefront Notification Service

Builds and sends the storefront's outbound email: order confirmations, order
updates, payment reminders and receipts, and the order-window announcements
(open / closing soon / closed).

Every notice is editable in Communications → Email Templates. Each ``send_*``
below builds two things: the message as this module has always composed it
(inline HTML through ``wrap_email_body``), and a *context* of variables. If the
organization has a template row for that notice, the template is rendered
against the context and the coded message is unused; otherwise the coded
message goes out. A department that never opens that screen therefore receives
exactly what it received before templates existed.

The context carries computed parts as ready-made HTML — ``items_table_html``,
``payment_block_html`` and friends, registered in ``_RAW_HTML_VARIABLES``.
That is the same arrangement property return reminders use for
``items_list_html``: the template system substitutes ``{{name}}`` and has no
loops, so a table of order lines cannot be expressed in a template body and is
injected into one instead. See ``email_templates_storefront`` for the default
bodies and the full variable list.

Settings still carry the wording that is per-department rather than per-notice:
``payment_instructions``, ``receipt_footer``, the window's
``pickup_instructions``, and the free-text message each announcement accepts.

Whether a notice goes out at all is decided by the caller, not here. Every
method below is switched by exactly one ``StoreSettings`` flag, checked in
``StorefrontService``:

===========================  =================================================
Notice                       Switch
===========================  =================================================
send_order_confirmation      ``send_order_confirmation``
send_admin_new_order         ``notify_admins_on_order``
send_order_update (status)   ``send_status_updates``
send_order_cancelled         ``send_status_updates``
send_order_update (waive,    ``send_payment_receipts``
refund)
send_payment_received        ``send_payment_receipts``
send_payment_reminder        ``send_payment_reminders``
send_window_opened           ``send_window_opened`` (+ the window's own
                             ``notify_on_open``)
send_window_closing_soon     ``send_window_closing_reminder``
send_window_closed           ``send_window_closed``
send_vendor_order_placed     ``send_vendor_order_updates``
===========================  =================================================

The one exception is ``send_order_update`` raised by ``add_order_message``,
which is a message a quartermaster typed and asked to send rather than a notice
the module raised on its own.
"""

import html as _html
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.constants import ADMIN_NOTIFY_ROLE_SLUGS
from app.models.email_template import EmailTemplate, EmailTemplateType
from app.models.storefront import (
    StoreOrder,
    StoreOrderWindow,
    StorePaymentMethod,
    StorePaymentStatus,
    StoreSettings,
)
from app.models.user import Organization, User, UserStatus
from app.services.email_service import EmailService, wrap_email_body
from app.services.email_template_service import EmailTemplateService
from app.services.email_theme import (
    ACCENT_AMBER,
    ACCENT_BLUE,
    ACCENT_GREEN,
    ACCENT_RED,
    TABLE_STYLE,
    TD_STYLE,
    TFOOT_STYLE,
    TH_STYLE,
)
from app.utils.storefront_payments import build_payment_options

# Header banner colour by notice kind. Aliased rather than re-declared so a
# coded fallback and its default template cannot drift apart.
_HEADER_BLUE = ACCENT_BLUE
_HEADER_GREEN = ACCENT_GREEN
_HEADER_AMBER = ACCENT_AMBER
_HEADER_RED = ACCENT_RED


def _balance_due(order: StoreOrder) -> Decimal:
    """Return the collectible balance; a waiver settles without collecting."""
    if order.payment_status == StorePaymentStatus.WAIVED:
        return Decimal("0")
    return max(
        Decimal(order.total or 0) - Decimal(order.amount_paid or 0), Decimal("0")
    )


_METHOD_LABELS = {
    StorePaymentMethod.VENMO: "Venmo",
    StorePaymentMethod.PAYPAL: "PayPal",
    StorePaymentMethod.CASH_APP: "Cash App",
    StorePaymentMethod.ZELLE: "Zelle",
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
    return f'<td style="{TD_STYLE}text-align:{align};{weight}">{content}</td>'


class StorefrontNotificationService:
    """Sends the storefront's member- and admin-facing email."""

    def __init__(
        self, db: AsyncSession, capture: Optional[List[Dict[str, Any]]] = None
    ):
        """*capture* diverts composed messages into a list instead of sending.

        This is how the settings screen previews a notice. Rendering the
        preview through the real ``send_*`` method — rather than a parallel
        "what it would look like" builder — is the point: a preview that is
        assembled separately drifts from the email, and a quartermaster who
        approved the preview would be approving something else.
        """
        self.db = db
        self._capture = capture
        self._templates: Dict[Tuple[str, str], Optional[EmailTemplate]] = {}

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
                User.status == UserStatus.ACTIVE,
                User.deleted_at.is_(None),
                User.email.isnot(None),
            )
        )
        return [email for email in result.scalars().all() if email]

    async def get_admin_recipients(
        self, organization_id: str, settings: Optional[StoreSettings]
    ) -> List[str]:
        """Store managers plus any extra addresses configured in settings.

        Admin-ness is a *position* slug, not a column on User — a member can
        hold several positions — so the roles relationship is eager-loaded and
        matched against the shared ADMIN_NOTIFY_ROLE_SLUGS list.
        """
        result = await self.db.execute(
            select(User)
            .where(
                User.organization_id == str(organization_id),
                User.email.isnot(None),
                User.deleted_at.is_(None),
            )
            .options(selectinload(User.roles))
        )
        recipients = set()
        for user in result.scalars().all():
            if not user.email:
                continue
            slugs = [role.slug for role in (user.roles or [])]
            if any(slug in slugs for slug in ADMIN_NOTIFY_ROLE_SLUGS):
                recipients.add(user.email)
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
            if item.personalization_text:
                # Member-entered text rendered into HTML email — escape it.
                name += (
                    '<br><span style="color:#6b7280;font-size:12px;">'
                    f"&ldquo;{_html.escape(item.personalization_text)}&rdquo;</span>"
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
            f'<tr><td colspan="3" style="{TFOOT_STYLE}text-align:right;">Total</td>'
            f'<td style="{TFOOT_STYLE}text-align:right;">'
            f"{_money(order.total, currency)}</td></tr>"
        )

        return (
            f'<table style="{TABLE_STYLE}">'
            "<thead><tr>"
            f'<th style="{TH_STYLE}text-align:left;">Item</th>'
            f'<th style="{TH_STYLE}text-align:center;">Qty</th>'
            f'<th style="{TH_STYLE}text-align:right;">Price</th>'
            f'<th style="{TH_STYLE}text-align:right;">Total</th>'
            f"</tr></thead><tbody>{rows}{totals}</tbody></table>"
        )

    def _payment_block(
        self,
        order: StoreOrder,
        settings: Optional[StoreSettings],
        currency: str,
    ) -> str:
        """Render 'how to pay' with a button per configured payment app.

        Every accepted method is offered, not only the one picked at checkout:
        the member is reading this on a phone that may or may not have the app
        they chose, and the money only has to arrive.
        """
        balance = _balance_due(order)
        if balance <= 0 or not settings:
            return ""

        options = build_payment_options(settings, balance, order.order_number)
        lines: List[str] = [
            f"<p><strong>Balance due: {_money(balance, currency)}</strong></p>"
        ]

        chosen = order.payment_method
        if chosen:
            options.sort(key=lambda o: o["method"] != chosen.value)

        buttons: List[str] = []
        for option in options:
            detail = self._payment_option_detail(option, order.order_number)
            if detail:
                lines.append(detail)
            url = option.get("payment_url")
            if url:
                buttons.append(
                    f'<a href="{_html.escape(url, quote=True)}" '
                    'style="display:inline-block;background:#1d4ed8;color:#ffffff;'
                    "padding:10px 18px;border-radius:6px;text-decoration:none;"
                    'font-weight:600;margin:0 8px 8px 0;">'
                    f"Pay with {_html.escape(option['label'])}</a>"
                )

        if buttons:
            lines.append(f"<p>{''.join(buttons)}</p>")

        if settings.payment_instructions:
            lines.append(
                '<p style="white-space:pre-line;color:#6b7280;">'
                f"{_html.escape(settings.payment_instructions)}</p>"
            )

        return "".join(lines)

    def _payment_option_detail(
        self, option: Dict[str, Any], reference: str
    ) -> Optional[str]:
        """One line telling the member where to send it and what to reference."""
        label = _html.escape(option["label"])
        handle = option.get("handle")
        parts: List[str] = []

        if handle:
            sentence = (
                f"Send payment on {label} to <strong>{_html.escape(handle)}</strong>"
            )
            # Only ask the member to type the order number when the link will
            # not carry it for them.
            if not option.get("prefills_reference"):
                sentence += f" and reference <strong>{_html.escape(reference)}</strong>"
            parts.append(f"<p>{sentence}.</p>")

        instructions = option.get("instructions")
        if instructions:
            parts.append(
                '<p style="white-space:pre-line;">' f"{_html.escape(instructions)}</p>"
            )
        return "".join(parts) or None

    def _order_context(
        self, order: StoreOrder, settings: Optional[StoreSettings], currency: str
    ) -> Dict[str, Any]:
        """The variables every order notice's template can use.

        Computed parts arrive as ready-made HTML (see
        ``email_templates_storefront``) because the template system has no
        loops: an item table cannot be expressed in ``{{variable}}`` syntax.
        """
        balance = _balance_due(order)
        store_name = (settings.store_name if settings else None) or "Department Store"
        return {
            "order_number": order.order_number or "",
            "customer_name": order.customer_name or "",
            "first_name": (order.customer_name or "").split(" ")[0],
            "store_name": store_name,
            "order_total": _money(order.total, currency),
            "balance_due": _money(balance, currency),
            "items_table_html": self._items_table(order, currency),
            "payment_block_html": self._payment_block(order, settings, currency),
        }

    def _window_context(
        self, window: StoreOrderWindow, settings: Optional[StoreSettings], extra: str
    ) -> Dict[str, Any]:
        """The variables every window notice's template can use."""
        store_name = (settings.store_name if settings else None) or "Department Store"
        description = ""
        if window.description:
            description = (
                '<p style="white-space:pre-line;">'
                f"{_html.escape(window.description)}</p>"
            )
        pickup = ""
        if window.pickup_instructions:
            pickup = (
                '<p style="white-space:pre-line;color:#6b7280;">'
                f"{_html.escape(window.pickup_instructions)}</p>"
            )
        return {
            "window_name": window.name or "",
            "store_name": store_name,
            "window_description_html": description,
            "window_extra_html": extra,
            "pickup_instructions_html": pickup,
        }

    # ------------------------------------------------------------------
    # Delivery
    # ------------------------------------------------------------------

    async def _load_template(
        self, organization_id: Optional[str], template_type: str
    ) -> Optional[EmailTemplate]:
        """The org's edited version of this notice, if it has one.

        Cached per service instance: a payment-reminder run walks up to 200
        orders, and each would otherwise re-read the same row.

        The cache key includes the organization. Today every caller builds one
        service per org, so the id alone would do — but a cache that is only
        correct because of how it happens to be called is one refactor away
        from serving org A's wording to org B's members.
        """
        if not organization_id:
            return None
        key = (str(organization_id), template_type)
        if key in self._templates:
            return self._templates[key]

        template: Optional[EmailTemplate] = None
        try:
            # The notice keys double as EmailTemplateType values; anything the
            # enum does not know has no template and takes the coded body.
            enum_type = EmailTemplateType(template_type)
            service = EmailTemplateService(self.db)
            template = await service.get_template(organization_id, enum_type)
        except ValueError:
            self._templates[key] = None
            return None
        except Exception as exc:
            # A template that will not load must not stop the notice: the
            # coded body below is a complete email on its own.
            logger.warning(
                f"Storefront template '{template_type}' failed to load, "
                f"using the built-in body: {exc}"
            )
        self._templates[key] = template
        return template

    async def _send(
        self,
        organization: Optional[Organization],
        recipients: List[str],
        subject: str,
        title: str,
        body_html: str,
        text_body: str,
        template_type: str,
        context: Optional[Dict[str, Any]] = None,
        header_color: str = _HEADER_BLUE,
        bcc: bool = False,
    ) -> int:
        """Compose one notice and send it; returns successful send count.

        *subject*, *title*, *body_html* and *text_body* are the built-in
        message. If the organization has edited this notice in Email
        Templates, that template is rendered against *context* instead and
        these become the fallback — so a department that has never opened that
        screen receives exactly what this module has always sent.
        """
        addresses = [address for address in recipients if address]
        if not addresses:
            return 0

        template = await self._load_template(
            str(organization.id) if organization else None, template_type
        )
        if template is not None:
            rendered_subject, html_body, rendered_text = (
                EmailTemplateService.render_static(
                    template, dict(context or {}), organization=organization
                )
            )
            subject = rendered_subject or subject
            text_body = rendered_text or text_body
        else:
            html_body = wrap_email_body(
                organization, title, body_html, header_color=header_color
            )

        if self._capture is not None:
            self._capture.append(
                {
                    "subject": subject,
                    "title": title,
                    "html_body": html_body,
                    "text_body": text_body,
                    "template_type": template_type,
                    "templated": template is not None,
                    "bcc": bcc,
                }
            )
            return len(addresses)
        try:
            email_service = EmailService(organization=organization)
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

        receipt_footer = ""
        if settings and settings.receipt_footer:
            receipt_footer = (
                '<p style="color:#6b7280;white-space:pre-line;">'
                f"{_html.escape(settings.receipt_footer)}</p>"
            )

        body = (
            f"<p>Hi {_html.escape((order.customer_name or '').split(' ')[0])},</p>"
            f"<p>Thanks for your order from the {_html.escape(store_name)}. "
            f"Your order number is <strong>{_html.escape(order.order_number)}</strong>."
            "</p>"
            f"{self._items_table(order, currency)}"
            f"{self._payment_block(order, settings, currency)}"
            f"{receipt_footer}"
        )

        context = self._order_context(order, settings, currency)
        context["receipt_footer_html"] = receipt_footer

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
            context=context,
        )

    async def send_admin_new_order(
        self,
        order: StoreOrder,
        settings: Optional[StoreSettings],
        organization: Optional[Organization] = None,
        recipients: Optional[List[str]] = None,
    ) -> int:
        """Heads-up to the quartermaster that an order landed."""
        if recipients is None:
            recipients = await self.get_admin_recipients(
                order.organization_id, settings
            )
        if not recipients:
            return 0
        org = organization or await self._get_organization(order.organization_id)
        currency = (settings.currency if settings else None) or "USD"

        member_notes = ""
        if order.member_notes:
            member_notes = (
                "<p><strong>Member notes:</strong><br>"
                f'<span style="white-space:pre-line;">'
                f"{_html.escape(order.member_notes)}</span></p>"
            )

        body = (
            f"<p><strong>{_html.escape(order.customer_name or '')}</strong> placed "
            f"order <strong>{_html.escape(order.order_number)}</strong>.</p>"
            f"{self._items_table(order, currency)}"
            f"{member_notes}"
        )

        context = self._order_context(order, settings, currency)
        context["member_notes_html"] = member_notes

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
            context=context,
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
        balance = _balance_due(order)
        if balance > 0:
            body += self._payment_block(order, settings, currency)

        subject = f"Order {order.order_number} update"
        if status_label:
            subject = f"Order {order.order_number}: {status_label}"

        context = self._order_context(order, settings, currency)
        context.update(
            {
                "update_message": message,
                "status_label_suffix": f" — {status_label}" if status_label else "",
                "status_subject_suffix": (
                    f": {status_label}" if status_label else " update"
                ),
                # A settled order is not asked to pay again, so the block is
                # empty rather than absent — a template referencing it renders
                # nothing instead of a stray {{placeholder}}.
                "payment_block_html": (
                    self._payment_block(order, settings, currency)
                    if balance > 0
                    else ""
                ),
            }
        )

        return await self._send(
            org,
            [order.customer_email],
            subject,
            "Order Update",
            body,
            f"Order {order.order_number}: {message}",
            "storefront_order_update",
            context=context,
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
        balance = _balance_due(order)

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
            context=self._order_context(order, settings, currency),
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
        balance = _balance_due(order)

        method_label = _METHOD_LABELS.get(order.payment_method or "", "")
        summary = (
            "<p>We received "
            f"<strong>{_money(amount if amount is not None else order.amount_paid, currency)}</strong>"
            + (f" via {_html.escape(method_label)}" if method_label else "")
            + f" for order <strong>{_html.escape(order.order_number)}</strong>.</p>"
        )
        if balance > 0:
            balance_notice = (
                "<p>Remaining balance: "
                f"<strong>{_money(balance, currency)}</strong>.</p>"
                f"{self._payment_block(order, settings, currency)}"
            )
        else:
            balance_notice = "<p>Your order is paid in full. Thank you!</p>"

        context = self._order_context(order, settings, currency)
        context.update(
            {
                "payment_summary_html": summary,
                "balance_notice_html": balance_notice,
            }
        )

        return await self._send(
            org,
            [order.customer_email],
            f"Payment received — order {order.order_number}",
            "Payment Received",
            summary + balance_notice,
            f"Payment received for order {order.order_number}.",
            "storefront_payment_received",
            context=context,
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
        currency = (settings.currency if settings else None) or "USD"

        reason_html = ""
        if reason:
            reason_html = f'<p style="white-space:pre-line;">{_html.escape(reason)}</p>'
        refund_html = ""
        if Decimal(order.amount_paid or 0) > 0:
            refund_html = (
                "<p>A refund of the amount already paid will be arranged by the "
                "department.</p>"
            )

        body = (
            f"<p>Your order <strong>{_html.escape(order.order_number)}</strong> "
            "has been cancelled.</p>"
            f"{reason_html}{refund_html}"
        )

        context = self._order_context(order, settings, currency)
        context.update(
            {
                "cancellation_reason_html": reason_html,
                "refund_notice_html": refund_html,
            }
        )

        return await self._send(
            org,
            [order.customer_email],
            f"Order {order.order_number} cancelled",
            "Order Cancelled",
            body,
            f"Order {order.order_number} was cancelled.",
            # Its own type since the move into Email Templates: sharing the
            # order-update row would mean rewording one and silently changing
            # the other.
            "storefront_order_cancelled",
            context=context,
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
            context=self._window_context(window, settings, extra),
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
            context=self._window_context(window, settings, extra),
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
            context=self._window_context(window, settings, extra),
            bcc=True,
        )

    async def send_vendor_order_placed(
        self,
        window: StoreOrderWindow,
        settings: Optional[StoreSettings],
        recipients: List[str],
        organization: Optional[Organization] = None,
        message: Optional[str] = None,
    ) -> int:
        """Tell everyone who ordered that the bulk order is now with the vendor.

        This is the update members actually chase. Between "ordering closed"
        and "come pick it up" there can be six quiet weeks, and without a note
        the quartermaster fields the same question a dozen times.
        """
        org = organization or await self._get_organization(window.organization_id)
        extra = ""
        if window.vendor_name:
            extra += f"<p>Ordered from <strong>{_html.escape(window.vendor_name)}</strong>.</p>"
        if window.expected_delivery_date:
            extra += (
                "<p>Expected delivery: "
                f'<strong>{window.expected_delivery_date.strftime("%B %d, %Y")}'
                "</strong>. We will let you know when it arrives.</p>"
            )
        else:
            extra += "<p>We will let you know as soon as it arrives.</p>"
        if message:
            extra += f'<p style="white-space:pre-line;">{_html.escape(message)}</p>'

        body = self._window_body(
            window,
            settings,
            "Your order has been placed with the vendor.",
            extra,
        )
        return await self._send(
            org,
            recipients,
            f"Order placed with the vendor — {window.name}",
            "Order Placed",
            body,
            f"The {window.name} order has been placed with the vendor.",
            "storefront_vendor_order_placed",
            context=self._window_context(window, settings, extra),
            bcc=True,
        )

    async def summarize(self, sent: int, kind: str) -> Dict[str, Any]:
        """Small helper so callers can log a consistent result shape."""
        return {"notification": kind, "sent": sent}
