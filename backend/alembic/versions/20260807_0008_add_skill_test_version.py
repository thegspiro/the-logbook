"""Add an optimistic-concurrency counter to skill_tests

``skill_tests`` carried no version column and no ETag, so concurrent writes were
last-write-wins with no detection. Two examiners on one test, or an officer
editing the scorecard in the admin UI while a phone still holds unsaved
criteria, silently lost one side's work — and the losing side got a success
response.

An integer counter rather than reusing ``updated_at``: MySQL DATETIME stores no
fractional seconds by default, so two writes inside the same second compare
equal and the conflict would go undetected. Autosave plus a manual save is
exactly that case.

Existing rows start at 1. A client that sends no expected version keeps the old
last-write-wins behavior, so this is additive.

Revision ID: 20260807_0008
Revises: 20260807_0007
Create Date: 2026-08-08 00:30:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260807_0008"
down_revision = "20260807_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    # skill_tests is a model-only table on some deployments — create_all()
    # materializes it with this column already present. Matches 20260227_0300,
    # 20260807_0005 and 20260807_0006.
    if not inspector.has_table("skill_tests"):
        return

    if "version" in {c["name"] for c in inspector.get_columns("skill_tests")}:
        return

    op.add_column(
        "skill_tests",
        sa.Column(
            "version",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
    )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("skill_tests"):
        return
    if "version" in {c["name"] for c in inspector.get_columns("skill_tests")}:
        op.drop_column("skill_tests", "version")
