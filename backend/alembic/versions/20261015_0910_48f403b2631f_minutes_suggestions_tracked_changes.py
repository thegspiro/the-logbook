"""Minutes suggestions: tracked changes

Adds the columns a tracked suggestion needs to ``minutes_suggestions``:

* ``base_content`` / ``proposed_content`` — the section as the reviewer saw it
  and their edit, as sanitized rich text.
* ``changes`` — the discrete edits between them, each with the secretary's
  decision once made (JSON).
* ``applied_at`` — when the accepted changes were written into the section.

Nothing is backfilled: every earlier suggestion is a comment with optional
wording and keeps NULL in all four. The table may not exist yet on a fresh
database where ``create_all`` builds it from the models (which already declare
these columns), so the step is skipped when it is absent.

The downgrade drops the four columns. Tracked changes already recorded are lost
with them; the comment on each suggestion stays.

Revision ID: 48f403b2631f
Revises: 1d65720bce34
Create Date: 2026-10-15 09:10:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "48f403b2631f"
down_revision: Union[str, None] = "1d65720bce34"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "minutes_suggestions"


def _columns() -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(TABLE)}


def _has_table() -> bool:
    return TABLE in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table():
        return
    existing = _columns()
    if "base_content" not in existing:
        op.add_column(TABLE, sa.Column("base_content", sa.Text(), nullable=True))
    if "proposed_content" not in existing:
        op.add_column(TABLE, sa.Column("proposed_content", sa.Text(), nullable=True))
    if "changes" not in existing:
        op.add_column(TABLE, sa.Column("changes", sa.JSON(), nullable=True))
    if "applied_at" not in existing:
        op.add_column(
            TABLE, sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    if not _has_table():
        return
    existing = _columns()
    for name in ("applied_at", "changes", "proposed_content", "base_content"):
        if name in existing:
            op.drop_column(TABLE, name)
