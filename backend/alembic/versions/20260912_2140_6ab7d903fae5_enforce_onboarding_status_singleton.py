"""Enforce the onboarding_status singleton, and collapse rows that broke it.

Revision ID: 6ab7d903fae5
Revises: 0533644945cd
Create Date: 2026-09-12 21:40:47.281102

``OnboardingStatus`` has always documented "only one row should exist in this
table" and nothing enforced it. ``OnboardingService.start_onboarding`` is a
read-then-write with no lock, so two concurrent ``POST /onboarding/start``
calls both read "none exists" and both insert -- and the wizard's own page load
issues them in parallel, so an ordinary first run reaches it.

The second row is not itself the damage. ``needs_onboarding()`` read the table
with ``scalar_one_or_none()``, which raises ``MultipleResultsFound`` the moment
two rows match, so ``GET /api/v1/onboarding/status`` returned 500 permanently
and setup could not continue. Recovery needed direct database access at the one
moment no account exists to sign in with: the System Owner is not created until
a later step, and ``/onboarding/reset`` authenticates against the same broken
state. See ONBOARD-7 in ``docs/KNOWN_LIMITATIONS.md``.

**Order matters here and is the whole reason this is not two lines.** The
unique index cannot be created over a table that already holds duplicates, and
the installations that most need this migration are exactly the ones that do.
So: collapse first, then constrain.

**Which row survives.** Losing recorded progress is the harm worth avoiding, so
the survivor is chosen, in order:

1. a **completed** row, if any -- setup is finished, and that is the fact the
   application acts on. A stray in-progress row beside it is noise;
2. otherwise the **furthest-progressed** row (highest ``current_step``), which
   is where the operator's answers actually went;
3. ties break on the **oldest** ``created_at``, then ``id`` -- deterministic,
   and it keeps the run the operator started rather than an accidental twin.

Deleting the losers is safe in a way it would not be for most tables: the rows
are duplicates of a singleton, the survivor carries the progress, and a row
that loses on every one of those three keys holds strictly less than the one
that wins.

**Reversible.** The downgrade drops the index and the column, restoring the
prior shape exactly. It cannot resurrect the collapsed duplicate rows, which is
stated rather than hidden -- but those rows were the defect, not data: each was
a partial copy of a singleton whose existence broke the endpoint that reads it.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6ab7d903fae5"
down_revision: Union[str, None] = "0533644945cd"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "onboarding_status"
INDEX = "uq_onboarding_status_singleton"


def _column_exists(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _index_exists(bind, table: str, name: str) -> bool:
    inspector = sa.inspect(bind)
    if name in {i["name"] for i in inspector.get_indexes(table)}:
        return True
    # A UniqueConstraint created by create_all() is reported as a constraint
    # rather than an index on MySQL, so both have to be checked or a fresh
    # install -- which builds this table from the models -- would try to add an
    # index it already has.
    return name in {
        c["name"] for c in inspector.get_unique_constraints(table) if c.get("name")
    }


def upgrade() -> None:
    bind = op.get_bind()

    # 1. Collapse duplicates. Runs before the column exists, so it is keyed on
    #    the columns the old shape already had.
    survivor = bind.execute(sa.text(f"""
            SELECT id FROM {TABLE}
            ORDER BY is_completed DESC,
                     current_step DESC,
                     created_at ASC,
                     id ASC
            LIMIT 1
            """)).scalar()

    if survivor is not None:
        bind.execute(
            sa.text(f"DELETE FROM {TABLE} WHERE id <> :keep"), {"keep": survivor}
        )

    # 2. Add the discriminator. Always 1; it exists only to hang the unique
    #    index on, since the table has no natural key to constrain.
    if not _column_exists(bind, TABLE, "singleton"):
        op.add_column(
            TABLE,
            sa.Column(
                "singleton",
                sa.Integer(),
                nullable=False,
                server_default="1",
            ),
        )
    else:
        # Present already on a fresh install built by create_all(); make sure
        # the value is the one the index will constrain.
        bind.execute(sa.text(f"UPDATE {TABLE} SET singleton = 1"))

    # 3. Constrain it. From here a second INSERT is an IntegrityError the
    #    service recovers from, rather than a duplicate nobody notices until a
    #    reader falls over.
    if not _index_exists(bind, TABLE, INDEX):
        op.create_unique_constraint(INDEX, TABLE, ["singleton"])


def downgrade() -> None:
    bind = op.get_bind()

    if _index_exists(bind, TABLE, INDEX):
        op.drop_constraint(INDEX, TABLE, type_="unique")

    if _column_exists(bind, TABLE, "singleton"):
        op.drop_column(TABLE, "singleton")
