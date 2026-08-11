"""add return-for-correction trail to skill_tests

Voiding was the only way out of a submitted-but-unvalidated result, and the
endpoint documented it as such: "the rejection path is /void". That is right
for a result that was *wrong* — the record survives with its reason, which is
what a candidate who sat the evaluation is owed — and wrong for a result that
was simply not finished properly. "Engine 2's captain mis-scored step 4, have
him redo it" cost a permanent, candidate-visible withdrawal and a second test.

These columns back a third transition: the officer sends the submission back to
its examiner. No void is spent, the marks stay for the examiner to correct, and
nothing has yet been claimed about the candidate.

Revision ID: 20260811_0001
Revises: 20260810_0008
Create Date: 2026-08-11 09:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260811_0001"
down_revision = "20260810_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "skill_tests",
        sa.Column("returned_at", sa.DateTime(timezone=True), nullable=True),
    )
    # SET NULL requires nullable — a departed officer's departure must not erase
    # the fact that a test was returned.
    op.add_column(
        "skill_tests",
        sa.Column("returned_by", sa.String(length=36), nullable=True),
    )
    op.add_column("skill_tests", sa.Column("return_reason", sa.Text(), nullable=True))
    op.add_column(
        "skill_tests",
        sa.Column(
            "return_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.create_foreign_key(
        "fk_skill_test_returned_by",
        "skill_tests",
        "users",
        ["returned_by"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_skill_test_returned_by", "skill_tests", type_="foreignkey")
    op.drop_column("skill_tests", "return_count")
    op.drop_column("skill_tests", "return_reason")
    op.drop_column("skill_tests", "returned_by")
    op.drop_column("skill_tests", "returned_at")
