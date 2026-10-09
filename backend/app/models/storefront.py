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
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import (
    JSON,
    Boolean,
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
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid

if TYPE_CHECKING:
    from app.models.inventory import InventoryItem
    from app.models.user import Organization, User


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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    is_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    store_name: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
        default="Department Store",
        server_default="Department Store",
    )
    tagline: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, default="USD", server_default="USD"
    )
    show_open_order_banner: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )

    # --- Payment configuration -------------------------------------------
    accepted_payment_methods: Mapped[Optional[list[str]]] = mapped_column(
        JSON, nullable=True
    )  # list[StorePaymentMethod]
    venmo_handle: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    paypal_me_url: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    paypal_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    # See StorePaymentPolicy. Gates the vendor order and/or pickup.
    payment_policy: Mapped[StorePaymentPolicy] = mapped_column(
        SQLEnum(StorePaymentPolicy, values_callable=_enum_values),
        nullable=False,
        default=StorePaymentPolicy.NONE,
        server_default=StorePaymentPolicy.NONE.value,
    )
    cash_app_cashtag: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    # Zelle has no deep link — this handle is shown for the member to type
    # into their own bank's app. See utils/storefront_payments.py.
    zelle_handle: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    zelle_instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    check_payable_to: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    check_mailing_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cash_instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    payroll_deduction_instructions: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )
    other_payment_instructions: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )
    payment_instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # --- Pricing ----------------------------------------------------------
    # Stored as a fraction (0.0600 == 6%), not a percentage, so line math is a
    # plain multiply with no /100 rounding step.
    tax_rate: Mapped[Decimal] = mapped_column(
        Numeric(6, 4), nullable=False, default=0, server_default="0"
    )
    shipping_flat_rate: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    allow_pickup: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    allow_shipping: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    pickup_location: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)

    # --- Notifications ----------------------------------------------------
    # Each notice the storefront can send has exactly one switch here, so a
    # quartermaster reading the settings screen can see the whole outbound
    # mailing list of the module in one place. A per-send checkbox (e.g. the
    # "email members" box on the close-window dialog) can suppress an
    # individual send, but it can never send a notice switched off here.
    notify_emails: Mapped[Optional[list[str]]] = mapped_column(
        JSON, nullable=True
    )  # extra admin recipients
    notify_admins_on_order: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    send_order_confirmation: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    send_status_updates: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    send_payment_reminders: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    # Receipts for money movement the quartermaster records by hand: payment
    # taken, payment waived, refund issued.
    send_payment_receipts: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    send_window_opened: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    send_window_closing_reminder: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    send_window_closed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    send_vendor_order_updates: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    payment_reminder_days: Mapped[int] = mapped_column(
        Integer, nullable=False, default=3, server_default="3"
    )
    window_reminder_hours: Mapped[int] = mapped_column(
        Integer, nullable=False, default=48, server_default="48"
    )

    terms_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    receipt_footer: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    organization: Mapped["Organization"] = relationship(
        "Organization", foreign_keys=[organization_id]
    )


class StoreProduct(Base):
    """A sellable item in the department catalog"""

    __tablename__ = "store_products"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sku: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Optional tie-back to logistics stock so a sold item can be reconciled
    # against the inventory the department already tracks.
    inventory_item_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("inventory_items.id", ondelete="SET NULL"),
        nullable=True,
    )

    price: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=0, server_default="0"
    )
    cost: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    is_taxable: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )

    status: Mapped[StoreProductStatus] = mapped_column(
        SQLEnum(StoreProductStatus, values_callable=_enum_values),
        nullable=False,
        default=StoreProductStatus.DRAFT,
        server_default="draft",
    )
    max_per_member: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # --- Personalization (embroidered name, engraved callsign, ...) --------
    # An upcharge is common because personalizing is a per-unit vendor cost,
    # and personalized lines can never be pooled in the vendor tally: each
    # distinct text is its own row on the purchase order.
    personalization_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    personalization_required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    personalization_label: Mapped[Optional[str]] = mapped_column(
        String(120), nullable=True
    )
    personalization_max_length: Mapped[int] = mapped_column(
        Integer, nullable=False, default=30, server_default="30"
    )
    personalization_price: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=0, server_default="0"
    )
    # Thread the vendor embroiders this product in. NULL means the department
    # never chose one and gets the historical default (gold), so an existing
    # catalog is unchanged by the setting appearing.
    personalization_thread_color: Mapped[Optional[str]] = mapped_column(
        String(30), nullable=True
    )
    # Embroidery (cloth) or engraving (metal). Decides whether the thread
    # colour above means anything: an engraver has no thread. NULL is
    # embroidery, which is what every product predating the setting was.
    personalization_method: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True
    )

    track_stock: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    stock_quantity: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    requires_variant: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    internal_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    organization: Mapped["Organization"] = relationship(
        "Organization", foreign_keys=[organization_id]
    )
    inventory_item: Mapped[Optional["InventoryItem"]] = relationship(
        "InventoryItem", foreign_keys=[inventory_item_id]
    )
    image: Mapped[Optional["StoreProductImage"]] = relationship(
        "StoreProductImage",
        back_populates="product",
        cascade="all, delete-orphan",
        uselist=False,
    )
    variants: Mapped[list["StoreProductVariant"]] = relationship(
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("store_products.id", ondelete="CASCADE"),
        nullable=False,
    )

    label: Mapped[str] = mapped_column(String(120), nullable=False)
    sku: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    # Added to the parent product price; negative values discount the variant.
    price_delta: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=0, server_default="0"
    )
    stock_quantity: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    product: Mapped["StoreProduct"] = relationship(
        "StoreProduct", back_populates="variants"
    )

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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("store_products.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    content_type: Mapped[str] = mapped_column(
        String(100), nullable=False, default="image/webp", server_default="image/webp"
    )
    # 16MB MEDIUMBLOB: MySQL's default BLOB caps at 64KB, which silently
    # truncates an optimized product photo (a few hundred KB).
    data: Mapped[bytes] = mapped_column(LargeBinary(length=16_777_215), nullable=False)
    byte_size: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    uploaded_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    product: Mapped["StoreProduct"] = relationship(
        "StoreProduct", back_populates="image"
    )


class StoreOrderWindow(Base):
    """A time-boxed ordering period ("order window")"""

    __tablename__ = "store_order_windows"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[StoreWindowStatus] = mapped_column(
        SQLEnum(StoreWindowStatus, values_callable=_enum_values),
        nullable=False,
        default=StoreWindowStatus.DRAFT,
        server_default="draft",
    )

    opens_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    closes_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    auto_open: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    auto_close: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )

    expected_delivery_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    pickup_instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # --- The vendor order -------------------------------------------------
    # Filled in when the department actually places the bulk order. Without
    # these, "has this been ordered yet?" is answered from memory, and the
    # member asking when their shirt arrives gets a shrug.
    vendor_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    vendor_reference: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    vendor_ordered_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    vendor_ordered_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # When True the window offers every ACTIVE catalog product; when False only
    # the products explicitly listed in store_window_products are for sale.
    include_all_products: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )

    notify_on_open: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    open_notice_sent_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    closing_reminder_sent_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    close_notice_sent_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    opened_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    closed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    closed_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    organization: Mapped["Organization"] = relationship(
        "Organization", foreign_keys=[organization_id]
    )
    offerings: Mapped[list["StoreWindowProduct"]] = relationship(
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    window_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("store_order_windows.id", ondelete="CASCADE"),
        nullable=False,
    )
    product_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("store_products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    price_override: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    quantity_limit: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # total units for the window
    max_per_member: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    window: Mapped["StoreOrderWindow"] = relationship(
        "StoreOrderWindow", back_populates="offerings"
    )
    product: Mapped["StoreProduct"] = relationship(
        "StoreProduct", foreign_keys=[product_id]
    )

    __table_args__ = (
        UniqueConstraint(
            "window_id", "product_id", name="uq_store_window_products_window_product"
        ),
    )


class StoreOrder(Base):
    """A member order placed against an order window"""

    __tablename__ = "store_orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    window_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("store_order_windows.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    user_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    order_number: Mapped[str] = mapped_column(String(30), nullable=False)

    # Snapshot of who ordered, so a departed member's order stays readable
    # after the user row is anonymized or the FK is nulled.
    customer_name: Mapped[str] = mapped_column(String(200), nullable=False)
    customer_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    customer_phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    status: Mapped[StoreOrderStatus] = mapped_column(
        SQLEnum(StoreOrderStatus, values_callable=_enum_values),
        nullable=False,
        default=StoreOrderStatus.SUBMITTED,
        server_default="submitted",
    )
    payment_status: Mapped[StorePaymentStatus] = mapped_column(
        SQLEnum(StorePaymentStatus, values_callable=_enum_values),
        nullable=False,
        default=StorePaymentStatus.UNPAID,
        server_default="unpaid",
    )
    payment_method: Mapped[Optional[StorePaymentMethod]] = mapped_column(
        SQLEnum(StorePaymentMethod, values_callable=_enum_values),
        nullable=True,
    )

    subtotal: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=0, server_default="0"
    )
    tax_amount: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=0, server_default="0"
    )
    shipping_amount: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=0, server_default="0"
    )
    discount_amount: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=0, server_default="0"
    )
    total: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=0, server_default="0"
    )
    amount_paid: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=0, server_default="0"
    )

    payment_reference: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    payment_reported_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    paid_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    payment_verified_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    fulfillment_method: Mapped[StoreFulfillmentMethod] = mapped_column(
        SQLEnum(StoreFulfillmentMethod, values_callable=_enum_values),
        nullable=False,
        default=StoreFulfillmentMethod.PICKUP,
        server_default="pickup",
    )
    shipping_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    member_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    admin_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancellation_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    fulfilled_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    fulfilled_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    payment_reminder_sent_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    organization: Mapped["Organization"] = relationship(
        "Organization", foreign_keys=[organization_id]
    )
    window: Mapped[Optional["StoreOrderWindow"]] = relationship(
        "StoreOrderWindow", foreign_keys=[window_id]
    )
    user: Mapped[Optional["User"]] = relationship("User", foreign_keys=[user_id])
    items: Mapped[list["StoreOrderItem"]] = relationship(
        "StoreOrderItem",
        back_populates="order",
        cascade="all, delete-orphan",
    )
    events: Mapped[list["StoreOrderEvent"]] = relationship(
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )

    provider: Mapped[str] = mapped_column(
        String(30), nullable=False, default="paypal", server_default="paypal"
    )
    # The provider's own id for the money movement. Unique per org so a
    # redelivered webhook is recognised rather than double-counted.
    external_id: Mapped[str] = mapped_column(String(120), nullable=False)
    event_id: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)

    amount: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=0, server_default="0"
    )
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, default="USD", server_default="USD"
    )

    payer_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    payer_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    # Whatever reference the payer or the department attached — an invoice id,
    # a custom id, or a free-text note. This is what matching reads.
    reference: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    status: Mapped[StorePaymentEventStatus] = mapped_column(
        SQLEnum(StorePaymentEventStatus, values_callable=_enum_values),
        nullable=False,
        default=StorePaymentEventStatus.UNMATCHED,
        server_default="unmatched",
    )
    matched_order_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("store_orders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # The provider payload, kept for support: when a match goes wrong the
    # original is the only way to work out why.
    raw_payload: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)

    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    resolved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolved_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    organization: Mapped["Organization"] = relationship(
        "Organization", foreign_keys=[organization_id]
    )
    matched_order: Mapped[Optional["StoreOrder"]] = relationship(
        "StoreOrder", foreign_keys=[matched_order_id]
    )

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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    order_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("store_orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("store_products.id", ondelete="SET NULL"),
        nullable=True,
    )
    variant_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("store_product_variants.id", ondelete="SET NULL"),
        nullable=True,
    )

    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    variant_label: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    sku: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # What the member asked to have printed/embroidered on this line. Two
    # otherwise-identical lines with different text are deliberately separate
    # rows -- they are different physical goods.
    personalization_text: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )
    # Snapshot of the product's thread color at order time, alongside the
    # product name and price that are already frozen here. The quartermaster
    # can switch a product to white next season without rewriting what the
    # vendor was told to stitch on an order placed in gold.
    personalization_thread_color: Mapped[Optional[str]] = mapped_column(
        String(30), nullable=True
    )
    # Snapshot alongside the thread colour: a product switched from a stitched
    # patch to an engraved plate must not restate what the vendor was already
    # told to do with an order placed under the old method.
    personalization_method: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True
    )

    unit_price: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=0, server_default="0"
    )
    quantity: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
    line_total: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=0, server_default="0"
    )
    fulfilled_quantity: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    order: Mapped["StoreOrder"] = relationship("StoreOrder", back_populates="items")
    product: Mapped[Optional["StoreProduct"]] = relationship(
        "StoreProduct", foreign_keys=[product_id]
    )
    variant: Mapped[Optional["StoreProductVariant"]] = relationship(
        "StoreProductVariant", foreign_keys=[variant_id]
    )


class StoreOrderEvent(Base):
    """Timeline entry on an order — the member-visible "order updates" feed"""

    __tablename__ = "store_order_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    order_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("store_orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    event_type: Mapped[StoreOrderEventType] = mapped_column(
        SQLEnum(StoreOrderEventType, values_callable=_enum_values),
        nullable=False,
    )
    from_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    to_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Internal notes stay off the member's timeline.
    is_member_visible: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    notified: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )

    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    order: Mapped["StoreOrder"] = relationship("StoreOrder", back_populates="events")
    author: Mapped[Optional["User"]] = relationship("User", foreign_keys=[created_by])
