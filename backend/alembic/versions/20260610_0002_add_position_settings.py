"""Add settings JSON to positions for per-position UI preferences

Stores per-position preferences such as the inventory label printer/size a
role uses (so a Quartermaster keeps a Rollo, Training keeps a Dymo, etc.,
independent of which computer is used).

Revision ID: 20260610_0002
Revises: 20260610_0001
Create Date: 2026-06-10 01:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260610_0002"
down_revision = "20260610_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # This runs BEFORE 20260805_0008 renames `roles` to `positions`, so the
    # table this names does not exist yet and the guard below always fires:
    # on every upgrade path this revision is inert. The models were renamed
    # long before the database was, which is why it was written against the
    # model name. The body stays as it ran -- an already-deployed migration is
    # not edited to change its behaviour (AGENTS.md).
    #
    # Nothing supersedes this one, and nothing needs to. `positions.settings`
    # is added by 20260805_0008's own fallback on the chain path, and by
    # `create_all` from the model everywhere else, so the column exists either
    # way. Do not delete that fallback on the assumption this revision covers
    # it: this revision covers nothing.
    from sqlalchemy import inspect

    if "positions" not in inspect(op.get_bind()).get_table_names():
        return

    op.add_column("positions", sa.Column("settings", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("positions", "settings")
