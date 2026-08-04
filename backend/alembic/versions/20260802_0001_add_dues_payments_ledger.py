"""Add dues_payments ledger (FIN-6)

Member dues carried a single ``amount_paid`` total plus one set of
``payment_method`` / ``transaction_reference`` / ``notes`` columns, all
overwritten by whichever payment was entered last. There was no record that a
payment had happened, so a retried submission could not be told apart from a
second instalment and every earlier payment's detail was destroyed.

Each payment becomes a row here, and ``member_dues.amount_paid`` becomes a
derived total rather than an accumulator.

The backfill is the load-bearing part: once the service recomputes
``amount_paid`` from this table, any existing balance with no ledger row behind
it would recompute to zero. One row is therefore synthesised per already-paid
record, carrying whatever detail that record still held.

Revision ID: 20260802_0001
Revises: 20260801_0019
Create Date: 2026-08-02 00:00:00.000000
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers
revision = "20260802_0001"
down_revision = "20260801_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dues_payments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "member_dues_id",
            sa.String(36),
            sa.ForeignKey("member_dues.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("payment_method", sa.String(50), nullable=True),
        sa.Column("transaction_reference", sa.String(200), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        # SET NULL demands nullable=True (MySQL 1830). A ledger row must
        # outlive the member who recorded it.
        sa.Column(
            "recorded_by",
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
            server_default=sa.text("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        ),
    )

    op.create_index("ix_dues_payments_org_id", "dues_payments", ["organization_id"])
    op.create_index(
        "ix_dues_payments_dues", "dues_payments", ["member_dues_id", "received_at"]
    )
    # Idempotency key. MySQL allows repeated NULLs in a unique index, so cash
    # with no reference is unconstrained; the rule binds only when a reference
    # identifies the transaction.
    op.create_index(
        "uq_dues_payment_reference",
        "dues_payments",
        ["member_dues_id", "transaction_reference"],
        unique=True,
    )

    # Backfill one payment per already-paid dues record so the derived total
    # matches what the aggregate said before this migration. paid_date can be
    # NULL on older rows, so fall back to created_at, which is NOT NULL.
    op.execute(
        """
        INSERT INTO dues_payments (
            id, organization_id, member_dues_id, amount,
            payment_method, transaction_reference, notes,
            received_at, recorded_by, created_at, updated_at
        )
        SELECT
            UUID(),
            md.organization_id,
            md.id,
            md.amount_paid,
            md.payment_method,
            md.transaction_reference,
            md.notes,
            COALESCE(md.paid_date, md.created_at),
            NULL,
            COALESCE(md.paid_date, md.created_at),
            COALESCE(md.paid_date, md.created_at)
        FROM member_dues md
        WHERE md.amount_paid > 0
        """
    )


def downgrade() -> None:
    op.drop_index("uq_dues_payment_reference", table_name="dues_payments")
    op.drop_index("ix_dues_payments_dues", table_name="dues_payments")
    op.drop_index("ix_dues_payments_org_id", table_name="dues_payments")
    op.drop_table("dues_payments")
