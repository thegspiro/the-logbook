"""Add folder access control columns

Adds visibility, owner_user_id, and allowed_roles columns to
document_folders for hierarchical access control. Per-member
folders (under the Members system folder) use visibility='owner'
so only the member and leadership can see them.

Revision ID: 20260215_0100
Revises: 20260214_2200
Create Date: 2026-02-15
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "20260215_0100"
down_revision = "20260214_2200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add visibility enum column with default 'organization' (all existing
    # folders remain visible to the whole org).
    op.add_column(
        "document_folders",
        sa.Column(
            "visibility",
            sa.Enum("organization", "leadership", "owner", name="foldervisibility"),
            nullable=False,
            server_default="organization",
        ),
    )

    # Owner user - when set, combined with visibility='owner' restricts
    # folder access to this user and leadership roles.
    op.add_column(
        "document_folders",
        sa.Column(
            "owner_user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # Optional role restrictions - JSON list of role slugs.
    op.add_column(
        "document_folders",
        sa.Column("allowed_roles", sa.JSON(), nullable=True),
    )

    op.create_index("idx_doc_folders_owner", "document_folders", ["owner_user_id"])


def downgrade() -> None:
    op.drop_index("idx_doc_folders_owner", table_name="document_folders")
    op.drop_column("document_folders", "allowed_roles")
    op.drop_column("document_folders", "owner_user_id")
    op.drop_column("document_folders", "visibility")
    op.execute("DROP TYPE IF EXISTS foldervisibility")
