"""rename the "Membership Committee Chair" system position to "Membership Coordinator"

The role is being renamed to match the terminology used throughout the rest of
the application (interviewer roles, pipeline approver configs, and admin error
messages all already say "Membership Coordinator"). The permission set is
unchanged, so it keeps ``prospective_members.manage`` (view/upload/delete of
prospect documents).

This is an in-place rename of the existing ``positions`` rows. ``user_positions``
links members to positions by ``position_id`` (a UUID that does not change), so
every existing assignment is preserved automatically.

Revision ID: 20260528_0001
Revises: 20260502_0004
Create Date: 2026-05-28 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260528_0001"
down_revision = "20260502_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # This runs BEFORE 20260805_0008 renames `roles` to `positions`, so the
    # table this names does not exist yet and the guard below always fires:
    # on every upgrade path this revision is inert. The models were renamed
    # long before the database was, which is why it was written against the
    # model name. The body stays as it ran (AGENTS.md: an already-deployed
    # migration is not edited to change its behaviour); the repair it was
    # meant to perform is carried by e8a1c04f6b27, which runs at head where
    # the table really is called `positions`.
    from sqlalchemy import inspect

    if "positions" not in inspect(op.get_bind()).get_table_names():
        return

    op.execute(
        sa.text(
            "UPDATE positions "
            "SET slug = 'membership_coordinator', name = 'Membership Coordinator' "
            "WHERE slug = 'membership_committee_chair'"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE positions "
            "SET slug = 'membership_committee_chair', "
            "name = 'Membership Committee Chair' "
            "WHERE slug = 'membership_coordinator'"
        )
    )
