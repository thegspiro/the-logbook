"""Suggestion idea board: publishing and votes

* ``suggestion_boxes.public_board_enabled``, off by default. Every existing
  box keeps working as the private box it was.
* ``suggestions.published_at``, ``published_by``, ``published_title`` and
  ``published_summary``: the reviewer-written copy the board shows in place
  of the submission. All NULL means not published.
* ``suggestion_votes``: one row per member per suggestion.

Every step is guarded, on the table's absence or on the column's absence, so a
fresh install that ran ``create_all`` is not altered twice.

**Downgrade** drops the votes table and the new columns. Every vote and every
published copy is lost; the submissions themselves are untouched.

Revision ID: e79309de6735
Revises: 0010291816fd
Create Date: 2026-09-25 16:23:36.211553

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e79309de6735"
down_revision: Union[str, None] = "0010291816fd"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SUGGESTION_COLUMNS = (
    ("published_at", sa.DateTime(timezone=True)),
    ("published_by", sa.String(36)),
    ("published_title", sa.String(200)),
    ("published_summary", sa.Text()),
)
_PUBLISHED_BY_FK = "fk_suggestions_published_by_users"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _columns(table: str) -> set:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if "public_board_enabled" not in _columns("suggestion_boxes"):
        op.add_column(
            "suggestion_boxes",
            sa.Column(
                "public_board_enabled",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            ),
        )

    existing = _columns("suggestions")
    for name, type_ in _SUGGESTION_COLUMNS:
        if name not in existing:
            op.add_column("suggestions", sa.Column(name, type_, nullable=True))
    if "published_by" not in existing:
        op.create_foreign_key(
            _PUBLISHED_BY_FK,
            "suggestions",
            "users",
            ["published_by"],
            ["id"],
            ondelete="SET NULL",
        )

    if not _has_table("suggestion_votes"):
        op.create_table(
            "suggestion_votes",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), nullable=False),
            sa.Column("suggestion_id", sa.String(36), nullable=False),
            sa.Column("user_id", sa.String(36), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(
                ["organization_id"], ["organizations.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["suggestion_id"], ["suggestions.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.UniqueConstraint(
                "suggestion_id", "user_id", name="uq_suggestion_vote_user"
            ),
        )
        op.create_index(
            "idx_suggestion_votes_org_suggestion",
            "suggestion_votes",
            ["organization_id", "suggestion_id"],
        )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS suggestion_votes")

    existing = _columns("suggestions")
    if "published_by" in existing:
        foreign_keys = {
            fk["name"]
            for fk in sa.inspect(op.get_bind()).get_foreign_keys("suggestions")
        }
        if _PUBLISHED_BY_FK in foreign_keys:
            op.drop_constraint(_PUBLISHED_BY_FK, "suggestions", type_="foreignkey")
    for name, _ in _SUGGESTION_COLUMNS:
        if name in existing:
            op.drop_column("suggestions", name)

    if "public_board_enabled" in _columns("suggestion_boxes"):
        op.drop_column("suggestion_boxes", "public_board_enabled")
