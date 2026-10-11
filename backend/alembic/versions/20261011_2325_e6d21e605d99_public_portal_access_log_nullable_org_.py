"""Let a public-portal access-log row carry no organization (failed auth)

``public_portal_access_log.organization_id`` and ``config_id`` were NOT NULL,
so a request presenting an API key that matches no stored key — which cannot
be attributed to any department — could not be logged, and the anomaly
detector's failed-authentication count never saw one (security review PUB-8).
The owner chose to make both nullable and log every 401. A row with no
organization is platform-level: every per-organization reader filters on
``organization_id = <caller's org>``, so no department sees it; the detector,
which counts by IP across the table, does.

Both columns keep their foreign keys and ``ON DELETE CASCADE``.

The downgrade deletes the rows with no organization or no config before
restoring NOT NULL — they cannot satisfy the old constraint and there is no
department to give them to. That loses only the platform-level failed-auth
records this revision exists to keep; every attributed row survives.

The table is created by a migration (``20260207_0501``), but each step is
still skipped when it is absent, so a database built another way cannot fail
here.

Revision ID: e6d21e605d99
Revises: 9e8b0b6f3fe8
Create Date: 2026-10-11 23:25:25.076239

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e6d21e605d99"
down_revision: Union[str, None] = "9e8b0b6f3fe8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# A module constant so a test can point the migration at a scratch copy.
TABLE = "public_portal_access_log"
COLUMNS = ("organization_id", "config_id")


def _nullability() -> dict:
    """{column: is_nullable} for the two columns, or {} if the table is absent."""
    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return {}
    return {
        column["name"]: bool(column["nullable"])
        for column in inspector.get_columns(TABLE)
        if column["name"] in COLUMNS
    }


def upgrade() -> None:
    for column, nullable in _nullability().items():
        if not nullable:
            op.alter_column(TABLE, column, existing_type=sa.String(36), nullable=True)


def downgrade() -> None:
    state = _nullability()
    if not state:
        return
    op.execute(
        sa.text(
            f"DELETE FROM {TABLE} WHERE organization_id IS NULL OR config_id IS NULL"
        )
    )
    for column, nullable in state.items():
        if nullable:
            op.alter_column(TABLE, column, existing_type=sa.String(36), nullable=False)
