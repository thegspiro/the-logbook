"""Add suggestion boxes.

Creates the five tables behind the communications module's suggestion boxes:
``suggestion_boxes``, ``suggestion_box_reviewers``, ``suggestions``,
``suggestion_attachments`` and ``suggestion_messages``.

Every table is new, so each step is guarded on the table's absence: a fresh
install that already ran ``create_all`` (``main.py``'s fast path) has them, and
the migration must then be a no-op rather than fail on a duplicate.

The downgrade drops the tables and therefore every suggestion, screenshot
record and follow-up message stored in them. Screenshot files on disk under
``uploads/suggestions`` are not touched by either direction.

Revision ID: 80e2004cd691
Revises: 6ab7d903fae5
Create Date: 2026-09-23 22:18:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "80e2004cd691"
down_revision = "6ab7d903fae5"
branch_labels = None
depends_on = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table("suggestion_boxes"):
        op.create_table(
            "suggestion_boxes",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), nullable=False),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column(
                "anonymity_mode",
                sa.String(16),
                nullable=False,
                server_default="allowed",
            ),
            sa.Column(
                "follow_up_enabled",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
            sa.Column("created_by", sa.String(36), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(
                ["organization_id"], ["organizations.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.UniqueConstraint(
                "organization_id", "name", name="uq_suggestion_box_org_name"
            ),
        )
        op.create_index(
            "idx_suggestion_boxes_org_active",
            "suggestion_boxes",
            ["organization_id", "is_active"],
        )

    if not _has_table("suggestion_box_reviewers"):
        op.create_table(
            "suggestion_box_reviewers",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), nullable=False),
            sa.Column("box_id", sa.String(36), nullable=False),
            sa.Column("position_id", sa.String(36), nullable=True),
            sa.Column("user_id", sa.String(36), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(
                ["organization_id"], ["organizations.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["box_id"], ["suggestion_boxes.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["position_id"], ["positions.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.UniqueConstraint(
                "box_id", "position_id", name="uq_suggestion_reviewer_pos"
            ),
            sa.UniqueConstraint(
                "box_id", "user_id", name="uq_suggestion_reviewer_user"
            ),
        )

        op.create_index(
            "idx_suggestion_reviewers_org_box",
            "suggestion_box_reviewers",
            ["organization_id", "box_id"],
        )

    if not _has_table("suggestions"):
        op.create_table(
            "suggestions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), nullable=False),
            sa.Column("box_id", sa.String(36), nullable=False),
            sa.Column("is_anonymous", sa.Boolean(), nullable=False),
            sa.Column("submitted_by", sa.String(36), nullable=True),
            sa.Column("follow_up_key_hash", sa.String(64), nullable=True),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("details", sa.Text(), nullable=False),
            sa.Column(
                "disposition", sa.String(32), nullable=False, server_default="new"
            ),
            sa.Column("internal_note", sa.Text(), nullable=True),
            sa.Column("disposition_updated_by", sa.String(36), nullable=True),
            sa.Column(
                "disposition_updated_at", sa.DateTime(timezone=True), nullable=True
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["organization_id"], ["organizations.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["box_id"], ["suggestion_boxes.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["submitted_by"], ["users.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(
                ["disposition_updated_by"], ["users.id"], ondelete="SET NULL"
            ),
            sa.UniqueConstraint("follow_up_key_hash"),
        )
        op.create_index(
            "idx_suggestions_org_box", "suggestions", ["organization_id", "box_id"]
        )
        op.create_index("idx_suggestions_submitter", "suggestions", ["submitted_by"])

    if not _has_table("suggestion_attachments"):
        op.create_table(
            "suggestion_attachments",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), nullable=False),
            sa.Column("suggestion_id", sa.String(36), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("file_name", sa.String(100), nullable=False),
            sa.Column("file_path", sa.String(500), nullable=False),
            sa.Column("content_type", sa.String(50), nullable=False),
            sa.Column("file_size", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["organization_id"], ["organizations.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["suggestion_id"], ["suggestions.id"], ondelete="CASCADE"
            ),
        )
        op.create_index(
            "idx_suggestion_attachments_suggestion",
            "suggestion_attachments",
            ["suggestion_id"],
        )

        op.create_index(
            "idx_suggestion_attachments_org_suggestion",
            "suggestion_attachments",
            ["organization_id", "suggestion_id"],
        )

    if not _has_table("suggestion_messages"):
        op.create_table(
            "suggestion_messages",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), nullable=False),
            sa.Column("suggestion_id", sa.String(36), nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("author_role", sa.String(16), nullable=False),
            sa.Column("author_id", sa.String(36), nullable=True),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["organization_id"], ["organizations.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["suggestion_id"], ["suggestions.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
            sa.UniqueConstraint(
                "suggestion_id", "sequence", name="uq_suggestion_msg_seq"
            ),
        )

        op.create_index(
            "idx_suggestion_messages_org_suggestion",
            "suggestion_messages",
            ["organization_id", "suggestion_id"],
        )


def downgrade() -> None:
    # Children first, so no drop is refused by a foreign key.
    for table in (
        "suggestion_messages",
        "suggestion_attachments",
        "suggestions",
        "suggestion_box_reviewers",
        "suggestion_boxes",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table}")
