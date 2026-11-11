"""Budget requests: a draft may have no amount or justification yet

Revision ID: 0136dd6d4144
Revises: 09f0171ccf5e
Create Date: 2026-11-11 13:20:00.000000

Owner decision, 2026-11-11: a budget request draft saves without an amount or
a justification, under the save rule of 2026-11-05 that a draft always saves.
Submitting still needs both, and the service refuses a submit, or an edit of
a submitted request, that would leave either empty. So
``budget_requests.requested_amount`` and ``budget_requests.justification``
become nullable; NULL means "a draft the owner has not filled in yet".

Existing rows: every one already holds both values (the columns were NOT
NULL), and loosening a column cannot fail on them, so nothing is rewritten.
Safe to run twice: a column already nullable is left alone. A table only
``create_all`` builds (CLAUDE.md pitfall #26) is skipped; it is built from the
model, which declares the columns nullable.

The downgrade makes both NOT NULL again, which it cannot do while a draft
holds NULL (MySQL ``1265 Data truncated``). It fills those drafts first: a
missing amount becomes 0.00 and a missing justification an empty string,
which the previous release reads and shows. Only drafts can hold NULL, so no
submitted or decided request is touched, but the fill is not reversed by
upgrading again: a draft downgraded and upgraded reads $0.00 rather than
"not entered", until its owner changes it.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0136dd6d4144"
down_revision: Union[str, None] = "09f0171ccf5e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "budget_requests"

# What the downgrade writes into a blank draft so NOT NULL can return.
_COLUMNS = (
    ("requested_amount", sa.Numeric(12, 2), "0.00"),
    ("justification", sa.Text(), ""),
)


def _nullable() -> dict[str, bool]:
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return {}
    return {c["name"]: bool(c["nullable"]) for c in inspector.get_columns(TABLE)}


def upgrade() -> None:
    nullable = _nullable()
    for name, type_, _fill in _COLUMNS:
        if name in nullable and not nullable[name]:
            op.alter_column(
                TABLE, name, existing_type=type_, existing_nullable=False, nullable=True
            )


def downgrade() -> None:
    nullable = _nullable()
    for name, type_, fill in _COLUMNS:
        if not nullable.get(name):
            continue
        op.execute(
            sa.text(
                f"UPDATE `{TABLE}` SET `{name}` = :fill WHERE `{name}` IS NULL"
            ).bindparams(fill=fill)
        )
        op.alter_column(
            TABLE, name, existing_type=type_, existing_nullable=True, nullable=False
        )
