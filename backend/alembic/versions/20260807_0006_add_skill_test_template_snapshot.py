"""Freeze each skill test's template structure at creation time

Criterion identity in a scorecard is positional — ``criterion-{section}-{index}``
— while ``PUT /skills-testing/templates/{id}`` rewrites
``skill_templates.sections`` in place on the one row (the ``version`` counter
increments, but no prior version is retained). Every completed test read its
structure from that live row, so editing a published template retroactively
rewrote finished scorecards: inserting a criterion shifted recorded pass/fail
marks onto neighbouring criteria, and deleting one dropped its recorded result
off the scorecard while leaving it in the stored JSON.

These records back certifications and training-pipeline completion, so the
structure a test was scored against is now copied onto the test itself.

Existing rows are backfilled from their template's current structure. The
structure those tests were originally scored against is unrecoverable — it was
overwritten in place — so the current template is the best available value, and
it is what they already display today. The backfill changes nothing visible; it
freezes them against *future* edits.

Revision ID: 20260807_0006
Revises: 20260807_0005
Create Date: 2026-08-07 13:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260807_0006"
down_revision = "20260807_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # skill_tests is a model-only table on some deployments — create_all()
    # materializes it with this column already present, so a fresh chain run
    # (CI) has nothing to alter. Matches 20260227_0300 and 20260807_0005.
    if not inspector.has_table("skill_tests"):
        return

    columns = {c["name"] for c in inspector.get_columns("skill_tests")}
    if "template_snapshot" not in columns:
        op.add_column(
            "skill_tests",
            sa.Column("template_snapshot", sa.JSON(), nullable=True),
        )

    if not inspector.has_table("skill_templates"):
        return

    # Backfill. JSON_OBJECT keeps the shape identical to what create_test
    # writes, so readers need only one code path.
    op.execute(sa.text("""
            UPDATE skill_tests st
            JOIN skill_templates t ON st.template_id = t.id
            SET st.template_snapshot = JSON_OBJECT(
                'version', t.version,
                'sections', t.sections,
                'passing_percentage', t.passing_percentage,
                'require_all_critical', t.require_all_critical,
                'time_limit_seconds', t.time_limit_seconds
            )
            WHERE st.template_snapshot IS NULL
            """))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("skill_tests"):
        return
    if "template_snapshot" in {c["name"] for c in inspector.get_columns("skill_tests")}:
        op.drop_column("skill_tests", "template_snapshot")
