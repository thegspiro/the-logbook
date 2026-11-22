"""Re-apply 5a41041e328b where an installation skipped it; merge the two heads

Revision ID: c4e7a9d2f1b8
Revises: 809893462b67, dd939b45d6c0
Create Date: 2026-11-22 13:30:00.000000

``5a41041e328b`` made ``event_requests.contact_email`` nullable and added
``source``, so a coordinator can enter a request from a caller who gave only a
phone number. An installation can be stamped past it without running it: when
any migration fails with "already exists" or "duplicate", startup in
``main.py`` stamps ``alembic_version`` to head and skips every remaining step.
Its column repair then adds ``source`` from the model, but nothing relaxes a
NOT NULL, so ``contact_email`` stays NOT NULL. A phone-only request then fails
the insert with MySQL ``1048 Column 'contact_email' cannot be null``, which the
coordinator sees as "Internal server error". Sitting after head, this revision
runs on that installation's next start.

It repeats ``5a41041e328b``'s upgrade and is a no-op wherever that already ran.
Existing rows (pitfall #35): every one holds an email, because the column was
NOT NULL, and loosening a column cannot fail on them. A table only
``create_all`` builds (pitfall #26) is skipped; the model declares both.

It also joins the two heads ``main`` carried on 2026-11-22, both merges of
``7d2e4b81c5a3`` and ``85680aed8332``.

The downgrade does nothing: the state this revision ensures is the state its
ancestor ``5a41041e328b`` already established, and that revision's own
downgrade is what reverses it.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4e7a9d2f1b8"
down_revision: Union[str, Sequence[str], None] = ("809893462b67", "dd939b45d6c0")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "event_requests"


def _columns() -> dict[str, bool]:
    """Column name -> nullable, or an empty dict when the table is absent."""
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return {}
    return {c["name"]: bool(c["nullable"]) for c in inspector.get_columns(TABLE)}


def upgrade() -> None:
    columns = _columns()
    if not columns:
        return
    if columns.get("contact_email") is False:
        op.alter_column(
            TABLE,
            "contact_email",
            existing_type=sa.Text(),
            existing_nullable=False,
            nullable=True,
        )
    if "source" not in columns:
        op.add_column(
            TABLE,
            sa.Column(
                "source",
                sa.String(20),
                nullable=False,
                server_default="web",
            ),
        )


def downgrade() -> None:
    """Leave the schema as it is.

    Below this revision the schema is still the one ``5a41041e328b`` defines,
    so undoing the nullable email here would leave a database at
    ``5a41041e328b`` that does not match it. That revision's downgrade reverses
    the change.
    """
