"""Zeffy campaign links and payments

Revision ID: 4262144ac214
Revises: 3d0b6b6be048
Create Date: 2026-10-31 21:17:00.000000

Adds the two tables the Zeffy integration reads into:

* ``zeffy_campaign_links`` — which fundraising campaign, fundraising event or
  dues schedule a Zeffy campaign's payments are applied to.
* ``zeffy_payments`` — one row per Zeffy payment. The unique key on
  ``(organization_id, zeffy_payment_id)`` is what makes a redelivered webhook,
  or a sync that reads a payment the webhook already recorded, a no-op.

New tables, so no existing row is touched, and each is created only when
absent, so the migration is safe to run twice.

Both reference ``dues_schedules`` / ``member_dues``, which no migration creates:
``create_all`` builds them (docs/rules/migrations.md). On a database that does
not have them yet — CI's empty-database ``alembic upgrade head`` — the tables
are skipped here and ``create_all`` builds them from the models later, which
declare exactly this shape.

The downgrade drops both tables. What the integration already applied stays
where it was applied (donations, event revenue, dues payments); only the record
of which Zeffy payment produced it is lost, so after a downgrade and a fresh
upgrade a re-sync would see those payments as new. Disconnect Zeffy before
downgrading.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4262144ac214"
down_revision: Union[str, None] = "3d0b6b6be048"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LINKS = "zeffy_campaign_links"
PAYMENTS = "zeffy_payments"

_LINK_TARGETS = ("fundraising_campaign", "fundraising_event", "dues_schedule")
_PAYMENT_STATES = (
    "pending",
    "ignored",
    "unlinked",
    "before_start",
    "unmatched",
    "applied",
    "reversed",
    "needs_review",
)
_REFERENCED = (
    "organizations",
    "users",
    "fundraising_campaigns",
    "fundraising_events",
    "dues_schedules",
    "member_dues",
    "donations",
)


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    ]


def upgrade() -> None:
    existing = _tables()
    if not set(_REFERENCED) <= existing:
        return

    if LINKS not in existing:
        op.create_table(
            LINKS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("zeffy_campaign_id", sa.String(120), nullable=False),
            sa.Column("zeffy_campaign_title", sa.String(255), nullable=True),
            sa.Column(
                "target_type",
                sa.Enum(*_LINK_TARGETS, name="zeffylinktarget"),
                nullable=False,
            ),
            sa.Column(
                "fundraising_campaign_id",
                sa.String(36),
                sa.ForeignKey("fundraising_campaigns.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "fundraising_event_id",
                sa.String(36),
                sa.ForeignKey("fundraising_events.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "dues_schedule_id",
                sa.String(36),
                sa.ForeignKey("dues_schedules.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("apply_from", sa.DateTime(timezone=True), nullable=False),
            sa.Column("synced_through", sa.DateTime(timezone=True), nullable=True),
            sa.Column("sync_window_end", sa.DateTime(timezone=True), nullable=True),
            sa.Column("sync_cursor", sa.String(255), nullable=True),
            sa.Column(
                "created_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            *_timestamps(),
            sa.UniqueConstraint(
                "organization_id",
                "zeffy_campaign_id",
                name="uq_zeffy_campaign_links_org_campaign",
            ),
        )

    if PAYMENTS not in existing:
        op.create_table(
            PAYMENTS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("zeffy_payment_id", sa.String(120), nullable=False),
            sa.Column("zeffy_campaign_id", sa.String(120), nullable=True),
            sa.Column("zeffy_parent_campaign_id", sa.String(120), nullable=True),
            sa.Column("campaign_title", sa.String(255), nullable=True),
            sa.Column("campaign_category", sa.String(30), nullable=True),
            sa.Column("payment_type", sa.String(20), nullable=True),
            sa.Column("zeffy_status", sa.String(30), nullable=True),
            sa.Column("refund_status", sa.String(10), nullable=True),
            sa.Column("dispute_status", sa.String(20), nullable=True),
            sa.Column(
                "deleted_in_zeffy",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
            sa.Column("amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
            sa.Column(
                "refunded_amount",
                sa.Numeric(12, 2),
                nullable=False,
                server_default="0",
            ),
            sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
            sa.Column("ticket_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("payer_name", sa.String(200), nullable=True),
            sa.Column("payer_email", sa.Text(), nullable=True),
            sa.Column("receipt_url", sa.String(500), nullable=True),
            sa.Column(
                "state",
                sa.Enum(*_PAYMENT_STATES, name="zeffypaymentstate"),
                nullable=False,
                server_default="unlinked",
            ),
            sa.Column("state_detail", sa.String(255), nullable=True),
            sa.Column(
                "applied_target_type",
                sa.Enum(*_LINK_TARGETS, name="zeffylinktarget"),
                nullable=True,
            ),
            sa.Column(
                "donation_id",
                sa.String(36),
                sa.ForeignKey("donations.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "fundraising_event_id",
                sa.String(36),
                sa.ForeignKey("fundraising_events.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "member_dues_id",
                sa.String(36),
                sa.ForeignKey("member_dues.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "applied_amount",
                sa.Numeric(12, 2),
                nullable=False,
                server_default="0",
            ),
            sa.Column(
                "applied_tickets", sa.Integer(), nullable=False, server_default="0"
            ),
            sa.Column("raw_payload", sa.JSON(), nullable=True),
            sa.Column("last_event_at", sa.DateTime(timezone=True), nullable=True),
            *_timestamps(),
            sa.UniqueConstraint(
                "organization_id",
                "zeffy_payment_id",
                name="uq_zeffy_payments_org_payment",
            ),
        )
        op.create_index(
            "ix_zeffy_payments_org_state", PAYMENTS, ["organization_id", "state"]
        )
        op.create_index(
            "ix_zeffy_payments_org_campaign",
            PAYMENTS,
            ["organization_id", "zeffy_campaign_id"],
        )
        op.create_index(
            "ix_zeffy_payments_org_paid", PAYMENTS, ["organization_id", "paid_at"]
        )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {PAYMENTS}")
    op.execute(f"DROP TABLE IF EXISTS {LINKS}")
