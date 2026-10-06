"""training requirement certification name match cutoff

A CERTIFICATION requirement was satisfied by any completed record whose course
name contained the requirement's name, so a "CPR Refresher" event credited a
"CPR" certification. The owner chose to keep that name match for legacy
records only: a record completed on or before
``training_requirements.name_match_until`` may still satisfy the requirement by
name; anything later needs a linked course, the requirement's training type or
its registry code.

Backfill: every requirement that exists when this runs gets the date it runs
(UTC), so the cut-off is the day this installation's matching rule changed —
not a fixed date that would strip name credit from records completed between
that date and a later upgrade, while the old rule was still live and its
figures were being published. Requirements created afterwards keep NULL, which
means no name matching at all: they were configured with the course picker
and have no published standing that relied on the old rule. A fresh install
builds the table from the model and so starts with no name matching either.

The downgrade drops the column; the previous code does not read it and
name-matches every record, as it did before.

Revision ID: 60aaf273de27
Revises: f16b004db34e
Create Date: 2026-10-05 23:29:31.173364

"""

from datetime import datetime, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "60aaf273de27"
down_revision: Union[str, None] = "f16b004db34e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "training_requirements"
_COLUMN = "name_match_until"


def _columns() -> set:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(_TABLE)}


def upgrade() -> None:
    columns = _columns()
    # No table: create_all builds it later from the model, column included,
    # and there are no existing requirements to backfill.
    if not columns:
        return
    if _COLUMN not in columns:
        op.add_column(_TABLE, sa.Column(_COLUMN, sa.Date(), nullable=True))
    # Also runs when repair_schema added the column first: those rows are
    # still the installation's existing requirements.
    op.execute(
        sa.text(
            f"UPDATE {_TABLE} SET {_COLUMN} = :cutoff WHERE {_COLUMN} IS NULL"
        ).bindparams(cutoff=datetime.now(timezone.utc).date())
    )


def downgrade() -> None:
    if _COLUMN in _columns():
        op.drop_column(_TABLE, _COLUMN)
