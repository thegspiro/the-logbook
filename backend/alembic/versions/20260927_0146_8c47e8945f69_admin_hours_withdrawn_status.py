"""Add withdrawn to the admin_hours entry status enum.

Revision ID: 8c47e8945f69
Revises: b795d1b3401b

A member who logged hours by mistake had no way to take the claim back: the
only exits from ``pending`` were an officer's approve or reject. ``withdrawn``
records that the member retracted the entry themselves, and keeps the row so
the audit trail of what was claimed survives the retraction.

Existing rows are untouched — no entry has ever been withdrawn before this.
"""

import sqlalchemy as sa
from alembic import op

revision = "8c47e8945f69"
down_revision = "b795d1b3401b"
branch_labels = None
depends_on = None

_OLD = ("active", "pending", "approved", "rejected")
_NEW = ("active", "pending", "approved", "rejected", "withdrawn")


def upgrade() -> None:
    # MySQL requires ALTER COLUMN to change enum values.
    op.alter_column(
        "admin_hours_entries",
        "status",
        type_=sa.Enum(*_NEW, name="adminhoursentrystatus"),
        existing_type=sa.Enum(*_OLD, name="adminhoursentrystatus"),
        existing_nullable=False,
        existing_server_default="active",
    )


def downgrade() -> None:
    # The older enum has no value meaning "the member retracted this". A
    # withdrawn entry counts toward nothing, which `rejected` also guarantees,
    # so it is the closest honest fallback; the reason records where it came
    # from. Narrowing the enum with any such row still present would otherwise
    # fail or truncate.
    op.execute(
        sa.text(
            "UPDATE admin_hours_entries SET status = 'rejected', "
            "rejection_reason = COALESCE(rejection_reason, 'Withdrawn by member') "
            "WHERE status = 'withdrawn'"
        )
    )
    op.alter_column(
        "admin_hours_entries",
        "status",
        type_=sa.Enum(*_OLD, name="adminhoursentrystatus"),
        existing_type=sa.Enum(*_NEW, name="adminhoursentrystatus"),
        existing_nullable=False,
        existing_server_default="active",
    )
