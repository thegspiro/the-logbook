"""Add nfc_tags: NFC ID card credentials bound to members.

Revision ID: c3b71f0d5a92
Revises: a17c4e9d2b61

The credential is stored only as a peppered SHA-256 hash — a card serial (or a
code written onto a blank tag) is the whole of the credential, so a plaintext
column would make a database dump a stack of working ID cards. ``uid_preview``
holds the last four characters purely so an officer can tell two of a member's
cards apart on screen.

The table is created regardless of whether a department uses cards; the feature
itself is gated by the ``nfc-id-cards`` integration row, which starts off.
"""

import sqlalchemy as sa
from alembic import op

revision = "c3b71f0d5a92"
down_revision = "a17c4e9d2b61"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "nfc_tags",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(length=36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
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
            sa.Enum(
                "active",
                "suspended",
                "lost",
                "revoked",
                name="nfctagstatus",
            ),
            nullable=False,
            server_default="active",
        ),
        sa.Column(
            "issued_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_reason", sa.Text(), nullable=True),
        sa.Column(
            "issued_by",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
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
    )
    op.create_index("ix_nfc_tags_organization_id", "nfc_tags", ["organization_id"])
    op.create_index("ix_nfc_tags_user_id", "nfc_tags", ["user_id"])
    op.create_index("ix_nfc_tags_status", "nfc_tags", ["status"])
    op.create_index("idx_nfc_tag_org_user", "nfc_tags", ["organization_id", "user_id"])
    op.create_unique_constraint(
        "uq_nfc_tag_org_uid", "nfc_tags", ["organization_id", "uid_hash"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_nfc_tag_org_uid", "nfc_tags", type_="unique")
    op.drop_index("idx_nfc_tag_org_user", table_name="nfc_tags")
    op.drop_index("ix_nfc_tags_status", table_name="nfc_tags")
    op.drop_index("ix_nfc_tags_user_id", table_name="nfc_tags")
    op.drop_index("ix_nfc_tags_organization_id", table_name="nfc_tags")
    op.drop_table("nfc_tags")
