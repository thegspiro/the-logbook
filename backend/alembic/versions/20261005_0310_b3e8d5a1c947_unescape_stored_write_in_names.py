"""elections: store write-in names as typed, unescaping the older rows

W50-42: write-in names were HTML-escaped into ``candidates.name`` until S15
(3de83db), so names saved before it hold ``&lt;``, ``&#x27;`` and the like and
render that way on the Candidates tab, the results and the certified PDF.
S15 stores the name as typed; this settles the rows already there (CLAUDE.md
pitfall 20). Owner decision: ship the backfill.

Every write-in whose name changes under ``html.unescape`` is rewritten and its
id logged. There is no reliable cut-off date, since an installation may have
deployed S15 well after it was committed, so the step cannot tell a pre-S15
row from a later one that a voter typed with a literal entity in it. That
case (a write-in name typed as ``&amp;``) is accepted: it is far rarer than
the escaped rows this repairs, and the result is still a readable name.

The unescaped name is cut to the column's 200 characters; unescaping only
ever shortens a string, so in practice nothing is cut.

Irreversible by design: the escaped form was a display bug, not data, so the
downgrade does nothing. Idempotent: an unescaped name unescapes to itself
unless it still contains an entity.

Revision ID: b3e8d5a1c947
Revises: 9a4c1e7b5d22
Create Date: 2026-10-05 03:10:00

"""

import html
import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3e8d5a1c947"
down_revision: Union[str, None] = "9a4c1e7b5d22"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")

_NAME_LENGTH = 200


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "candidates" not in inspector.get_table_names():
        return
    columns = {c["name"] for c in inspector.get_columns("candidates")}
    if not {"name", "is_write_in"} <= columns:
        return

    candidates = sa.table(
        "candidates",
        sa.column("id"),
        sa.column("name"),
        sa.column("is_write_in"),
    )
    rows = bind.execute(
        sa.select(candidates.c.id, candidates.c.name).where(
            candidates.c.is_write_in.is_(sa.true()),
            candidates.c.name.contains("&", autoescape=True),
        )
    ).all()

    changed = []
    for candidate_id, name in rows:
        plain = html.unescape(name)[:_NAME_LENGTH]
        if plain != name:
            bind.execute(
                sa.update(candidates)
                .where(candidates.c.id == candidate_id)
                .values(name=plain)
            )
            changed.append(str(candidate_id))
    if changed:
        logger.warning(
            "W50-42: unescaped %d stored write-in name(s): %s",
            len(changed),
            ", ".join(changed),
        )


def downgrade() -> None:
    # The escaped form was a display bug, not data; see the docstring.
    pass
