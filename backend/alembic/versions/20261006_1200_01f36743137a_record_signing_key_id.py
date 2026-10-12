"""Record which key signed each audit row and ballot

Until 2026-10-06 the shipped compose files did not pass
``AUDIT_LOG_SIGNING_KEY`` (and, on the Unraid files, ``VOTE_SIGNING_KEY``)
through to the backend, so installs that set either key in ``.env`` signed
with the ``SECRET_KEY`` fallback. Once the key arrives, those rows must keep
verifying (owner decision, 2026-10-06) without ``SECRET_KEY`` becoming a
permanent second key.

``audit_logs.signing_key_id`` and ``votes.signing_key_id`` hold a 16-hex
fingerprint of the key that signed the row — an HMAC of a fixed label under
the key, never the key or anything it can be recovered from. New rows record
it; verification then checks a row only against the key it names, and accepts
``SECRET_KEY`` only for rows before the first one recording the dedicated key.

Existing rows are left NULL. Nothing is backfilled and no stored hash or
signature is rewritten: which key signed a pre-existing row is exactly what
is not known, and the verifier treats NULL as "the dedicated key, else
``SECRET_KEY``" under the same cut-over bound.

The downgrade drops both columns. The fingerprints on rows written since are
lost, and the older verifier, which ignores them, checks every row against the
current key as before.

Revision ID: 01f36743137a
Revises: 4e8b1c6d2a90
Create Date: 2026-10-06 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "01f36743137a"
down_revision: Union[str, None] = "4e8b1c6d2a90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMN = "signing_key_id"
_TABLES = ("audit_logs", "votes")


def _columns(table: str) -> set:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    for table in _TABLES:
        columns = _columns(table)
        # No table: create_all builds it later from the model, column included.
        if not columns or _COLUMN in columns:
            continue
        op.add_column(table, sa.Column(_COLUMN, sa.String(16), nullable=True))


def downgrade() -> None:
    for table in _TABLES:
        if _COLUMN in _columns(table):
            op.drop_column(table, _COLUMN)
