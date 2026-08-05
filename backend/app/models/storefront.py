"""
Storefront Database Models

Optional department storefront that sits alongside the inventory (logistics)
module.  Departments publish a catalog of sellable items (job shirts, challenge
coins, duty boots), open a time-boxed *order window*, collect member orders,
and reconcile payments that are settled out-of-band through Venmo / PayPal /
cash / check.

Payment design note
-------------------
Venmo has no merchant API for peer-to-peer collection and PayPal's
merchant onboarding is out of reach for most volunteer departments, so this
module deliberately models **assisted manual settlement**: the store hands the
member a prefilled Venmo/PayPal deep link, the member reports the payment they
sent, and a quartermaster verifies it against the department account.  The
``payment_status`` column tracks that reconciliation independently of the
fulfillment ``status`` so an unpaid-but-shipped order is representable rather
than being squeezed into one lifecycle.
"""

import enum

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
)
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import (
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


def _enum_values(enum_cls):
    """Extract string values from a (str, Enum) for SQLAlchemy's values_callable."""
    return [e.value for e in enum_cls]


class StoreProductStatus(str, enum.Enum):
    """Publication state of a catalog product"""

    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"


class StoreWindowStatus(str, enum.Enum):
    """Lifecycle of an order window (the "order period")"""

    DRAFT = "draft"  # Being set up, invisible to members
    SCHEDULED = "scheduled"  # Published, waiting for opens_at
    OPEN = "open"  # Accepting orders
    CLOSED = "closed"  # No longer accepting orders; being fulfilled
    FULFILLED = "fulfilled"  # Everything distributed
    CANCELLED = "cancelled"


class StoreOrderStatus(str, enum.Enum):
    """Fulfillment lifecycle of a member order"""

    SUBMITTED = "submitted"
    AWAITING_PAYMENT = "awaiting_payment"
    PAID = "paid"
    ORDERED = "ordered"  # Department placed the bulk order with the vendor
    READY_FOR_PICKUP = "ready_for_pickup"
    FULFILLED = "fulfilled"
    CANCELLED = "cancelled"


class StorePaymentStatus(str, enum.Enum):
    """Reconciliation state of the money, tracked separately from fulfillment"""

    UNPAID = "unpaid"
    PENDING_VERIFICATION = "pending_verification"  # Member says they paid
    PARTIAL = "partial"
    PAID = "paid"
    REFUNDED = "refunded"
    WAIVED = "waived"  # Comped by the department


class StorePaymentMethod(str, enum.Enum):
    """How the member settles up"""

    VENMO = "venmo"
    PAYPAL = "paypal"
    CASH_APP = "cash_app"
    ZELLE = "zelle"
    CASH = "cash"
    CHECK = "check"
    PAYROLL_DEDUCTION = "payroll_deduction"
    OTHER = "other"


class StorePaymentPolicy(str, enum.Enum):
    """When an unpaid order is allowed to move forward.

    Departments genuinely differ here, and both directions are defensible: one
    will not float a member the cost of a shirt, another would rather place one
    clean vendor order and chase the money afterwards. Neither is the safe
    default, so the default is NONE — the behaviour a store already had before
    this setting existed.
    """

    NONE = "none"
    # The shirt gets ordered either way; the member cannot collect it unpaid.
    BEFORE_PICKUP = "before_pickup"
    # Unpaid orders are held out of the vendor order entirely.
    BEFORE_VENDOR_ORDER = "before_vendor_order"


class StoreFulfillmentMethod(str, enum.Enum):
    """How the member receives the goods"""

    PICKUP = "pickup"
    SHIP = "ship"


class StorePaymentEventStatus(str, enum.Enum):
    """How an externally-reported payment was reconciled."""

    APPLIED = "applied"  # Matched an order and settled it
    MATCHED = "matched"  # Matched an order but was not applied automatically
    UNMATCHED = "unmatched"  # No order could be identified — needs a human
    AMBIGUOUS = "ambiguous"  # Reference matched, amount did not
    IGNORED = "ignored"  # Dismissed by an administrator
    DUPLICATE = "duplicate"  # Provider redelivered a capture we already have


class StoreOrderEventType(str, enum.Enum):
    """Timeline entry types on an order"""

    CREATED = "created"
    STATUS_CHANGED = "status_changed"
    PAYMENT_REPORTED = "payment_reported"
    PAYMENT_RECORDED = "payment_recorded"
    REFUNDED = "refunded"
    MESSAGE = "message"
    NOTE = "note"
    CANCELLED = "cancelled"


class StoreSettings(Base):
    """Per-organization storefront configuration (one row per org).

    ``is_enabled`` gates the *member-facing* store independently of the
    ``storefront`` module flag in ``Organization.settings.modules``: the module
    flag decides whether the feature appears in navigation at all, while this
    flag lets a quartermaster take the store down for maintenance without
    disabling the module and hiding the admin screens they need.
    """

    __tablename__ = "store_settings"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    is_enabled = Column(Boolean, nullable=False, default=False)
    store_name = Column(String(200), nullable=False, default="Department Store")
    tagline = Column(String(300), nullable=True)
    description = Column(Text, nullable=True)
    currency = Column(String(3), nullable=False, default="USD")

    # --- Payment configuration -------------------------------------------
    accepted_payment_methods = Column(JSON, nullable=True)  # list[StorePaymentMethod]
    venmo_handle = Column(String(100), nullable=True)
    paypal_me_url = Column(String(300), nullable=True)
    paypal_email = Column(String(255), nullable=True)
    # See StorePaymentPolicy. Gates the vendor order and/or pickup.
    payment_policy = Column(
        SQLEnum(StorePaymentPolicy, values_callable=_enum_values),
        nullable=False,
        default=StorePaymentPolicy.NONE,
        server_default=StorePaymentPolicy.NONE.value,
    )
    cash_app_cashtag = Column(String(100), nullable=True)
    # Zelle has no deep link — this handle is shown for the member to type
    # into their own bank's app. See utils/storefront_payments.py.
    zelle_handle = Column(String(255), nullable=True)
    zelle_instructions = Column(Text, nullable=True)
    check_payable_to = Column(String(200), nullable=True)
    check_mailing_address = Column(Text, nullable=True)
    cash_instructions = Column(Text, nullable=True)
    payroll_deduction_instructions = Column(Text, nullable=True)
    other_payment_instructions = Column(Text, nullable=True)
    payment_instructions = Column(Text, nullable=True)

    # --- Pricing ----------------------------------------------------------
    # Stored as a fraction (0.0600 == 6%), not a percentage, so line math is a
    # plain multiply with no /100 rounding step.
    tax_rate = Column(Numeric(6, 4), nullable=False, default=0)
    shipping_flat_rate = Column(Numeric(10, 2), nullable=True)
    allow_pickup = Column(Boolean, nullable=False, default=True)
    allow_shipping = Column(Boolean, nullable=False, default=False)
    pickup_location = Column(String(300), nullable=True)

    # --- Notifications ----------------------------------------------------
    # Each notice the storefront can send has exactly one switch here, so a
    # quartermaster reading the settings screen can see the whole outbound
    # mailing list of the module in one place. A per-send checkbox (e.g. the
    # "email members" box on the close-window dialog) can suppress an
    # individual send, but it can never send a notice switched off here.
    notify_emails = Column(JSON, nullable=True)  # extra admin recipients
    notify_admins_on_order = Column(Boolean, nullable=False, default=True)
    send_order_confirmation = Column(Boolean, nullable=False, default=True)
    send_status_updates = Column(Boolean, nullable=False, default=True)
    send_payment_reminders = Column(Boolean, nullable=False, default=True)
    # Receipts for money movement the quartermaster records by hand: payment
    # taken, payment waived, refund issued.
    send_payment_receipts = Column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    send_window_opened = Column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    send_window_closing_reminder = Column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    send_window_closed = Column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    send_vendor_order_updates = Column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    payment_reminder_days = Column(Integer, nullable=False, default=3)
    window_reminder_hours = Column(Integer, nullable=False, default=48)

    terms_text = Column(Text, nullable=True)
    receipt_footer = Column(Text, nullable=True)

    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    organization = relationship("Organization", foreign_keys=[organization_id])


class StoreProduct(Base):
    """A sellable item in the department catalog"""

    __tablename__ = "store_products"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name = Column(String(255), nullable=False)
    sku = Column(String(100), nullable=True)
    description = Column(Text, nullable=True)
    image_url = Column(String(500), nullable=True)
    category = Column(String(100), nullable=True)

    # Optional tie-back to logistics stock so a sold item can be reconciled
    # against the inventory the department already tracks.
    inventory_item_id = Column(
        String(36),
        ForeignKey("inventory_items.id", ondelete="SET NULL"),
        nullable=True,
    )

    price = Column(Numeric(10, 2), nullable=False, default=0)
    cost = Column(Numeric(10, 2), nullable=True)
    is_taxable = Column(Boolean, nullable=False, default=False)

    status = Column(
        SQLEnum(StoreProductStatus, values_callable=_enum_values),
        nullable=False,
        default=StoreProductStatus.DRAFT,
    )
    max_per_member = Column(Integer, nullable=True)

    # --- Personalization (embroidered name, engraved callsign, ...) --------
    # An upcharge is common because personalizing is a per-unit vendor cost,
    # and personalized lines can never be pooled in the vendor tally: each
    # distinct text is its own row on the purchase order.
    personalization_enabled = Column(Boolean, nullable=False, default=False)
    personalization_required = Column(Boolean, nullable=False, default=False)
    personalization_label = Column(String(120), nullable=True)
    personalization_max_length = Column(Integer, nullable=False, default=30)
    personalization_price = Column(Numeric(10, 2), nullable=False, default=0)

    track_stock = Column(Boolean, nullable=False, default=False)
    stock_quantity = Column(Integer, nullable=True)
    requires_variant = Column(Boolean, nullable=False, default=False)
    sort_order = Column(Integer, nullable=False, default=0)
    internal_notes = Column(Text, nullable=True)

    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    organization = relationship("Organization", foreign_keys=[organization_id])
    inventory_item = relationship("InventoryItem", foreign_keys=[inventory_item_id])
    image = relationship(
        "StoreProductImage",
        back_populates="product",
        cascade="all, delete-orphan",
        uselist=False,
    )
    variants = relationship(
        "StoreProductVariant",
        back_populates="product",
        cascade="all, delete-orphan",
        order_by="StoreProductVariant.sort_order",
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "sku", name="uq_store_products_org_sku"),
        Index("ix_store_products_org_status", "organization_id", "status"),
    )


class StoreProductVariant(Base):
    """A size/color option on a product (e.g. "L / Navy")"""

    __tablename__ = "store_product_variants"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_id = Column(
        String(36),
        ForeignKey("store_products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    label = Column(String(120), nullable=False)
    sku = Column(String(100), nullable=True)
    # Added to the parent product price; negative values discount the variant.
    price_delta = Column(Numeric(10, 2), nullable=False, default=0)
    stock_quantity = Column(Integer, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    sort_order = Column(Integer, nullable=False, default=0)

    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    product = relationship("StoreProduct", back_populates="variants")

    __table_args__ = (
        UniqueConstraint(
            "product_id", "label", name="uq_store_product_variants_product_label"
        ),
    )


class StoreProductImage(Base):
    """Uploaded product photo, stored out of line from the catalog row.

    Kept in its own table (and served by its own endpoint) so listing the
    catalog never drags a few hundred KB of image bytes per product through
    the ORM -- the storefront lists every active product at once.
    """

    __tablename__ = "store_product_images"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_id = Column(
        String(36),
        ForeignKey("store_products.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    content_type = Column(String(100), nullable=False, default="image/webp")
    # 16MB MEDIUMBLOB: MySQL's default BLOB caps at 64KB, which silently
    # truncates an optimized product photo (a few hundred KB).
    data = Column(LargeBinary(length=16_777_215), nullable=False)
    byte_size = Column(Integer, nullable=False, default=0)

    uploaded_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    product = relationship("StoreProduct", back_populates="image")


class StoreOrderWindow(Base):
    """A time-boxed ordering period ("order window")"""

    __tablename__ = "store_order_windows"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(
        SQLEnum(StoreWindowStatus, values_callable=_enum_values),
        nullable=False,
        default=StoreWindowStatus.DRAFT,
    )

    opens_at = Column(DateTime(timezone=True), nullable=True)
    closes_at = Column(DateTime(timezone=True), nullable=True)
    auto_open = Column(Boolean, nullable=False, default=True)
    auto_close = Column(Boolean, nullable=False, default=True)

    expected_delivery_date = Column(Date, nullable=True)
    pickup_instructions = Column(Text, nullable=True)

    # --- The vendor order -------------------------------------------------
    # Filled in when the department actually places the bulk order. Without
    # these, "has this been ordered yet?" is answered from memory, and the
    # member asking when their shirt arrives gets a shrug.
    vendor_name = Column(String(200), nullable=True)
    vendor_reference = Column(String(120), nullable=True)
    vendor_ordered_at = Column(DateTime(timezone=True), nullable=True)
    vendor_ordered_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # When True the window offers every ACTIVE catalog product; when False only
    # the products explicitly listed in store_window_products are for sale.
    include_all_products = Column(Boolean, nullable=False, default=True)

    notify_on_open = Column(Boolean, nullable=False, default=True)
    open_notice_sent_at = Column(DateTime(timezone=True), nullable=True)
    closing_reminder_sent_at = Column(DateTime(timezone=True), nullable=True)
    close_notice_sent_at = Column(DateTime(timezone=True), nullable=True)

    opened_at = Column(DateTime(timezone=True), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    closed_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)

    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    organization = relationship("Organization", foreign_keys=[organization_id])
    offerings = relationship(
        "StoreWindowProduct",
        back_populates="window",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_store_order_windows_org_status", "organization_id", "status"),
    )


class StoreWindowProduct(Base):
    """Which catalog products a window offers, with per-window overrides"""

    __tablename__ = "store_window_products"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    window_id = Column(
        String(36),
        ForeignKey("store_order_windows.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_id = Column(
        String(36),
        ForeignKey("store_products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    price_override = Column(Numeric(10, 2), nullable=True)
    quantity_limit = Column(Integer, nullable=True)  # total units for the window
    max_per_member = Column(Integer, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)

    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    window = relationship("StoreOrderWindow", back_populates="offerings")
    product = relationship("StoreProduct", foreign_keys=[product_id])

    __table_args__ = (
        UniqueConstraint(
            "window_id", "product_id", name="uq_store_window_products_window_product"
        ),
    )


class StoreOrder(Base):
    """A member order placed against an order window"""

    __tablename__ = "store_orders"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    window_id = Column(
        String(36),
        ForeignKey("store_order_windows.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    order_number = Column(String(30), nullable=False)

    # Snapshot of who ordered, so a departed member's order stays readable
    # after the user row is anonymized or the FK is nulled.
    customer_name = Column(String(200), nullable=False)
    customer_email = Column(String(255), nullable=True)
    customer_phone = Column(String(50), nullable=True)

    status = Column(
        SQLEnum(StoreOrderStatus, values_callable=_enum_values),
        nullable=False,
        default=StoreOrderStatus.SUBMITTED,
    )
    payment_status = Column(
        SQLEnum(StorePaymentStatus, values_callable=_enum_values),
        nullable=False,
        default=StorePaymentStatus.UNPAID,
    )
    payment_method = Column(
        SQLEnum(StorePaymentMethod, values_callable=_enum_values),
        nullable=True,
    )

    subtotal = Column(Numeric(10, 2), nullable=False, default=0)
    tax_amount = Column(Numeric(10, 2), nullable=False, default=0)
    shipping_amount = Column(Numeric(10, 2), nullable=False, default=0)
    discount_amount = Column(Numeric(10, 2), nullable=False, default=0)
    total = Column(Numeric(10, 2), nullable=False, default=0)
    amount_paid = Column(Numeric(10, 2), nullable=False, default=0)

    payment_reference = Column(String(200), nullable=True)
    payment_reported_at = Column(DateTime(timezone=True), nullable=True)
    paid_at = Column(DateTime(timezone=True), nullable=True)
    payment_verified_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    fulfillment_method = Column(
        SQLEnum(StoreFulfillmentMethod, values_callable=_enum_values),
        nullable=False,
        default=StoreFulfillmentMethod.PICKUP,
    )
    shipping_address = Column(Text, nullable=True)

    member_notes = Column(Text, nullable=True)
    admin_notes = Column(Text, nullable=True)

    submitted_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    cancellation_reason = Column(Text, nullable=True)
    fulfilled_at = Column(DateTime(timezone=True), nullable=True)
    fulfilled_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    payment_reminder_sent_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    organization = relationship("Organization", foreign_keys=[organization_id])
    window = relationship("StoreOrderWindow", foreign_keys=[window_id])
    user = relationship("User", foreign_keys=[user_id])
    items = relationship(
        "StoreOrderItem",
        back_populates="order",
        cascade="all, delete-orphan",
    )
    events = relationship(
        "StoreOrderEvent",
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="StoreOrderEvent.created_at",
    )

    __table_args__ = (
        # Numbers are allocated per org (ORD-YYYY-NNNN); a global unique would
        # make two orgs' first order of a year collide. Also backs the
        # retry-on-conflict allocator in StorefrontService.
        UniqueConstraint(
            "organization_id", "order_number", name="uq_store_orders_org_number"
        ),
        Index("ix_store_orders_org_status", "organization_id", "status"),
        Index("ix_store_orders_org_payment", "organization_id", "payment_status"),
        Index("ix_store_orders_org_window", "organization_id", "window_id"),
    )


class StorePaymentEvent(Base):
    """A payment a provider says it received, and what we did about it.

    Every inbound capture is recorded here whether or not it could be matched,
    because the failures are the point: a payment that arrives with no usable
    reference still has to reach a human, and silently dropping it would leave
    a member marked unpaid with money gone from their account.

    This is a ledger of *external* reports, deliberately separate from
    ``store_orders.amount_paid``. Applying an event writes the payment through
    the normal service path; this table records that it happened and why.
    """

    __tablename__ = "store_payment_events"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    provider = Column(String(30), nullable=False, default="paypal")
    # The provider's own id for the money movement. Unique per org so a
    # redelivered webhook is recognised rather than double-counted.
    external_id = Column(String(120), nullable=False)
    event_id = Column(String(120), nullable=True)

    amount = Column(Numeric(10, 2), nullable=False, default=0)
    currency = Column(String(3), nullable=False, default="USD")

    payer_name = Column(String(200), nullable=True)
    payer_email = Column(String(255), nullable=True)
    # Whatever reference the payer or the department attached — an invoice id,
    # a custom id, or a free-text note. This is what matching reads.
    reference = Column(String(255), nullable=True)

    status = Column(
        SQLEnum(StorePaymentEventStatus, values_callable=_enum_values),
        nullable=False,
        default=StorePaymentEventStatus.UNMATCHED,
    )
    matched_order_id = Column(
        String(36),
        ForeignKey("store_orders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    note = Column(Text, nullable=True)
    # The provider payload, kept for support: when a match goes wrong the
    # original is the only way to work out why.
    raw_payload = Column(JSON, nullable=True)

    received_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    organization = relationship("Organization", foreign_keys=[organization_id])
    matched_order = relationship("StoreOrder", foreign_keys=[matched_order_id])

    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "provider",
            "external_id",
            name="uq_store_payment_events_provider_external",
        ),
        Index("ix_store_payment_events_org_status", "organization_id", "status"),
    )


class StoreOrderItem(Base):
    """A line item on an order.

    Product name / variant / price are snapshotted at order time: catalog rows
    get renamed and repriced between order windows, and a receipt must keep
    saying what the member actually bought and paid.
    """

    __tablename__ = "store_order_items"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    order_id = Column(
        String(36),
        ForeignKey("store_orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_id = Column(
        String(36),
        ForeignKey("store_products.id", ondelete="SET NULL"),
        nullable=True,
    )
    variant_id = Column(
        String(36),
        ForeignKey("store_product_variants.id", ondelete="SET NULL"),
        nullable=True,
    )

    product_name = Column(String(255), nullable=False)
    variant_label = Column(String(120), nullable=True)
    sku = Column(String(100), nullable=True)

    # What the member asked to have printed/embroidered on this line. Two
    # otherwise-identical lines with different text are deliberately separate
    # rows -- they are different physical goods.
    personalization_text = Column(String(200), nullable=True)

    unit_price = Column(Numeric(10, 2), nullable=False, default=0)
    quantity = Column(Integer, nullable=False, default=1)
    line_total = Column(Numeric(10, 2), nullable=False, default=0)
    fulfilled_quantity = Column(Integer, nullable=False, default=0)

    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    order = relationship("StoreOrder", back_populates="items")
    product = relationship("StoreProduct", foreign_keys=[product_id])
    variant = relationship("StoreProductVariant", foreign_keys=[variant_id])


class StoreOrderEvent(Base):
    """Timeline entry on an order — the member-visible "order updates" feed"""

    __tablename__ = "store_order_events"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    order_id = Column(
        String(36),
        ForeignKey("store_orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    event_type = Column(
        SQLEnum(StoreOrderEventType, values_callable=_enum_values),
        nullable=False,
    )
    from_status = Column(String(50), nullable=True)
    to_status = Column(String(50), nullable=True)
    message = Column(Text, nullable=True)
    # Internal notes stay off the member's timeline.
    is_member_visible = Column(Boolean, nullable=False, default=True)
    notified = Column(Boolean, nullable=False, default=False)

    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    order = relationship("StoreOrder", back_populates="events")
    author = relationship("User", foreign_keys=[created_by])
