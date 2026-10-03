"""add grandfathering dates to training_requirements

Lets a department change its training standard without turning its existing
roster non-compliant overnight. Three nullable dates:

- ``new_member_cutoff_date`` — members who joined before it are "existing
  members" for this requirement.
- ``existing_member_deadline`` — with a cutoff set: NULL exempts existing
  members outright; a date holds them to the requirement but does not count an
  unmet one against them until it passes.
- ``applies_to_joined_before`` — set on the original when an edit is saved for
  "new members only", so the old standard keeps grading the members who joined
  before the change while a copy grades everyone after.

NULL on all three — the value every existing row gets — is the behavior before
these columns existed: the requirement applies to everyone it matches.

Each step is guarded on the column's absence so a re-run, or a database that
``repair_schema.py`` already patched from the models, is a no-op.

Revision ID: d058b5e7c1f4
Revises: f73b449bdb8b
Create Date: 2026-10-03 01:44:10.870923

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d058b5e7c1f4"
down_revision: Union[str, None] = "f73b449bdb8b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "training_requirements"

_COLUMNS = (
    (
        "new_member_cutoff_date",
        "Members who joined before this date are existing members for this "
        "requirement. NULL = applies to everyone.",
    ),
    (
        "existing_member_deadline",
        "With a cutoff: NULL exempts existing members; a date gives them until "
        "then to meet it.",
    ),
    (
        "applies_to_joined_before",
        "Only members who joined before this date are graded against this "
        "requirement. Set on the original of a new-members-only edit.",
    ),
)


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if not _has_table(_TABLE):
        return
    for name, comment in _COLUMNS:
        if not _has_column(_TABLE, name):
            op.add_column(
                _TABLE,
                sa.Column(name, sa.Date(), nullable=True, comment=comment),
            )


def downgrade() -> None:
    if not _has_table(_TABLE):
        return
    for name, _ in reversed(_COLUMNS):
        if _has_column(_TABLE, name):
            op.drop_column(_TABLE, name)
