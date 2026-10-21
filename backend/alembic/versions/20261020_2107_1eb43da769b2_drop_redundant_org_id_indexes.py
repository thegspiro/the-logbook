"""Drop single-column organization_id indexes covered by a composite index.

Revision ID: 1eb43da769b2
Revises: 7c8e6565e05e
Create Date: 2026-10-20 21:07:00

On these three tables the models declared ``index=True`` on
``organization_id`` as well as a composite index that leads with it, so a
fresh install (``create_all``) built ``ix_<table>_organization_id`` in addition
to the composite. Upgraded databases never had it, since no migration created
it. The composite serves every lookup the single-column index could, so this
drops it where it exists rather than adding it where it does not. The
``organization_id`` foreign key keeps the composite as its supporting index.

Both directions check the table and index first, so either kind of database
upgrades and downgrades cleanly.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1eb43da769b2"
down_revision: Union[str, None] = "7c8e6565e05e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("admin_hub_metric_preferences", "facility_documents", "facility_photos")


def _index_state(table: str) -> tuple[bool, bool]:
    """(table exists, its single-column organization_id index exists)."""
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table):
        return False, False
    names = {ix.get("name") for ix in inspector.get_indexes(table)}
    return True, f"ix_{table}_organization_id" in names


def upgrade() -> None:
    for table in _TABLES:
        _, has_index = _index_state(table)
        if has_index:
            op.drop_index(f"ix_{table}_organization_id", table_name=table)


def downgrade() -> None:
    for table in _TABLES:
        has_table, has_index = _index_state(table)
        if has_table and not has_index:
            op.create_index(f"ix_{table}_organization_id", table, ["organization_id"])
