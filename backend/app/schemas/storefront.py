"""
Storefront Module Schemas

Pydantic request/response schemas for the department storefront: settings,
catalog products and variants, order windows, member orders, and the
order-update timeline.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

from app.models.storefront import (
    StoreFulfillmentMethod,
    StoreOrderEventType,
    StoreOrderStatus,
    StorePaymentEventStatus,
    StorePaymentMethod,
    StorePaymentPolicy,
    StorePaymentStatus,
    StoreProductStatus,
    StoreWindowStatus,
)
from app.schemas.base import UTCResponseBase
from app.utils.storefront_payments import normalize_cashtag, normalize_zelle_handle

_RESPONSE_CONFIG = ConfigDict(
    from_attributes=True,
    alias_generator=to_camel,
    populate_by_name=True,
)

# Request bodies accept camelCase (what the SPA sends) *and* snake_case, so the
# same schemas stay usable from scripts and tests that speak Python field names.
_REQUEST_CONFIG = ConfigDict(
    alias_generator=to_camel,
    populate_by_name=True,
)


def _strip_or_none(value: Optional[str]) -> Optional[str]:
    """Normalize blank/whitespace-only strings to None."""
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


# ============================================
# Settings
# ============================================


class StoreSettingsUpdate(BaseModel):
    """Update the organization's storefront configuration"""

    model_config = _REQUEST_CONFIG

    is_enabled: Optional[bool] = None
    store_name: Optional[str] = Field(None, min_length=1, max_length=200)
    tagline: Optional[str] = Field(None, max_length=300)
    description: Optional[str] = None
    currency: Optional[str] = Field(None, min_length=3, max_length=3)

    accepted_payment_methods: Optional[List[StorePaymentMethod]] = None
    payment_policy: Optional[StorePaymentPolicy] = None
    venmo_handle: Optional[str] = Field(None, max_length=100)
    paypal_me_url: Optional[str] = Field(None, max_length=300)
    paypal_email: Optional[str] = Field(None, max_length=255)
    cash_app_cashtag: Optional[str] = Field(None, max_length=100)
    zelle_handle: Optional[str] = Field(None, max_length=255)
    zelle_instructions: Optional[str] = None
    check_payable_to: Optional[str] = Field(None, max_length=200)
    check_mailing_address: Optional[str] = None
    cash_instructions: Optional[str] = None
    payroll_deduction_instructions: Optional[str] = None
    other_payment_instructions: Optional[str] = None
    payment_instructions: Optional[str] = None

    tax_rate: Optional[Decimal] = Field(None, ge=0, le=1)
    shipping_flat_rate: Optional[Decimal] = Field(None, ge=0)
    allow_pickup: Optional[bool] = None
    allow_shipping: Optional[bool] = None
    pickup_location: Optional[str] = Field(None, max_length=300)

    notify_emails: Optional[List[str]] = None
    notify_admins_on_order: Optional[bool] = None
    send_order_confirmation: Optional[bool] = None
    send_status_updates: Optional[bool] = None
    send_payment_reminders: Optional[bool] = None
    payment_reminder_days: Optional[int] = Field(None, ge=1, le=90)
    window_reminder_hours: Optional[int] = Field(None, ge=1, le=720)

    terms_text: Optional[str] = None
    receipt_footer: Optional[str] = None

    @field_validator("currency")
    @classmethod
    def _upper_currency(cls, v: Optional[str]) -> Optional[str]:
        return v.upper() if v else v

    @field_validator("venmo_handle")
    @classmethod
    def _clean_venmo(cls, v: Optional[str]) -> Optional[str]:
        # Members paste the handle with or without the leading @; the deep-link
        # builder needs it bare.
        cleaned = _strip_or_none(v)
        return cleaned.lstrip("@") if cleaned else cleaned

    @field_validator("cash_app_cashtag")
    @classmethod
    def _clean_cashtag(cls, v: Optional[str]) -> Optional[str]:
        # Rejected here rather than silently dropped: a typo'd cashtag would
        # otherwise just make the Cash App button vanish with no explanation.
        cleaned = _strip_or_none(v)
        if cleaned is None:
            return None
        normalized = normalize_cashtag(cleaned)
        if not normalized:
            raise ValueError(
                "Enter a valid Cash App $cashtag (letters, digits and "
                "underscores, starting with a letter)"
            )
        return normalized

    @field_validator("zelle_handle")
    @classmethod
    def _clean_zelle(cls, v: Optional[str]) -> Optional[str]:
        cleaned = _strip_or_none(v)
        if cleaned is None:
            return None
        normalized = normalize_zelle_handle(cleaned)
        if not normalized:
            raise ValueError(
                "Zelle is registered against an email address or a 10-digit "
                "mobile number"
            )
        return normalized


class StoreSettingsResponse(UTCResponseBase):
    """Storefront configuration as seen by administrators"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    is_enabled: bool
    store_name: str
    tagline: Optional[str] = None
    description: Optional[str] = None
    currency: str

    accepted_payment_methods: List[str] = Field(default_factory=list)
    payment_policy: StorePaymentPolicy = StorePaymentPolicy.NONE
    venmo_handle: Optional[str] = None
    paypal_me_url: Optional[str] = None
    paypal_email: Optional[str] = None
    cash_app_cashtag: Optional[str] = None
    zelle_handle: Optional[str] = None
    zelle_instructions: Optional[str] = None
    check_payable_to: Optional[str] = None
    check_mailing_address: Optional[str] = None
    cash_instructions: Optional[str] = None
    payroll_deduction_instructions: Optional[str] = None
    other_payment_instructions: Optional[str] = None
    payment_instructions: Optional[str] = None

    tax_rate: Decimal
    shipping_flat_rate: Optional[Decimal] = None
    allow_pickup: bool
    allow_shipping: bool
    pickup_location: Optional[str] = None

    notify_emails: List[str] = Field(default_factory=list)
    notify_admins_on_order: bool
    send_order_confirmation: bool
    send_status_updates: bool
    send_payment_reminders: bool
    payment_reminder_days: int
    window_reminder_hours: int

    terms_text: Optional[str] = None
    receipt_footer: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @field_validator("accepted_payment_methods", "notify_emails", mode="before")
    @classmethod
    def _null_list_to_empty(cls, v: Any) -> Any:
        return v or []


# ============================================
# Products & Variants
# ============================================


class StoreProductVariantCreate(BaseModel):
    """Create/replace a variant on a product"""

    model_config = _REQUEST_CONFIG

    id: Optional[str] = None
    label: str = Field(..., min_length=1, max_length=120)
    sku: Optional[str] = Field(None, max_length=100)
    price_delta: Decimal = Field(default=Decimal("0"))
    stock_quantity: Optional[int] = Field(None, ge=0)
    is_active: bool = True
    sort_order: int = 0


class StoreProductVariantResponse(UTCResponseBase):
    """Variant as returned to clients"""

    model_config = _RESPONSE_CONFIG

    id: str
    product_id: str
    label: str
    sku: Optional[str] = None
    price_delta: Decimal
    stock_quantity: Optional[int] = None
    is_active: bool
    sort_order: int


class StoreProductBase(BaseModel):
    """Fields shared by product create and update"""

    model_config = _REQUEST_CONFIG

    name: str = Field(..., min_length=1, max_length=255)
    sku: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None
    image_url: Optional[str] = Field(None, max_length=500)
    category: Optional[str] = Field(None, max_length=100)
    inventory_item_id: Optional[str] = Field(None, max_length=36)
    price: Decimal = Field(..., ge=0)
    cost: Optional[Decimal] = Field(None, ge=0)
    is_taxable: bool = False
    status: StoreProductStatus = StoreProductStatus.DRAFT
    max_per_member: Optional[int] = Field(None, ge=1)
    personalization_enabled: bool = False
    personalization_required: bool = False
    personalization_label: Optional[str] = Field(None, max_length=120)
    personalization_max_length: int = Field(default=30, ge=1, le=200)
    personalization_price: Decimal = Field(default=Decimal("0"), ge=0)
    track_stock: bool = False
    stock_quantity: Optional[int] = Field(None, ge=0)
    requires_variant: bool = False
    sort_order: int = 0
    internal_notes: Optional[str] = None


class StoreProductCreate(StoreProductBase):
    """Create a catalog product"""

    variants: List[StoreProductVariantCreate] = Field(default_factory=list)

    @model_validator(mode="after")
    def _variant_required_needs_variants(self) -> "StoreProductCreate":
        if self.requires_variant and not self.variants:
            raise ValueError(
                "A product that requires a variant must define at least one variant"
            )
        if self.personalization_required and not self.personalization_enabled:
            raise ValueError(
                "Personalization must be enabled before it can be required"
            )
        return self


class StoreProductUpdate(BaseModel):
    """Update a catalog product; omitted fields are left untouched"""

    model_config = _REQUEST_CONFIG

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    sku: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None
    image_url: Optional[str] = Field(None, max_length=500)
    category: Optional[str] = Field(None, max_length=100)
    inventory_item_id: Optional[str] = Field(None, max_length=36)
    price: Optional[Decimal] = Field(None, ge=0)
    cost: Optional[Decimal] = Field(None, ge=0)
    is_taxable: Optional[bool] = None
    status: Optional[StoreProductStatus] = None
    max_per_member: Optional[int] = Field(None, ge=1)
    personalization_enabled: Optional[bool] = None
    personalization_required: Optional[bool] = None
    personalization_label: Optional[str] = Field(None, max_length=120)
    personalization_max_length: Optional[int] = Field(None, ge=1, le=200)
    personalization_price: Optional[Decimal] = Field(None, ge=0)
    track_stock: Optional[bool] = None
    stock_quantity: Optional[int] = Field(None, ge=0)
    requires_variant: Optional[bool] = None
    sort_order: Optional[int] = None
    internal_notes: Optional[str] = None
    variants: Optional[List[StoreProductVariantCreate]] = None


class StoreProductResponse(UTCResponseBase):
    """Catalog product with its variants"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    name: str
    sku: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    category: Optional[str] = None
    inventory_item_id: Optional[str] = None
    price: Decimal
    cost: Optional[Decimal] = None
    is_taxable: bool
    status: StoreProductStatus
    max_per_member: Optional[int] = None
    personalization_enabled: bool
    personalization_required: bool
    personalization_label: Optional[str] = None
    personalization_max_length: int
    personalization_price: Decimal
    track_stock: bool
    stock_quantity: Optional[int] = None
    requires_variant: bool
    sort_order: int
    internal_notes: Optional[str] = None
    has_image: bool = False
    variants: List[StoreProductVariantResponse] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class StorefrontVariantOption(UTCResponseBase):
    """Variant as offered to a shopper (no internal fields)"""

    model_config = _RESPONSE_CONFIG

    id: str
    label: str
    price: Decimal
    available_quantity: Optional[int] = None
    is_available: bool


class StorefrontProductOffer(UTCResponseBase):
    """Product as offered to a shopper in an open window"""

    model_config = _RESPONSE_CONFIG

    id: str
    name: str
    description: Optional[str] = None
    image_url: Optional[str] = None
    category: Optional[str] = None
    price: Decimal
    is_taxable: bool
    requires_variant: bool
    max_per_member: Optional[int] = None
    personalization_enabled: bool = False
    personalization_required: bool = False
    personalization_label: Optional[str] = None
    personalization_max_length: int = 30
    personalization_price: Decimal = Decimal("0")
    available_quantity: Optional[int] = None
    is_available: bool
    variants: List[StorefrontVariantOption] = Field(default_factory=list)


# ============================================
# Order Windows
# ============================================


class StoreWindowOfferingInput(BaseModel):
    """Per-window product offering with optional price/limit overrides"""

    model_config = _REQUEST_CONFIG

    product_id: str = Field(..., min_length=1, max_length=36)
    price_override: Optional[Decimal] = Field(None, ge=0)
    quantity_limit: Optional[int] = Field(None, ge=1)
    max_per_member: Optional[int] = Field(None, ge=1)
    sort_order: int = 0


class StoreWindowOfferingResponse(UTCResponseBase):
    """Offering row joined with its product name for display"""

    model_config = _RESPONSE_CONFIG

    id: str
    product_id: str
    product_name: Optional[str] = None
    price_override: Optional[Decimal] = None
    quantity_limit: Optional[int] = None
    max_per_member: Optional[int] = None
    sort_order: int


class StoreOrderWindowBase(BaseModel):
    """Fields shared by window create and update"""

    model_config = _REQUEST_CONFIG

    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    opens_at: Optional[datetime] = None
    closes_at: Optional[datetime] = None
    auto_open: bool = True
    auto_close: bool = True
    expected_delivery_date: Optional[date] = None
    pickup_instructions: Optional[str] = None
    include_all_products: bool = True
    notify_on_open: bool = True
    notes: Optional[str] = None


class StoreOrderWindowCreate(StoreOrderWindowBase):
    """Create an order window"""

    offerings: List[StoreWindowOfferingInput] = Field(default_factory=list)

    @model_validator(mode="after")
    def _closes_after_opens(self) -> "StoreOrderWindowCreate":
        if self.opens_at and self.closes_at and self.closes_at <= self.opens_at:
            raise ValueError("Window close time must be after the open time")
        return self


class StoreOrderWindowUpdate(BaseModel):
    """Update an order window; omitted fields are left untouched"""

    model_config = _REQUEST_CONFIG

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    opens_at: Optional[datetime] = None
    closes_at: Optional[datetime] = None
    auto_open: Optional[bool] = None
    auto_close: Optional[bool] = None
    expected_delivery_date: Optional[date] = None
    pickup_instructions: Optional[str] = None
    include_all_products: Optional[bool] = None
    notify_on_open: Optional[bool] = None
    notes: Optional[str] = None
    offerings: Optional[List[StoreWindowOfferingInput]] = None


class StoreWindowCloseRequest(BaseModel):
    """Close an order window, optionally emailing everyone who ordered"""

    model_config = _REQUEST_CONFIG

    notify_members: bool = True
    message: Optional[str] = None


class StoreWindowOpenRequest(BaseModel):
    """Open an order window, optionally announcing it to the membership"""

    model_config = _REQUEST_CONFIG

    notify_members: bool = True
    message: Optional[str] = None


class StoreOrderWindowResponse(UTCResponseBase):
    """Order window with rollup counters"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    name: str
    description: Optional[str] = None
    status: StoreWindowStatus
    opens_at: Optional[datetime] = None
    closes_at: Optional[datetime] = None
    auto_open: bool
    auto_close: bool
    expected_delivery_date: Optional[date] = None
    pickup_instructions: Optional[str] = None
    include_all_products: bool
    notify_on_open: bool
    opened_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    notes: Optional[str] = None
    order_count: int = 0
    total_sales: Decimal = Decimal("0")
    outstanding_balance: Decimal = Decimal("0")
    offerings: List[StoreWindowOfferingResponse] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class StorefrontWindowSummary(UTCResponseBase):
    """The open window as presented to a shopper"""

    model_config = _RESPONSE_CONFIG

    id: str
    name: str
    description: Optional[str] = None
    closes_at: Optional[datetime] = None
    expected_delivery_date: Optional[date] = None
    pickup_instructions: Optional[str] = None


class StorefrontResponse(UTCResponseBase):
    """Everything a shopper needs to render the store in one call"""

    model_config = _RESPONSE_CONFIG

    is_enabled: bool
    store_name: str
    tagline: Optional[str] = None
    description: Optional[str] = None
    currency: str
    terms_text: Optional[str] = None
    allow_pickup: bool
    allow_shipping: bool
    pickup_location: Optional[str] = None
    shipping_flat_rate: Optional[Decimal] = None
    tax_rate: Decimal
    accepted_payment_methods: List[str] = Field(default_factory=list)
    payment_instructions: Optional[str] = None
    window: Optional[StorefrontWindowSummary] = None
    # A department can run more than one order period at once (apparel and
    # challenge coins, say); the shopper picks which one they're browsing.
    other_open_windows: List[StorefrontWindowSummary] = Field(default_factory=list)
    products: List[StorefrontProductOffer] = Field(default_factory=list)


# ============================================
# Orders
# ============================================


class StoreOrderItemInput(BaseModel):
    """One line of a submitted order"""

    model_config = _REQUEST_CONFIG

    product_id: str = Field(..., min_length=1, max_length=36)
    variant_id: Optional[str] = Field(None, max_length=36)
    quantity: int = Field(..., ge=1, le=999)
    # Free text the member wants embroidered/engraved on this line. The server
    # discards it for products that do not offer personalization.
    personalization_text: Optional[str] = Field(None, max_length=200)


class StoreOrderCreate(BaseModel):
    """Submit an order against the open window.

    Prices are deliberately absent: the server recomputes every line from the
    catalog so a tampered client cannot set its own price.
    """

    model_config = _REQUEST_CONFIG

    window_id: Optional[str] = Field(None, max_length=36)
    items: List[StoreOrderItemInput] = Field(..., min_length=1)
    payment_method: Optional[StorePaymentMethod] = None
    fulfillment_method: StoreFulfillmentMethod = StoreFulfillmentMethod.PICKUP
    shipping_address: Optional[str] = None
    member_notes: Optional[str] = None

    @model_validator(mode="after")
    def _shipping_needs_address(self) -> "StoreOrderCreate":
        if (
            self.fulfillment_method == StoreFulfillmentMethod.SHIP
            and not (self.shipping_address or "").strip()
        ):
            raise ValueError("A shipping address is required for shipped orders")
        return self


class StoreOrderItemResponse(UTCResponseBase):
    """Order line item"""

    model_config = _RESPONSE_CONFIG

    id: str
    product_id: Optional[str] = None
    variant_id: Optional[str] = None
    product_name: str
    variant_label: Optional[str] = None
    sku: Optional[str] = None
    personalization_text: Optional[str] = None
    unit_price: Decimal
    quantity: int
    line_total: Decimal
    fulfilled_quantity: int


class StoreOrderEventResponse(UTCResponseBase):
    """Timeline entry on an order"""

    model_config = _RESPONSE_CONFIG

    id: str
    event_type: StoreOrderEventType
    from_status: Optional[str] = None
    to_status: Optional[str] = None
    message: Optional[str] = None
    is_member_visible: bool
    author_name: Optional[str] = None
    created_at: Optional[datetime] = None


class StorePaymentOption(UTCResponseBase):
    """One configured way to settle an order"""

    model_config = _RESPONSE_CONFIG

    method: str
    label: str
    handle: Optional[str] = None
    # Deep link that opens the payment app prefilled with the amount. None for
    # methods that have no link to open (Zelle, cash, check).
    payment_url: Optional[str] = None
    instructions: Optional[str] = None
    # True when the link carries the order number through, so the UI knows
    # whether to tell the member to type the reference themselves.
    prefills_reference: bool = False


class StorePaymentInstructions(UTCResponseBase):
    """Where and how to send the money for one order"""

    model_config = _RESPONSE_CONFIG

    method: Optional[str] = None
    label: Optional[str] = None
    # Deep link that opens Venmo/PayPal prefilled with amount and order number.
    payment_url: Optional[str] = None
    handle: Optional[str] = None
    instructions: Optional[str] = None
    reference: Optional[str] = None
    amount_due: Decimal = Decimal("0")
    # Every method the department accepts and has configured, the one chosen at
    # checkout first. The member is not locked into that choice.
    options: List[StorePaymentOption] = Field(default_factory=list)


class StoreOrderResponse(UTCResponseBase):
    """Full order record"""

    model_config = _RESPONSE_CONFIG

    id: str
    organization_id: str
    window_id: Optional[str] = None
    window_name: Optional[str] = None
    user_id: Optional[str] = None
    order_number: str
    customer_name: str
    customer_email: Optional[str] = None
    customer_phone: Optional[str] = None
    status: StoreOrderStatus
    payment_status: StorePaymentStatus
    payment_method: Optional[StorePaymentMethod] = None
    subtotal: Decimal
    tax_amount: Decimal
    shipping_amount: Decimal
    discount_amount: Decimal
    total: Decimal
    amount_paid: Decimal
    balance_due: Decimal = Decimal("0")
    payment_reference: Optional[str] = None
    payment_reported_at: Optional[datetime] = None
    paid_at: Optional[datetime] = None
    fulfillment_method: StoreFulfillmentMethod
    shipping_address: Optional[str] = None
    member_notes: Optional[str] = None
    admin_notes: Optional[str] = None
    submitted_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    cancellation_reason: Optional[str] = None
    fulfilled_at: Optional[datetime] = None
    items: List[StoreOrderItemResponse] = Field(default_factory=list)
    events: List[StoreOrderEventResponse] = Field(default_factory=list)
    payment_instructions: Optional[StorePaymentInstructions] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class StoreOrderStatusUpdate(BaseModel):
    """Move an order along its fulfillment lifecycle"""

    model_config = _REQUEST_CONFIG

    status: StoreOrderStatus
    message: Optional[str] = None
    notify_member: bool = True


class StoreOrderPaymentRecord(BaseModel):
    """Record a payment an administrator has verified"""

    model_config = _REQUEST_CONFIG

    amount: Decimal = Field(..., gt=0)
    payment_method: Optional[StorePaymentMethod] = None
    reference: Optional[str] = Field(None, max_length=200)
    mark_paid: bool = True
    notify_member: bool = True


class StoreOrderPaymentReport(BaseModel):
    """A member telling the department they have sent payment"""

    model_config = _REQUEST_CONFIG

    payment_method: StorePaymentMethod
    reference: Optional[str] = Field(None, max_length=200)
    note: Optional[str] = None


class StoreOrderMarkPaid(BaseModel):
    """Settle an order's whole remaining balance."""

    model_config = _REQUEST_CONFIG

    payment_method: Optional[StorePaymentMethod] = None
    reference: Optional[str] = Field(None, max_length=200)
    notify_member: bool = True


class StoreOrderWaive(BaseModel):
    """Comp an order — no money is being collected."""

    model_config = _REQUEST_CONFIG

    reason: Optional[str] = None
    notify_member: bool = True


class StoreBulkPayment(BaseModel):
    """Settle several orders at once (reconciling a payout statement)."""

    model_config = _REQUEST_CONFIG

    order_ids: List[str] = Field(..., min_length=1, max_length=500)
    payment_method: Optional[StorePaymentMethod] = None
    reference: Optional[str] = Field(None, max_length=200)
    notify_members: bool = True


class StoreOrderRefund(BaseModel):
    """Record a refund issued outside the app"""

    model_config = _REQUEST_CONFIG

    amount: Optional[Decimal] = Field(None, gt=0)
    reason: Optional[str] = None
    notify_member: bool = True


class StoreOrderCancel(BaseModel):
    """Cancel an order"""

    model_config = _REQUEST_CONFIG

    reason: Optional[str] = None
    notify_member: bool = True


class StoreOrderMessage(BaseModel):
    """Post an update to the order timeline"""

    model_config = _REQUEST_CONFIG

    message: str = Field(..., min_length=1)
    is_member_visible: bool = True
    notify_member: bool = True


class StoreOrderAdminNotes(BaseModel):
    """Replace the internal notes on an order"""

    model_config = _REQUEST_CONFIG

    admin_notes: Optional[str] = None


# ============================================
# Reporting
# ============================================


class StoreWindowSizeTotal(UTCResponseBase):
    """How many of one product/size to order — the vendor purchase order"""

    model_config = _RESPONSE_CONFIG

    product_id: Optional[str] = None
    product_name: str
    variant_label: Optional[str] = None
    sku: Optional[str] = None
    quantity: int
    line_total: Decimal


class StoreWindowProductTally(UTCResponseBase):
    """One row of the bulk-purchase sheet for a window"""

    model_config = _RESPONSE_CONFIG

    product_id: Optional[str] = None
    product_name: str
    variant_label: Optional[str] = None
    sku: Optional[str] = None
    personalization_text: Optional[str] = None
    quantity: int
    unit_price: Decimal
    line_total: Decimal


class StoreWindowSummaryResponse(UTCResponseBase):
    """Fulfillment rollup for one order window"""

    model_config = _RESPONSE_CONFIG

    window_id: str
    window_name: str
    status: StoreWindowStatus
    order_count: int
    member_count: int
    gross_sales: Decimal
    collected: Decimal
    outstanding: Decimal
    unpaid_order_count: int
    pending_verification_count: int
    payment_policy: StorePaymentPolicy = StorePaymentPolicy.NONE
    # What to order from the vendor, merged across members.
    size_totals: List[StoreWindowSizeTotal] = Field(default_factory=list)
    # Held back because they are unpaid, when the policy requires payment
    # before the vendor order. Empty under every other policy.
    held_totals: List[StoreWindowSizeTotal] = Field(default_factory=list)
    held_order_count: int = 0
    # What to embroider on each one — one row per distinct name.
    tallies: List[StoreWindowProductTally] = Field(default_factory=list)


class StoreDashboardResponse(UTCResponseBase):
    """Admin landing-page rollup"""

    model_config = _RESPONSE_CONFIG

    is_enabled: bool
    active_window: Optional[StoreOrderWindowResponse] = None
    open_order_count: int
    awaiting_payment_count: int
    pending_verification_count: int
    ready_for_pickup_count: int
    outstanding_balance: Decimal
    collected_this_window: Decimal
    active_product_count: int
    recent_orders: List[StoreOrderResponse] = Field(default_factory=list)


class StoreOrderListResponse(UTCResponseBase):
    """Paged order list"""

    model_config = _RESPONSE_CONFIG

    items: List[StoreOrderResponse] = Field(default_factory=list)
    total: int
    page: int
    page_size: int


class StoreBulkStatusUpdate(BaseModel):
    """Advance several orders at once (e.g. mark a whole window ready)"""

    model_config = _REQUEST_CONFIG

    order_ids: List[str] = Field(..., min_length=1, max_length=500)
    status: StoreOrderStatus
    message: Optional[str] = None
    notify_members: bool = True


class StoreBulkStatusResult(UTCResponseBase):
    """Outcome of a bulk status change"""

    model_config = _RESPONSE_CONFIG

    updated: int
    skipped: int
    errors: List[Dict[str, str]] = Field(default_factory=list)


# ============================================
# External payment reconciliation
# ============================================


class StorePaymentEventResponse(UTCResponseBase):
    """One payment a provider reported, and what the storefront did with it"""

    model_config = _RESPONSE_CONFIG

    id: str
    provider: str
    external_id: str
    amount: Decimal
    currency: str
    payer_name: Optional[str] = None
    payer_email: Optional[str] = None
    reference: Optional[str] = None
    status: StorePaymentEventStatus
    note: Optional[str] = None
    matched_order_id: Optional[str] = None
    matched_order_number: Optional[str] = None
    matched_order_member: Optional[str] = None
    matched_order_balance: Optional[Decimal] = None
    received_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None


class StorePaymentEventListResponse(UTCResponseBase):
    """Inbound payments, newest first"""

    model_config = _RESPONSE_CONFIG

    items: List[StorePaymentEventResponse] = Field(default_factory=list)
    unresolved_count: int = 0


class StorePaymentEventApply(BaseModel):
    """Settle an order from a recorded payment"""

    model_config = _REQUEST_CONFIG

    # Supplied when an administrator attaches a payment the matcher could not
    # place; omitted to accept the order the matcher already found.
    order_id: Optional[str] = None


class StorePaymentEventIgnore(BaseModel):
    """Dismiss a payment that does not belong to any store order"""

    model_config = _REQUEST_CONFIG

    reason: Optional[str] = Field(default=None, max_length=500)
