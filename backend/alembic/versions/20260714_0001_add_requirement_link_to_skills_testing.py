"""Add optional pipeline requirement link to skills testing

Adds a nullable ``requirement_id`` FK (SET NULL) to ``skill_templates`` and
``skill_tests`` so a skills template can point at the training-pipeline
requirement it satisfies. Tests inherit the link from their template at creation
(overridable per test); a passing test marks that requirement complete on the
candidate's active enrollment.

Revision ID: 20260714_0001
Revises: 20260707_0001
Create Date: 2026-07-14 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260714_0001"
down_revision = "20260707_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "skill_templates",
        sa.Column(
            "requirement_id",
            sa.String(36),
            sa.ForeignKey("training_requirements.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "idx_skill_template_requirement", "skill_templates", ["requirement_id"]
    )
    op.add_column(
        "skill_tests",
        sa.Column(
            "requirement_id",
            sa.String(36),
            sa.ForeignKey("training_requirements.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("idx_skill_test_requirement", "skill_tests", ["requirement_id"])


def downgrade() -> None:
    op.drop_index("idx_skill_test_requirement", table_name="skill_tests")
    op.drop_column("skill_tests", "requirement_id")
    op.drop_index("idx_skill_template_requirement", table_name="skill_templates")
    op.drop_column("skill_templates", "requirement_id")
