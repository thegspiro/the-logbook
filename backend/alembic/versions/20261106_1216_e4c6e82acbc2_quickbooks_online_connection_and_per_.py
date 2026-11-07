"""QuickBooks Online connection and per-payment postings

Owner decision, 2026-11-01 ("Should a live QuickBooks Online connection be
built?" -- build it, posting each payment as a Purchase to its vendor):

* ``quickbooks_connections`` -- one row per department: the QuickBooks
  company (realmId) it is connected to, its OAuth tokens (encrypted at rest
  by the model's EncryptedText columns), the connect attempt in flight, and
  the date payments are posted from.
* ``quickbooks_postings`` -- one row per payment sent, or being sent, to
  QuickBooks. Unique per (organization, payment type, payment), so a second
  run never posts a payment twice; the Intuit ``requestid`` it sends is
  unique too, and so is the QuickBooks Purchase id within a company.

Both tables are new and start empty, so there are no existing rows to settle
(CLAUDE.md pitfall #35). They reference only ``organizations`` and ``users``,
which every database has.

The downgrade drops both tables. A department's connection and the record of
which payments QuickBooks accepted are lost with them: those payments would
then be offered to the CSV export again, which would double them in
QuickBooks if the Treasurer imported that file. Reconnecting after an upgrade
again does not bring the record back.

Revision ID: e4c6e82acbc2
Revises: 3c1f5e2a9d47
Create Date: 2026-11-06 12:16:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e4c6e82acbc2"
down_revision: Union[str, None] = "3c1f5e2a9d47"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CONNECTIONS = "quickbooks_connections"
POSTINGS = "quickbooks_postings"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table(CONNECTIONS):
        op.create_table(
            CONNECTIONS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey(
                    "organizations.id",
                    ondelete="CASCADE",
                    name="fk_quickbooks_connections_organization_id_organizations",
                ),
                nullable=False,
            ),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("environment", sa.String(20), nullable=True),
            sa.Column("realm_id", sa.String(32), nullable=True),
            sa.Column("access_token", sa.Text(), nullable=True),
            sa.Column("refresh_token", sa.Text(), nullable=True),
            sa.Column(
                "access_token_expires_at", sa.DateTime(timezone=True), nullable=True
            ),
            sa.Column(
                "refresh_token_expires_at", sa.DateTime(timezone=True), nullable=True
            ),
            sa.Column("pending_attempt", sa.Text(), nullable=True),
            sa.Column("post_from", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "connected_by",
                sa.String(36),
                sa.ForeignKey(
                    "users.id",
                    ondelete="SET NULL",
                    name="fk_quickbooks_connections_connected_by_users",
                ),
                nullable=True,
            ),
            sa.Column("connected_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error", sa.String(500), nullable=True),
            sa.Column("sync_lease_until", sa.DateTime(timezone=True), nullable=True),
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
            ),
            sa.UniqueConstraint(
                "organization_id",
                name="uq_quickbooks_connections_organization_id",
            ),
            mysql_charset="utf8mb4",
            mysql_collate="utf8mb4_unicode_ci",
        )

    if not _has_table(POSTINGS):
        op.create_table(
            POSTINGS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey(
                    "organizations.id",
                    ondelete="CASCADE",
                    name="fk_quickbooks_postings_organization_id_organizations",
                ),
                nullable=False,
            ),
            sa.Column("payment_type", sa.String(20), nullable=False),
            sa.Column("payment_id", sa.String(36), nullable=False),
            sa.Column("document_number", sa.String(20), nullable=False),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("request_id", sa.String(50), nullable=False),
            sa.Column("realm_id", sa.String(32), nullable=True),
            sa.Column("qb_purchase_id", sa.String(32), nullable=True),
            sa.Column("qb_vendor_id", sa.String(32), nullable=True),
            sa.Column("vendor_name", sa.String(300), nullable=True),
            sa.Column("amount", sa.Numeric(12, 2), nullable=True),
            sa.Column("attempts", sa.Integer(), nullable=False),
            sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error", sa.String(500), nullable=True),
            sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
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
            ),
            sa.UniqueConstraint(
                "organization_id",
                "payment_type",
                "payment_id",
                name="uq_quickbooks_postings_payment",
            ),
            sa.UniqueConstraint(
                "realm_id", "qb_purchase_id", name="uq_quickbooks_postings_purchase"
            ),
            sa.UniqueConstraint("request_id", name="uq_quickbooks_postings_request_id"),
            sa.Index("ix_quickbooks_postings_org_status", "organization_id", "status"),
            mysql_charset="utf8mb4",
            mysql_collate="utf8mb4_unicode_ci",
        )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {POSTINGS}")
    op.execute(f"DROP TABLE IF EXISTS {CONNECTIONS}")
