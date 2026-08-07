"""Add store_payment_events for external payment reconciliation

Ledger of payments a provider (PayPal) reports receiving, and what the
storefront did about each one. Recorded whether or not a matching order could
be found: an unmatchable payment is the case that most needs a human.

Revision ID: 20260802_0004
Revises: 20260802_0003
Create Date: 2026-08-04
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260802_0004"
down_revision = "20260802_0003"
branch_labels = None
depends_on = None


PAYMENT_EVENT_STATUS = (
    "applied",
    "matched",
    "unmatched",
    "ambiguous",
    "ignored",
    "duplicate",
)


def upgrade() -> None:
    op.create_table(
        "store_payment_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("provider", sa.String(30), nullable=False, server_default="paypal"),
        sa.Column("external_id", sa.String(120), nullable=False),
        sa.Column("event_id", sa.String(120), nullable=True),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("payer_name", sa.String(200), nullable=True),
        sa.Column("payer_email", sa.String(255), nullable=True),
        sa.Column("reference", sa.String(255), nullable=True),
        sa.Column(
            "status",
            sa.Enum(*PAYMENT_EVENT_STATUS, name="storepaymenteventstatus"),
            nullable=False,
            server_default="unmatched",
        ),
        sa.Column(
            "matched_order_id",
            sa.String(36),
            sa.ForeignKey("store_orders.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("raw_payload", sa.JSON(), nullable=True),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "resolved_by",
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
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        # A redelivered webhook must be recognised, not double-counted.
        sa.UniqueConstraint(
            "organization_id",
            "provider",
            "external_id",
            name="uq_store_payment_events_provider_external",
        ),
    )
    op.create_index(
        "ix_store_payment_events_org_status",
        "store_payment_events",
        ["organization_id", "status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_store_payment_events_org_status", table_name="store_payment_events"
    )
    op.drop_table("store_payment_events")
