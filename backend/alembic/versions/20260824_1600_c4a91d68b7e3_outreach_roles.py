"""Give community outreach events their own roles.

Revision ID: c4a91d68b7e3
Revises: b8f2c05d7a91

An outreach signup sheet was staffed with crew seats — firefighter, driver,
officer — which is the wrong vocabulary for a school visit: nobody is riding a
seat on an engine, and "Driver" tells a member nothing about what they would
actually be doing. Roles (tour guide, educator, facilitator) are configurable
per department in event settings; these two columns are where a sheet's needs
and a member's chosen role are recorded.

``event_requests.staffing_roles`` holds the composition —
``[{"role": "tour_guide", "count": 2}, …]``.

``shift_assignments.outreach_role`` holds the role one member took. It is a
VARCHAR rather than a value added to the ``position`` ENUM on purpose:
``app/utils/enum_normalization`` rewrites that column's labels to exactly the
``ShiftPosition`` values at startup, so a role stored there would be rejected by
the column or erased by that pass. ``position`` stays ``volunteer`` on these
seats, which keeps capacity, eligibility and coverage reading the sheet as the
ordinary open shift it is.

Both are nullable with no backfill. NULL means "a duty shift, or a sheet opened
before roles existed", which is true of every row written before this migration
— an existing sheet keeps its plain volunteer seats and simply shows no role.
"""

import sqlalchemy as sa
from alembic import op

revision = "c4a91d68b7e3"
down_revision = "b8f2c05d7a91"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if not _has_column("event_requests", "staffing_roles"):
        op.add_column(
            "event_requests",
            sa.Column("staffing_roles", sa.JSON(), nullable=True),
        )
    if not _has_column("shift_assignments", "outreach_role"):
        op.add_column(
            "shift_assignments",
            sa.Column("outreach_role", sa.String(length=100), nullable=True),
        )


def downgrade() -> None:
    if _has_column("shift_assignments", "outreach_role"):
        op.drop_column("shift_assignments", "outreach_role")
    if _has_column("event_requests", "staffing_roles"):
        op.drop_column("event_requests", "staffing_roles")
