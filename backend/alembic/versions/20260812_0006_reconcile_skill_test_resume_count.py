"""Re-add skill_tests.resume_count on databases the renumbering skipped

``20260812_0002`` was originally the prospect-uniqueness migration; the
resume-count migration took that revision id later, when the duplicate was
renumbered. A deployment that upgraded in the window between the two is
stamped ``20260812_0002`` for work that is now attributed to a different file:
Alembic reads the stamp as "resume-count applied", walks on through the rest of
the chain, and ``skill_tests.resume_count`` is never added.

``SkillTest.resume_count`` is NOT NULL in the model and is read on every
skills-test load (the examiner clock's "timing not verified" marking), so those
databases fail with an unknown-column error on queries that had nothing to do
with the renumbering.

The stamp itself cannot be corrected — it is a legitimate revision that was
genuinely applied — so this reconciles the schema instead: inspect the table
and add the column when it is absent, matching ``20260812_0002`` and the model
exactly. A database that took the normal route already has it and this is a
no-op, which is also what makes the migration safe to re-run.

Revision ID: 20260812_0006
Revises: 20260812_0005
Create Date: 2026-08-13
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260812_0006"
down_revision = "20260812_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    # skill_tests is model-only on some deployments — create_all() materializes
    # it with the column already present, so there is nothing to reconcile.
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
    # Deliberately a no-op. This revision only ever *restores* a column that
    # 20260812_0002 owns, and that revision stays applied when this one is
    # reversed — dropping the column here would break every database that
    # legitimately has it, which is the entire fleet apart from the ones this
    # migration exists to repair. Dropping it would also re-create the runtime
    # failure the upgrade fixes, on those same databases.
    pass
