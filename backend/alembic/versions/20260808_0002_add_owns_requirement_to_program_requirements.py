"""add owns_requirement to program_requirements

Unlinking a requirement from a program deletes the underlying
``training_requirements`` row once nothing else references it, so the library
does not fill up with orphans. That was safe only while the sole way to attach
a requirement to a program was the inline "create a new requirement" form —
every link had created the row it pointed at.

Now that an existing department requirement can be linked into a program phase,
that cleanup would delete a shared requirement (e.g. the department's CPR/BLS
certification) the moment one program stopped using it. ``owns_requirement``
records which links may trigger the cleanup.

Existing rows are backfilled to TRUE: they all came from the inline create
flow, so this preserves the current behavior exactly.

Revision ID: 20260808_0002
Revises: 20260808_0001
Create Date: 2026-08-08 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260808_0002"
down_revision = "20260808_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "program_requirements",
        sa.Column(
            "owns_requirement",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
            comment=(
                "True when this link created the requirement it points at, so "
                "unlinking may delete it. False when an existing department "
                "requirement was linked in and must survive the unlink."
            ),
        ),
    )


def downgrade() -> None:
    op.drop_column("program_requirements", "owns_requirement")
