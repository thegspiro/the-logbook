"""Add department storefront tables

Optional storefront alongside the inventory (logistics) module: catalog
products with variants, time-boxed order windows, member orders, and the
order-update timeline.

Revision ID: 20260801_0020
Revises: 20260801_0019
Create Date: 2026-08-04 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260801_0020"
down_revision = "20260801_0019"
branch_labels = None
depends_on = None


PRODUCT_STATUS = ("draft", "active", "archived")
WINDOW_STATUS = ("draft", "scheduled", "open", "closed", "fulfilled", "cancelled")
ORDER_STATUS = (
    "submitted",
    "awaiting_payment",
    "paid",
    "ordered",
    "ready_for_pickup",
    "fulfilled",
    "cancelled",
)
PAYMENT_STATUS = (
    "unpaid",
    "pending_verification",
    "partial",
    "paid",
    "refunded",
    "waived",
)
PAYMENT_METHOD = ("venmo", "paypal", "cash", "check", "payroll_deduction", "other")
FULFILLMENT_METHOD = ("pickup", "ship")
ORDER_EVENT_TYPE = (
    "created",
    "status_changed",
    "payment_reported",
    "payment_recorded",
    "refunded",
    "message",
    "note",
    "cancelled",
)


def _timestamps() -> list:
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
            server_onupdate=sa.text("CURRENT_TIMESTAMP"),
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "store_settings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
            index=True,
        ),
        sa.Column(
            "is_enabled", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column(
            "store_name",
            sa.String(200),
            nullable=False,
            server_default="Department Store",
        ),
        sa.Column("tagline", sa.String(300), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("accepted_payment_methods", sa.JSON(), nullable=True),
        sa.Column("venmo_handle", sa.String(100), nullable=True),
        sa.Column("paypal_me_url", sa.String(300), nullable=True),
        sa.Column("paypal_email", sa.String(255), nullable=True),
        sa.Column("check_payable_to", sa.String(200), nullable=True),
        sa.Column("check_mailing_address", sa.Text(), nullable=True),
        sa.Column("cash_instructions", sa.Text(), nullable=True),
        sa.Column("payroll_deduction_instructions", sa.Text(), nullable=True),
        sa.Column("other_payment_instructions", sa.Text(), nullable=True),
        sa.Column("payment_instructions", sa.Text(), nullable=True),
        sa.Column("tax_rate", sa.Numeric(6, 4), nullable=False, server_default="0"),
        sa.Column("shipping_flat_rate", sa.Numeric(10, 2), nullable=True),
        sa.Column(
            "allow_pickup", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        sa.Column(
            "allow_shipping", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("pickup_location", sa.String(300), nullable=True),
        sa.Column("notify_emails", sa.JSON(), nullable=True),
        sa.Column(
            "notify_admins_on_order",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "send_order_confirmation",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "send_status_updates",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "send_payment_reminders",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "payment_reminder_days", sa.Integer(), nullable=False, server_default="3"
        ),
        sa.Column(
            "window_reminder_hours", sa.Integer(), nullable=False, server_default="48"
        ),
        sa.Column("terms_text", sa.Text(), nullable=True),
        sa.Column("receipt_footer", sa.Text(), nullable=True),
        *_timestamps(),
    )

    op.create_table(
        "store_products",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("sku", sa.String(100), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("image_url", sa.String(500), nullable=True),
        sa.Column("category", sa.String(100), nullable=True),
        sa.Column(
            "inventory_item_id",
            sa.String(36),
            sa.ForeignKey("inventory_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("price", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("cost", sa.Numeric(10, 2), nullable=True),
        sa.Column(
            "is_taxable", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column(
            "status",
            sa.Enum(*PRODUCT_STATUS, name="storeproductstatus"),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("max_per_member", sa.Integer(), nullable=True),
        sa.Column(
            "track_stock", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("stock_quantity", sa.Integer(), nullable=True),
        sa.Column(
            "requires_variant", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("internal_notes", sa.Text(), nullable=True),
        sa.Column(
            "created_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        *_timestamps(),
        sa.UniqueConstraint("organization_id", "sku", name="uq_store_products_org_sku"),
    )
    op.create_index(
        "ix_store_products_org_status", "store_products", ["organization_id", "status"]
    )

    op.create_table(
        "store_product_variants",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "product_id",
            sa.String(36),
            sa.ForeignKey("store_products.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("label", sa.String(120), nullable=False),
        sa.Column("sku", sa.String(100), nullable=True),
        sa.Column("price_delta", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("stock_quantity", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        *_timestamps(),
        sa.UniqueConstraint(
            "product_id", "label", name="uq_store_product_variants_product_label"
        ),
    )

    op.create_table(
        "store_order_windows",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(*WINDOW_STATUS, name="storewindowstatus"),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("opens_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closes_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("auto_open", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("auto_close", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("expected_delivery_date", sa.Date(), nullable=True),
        sa.Column("pickup_instructions", sa.Text(), nullable=True),
        sa.Column(
            "include_all_products",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "notify_on_open", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        sa.Column("open_notice_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "closing_reminder_sent_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column("close_notice_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "closed_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        *_timestamps(),
    )
    op.create_index(
        "ix_store_order_windows_org_status",
        "store_order_windows",
        ["organization_id", "status"],
    )

    op.create_table(
        "store_window_products",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "window_id",
            sa.String(36),
            sa.ForeignKey("store_order_windows.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "product_id",
            sa.String(36),
            sa.ForeignKey("store_products.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("price_override", sa.Numeric(10, 2), nullable=True),
        sa.Column("quantity_limit", sa.Integer(), nullable=True),
        sa.Column("max_per_member", sa.Integer(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint(
            "window_id", "product_id", name="uq_store_window_products_window_product"
        ),
    )

    op.create_table(
        "store_orders",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "window_id",
            sa.String(36),
            sa.ForeignKey("store_order_windows.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("order_number", sa.String(30), nullable=False),
        sa.Column("customer_name", sa.String(200), nullable=False),
        sa.Column("customer_email", sa.String(255), nullable=True),
        sa.Column("customer_phone", sa.String(50), nullable=True),
        sa.Column(
            "status",
            sa.Enum(*ORDER_STATUS, name="storeorderstatus"),
            nullable=False,
            server_default="submitted",
        ),
        sa.Column(
            "payment_status",
            sa.Enum(*PAYMENT_STATUS, name="storepaymentstatus"),
            nullable=False,
            server_default="unpaid",
        ),
        sa.Column(
            "payment_method",
            sa.Enum(*PAYMENT_METHOD, name="storepaymentmethod"),
            nullable=True,
        ),
        sa.Column("subtotal", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("tax_amount", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column(
            "shipping_amount", sa.Numeric(10, 2), nullable=False, server_default="0"
        ),
        sa.Column(
            "discount_amount", sa.Numeric(10, 2), nullable=False, server_default="0"
        ),
        sa.Column("total", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("amount_paid", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("payment_reference", sa.String(200), nullable=True),
        sa.Column("payment_reported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "payment_verified_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "fulfillment_method",
            sa.Enum(*FULFILLMENT_METHOD, name="storefulfillmentmethod"),
            nullable=False,
            server_default="pickup",
        ),
        sa.Column("shipping_address", sa.Text(), nullable=True),
        sa.Column("member_notes", sa.Text(), nullable=True),
        sa.Column("admin_notes", sa.Text(), nullable=True),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancellation_reason", sa.Text(), nullable=True),
        sa.Column("fulfilled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "fulfilled_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "payment_reminder_sent_at", sa.DateTime(timezone=True), nullable=True
        ),
        *_timestamps(),
        sa.UniqueConstraint(
            "organization_id", "order_number", name="uq_store_orders_org_number"
        ),
    )
    op.create_index(
        "ix_store_orders_org_status", "store_orders", ["organization_id", "status"]
    )
    op.create_index(
        "ix_store_orders_org_payment",
        "store_orders",
        ["organization_id", "payment_status"],
    )
    op.create_index(
        "ix_store_orders_org_window", "store_orders", ["organization_id", "window_id"]
    )

    op.create_table(
        "store_order_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "order_id",
            sa.String(36),
            sa.ForeignKey("store_orders.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "product_id",
            sa.String(36),
            sa.ForeignKey("store_products.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "variant_id",
            sa.String(36),
            sa.ForeignKey("store_product_variants.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("product_name", sa.String(255), nullable=False),
        sa.Column("variant_label", sa.String(120), nullable=True),
        sa.Column("sku", sa.String(100), nullable=True),
        sa.Column("unit_price", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("line_total", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column(
            "fulfilled_quantity", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )

    op.create_table(
        "store_order_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "order_id",
            sa.String(36),
            sa.ForeignKey("store_orders.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "event_type",
            sa.Enum(*ORDER_EVENT_TYPE, name="storeordereventtype"),
            nullable=False,
        ),
        sa.Column("from_status", sa.String(50), nullable=True),
        sa.Column("to_status", sa.String(50), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column(
            "is_member_visible", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        sa.Column("notified", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )


def downgrade() -> None:
    op.drop_table("store_order_events")
    op.drop_table("store_order_items")
    op.drop_index("ix_store_orders_org_window", table_name="store_orders")
    op.drop_index("ix_store_orders_org_payment", table_name="store_orders")
    op.drop_index("ix_store_orders_org_status", table_name="store_orders")
    op.drop_table("store_orders")
    op.drop_table("store_window_products")
    op.drop_index("ix_store_order_windows_org_status", table_name="store_order_windows")
    op.drop_table("store_order_windows")
    op.drop_table("store_product_variants")
    op.drop_index("ix_store_products_org_status", table_name="store_products")
    op.drop_table("store_products")
    op.drop_table("store_settings")
