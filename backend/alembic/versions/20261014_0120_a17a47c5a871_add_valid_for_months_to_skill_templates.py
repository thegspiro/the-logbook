"""Add valid_for_months to skill_templates

A skills test had no notion of lapsing, so a pass could never appear in a
member's upcoming list. ``valid_for_months`` is how long a passing official
test stays valid, counted from the day it was taken. NULL means the skill does
not lapse, which is every existing template, so nothing changes until a
template is given a period.

skill_templates is a model-only table on some deployments (create_all builds it
from the model, which already declares the column), so both steps are guarded.

Revision ID: a17a47c5a871
Revises: 70070d86ff27
Create Date: 2026-10-14 01:20:04.266263

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a17a47c5a871"
down_revision: Union[str, None] = "70070d86ff27"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column() -> bool:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("skill_templates"):
        return False
    return "valid_for_months" in {
        c["name"] for c in inspector.get_columns("skill_templates")
    }


def _has_table() -> bool:
    return sa.inspect(op.get_bind()).has_table("skill_templates")


def upgrade() -> None:
    if _has_table() and not _has_column():
        op.add_column(
            "skill_templates",
            sa.Column("valid_for_months", sa.Integer(), nullable=True),
        )


def downgrade() -> None:
    if _has_column():
        op.drop_column("skill_templates", "valid_for_months")
