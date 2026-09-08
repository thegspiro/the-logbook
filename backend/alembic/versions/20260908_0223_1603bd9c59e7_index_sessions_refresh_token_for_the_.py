"""Index sessions.refresh_token for the hot refresh lookup

Revision ID: 1603bd9c59e7
Revises: b1e7c3a92f45
Create Date: 2026-09-08 02:23:30.364831

`AuthService.refresh_access_token` filters on `UserSession.refresh_token` on
every token-refresh request -- the single busiest query against this table --
but only its sibling `previous_refresh_token` (the short-lived rotation-grace
column) carried an index. A security-review pass (AUTH-01, AUTH-17) had
assumed both token columns were indexed when reasoning that unbounded session
growth (no reaper exists yet, tracked separately) "doesn't degrade a lookup";
that assumption was wrong for this column, so a growing `sessions` table with
no reaper turns every refresh into a full-table scan, not just extra storage.

Purely additive: one index, no data change, no behavior change.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1603bd9c59e7"
down_revision: Union[str, None] = "b1e7c3a92f45"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "sessions"
_INDEX = "ix_sessions_refresh_token"


def _index_exists(name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return name in {ix["name"] for ix in inspector.get_indexes(_TABLE)}


def upgrade() -> None:
    if not _index_exists(_INDEX):
        op.create_index(_INDEX, _TABLE, ["refresh_token"])


def downgrade() -> None:
    if _index_exists(_INDEX):
        op.drop_index(_INDEX, table_name=_TABLE)
