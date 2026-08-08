"""Add the void trail to skill_tests and an index for the practice purge

Official skill-test results are evaluation records a member's certification can
rest on, so they are no longer deletable. Withdrawing one now means voiding it:
the row survives carrying who voided it, when, and why, while dropping out of
pass-rate/statistics math and releasing any training-pipeline requirement the
pass had credited.

Practice attempts keep the opposite lifecycle — they are throwaway drill notes
that auto-purge after a year — so this also adds the composite index the purge
job sweeps on.

Revision ID: 20260807_0005
Revises: 20260807_0004
Create Date: 2026-08-07 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260807_0005"
down_revision = "20260807_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    # skill_tests is a model-only table on some deployments — nothing in the
    # migration chain creates it, and create_all() materializes it with these
    # columns already present. On a fresh chain run (CI) there is nothing to
    # alter, matching 20260227_0300 which added is_practice the same way.
    if not inspector.has_table("skill_tests"):
        return

    columns = {c["name"] for c in inspector.get_columns("skill_tests")}

    if "voided_at" not in columns:
        op.add_column(
            "skill_tests",
            sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        )
    if "voided_by" not in columns:
        op.add_column(
            "skill_tests",
            sa.Column("voided_by", sa.String(36), nullable=True),
        )
        op.create_foreign_key(
            "fk_skill_tests_voided_by_users",
            "skill_tests",
            "users",
            ["voided_by"],
            ["id"],
            ondelete="SET NULL",
        )
    if "void_reason" not in columns:
        op.add_column("skill_tests", sa.Column("void_reason", sa.Text(), nullable=True))

    indexes = {i["name"] for i in inspector.get_indexes("skill_tests")}
    if "idx_skill_test_practice_created" not in indexes:
        op.create_index(
            "idx_skill_test_practice_created",
            "skill_tests",
            ["is_practice", "created_at"],
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("skill_tests"):
        return

    indexes = {i["name"] for i in inspector.get_indexes("skill_tests")}
    if "idx_skill_test_practice_created" in indexes:
        op.drop_index("idx_skill_test_practice_created", table_name="skill_tests")

    columns = {c["name"] for c in inspector.get_columns("skill_tests")}
    if "void_reason" in columns:
        op.drop_column("skill_tests", "void_reason")
    if "voided_by" in columns:
        op.drop_constraint(
            "fk_skill_tests_voided_by_users", "skill_tests", type_="foreignkey"
        )
        op.drop_column("skill_tests", "voided_by")
    if "voided_at" in columns:
        op.drop_column("skill_tests", "voided_at")
