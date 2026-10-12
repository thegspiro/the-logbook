"""Link a reversing budget amendment to the amendment it cancels.

Revision ID: c62a98b47406
Revises: 9effb8790488
Create Date: 2026-10-09 01:20:48.671757

A mistaken budget amendment is corrected by a **reversing entry**, never by
editing or deleting it (owner decision, 2026-10-09). The reversal is an
ordinary ``budget_amendments`` row whose ``amount`` is the original's, negated;
this revision adds the one thing that row needs and the table lacks -- a link
to the amendment it reverses:

* ``reverses_amendment_id`` -- nullable, a foreign key to
  ``budget_amendments.id`` with ``ON DELETE SET NULL`` (nullable, as SET NULL
  requires -- CLAUDE.md pitfall #2);
* a UNIQUE constraint on it, so an amendment is reversed at most once.
  InnoDB admits any number of NULLs under a unique key, so every ordinary
  amendment (NULL) is unaffected. The unique index also serves the foreign
  key, so no second index is added.

**Why the step is skipped when ``budget_amendments`` does not exist.** That
table is created by ``ca564ba5a9ad`` only where ``budgets`` already exists,
and ``budgets`` is built by ``create_all()`` and by no migration (CLAUDE.md
pitfall #26). On the empty database CI upgrades, neither is there, and
``create_all`` later builds the table from the model, which already declares
the column, key and constraint. A column that is already present is left
alone, so a re-run changes nothing.

The key and constraint names match the models' naming convention, so a table
built by either path looks the same.

**Downgrade** drops the key, the constraint and the column. Reversal rows stay,
with their negative amounts, and keep reducing ``amount_budgeted`` and the
amendments total exactly as before -- that arithmetic never read the link. What
is lost is which amendment each one reversed; a re-upgrade cannot recover it.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c62a98b47406"
down_revision: Union[str, None] = "9effb8790488"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Module-level so the migration test can aim it at scratch tables. The names
# are spelled out rather than derived, so the test can shorten a prefixed one
# that would otherwise pass MySQL's 64-character limit.
TABLE = "budget_amendments"
COLUMN = "reverses_amendment_id"
FK_REVERSES = "fk_budget_amendments_reverses_amendment_id_budget_amendments"
UQ_REVERSES = "uq_budget_amendments_reverses_amendment_id"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if not _has_table(TABLE) or _has_column(TABLE, COLUMN):
        return
    op.add_column(TABLE, sa.Column(COLUMN, sa.String(36), nullable=True))
    # The unique key first, so the foreign key finds an index to use and
    # MySQL does not build a second one of its own.
    op.create_unique_constraint(UQ_REVERSES, TABLE, [COLUMN])
    op.create_foreign_key(
        FK_REVERSES, TABLE, TABLE, [COLUMN], ["id"], ondelete="SET NULL"
    )


def downgrade() -> None:
    if not _has_table(TABLE) or not _has_column(TABLE, COLUMN):
        return
    inspector = sa.inspect(op.get_bind())
    if FK_REVERSES in {fk["name"] for fk in inspector.get_foreign_keys(TABLE)}:
        op.drop_constraint(FK_REVERSES, TABLE, type_="foreignkey")
    if UQ_REVERSES in {ix["name"] for ix in inspector.get_indexes(TABLE)}:
        op.drop_constraint(UQ_REVERSES, TABLE, type_="unique")
    op.drop_column(TABLE, COLUMN)
