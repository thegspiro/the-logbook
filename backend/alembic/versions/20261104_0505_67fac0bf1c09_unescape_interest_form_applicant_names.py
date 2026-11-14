"""Unescape applicant names copied HTML-escaped from interest forms

``FormsService`` HTML-escapes every answer it stores, and until 2026-11-04 the
membership-interest mapping copied those escaped answers straight onto the
new applicant, so "O'Brien" was stored as ``O&#x27;Brien`` and "Smith & Sons"
as ``Smith &amp; Sons`` -- and every pipeline screen, which escapes on its own
as React renders, showed the entities. The mapping now unescapes before it
writes; this revision converts the records written before that, once (owner
decision 2026-11-01, "Backfill existing records").

**Columns.** The plain-text ``prospective_members`` columns the mapping
filled from an answer: ``first_name``, ``last_name``, ``interest_reason`` and
``referral_source``. The other mapped columns (``email``, ``phone``,
``mobile``, the address) are encrypted at rest and are not touched here: a
migration cannot read them without the application's key handling, and
``email_hash`` is derived from the stored email. That remainder is recorded
in ``docs/KNOWN_LIMITATIONS.md``.

**Which values.** Only a value that is exactly what ``html.escape`` produces
from some text, and whose unescaped form contains no further entity:

- it must contain one of the five entities ``html.escape`` writes
  (``&amp;`` ``&lt;`` ``&gt;`` ``&quot;`` ``&#x27;``), so a name with a bare
  ``&`` or one typed by a coordinator is left alone;
- re-escaping the unescaped text must give the stored value back, so a value
  mixing a raw quote with an entity -- one somebody edited by hand -- is left
  alone, and so is a value cut mid-entity by the old length limit;
- the unescaped text must contain no entity. ``&amp;amp;`` is what an
  applicant typing ``&amp;`` produced, but it is equally a value escaped twice;
  converting it once would leave ``&amp;``, which a second run would convert
  again. Such a value is left as it is and counted in the log, so the
  revision is idempotent: running it again changes nothing more.

A coordinator-typed name that genuinely contains an entity sequence (a literal
``AT&amp;T``) is indistinguishable from an escaped one and is converted; no
such name is known, and the owner accepted that trade in choosing the
backfill.

**Irreversible by design.** The escaped form carried nothing the plain text
does not -- ``html.escape`` is a pure function of it -- and restoring it would
only reintroduce the defect. Downgrade changes no rows.

Guarded on the table and each column (Pitfall #26): CI upgrades an empty
database before ``create_all`` runs.

Revision ID: 67fac0bf1c09
Revises: d6906e3dd76c
Create Date: 2026-11-04 05:05:14.180743

"""

import html
import logging
import re
from typing import Dict, Optional, Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "67fac0bf1c09"
down_revision: Union[str, None] = "d6906e3dd76c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")

TABLE = "prospective_members"
COLUMNS = ("first_name", "last_name", "interest_reason", "referral_source")

# Frozen on purpose: a migration must keep transforming rows the way it did
# the day it ran, so these are inlined rather than imported.
_ESCAPE_ENTITY = re.compile(r"&(?:amp|lt|gt|quot|#x27);")


def _plain_text(value: object) -> Optional[str]:
    """The text ``value`` is the HTML-escaped form of, or None to leave it."""
    if not isinstance(value, str) or not _ESCAPE_ENTITY.search(value):
        return None
    plain = html.unescape(value)
    if html.escape(plain) != value:
        return None
    if _ESCAPE_ENTITY.search(plain):
        return None
    return plain


def _backfill(conn: sa.engine.Connection) -> Dict[str, int]:
    """Convert the escaped values in ``conn``'s database; returns counts."""
    counts = {"rows": 0, "values": 0, "ambiguous": 0}
    inspector = sa.inspect(conn)
    if TABLE not in inspector.get_table_names():
        return counts
    present = {c["name"] for c in inspector.get_columns(TABLE)}
    columns = [c for c in COLUMNS if c in present]
    if not columns:
        return counts

    # "&" is not a LIKE wildcard, so this only narrows the scan to rows that
    # could hold an entity; _plain_text makes the actual decision.
    where = " OR ".join(f"{c} LIKE '%&%;%'" for c in columns)
    rows = conn.execute(
        sa.text(f"SELECT id, {', '.join(columns)} FROM {TABLE} WHERE {where}")
    ).mappings()

    updates = []
    for row in rows:
        changed: Dict[str, str] = {}
        for column in columns:
            value = row[column]
            plain = _plain_text(value)
            if plain is not None:
                changed[column] = plain
            elif isinstance(value, str) and _ESCAPE_ENTITY.search(value):
                counts["ambiguous"] += 1
        if changed:
            updates.append((row["id"], changed))

    for row_id, changed in updates:
        assignments = ", ".join(f"{c} = :{c}" for c in changed)
        conn.execute(
            sa.text(f"UPDATE {TABLE} SET {assignments} WHERE id = :row_id"),
            {**changed, "row_id": row_id},
        )
        counts["rows"] += 1
        counts["values"] += len(changed)
    return counts


def upgrade() -> None:
    counts = _backfill(op.get_bind())
    if counts["rows"] or counts["ambiguous"]:
        logger.info(
            "Unescaped %s value(s) on %s applicant record(s); left %s "
            "ambiguous value(s) as they were.",
            counts["values"],
            counts["rows"],
            counts["ambiguous"],
        )


def downgrade() -> None:
    """Irreversible data backfill; see the module docstring.

    The escaped form is a pure function of the plain text and restoring it
    would only bring the defect back, so the rows are left as they are.
    """
    return
