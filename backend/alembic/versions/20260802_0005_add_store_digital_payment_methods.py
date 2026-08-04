"""Add Cash App and Zelle as storefront payment methods

Departments settle store orders through whichever peer-to-peer app their
members already have. Venmo and PayPal covered most of it; Cash App and Zelle
are the two that were missing.

Zelle gets a handle and free-text instructions but no link column — it lives
inside each bank's own app and publishes no deep-link scheme, so a member is
given the handle to type rather than a button that goes nowhere.

Revision ID: 20260802_0005
Revises: 20260802_0004
Create Date: 2026-08-04
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers
revision = "20260802_0005"
down_revision = "20260802_0004"
branch_labels = None
depends_on = None


# MySQL stores ENUM members by position, so the new values are appended rather
# than slotted in beside the payment apps they resemble.
_OLD_METHODS = ("venmo", "paypal", "cash", "check", "payroll_deduction", "other")
_NEW_METHODS = _OLD_METHODS + ("cash_app", "zelle")


def upgrade() -> None:
    op.add_column(
        "store_settings",
        sa.Column("cash_app_cashtag", sa.String(100), nullable=True),
    )
    op.add_column(
        "store_settings",
        sa.Column("zelle_handle", sa.String(255), nullable=True),
    )
    op.add_column(
        "store_settings",
        sa.Column("zelle_instructions", sa.Text(), nullable=True),
    )
    op.alter_column(
        "store_orders",
        "payment_method",
        existing_type=sa.Enum(*_OLD_METHODS, name="storepaymentmethod"),
        type_=sa.Enum(*_NEW_METHODS, name="storepaymentmethod"),
        existing_nullable=True,
    )


def downgrade() -> None:
    # Orders already settled through the new apps would violate the narrowed
    # ENUM, so park them on 'other' rather than failing the migration.
    op.execute(
        "UPDATE store_orders SET payment_method = 'other' "
        "WHERE payment_method IN ('cash_app', 'zelle')"
    )
    op.alter_column(
        "store_orders",
        "payment_method",
        existing_type=sa.Enum(*_NEW_METHODS, name="storepaymentmethod"),
        type_=sa.Enum(*_OLD_METHODS, name="storepaymentmethod"),
        existing_nullable=True,
    )
    op.drop_column("store_settings", "zelle_instructions")
    op.drop_column("store_settings", "zelle_handle")
    op.drop_column("store_settings", "cash_app_cashtag")
