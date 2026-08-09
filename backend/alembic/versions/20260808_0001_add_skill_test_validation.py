"""Add officer validation trail to skills tests

Official skills tests could only be started by a training officer, which does
not match how departments actually run them: a senior member is often the one
holding the clipboard. Examining is now open to any member, and the authority an
officer holds is moved to a second step — validating the result against the
candidate's account.

Until ``validated_at`` is set, an official test is a submission rather than a
record: no linked pipeline requirement is credited, no attempt against the
requirement's cap is consumed, and the candidate sees it listed as pending
rather than scored. An officer completing a test validates it in the same step,
so the column is NULL only while a peer-run test awaits review.

Existing completed official tests are backfilled as validated by their examiner:
under the old rules only officers could run them, so every one of them already
carries the sign-off this column records. Without the backfill the whole history
would re-appear in the review queue.

Revision ID: 20260808_0001
Revises: 20260807_0009
Create Date: 2026-08-08 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260808_0001"
down_revision = "20260807_0009"
branch_labels = None
depends_on = None


def _columns(inspector, table: str) -> set[str]:
    return {c["name"] for c in inspector.get_columns(table)}


def _indexes(inspector, table: str) -> set[str]:
    return {i["name"] for i in inspector.get_indexes(table)}


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    # skill_tests is a model-only table on some deployments — create_all()
    # materializes it with these columns already present, so a fresh chain run
    # has nothing to alter. Matches 20260227_0300 onward.
    if not inspector.has_table("skill_tests"):
        return

    existing = _columns(inspector, "skill_tests")

    if "validated_at" not in existing:
        op.add_column(
            "skill_tests",
            sa.Column("validated_at", sa.DateTime(timezone=True), nullable=True),
        )
    if "validated_by" not in existing:
        op.add_column(
            "skill_tests",
            sa.Column("validated_by", sa.String(36), nullable=True),
        )
        op.create_foreign_key(
            "fk_skill_tests_validated_by_users",
            "skill_tests",
            "users",
            ["validated_by"],
            ["id"],
            ondelete="SET NULL",
        )

    if "idx_skill_test_org_validation" not in _indexes(inspector, "skill_tests"):
        op.create_index(
            "idx_skill_test_org_validation",
            "skill_tests",
            ["organization_id", "is_practice", "validated_at"],
        )

    # Backfill: every pre-existing official result was officer-run, so it is
    # already validated. completed_at is the moment the sign-off happened;
    # updated_at covers the rare row completed before completed_at was set.
    op.execute(sa.text("""
            UPDATE skill_tests
               SET validated_at = COALESCE(completed_at, updated_at),
                   validated_by = examiner_id
             WHERE validated_at IS NULL
               AND is_practice = 0
               AND status = 'completed'
            """))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    if not inspector.has_table("skill_tests"):
        return

    if "idx_skill_test_org_validation" in _indexes(inspector, "skill_tests"):
        op.drop_index("idx_skill_test_org_validation", table_name="skill_tests")

    existing = _columns(inspector, "skill_tests")
    if "validated_by" in existing:
        op.drop_constraint(
            "fk_skill_tests_validated_by_users", "skill_tests", type_="foreignkey"
        )
        op.drop_column("skill_tests", "validated_by")
    if "validated_at" in existing:
        op.drop_column("skill_tests", "validated_at")
