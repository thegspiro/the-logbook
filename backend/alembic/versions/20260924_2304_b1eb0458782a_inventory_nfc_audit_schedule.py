"""NFC phase 4a: scheduled shelf audits.

Revision ID: b1eb0458782a
Revises: 7ad83f52735c

Two changes, both additive:

* ``storage_areas.audit_frequency`` (nullable enum: weekly, monthly,
  quarterly, yearly). Null means "not on a schedule", which is what every
  existing row becomes, so no behaviour changes until an administrator sets
  one.
* ``inventory_nfc_audit_digests`` is created: one row per "audits overdue"
  digest sent, so the weekly cadence survives restarts of the in-process
  scheduler.

Each step is guarded, so a database whose tables ``create_all`` already built
from the current models is left alone.

Downgrade drops the column and the table; audit frequencies that were set are
lost, which is the only information either carried.
"""

import sqlalchemy as sa
from alembic import op

revision = "b1eb0458782a"
down_revision = "7ad83f52735c"
branch_labels = None
depends_on = None

AREAS = "storage_areas"
DIGESTS = "inventory_nfc_audit_digests"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def upgrade() -> None:
    if _has_table(AREAS) and not _has_column(AREAS, "audit_frequency"):
        op.add_column(
            AREAS,
            sa.Column(
                "audit_frequency",
                sa.Enum(
                    "weekly",
                    "monthly",
                    "quarterly",
                    "yearly",
                    name="inventoryauditfrequency",
                ),
                nullable=True,
            ),
        )

    if not _has_table(DIGESTS):
        op.create_table(
            DIGESTS,
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(length=36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "sent_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "overdue_count", sa.Integer(), nullable=False, server_default="0"
            ),
            sa.Column(
                "recipient_count", sa.Integer(), nullable=False, server_default="0"
            ),
        )
        op.create_index(
            "idx_inventory_nfc_audit_digest_org_sent",
            DIGESTS,
            ["organization_id", "sent_at"],
        )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {DIGESTS}")
    if _has_table(AREAS) and _has_column(AREAS, "audit_frequency"):
        op.drop_column(AREAS, "audit_frequency")
