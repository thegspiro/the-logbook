"""Add users.bottom_nav_slots — a member's choice of phone bottom-bar tabs.

The phone bottom bar has two configurable tabs either side of Quick Add. Until
now the choice lived only in the browser's localStorage, and nothing in the app
let a member set it, so every member got their role's defaults. This column
stores the member's own choice on their account, so it follows them to every
device.

Stored shape is a JSON array of up to two app paths, e.g.
``["/events", "/account"]``, written only as a whole by
``PUT /users/me/bottom-navigation``. NULL means the member has never chosen and
the bar keeps its role-based defaults, so there is nothing to backfill and no
installation's bar changes on upgrade.

**Reversible.** The downgrade drops the column; a member who had chosen reverts
to the defaults, which is the only state the old code could express.

Revision ID: 8464e9962f76
Revises: f73b449bdb8b
Create Date: 2026-10-02 22:49:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "8464e9962f76"
down_revision = "f73b449bdb8b"
branch_labels = None
depends_on = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    # Guarded although a migration does create `users`: reflecting an absent
    # table would take down the whole upgrade rather than this step
    # (pitfall #26), and `create_all` builds the column from the model anyway.
    if not _has_table("users"):
        return

    if not _has_column("users", "bottom_nav_slots"):
        op.add_column(
            "users",
            sa.Column("bottom_nav_slots", sa.JSON(), nullable=True),
        )


def downgrade() -> None:
    if not _has_table("users"):
        return

    if _has_column("users", "bottom_nav_slots"):
        op.drop_column("users", "bottom_nav_slots")
