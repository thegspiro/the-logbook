"""add resume_count to skill_tests

The examiner's clock lives in memory and is restored from elapsed_seconds when
a test is reopened, so a resumed evaluation counts on from the last save rather
than from a stopwatch that ran continuously. Time between that save and the
interruption is missing; time spent getting back into the test is not.

For an untimed sheet that is immaterial. For a timed evolution — where the
duration may itself be the criterion — the recorded seconds stop being
evidence, and nothing said so.

This records the fact so the duration can be marked unverified wherever it is
shown. Deliberately not an attempt to correct the figure: there is no honest
way to reconstruct what the stopwatch would have read, and a corrected-looking
number is worse than one openly marked uncertain.

Revision ID: 20260812_0002
Revises: 20260812_0001
Create Date: 2026-08-11 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260812_0002"
down_revision = "20260812_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("skill_tests"):
        return
    if "resume_count" in {c["name"] for c in inspector.get_columns("skill_tests")}:
        return

    op.add_column(
        "skill_tests",
        sa.Column(
            "resume_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("skill_tests") and "resume_count" in {
        c["name"] for c in inspector.get_columns("skill_tests")
    }:
        op.drop_column("skill_tests", "resume_count")
