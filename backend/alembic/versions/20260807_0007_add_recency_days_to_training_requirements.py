"""add recency_days freshness window to training_requirements

A completion older than ``recency_days`` no longer counts toward the
requirement. Lets a recruit pipeline demand "CPR taken within the last 180
days" while the department's own CPR requirement stays a one-time item.

NULL (the default, and the value every existing row gets) means any completion
counts however old — the behavior before this column existed.

Originally numbered ``20260807_0004``, which collided with
``add_program_enrollment_notes`` — the revision ``20260807_0003`` had just been
written to repair an identical collision one number earlier. Both files
declared ``20260807_0004`` off ``20260807_0003``, which leaves the graph
unresolvable again. Moved to the end of the chain rather than renumbering the
other side, since that one is what the repair commit established and other
revisions already build on it. Adding a nullable column is order-independent,
so nothing below this point matters.

Revision ID: 20260807_0007
Revises: 20260807_0006
Create Date: 2026-08-07 19:05:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260807_0007"
down_revision = "20260807_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "training_requirements",
        sa.Column(
            "recency_days",
            sa.Integer(),
            nullable=True,
            comment=(
                "Freshness window: a completion older than this many days does "
                "not count toward the requirement. NULL = any completion counts "
                "however old."
            ),
        ),
    )


def downgrade() -> None:
    op.drop_column("training_requirements", "recency_days")
