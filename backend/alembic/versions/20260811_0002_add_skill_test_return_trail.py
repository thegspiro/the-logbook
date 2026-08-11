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

Revision ID: 20260811_0002
Revises: 20260811_0001
Create Date: 2026-08-11 09:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260811_0002"
down_revision = "20260811_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    # skill_tests is a model-only table — nothing in the migration chain creates
    # it, and create_all() materializes it with these columns already present.
    # On a fresh chain run (CI) there is nothing to alter. Same guard as
    # 20260807_0005, which added the void trail alongside these.
    if not inspector.has_table("skill_tests"):
        return

    columns = {c["name"] for c in inspector.get_columns("skill_tests")}

    if "returned_at" not in columns:
        op.add_column(
            "skill_tests",
            sa.Column("returned_at", sa.DateTime(timezone=True), nullable=True),
        )
    if "returned_by" not in columns:
        # SET NULL requires nullable — an officer's departure must not erase the
        # fact that a test was returned.
        op.add_column(
            "skill_tests",
            sa.Column("returned_by", sa.String(length=36), nullable=True),
        )
        op.create_foreign_key(
            "fk_skill_test_returned_by",
            "skill_tests",
            "users",
            ["returned_by"],
            ["id"],
            ondelete="SET NULL",
        )
    if "return_reason" not in columns:
        op.add_column(
            "skill_tests", sa.Column("return_reason", sa.Text(), nullable=True)
        )
    if "return_count" not in columns:
        op.add_column(
            "skill_tests",
            sa.Column(
                "return_count",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    if not inspector.has_table("skill_tests"):
        return

    columns = {c["name"] for c in inspector.get_columns("skill_tests")}

    if "returned_by" in columns:
        op.drop_constraint(
            "fk_skill_test_returned_by", "skill_tests", type_="foreignkey"
        )
    for column in ("return_count", "return_reason", "returned_by", "returned_at"):
        if column in columns:
            op.drop_column("skill_tests", column)
