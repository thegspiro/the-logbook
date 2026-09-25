"""NFC phase 4d: a submission id on shelf audits finished offline.

Revision ID: 31e8ad77527b
Revises: ff6730a7db54

``inventory_nfc_audits.client_submission_id`` (nullable) and a unique
constraint on ``(organization_id, client_submission_id)``. An audit finished
while the phone had no signal is sent later from its offline queue; if that
send's response is lost it is sent again, and the constraint makes the second
send return the audit already saved instead of recording it twice. Existing
rows keep NULL, which the unique constraint does not compare.

Each step is guarded, so a table ``create_all`` already built from the current
models is left alone. The downgrade drops the constraint and the column; the
ids it discards were only ever used to spot a repeated send.
"""

import sqlalchemy as sa
from alembic import op

revision = "31e8ad77527b"
down_revision = "ff6730a7db54"
branch_labels = None
depends_on = None

AUDITS = "inventory_nfc_audits"
COLUMN = "client_submission_id"
UNIQUE = "uq_inventory_nfc_audits_client_submission"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def _has_unique(table: str, name: str) -> bool:
    return any(
        u.get("name") == name for u in _inspector().get_unique_constraints(table)
    )


def upgrade() -> None:
    if not _has_table(AUDITS):
        return
    if not _has_column(AUDITS, COLUMN):
        op.add_column(AUDITS, sa.Column(COLUMN, sa.String(length=64), nullable=True))
    if not _has_unique(AUDITS, UNIQUE):
        op.create_unique_constraint(UNIQUE, AUDITS, ["organization_id", COLUMN])


def downgrade() -> None:
    if not _has_table(AUDITS):
        return
    if _has_unique(AUDITS, UNIQUE):
        op.drop_constraint(UNIQUE, AUDITS, type_="unique")
    if _has_column(AUDITS, COLUMN):
        op.drop_column(AUDITS, COLUMN)
