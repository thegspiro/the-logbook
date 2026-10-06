"""elections: an empty eligible_voters list means everyone, so store NULL

W50-41: create and update now normalise ``eligible_voters = []`` to NULL, but
rows written before that kept ``[]``. In-app voting reads ``[]`` as
"restricted to nobody" and refuses every vote, while ballot mail and token
votes read it as everyone. Owner decision: settle the stored rows.

Only a stored empty JSON list changes; a NULL or a non-empty list is left
alone. Read in Python rather than with JSON_LENGTH so the step means the same
on MySQL, MariaDB and SQLite.

Irreversible by design: ``[]`` and NULL meant the same thing to every writer
after 7aa3405, and the downgrade has no way to know which rows were ``[]``,
so it does nothing. Idempotent.

Revision ID: 9a4c1e7b5d22
Revises: 80cc1edc1610
Create Date: 2026-10-05 03:00:00

"""

import json
import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9a4c1e7b5d22"
down_revision: Union[str, None] = "80cc1edc1610"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")


def _is_empty_list(value) -> bool:
    if isinstance(value, (bytes, bytearray)):
        value = value.decode()
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return False
    return isinstance(value, list) and not value


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "elections" not in inspector.get_table_names():
        return
    if "eligible_voters" not in {c["name"] for c in inspector.get_columns("elections")}:
        return

    elections = sa.table("elections", sa.column("id"), sa.column("eligible_voters"))
    # Read through plain SQL, so the value arrives as the driver gives it
    # (text on MySQL, MariaDB and SQLite) and _is_empty_list decides. A
    # stored JSON null is not an empty list and is left alone.
    rows = bind.execute(
        sa.text(
            "SELECT id, eligible_voters FROM elections WHERE eligible_voters IS NOT NULL"
        )
    ).all()
    ids = [row[0] for row in rows if _is_empty_list(row[1])]
    if not ids:
        return
    logger.warning(
        "W50-41: %d election(s) stored eligible_voters = [] and now store NULL "
        "(everyone may vote, as ballot mail already assumed): %s",
        len(ids),
        ", ".join(str(i) for i in ids),
    )
    bind.execute(
        sa.update(elections)
        .where(elections.c.id.in_(ids))
        .values(eligible_voters=sa.null())
    )


def downgrade() -> None:
    # Which rows held [] is not kept; see the docstring.
    pass
