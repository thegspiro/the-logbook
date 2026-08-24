"""
Default Email Templates — Department Storefront

The ten notices the store sends, as editable templates.

These render into the same shell as every other default template — the one
:func:`app.services.email_theme.build_shell` builds — so the storefront's mail
looks like the rest of the platform's and an admin editing one finds what they
expect. Each body here reproduces what ``storefront_notification_service``
composes in code, so a department that has never opened the Email Templates
screen and one that has just accepted the defaults receive the same email.

The store's own colourway is violet. The four notices that carry a status the
member has to act on — cancelled, payment reminder, payment received, ordering
open — keep the accent that says so, because "your order was cancelled" and
"your order is confirmed" arriving in the same violet is the one place a
category colour would cost more than it buys.

**Why the ``_html`` variables exist.** The template system substitutes
``{{name}}`` and has no loops or conditionals, but a store email is mostly a
table of order lines and a set of pay buttons whose content depends on which
methods are configured. So the service renders those parts and injects them
through ``_RAW_HTML_VARIABLES`` — the same arrangement property return
reminders use for ``items_list_html`` and elections use for
``ballot_items_html``. Everything an admin would actually want to reword is
plain prose in these bodies; everything computed is one variable.

Deleting a computed variable from a body is allowed and does what it looks
like: remove ``{{payment_block_html}}`` from the confirmation and members stop
being told how to pay.
"""

from typing import Any, Dict, List

from app.models.email_template import EmailTemplateType
from app.services.email_theme import (
    ACCENT_AMBER,
    ACCENT_GREEN,
    ACCENT_RED,
    ACCENT_VIOLET,
    TABLE_STYLE,
    TD_STYLE,
    TFOOT_STYLE,
    TH_STYLE,
    build_shell,
)


def _shell(
    title: str,
    content: str,
    accent: str = ACCENT_VIOLET,
    chip: str = "",
    subtitle: str = "",
    layout: str = "notice",
) -> str:
    """The house shell, with the store's name in the lockup.

    A thin wrapper rather than a second layout: ``build_shell`` is the only
    place the chrome is written, and this exists purely to default the accent
    to the store's colourway and put ``{{store_name}}`` where the department
    name would otherwise go. A member reading a store receipt is dealing with
    the store, which may be named something other than the department.
    """
    return build_shell(
        title,
        content,
        accent=accent,
        chip=chip,
        subtitle=subtitle,
        brand="{{store_name}}",
        layout=layout,
    )


_FOOTER_TEXT = """
{{footer_text}}"""


# ----------------------------------------------------------------------
# Order notices
# ----------------------------------------------------------------------

ORDER_CONFIRMATION_SUBJECT = "Order {{order_number}} received"
ORDER_CONFIRMATION_HTML = _shell(
    "Order {{order_number}} received",
    """        <p>Hi {{first_name}},</p>
        <p>Thanks for your order from the {{store_name}}. Your order number is
           <strong>{{order_number}}</strong>.</p>
        {{items_table_html}}
        {{payment_block_html}}
        {{receipt_footer_html}}""",
    chip="Receipt",
    subtitle="Total {{order_total}}",
    layout="receipt",
)
ORDER_CONFIRMATION_TEXT = """Hi {{first_name}},

Thanks for your order from the {{store_name}}.
Order {{order_number}} received. Total {{order_total}}.
""" + _FOOTER_TEXT

NEW_ORDER_ADMIN_SUBJECT = "New store order {{order_number}}"
NEW_ORDER_ADMIN_HTML = _shell(
    "New Store Order",
    """        <p><strong>{{customer_name}}</strong> placed order
           <strong>{{order_number}}</strong>.</p>
        {{items_table_html}}
        {{member_notes_html}}""",
    chip="New order",
    subtitle="{{order_total}}",
)
NEW_ORDER_ADMIN_TEXT = (
    """{{customer_name}} placed order {{order_number}} for {{order_total}}.
""" + _FOOTER_TEXT
)

ORDER_UPDATE_SUBJECT = "Order {{order_number}}{{status_subject_suffix}}"
ORDER_UPDATE_HTML = _shell(
    "Order Update",
    """        <p>Update on your order <strong>{{order_number}}</strong>{{status_label_suffix}}.</p>
        <p style="white-space:pre-line;">{{update_message}}</p>
        {{payment_block_html}}""",
    chip="Update",
    subtitle="{{order_number}}",
)
ORDER_UPDATE_TEXT = """Order {{order_number}}: {{update_message}}
""" + _FOOTER_TEXT

ORDER_CANCELLED_SUBJECT = "Order {{order_number}} cancelled"
ORDER_CANCELLED_HTML = _shell(
    "Order Cancelled",
    """        <p>Your order <strong>{{order_number}}</strong> has been cancelled.</p>
        {{cancellation_reason_html}}
        {{refund_notice_html}}""",
    accent=ACCENT_RED,
    chip="Cancelled",
    subtitle="{{order_number}}",
)
ORDER_CANCELLED_TEXT = """Order {{order_number}} was cancelled.
""" + _FOOTER_TEXT

PAYMENT_REMINDER_SUBJECT = "Payment reminder — order {{order_number}}"
PAYMENT_REMINDER_HTML = _shell(
    "Payment Reminder",
    """        <p>Your order <strong>{{order_number}}</strong> still has a balance of
           <strong>{{balance_due}}</strong>.</p>
        {{items_table_html}}
        {{payment_block_html}}""",
    accent=ACCENT_AMBER,
    chip="Payment reminder",
    subtitle="{{balance_due}} outstanding",
    layout="receipt",
)
PAYMENT_REMINDER_TEXT = """Order {{order_number}} has a balance of {{balance_due}}.
""" + _FOOTER_TEXT

PAYMENT_RECEIVED_SUBJECT = "Payment received — order {{order_number}}"
PAYMENT_RECEIVED_HTML = _shell(
    "Payment Received",
    """        {{payment_summary_html}}
        {{balance_notice_html}}""",
    accent=ACCENT_GREEN,
    chip="Payment received",
    subtitle="{{order_number}}",
)
PAYMENT_RECEIVED_TEXT = """Payment received for order {{order_number}}.
""" + _FOOTER_TEXT


# ----------------------------------------------------------------------
# Order window notices
# ----------------------------------------------------------------------


# Every window notice shares a shape: a lead sentence the department may want
# to reword, the window's own name and description, whatever detail that
# particular notice adds (a deadline, a vendor, a delivery date), and the
# pickup instructions set on the window.
def _window_body(lead: str) -> str:
    return f"""        <p>{lead}</p>
        <p><strong>{{{{window_name}}}}</strong> — {{{{store_name}}}}</p>
        {{{{window_description_html}}}}
        {{{{window_extra_html}}}}
        {{{{pickup_instructions_html}}}}"""


WINDOW_OPEN_SUBJECT = "Store orders are open — {{window_name}}"
WINDOW_OPEN_HTML = _shell(
    "Ordering Is Open",
    _window_body("The department store is now taking orders."),
    accent=ACCENT_GREEN,
    chip="Now open",
    subtitle="{{window_name}}",
)
WINDOW_OPEN_TEXT = """Store orders are open for {{window_name}}.
""" + _FOOTER_TEXT

WINDOW_CLOSING_SUBJECT = "Last call — {{window_name}} closes soon"
WINDOW_CLOSING_HTML = _shell(
    "Order Window Closing",
    _window_body("Last call — the store order window closes soon."),
    accent=ACCENT_AMBER,
    chip="Last call",
    subtitle="{{window_name}}",
)
WINDOW_CLOSING_TEXT = """The {{window_name}} order window closes soon.
""" + _FOOTER_TEXT

WINDOW_CLOSED_SUBJECT = "Ordering closed — {{window_name}}"
WINDOW_CLOSED_HTML = _shell(
    "Order Window Closed",
    _window_body("Ordering has closed and the department is placing the order."),
    chip="Closed",
    subtitle="{{window_name}}",
)
WINDOW_CLOSED_TEXT = """The {{window_name}} order window has closed.
""" + _FOOTER_TEXT

VENDOR_ORDER_PLACED_SUBJECT = "Order placed with the vendor — {{window_name}}"
VENDOR_ORDER_PLACED_HTML = _shell(
    "Order Placed",
    _window_body("Your order has been placed with the vendor."),
    chip="With the vendor",
    subtitle="{{window_name}}",
)
VENDOR_ORDER_PLACED_TEXT = """The {{window_name}} order has been placed with the vendor.
""" + _FOOTER_TEXT


# ----------------------------------------------------------------------
# Registration data
# ----------------------------------------------------------------------

# Variables the service injects as ready-made HTML rather than escaped text.
RAW_HTML_VARIABLES = {
    "items_table_html",
    "payment_block_html",
    "receipt_footer_html",
    "member_notes_html",
    "cancellation_reason_html",
    "refund_notice_html",
    "payment_summary_html",
    "balance_notice_html",
    "window_description_html",
    "window_extra_html",
    "pickup_instructions_html",
}

_ORDER_VARS = [
    {"name": "order_number", "description": "Order number, e.g. ORD-2026-0042"},
    {"name": "customer_name", "description": "Name of the member who ordered"},
    {"name": "first_name", "description": "Member's first name"},
    {"name": "store_name", "description": "Store name from the store settings"},
    {"name": "order_total", "description": "Order total, formatted"},
    {"name": "balance_due", "description": "Amount still owing, formatted"},
    {
        "name": "items_table_html",
        "description": "Table of ordered items with sizes, names and prices",
    },
]
_PAYMENT_BLOCK_VAR = {
    "name": "payment_block_html",
    "description": (
        "Balance due, a pay button per configured method, and your payment "
        "instructions. Remove it and members are not told how to pay."
    ),
}
_WINDOW_VARS = [
    {"name": "window_name", "description": "Name of the order window"},
    {"name": "store_name", "description": "Store name from the store settings"},
    {
        "name": "window_description_html",
        "description": "The window's description, if it has one",
    },
    {
        "name": "window_extra_html",
        "description": (
            "What this notice adds: the closing time, the vendor and expected "
            "delivery, or the message typed when the action was taken"
        ),
    },
    {
        "name": "pickup_instructions_html",
        "description": "The window's pickup instructions, if set",
    },
]

TEMPLATE_VARIABLES: Dict[str, List[Dict[str, str]]] = {
    EmailTemplateType.STOREFRONT_ORDER_CONFIRMATION.value: _ORDER_VARS
    + [
        _PAYMENT_BLOCK_VAR,
        {
            "name": "receipt_footer_html",
            "description": "The receipt footer from your store settings",
        },
    ],
    EmailTemplateType.STOREFRONT_NEW_ORDER_ADMIN.value: _ORDER_VARS
    + [
        {
            "name": "member_notes_html",
            "description": "Anything the member typed in the notes box",
        }
    ],
    EmailTemplateType.STOREFRONT_ORDER_UPDATE.value: _ORDER_VARS
    + [
        _PAYMENT_BLOCK_VAR,
        {"name": "update_message", "description": "The update being sent"},
        {
            "name": "status_label_suffix",
            "description": "The new status, as a phrase to append (may be empty)",
        },
        {
            "name": "status_subject_suffix",
            "description": "The new status, for the subject line (may be empty)",
        },
    ],
    EmailTemplateType.STOREFRONT_ORDER_CANCELLED.value: _ORDER_VARS
    + [
        {
            "name": "cancellation_reason_html",
            "description": "The reason given, if one was",
        },
        {
            "name": "refund_notice_html",
            "description": "A refund note, shown only when money had been paid",
        },
    ],
    EmailTemplateType.STOREFRONT_PAYMENT_REMINDER.value: _ORDER_VARS
    + [_PAYMENT_BLOCK_VAR],
    EmailTemplateType.STOREFRONT_PAYMENT_RECEIVED.value: _ORDER_VARS
    + [
        {
            "name": "payment_summary_html",
            "description": "What was received, by which method, against which order",
        },
        {
            "name": "balance_notice_html",
            "description": (
                "Either a paid-in-full line or the remaining balance with the "
                "pay buttons"
            ),
        },
    ],
    EmailTemplateType.STOREFRONT_WINDOW_OPEN.value: _WINDOW_VARS,
    EmailTemplateType.STOREFRONT_WINDOW_CLOSING.value: _WINDOW_VARS,
    EmailTemplateType.STOREFRONT_WINDOW_CLOSED.value: _WINDOW_VARS,
    EmailTemplateType.STOREFRONT_VENDOR_ORDER_PLACED.value: _WINDOW_VARS,
}

# Built from the same constants StorefrontNotificationService uses, so the
# preview a quartermaster approves is the table the member receives.
_SAMPLE_ITEMS_TABLE = (
    f'<table style="{TABLE_STYLE}">'
    "<thead><tr>"
    f'<th style="{TH_STYLE}text-align:left;">Item</th>'
    f'<th style="{TH_STYLE}text-align:center;">Qty</th>'
    f'<th style="{TH_STYLE}text-align:right;">Total</th></tr></thead>'
    "<tbody><tr>"
    f'<td style="{TD_STYLE}text-align:left;">Department Job Shirt<br>'
    '<span style="color:#6b7280;font-size:12px;">Large</span></td>'
    f'<td style="{TD_STYLE}text-align:center;">1</td>'
    f'<td style="{TD_STYLE}text-align:right;">$53.00</td>'
    "</tr></tbody>"
    f'<tfoot><tr><td colspan="2" style="{TFOOT_STYLE}text-align:right;">Total</td>'
    f'<td style="{TFOOT_STYLE}text-align:right;">$53.00</td></tr></tfoot></table>'
)
# Mirrors what StorefrontNotificationService._payment_block emits, panel and
# all. A sample that is merely plausible is worse than none: the preview is
# where an admin decides the layout is right, so a preview that shows loose
# paragraphs where the real mail shows a panel sends them to fix something
# that is not broken.
_SAMPLE_PAYMENT_BLOCK = (
    f'<div class="details" style="border-left-color: {ACCENT_VIOLET};">'
    "<p><strong>Balance due: $53.00</strong></p>"
    "<p>Send payment on Venmo to <strong>@YourDepartment</strong>.</p>"
    f'<p><a href="#" style="display:inline-block;background:{ACCENT_VIOLET};'
    "color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;"
    'font-weight:600;margin:0 8px 8px 0;">Pay with Venmo</a></p>'
    '<p class="fineprint" style="white-space:pre-line;">'
    "Include your order number with the payment.</p>"
    "</div>"
)

_SAMPLE_ORDER: Dict[str, str] = {
    "order_number": "ORD-2026-0042",
    "customer_name": "Sam Member",
    "first_name": "Sam",
    "store_name": "Department Store",
    "order_total": "$53.00",
    "balance_due": "$53.00",
    "items_table_html": _SAMPLE_ITEMS_TABLE,
    "payment_block_html": _SAMPLE_PAYMENT_BLOCK,
}

_SAMPLE_WINDOW: Dict[str, str] = {
    "window_name": "Fall job shirts",
    "store_name": "Department Store",
    "window_description_html": (
        "<p>Navy job shirts with your name embroidered on the chest.</p>"
    ),
    "window_extra_html": "<p>Orders close November 01, 2026.</p>",
    "pickup_instructions_html": (
        '<p class="fineprint">Collect at the station office after drill.</p>'
    ),
}

SAMPLE_CONTEXT: Dict[str, Dict[str, str]] = {
    EmailTemplateType.STOREFRONT_ORDER_CONFIRMATION.value: {
        **_SAMPLE_ORDER,
        "receipt_footer_html": (
            '<p style="color:#6b7280;">Questions? Ask the quartermaster.</p>'
        ),
    },
    EmailTemplateType.STOREFRONT_NEW_ORDER_ADMIN.value: {
        **_SAMPLE_ORDER,
        "member_notes_html": (
            "<p><strong>Member notes:</strong><br>Happy to collect at drill.</p>"
        ),
    },
    EmailTemplateType.STOREFRONT_ORDER_UPDATE.value: {
        **_SAMPLE_ORDER,
        "update_message": "Your order has arrived and is ready to collect.",
        "status_label_suffix": " — Ready for pickup",
        "status_subject_suffix": ": Ready for pickup",
        "payment_block_html": "",
    },
    EmailTemplateType.STOREFRONT_ORDER_CANCELLED.value: {
        **_SAMPLE_ORDER,
        "cancellation_reason_html": (
            '<p style="white-space:pre-line;">The vendor discontinued the style.</p>'
        ),
        "refund_notice_html": "",
    },
    EmailTemplateType.STOREFRONT_PAYMENT_REMINDER.value: dict(_SAMPLE_ORDER),
    EmailTemplateType.STOREFRONT_PAYMENT_RECEIVED.value: {
        **_SAMPLE_ORDER,
        "balance_due": "$0.00",
        "payment_summary_html": (
            "<p>We received <strong>$53.00</strong> via Venmo for order "
            "<strong>ORD-2026-0042</strong>.</p>"
        ),
        "balance_notice_html": "<p>Your order is paid in full. Thank you!</p>",
    },
    EmailTemplateType.STOREFRONT_WINDOW_OPEN.value: dict(_SAMPLE_WINDOW),
    EmailTemplateType.STOREFRONT_WINDOW_CLOSING.value: {
        **_SAMPLE_WINDOW,
        "window_extra_html": "<p>Ordering closes November 01, 2026.</p>",
    },
    EmailTemplateType.STOREFRONT_WINDOW_CLOSED.value: {
        **_SAMPLE_WINDOW,
        "window_extra_html": "<p>Expected delivery: December 15, 2026.</p>",
    },
    EmailTemplateType.STOREFRONT_VENDOR_ORDER_PLACED.value: {
        **_SAMPLE_WINDOW,
        "window_extra_html": (
            "<p>Ordered from <strong>Acme Apparel</strong>.</p>"
            "<p>Expected delivery: December 15, 2026.</p>"
        ),
    },
}

DEFAULT_TEMPLATE_DEFS: List[Dict[str, Any]] = [
    {
        "type": EmailTemplateType.STOREFRONT_ORDER_CONFIRMATION,
        "name": "Store — Order Confirmation",
        "subject": ORDER_CONFIRMATION_SUBJECT,
        "html": ORDER_CONFIRMATION_HTML,
        "text": ORDER_CONFIRMATION_TEXT,
        "description": (
            "Sent to a member the moment they place a store order. Carries the "
            "receipt and how to pay."
        ),
    },
    {
        "type": EmailTemplateType.STOREFRONT_NEW_ORDER_ADMIN,
        "name": "Store — New Order Alert",
        "subject": NEW_ORDER_ADMIN_SUBJECT,
        "html": NEW_ORDER_ADMIN_HTML,
        "text": NEW_ORDER_ADMIN_TEXT,
        "description": (
            "Sent to store managers and the extra notification recipients each "
            "time an order lands."
        ),
    },
    {
        "type": EmailTemplateType.STOREFRONT_ORDER_UPDATE,
        "name": "Store — Order Status Change",
        "subject": ORDER_UPDATE_SUBJECT,
        "html": ORDER_UPDATE_HTML,
        "text": ORDER_UPDATE_TEXT,
        "description": (
            "Sent when an order moves to ordered, ready for pickup or picked "
            "up, and when a quartermaster sends a note on an order."
        ),
    },
    {
        "type": EmailTemplateType.STOREFRONT_ORDER_CANCELLED,
        "name": "Store — Order Cancelled",
        "subject": ORDER_CANCELLED_SUBJECT,
        "html": ORDER_CANCELLED_HTML,
        "text": ORDER_CANCELLED_TEXT,
        "description": "Sent to a member when their store order is cancelled.",
    },
    {
        "type": EmailTemplateType.STOREFRONT_PAYMENT_REMINDER,
        "name": "Store — Payment Reminder",
        "subject": PAYMENT_REMINDER_SUBJECT,
        "html": PAYMENT_REMINDER_HTML,
        "text": PAYMENT_REMINDER_TEXT,
        "description": (
            "Sent to members still carrying a balance, on the schedule set in "
            "the store settings."
        ),
    },
    {
        "type": EmailTemplateType.STOREFRONT_PAYMENT_RECEIVED,
        "name": "Store — Payment Receipt",
        "subject": PAYMENT_RECEIVED_SUBJECT,
        "html": PAYMENT_RECEIVED_HTML,
        "text": PAYMENT_RECEIVED_TEXT,
        "description": (
            "Sent when a quartermaster records a payment, waives a balance or "
            "records a refund."
        ),
    },
    {
        "type": EmailTemplateType.STOREFRONT_WINDOW_OPEN,
        "name": "Store — Ordering Is Open",
        "subject": WINDOW_OPEN_SUBJECT,
        "html": WINDOW_OPEN_HTML,
        "text": WINDOW_OPEN_TEXT,
        "description": "Announced to every active member when an order window opens.",
    },
    {
        "type": EmailTemplateType.STOREFRONT_WINDOW_CLOSING,
        "name": "Store — Last Call",
        "subject": WINDOW_CLOSING_SUBJECT,
        "html": WINDOW_CLOSING_HTML,
        "text": WINDOW_CLOSING_TEXT,
        "description": (
            "Announced to every active member ahead of an order window closing."
        ),
    },
    {
        "type": EmailTemplateType.STOREFRONT_WINDOW_CLOSED,
        "name": "Store — Ordering Has Closed",
        "subject": WINDOW_CLOSED_SUBJECT,
        "html": WINDOW_CLOSED_HTML,
        "text": WINDOW_CLOSED_TEXT,
        "description": "Sent to everyone who ordered when the window closes.",
    },
    {
        "type": EmailTemplateType.STOREFRONT_VENDOR_ORDER_PLACED,
        "name": "Store — Order Placed With the Vendor",
        "subject": VENDOR_ORDER_PLACED_SUBJECT,
        "html": VENDOR_ORDER_PLACED_HTML,
        "text": VENDOR_ORDER_PLACED_TEXT,
        "description": (
            "Sent to everyone who ordered when the bulk order goes to the "
            "vendor. The update members chase."
        ),
    },
]
