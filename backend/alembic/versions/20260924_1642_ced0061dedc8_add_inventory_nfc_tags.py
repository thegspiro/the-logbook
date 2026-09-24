"""Add inventory_nfc_tags: NFC tags attached to inventory items.

Revision ID: ced0061dedc8
Revises: 941e1251ad74

A new table only; nothing existing is altered. The table is created whether or
not a department uses NFC — the feature is off until an administrator sets
``inventory.nfc_tracking_enabled`` in the organization settings, and an absent
key reads as off.

The identifier is stored as a peppered SHA-256 hash, never in clear text, for
the reason given on the model: the phone that links an equipment tag is the
same one that reads member ID cards.

Idempotent: a database whose table was already built by ``create_all`` (the
fast-path fresh install) is left alone.
"""

import sqlalchemy as sa
from alembic import op

revision = "ced0061dedc8"
down_revision = "941e1251ad74"
branch_labels = None
depends_on = None

TABLE = "inventory_nfc_tags"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table(TABLE):
        return

    op.create_table(
        TABLE,
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(length=36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "item_id",
            sa.String(length=36),
            sa.ForeignKey("inventory_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("uid_hash", sa.String(length=64), nullable=False),
        sa.Column("uid_preview", sa.String(length=8), nullable=False),
        sa.Column(
            "credential_type",
            sa.Enum("serial", "written", name="nfccredentialtype"),
            nullable=False,
            server_default="serial",
        ),
        sa.Column("label", sa.String(length=100), nullable=True),
        sa.Column(
            "status",
            sa.Enum("active", "lost", name="inventorynfctagstatus"),
            nullable=False,
            server_default="active",
        ),
        sa.Column(
            "linked_by",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "linked_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
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
            "organization_id", "uid_hash", name="uq_inventory_nfc_tag_org_uid"
        ),
    )
    op.create_index("ix_inventory_nfc_tags_organization_id", TABLE, ["organization_id"])
    op.create_index("ix_inventory_nfc_tags_item_id", TABLE, ["item_id"])
    op.create_index(
        "idx_inventory_nfc_tag_org_item", TABLE, ["organization_id", "item_id"]
    )


def downgrade() -> None:
    # Dropping the table drops its indexes and constraints with it. The tag
    # links are lost; the physical tags and the items they sit on are not.
    op.execute(f"DROP TABLE IF EXISTS {TABLE}")
