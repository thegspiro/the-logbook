"""Event requests: staff may enter one taken by phone, without an email

Revision ID: 5a41041e328b
Revises: 56377b666eb3
Create Date: 2026-11-20 23:00:00.000000

Owner decision, 2026-11-20: a coordinator can enter an outreach request that
arrived by phone, email or in person, and a caller who gave only a phone number
is still a request. So:

* ``event_requests.contact_email`` becomes nullable. NULL means the requester
  gave no email; every requester email is skipped for such a request. A public
  submission still requires one, in the schema.
* ``event_requests.source`` records how the request arrived: ``web`` (the public
  form, either intake path), ``phone``, ``email``, ``in_person`` or ``other``.
  It is NOT NULL with a server default of ``web``, which is the truth for every
  row already there — until this revision the public form was the only way in.

Existing rows: every one already holds an email (the column was NOT NULL) and
loosening a column cannot fail on them; the new column takes ``web`` from its
server default. Safe to run twice: a nullable column and a present ``source``
are left alone. A table only ``create_all`` builds (CLAUDE.md pitfall #26) is
skipped; it is built from the model, which declares both.

The downgrade drops ``source`` and makes ``contact_email`` NOT NULL again,
which it cannot do while a phone-only request holds NULL (MySQL ``1265 Data
truncated``). It fills those with an empty string first, which the previous
release reads as an address it cannot deliver to: its requester emails to that
request fail and are logged, and nothing else changes. The fill is not undone
by upgrading again, so such a request then reads as having an empty email
rather than none, which every reader of this revision treats the same way.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5a41041e328b"
down_revision: Union[str, None] = "56377b666eb3"
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
    columns = _columns()
    if not columns:
        return
    if "source" in columns:
        op.drop_column(TABLE, "source")
    if columns.get("contact_email") is True:
        op.execute(
            sa.text(
                f"UPDATE `{TABLE}` SET `contact_email` = '' "
                "WHERE `contact_email` IS NULL"
            )
        )
        op.alter_column(
            TABLE,
            "contact_email",
            existing_type=sa.Text(),
            existing_nullable=True,
            nullable=False,
        )
