"""Add users.dashboard_pulse — a member's own Department pulse layout.

The dashboard's Department pulse cards were a fixed list in code. A member can
now show, hide, reorder and rename them, and choose the period the section
opens on. This column stores that choice on the member's account so it follows
them to every device.

Stored shape is a JSON object ``{"period": ..., "cards": [{"id", "visible",
"title"}]}``, written only as a whole by ``PUT /dashboard/pulse-layout``. NULL
means the member has never chosen, and the dashboard uses the department
default (or the built-in layout), so there is nothing to backfill and no
installation's dashboard changes on upgrade. The department default itself
lives in ``organizations.settings`` and needs no migration.

**Reversible.** The downgrade drops the column; a member who had customised
reverts to the department default, which is the only state the old code could
express.

Revision ID: a51a4e1d2443
Revises: 3c9c5025a380
Create Date: 2026-10-12 16:19:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a51a4e1d2443"
down_revision = "3c9c5025a380"
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

    if not _has_column("users", "dashboard_pulse"):
        op.add_column(
            "users",
            sa.Column("dashboard_pulse", sa.JSON(), nullable=True),
        )


def downgrade() -> None:
    if not _has_table("users"):
        return

    if _has_column("users", "dashboard_pulse"):
        op.drop_column("users", "dashboard_pulse")
