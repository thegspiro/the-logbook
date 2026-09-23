"""Add suggestion forwards.

Creates ``suggestion_forwards``: a box reviewer can forward one suggestion to
a member or a position, who then reviews that suggestion only. A separate
revision rather than an edit to ``80e2004cd691``, which is already published
on its branch — an installation that stamped it would never run an edit.

Guarded on the table's absence so a database built by ``create_all`` is a
no-op. The downgrade drops the table and with it every forward; the
suggestions themselves are untouched.

Revision ID: 9cb132ad83dc
Revises: 394600cbfae2
Create Date: 2026-09-23 23:32:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "9cb132ad83dc"
down_revision = "394600cbfae2"
branch_labels = None
depends_on = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table("suggestion_forwards"):
        return
    op.create_table(
        "suggestion_forwards",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("suggestion_id", sa.String(36), nullable=False),
        sa.Column("position_id", sa.String(36), nullable=True),
        sa.Column("user_id", sa.String(36), nullable=True),
        sa.Column("forwarded_by", sa.String(36), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["suggestion_id"], ["suggestions.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["position_id"], ["positions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["forwarded_by"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint(
            "suggestion_id", "position_id", name="uq_suggestion_forward_pos"
        ),
        sa.UniqueConstraint(
            "suggestion_id", "user_id", name="uq_suggestion_forward_user"
        ),
    )
    op.create_index(
        "idx_suggestion_forwards_org_suggestion",
        "suggestion_forwards",
        ["organization_id", "suggestion_id"],
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS suggestion_forwards")
