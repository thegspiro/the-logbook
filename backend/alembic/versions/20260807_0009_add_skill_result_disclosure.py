"""Add configurable result disclosure to skills testing

Completing a skills test made the full scorecard — every criterion note the
examiner wrote — visible to the candidate immediately. That is the right
default for a routine drill and the wrong one for a promotional evaluation, and
examiner notes are frequently candid working notes for the training file rather
than feedback drafted for the member to read.

Three things become configurable, each resolved test → template → organization:

* ``result_disclosure`` — none / scores / full. "scores" keeps the marks and
  points and drops every written note.
* ``result_release`` — on_completion / on_release. Under on_release a result
  stays invisible until an officer releases it, mirroring the shift-report
  review workflow that already gates trainee visibility.
* ``result_viewer_positions`` — corporate position slugs whose holders may see
  results in addition to the candidate, mirroring
  ``InventoryItem.restricted_to_positions``. Plus ``skill_test_viewers`` for
  naming an individual (a preceptor, an FTO) on a single test.

Defaults are full / on_completion: exactly the behavior members have today, so
this is additive and nobody loses sight of a result they can currently see.

Revision ID: 20260807_0009
Revises: 20260807_0008
Create Date: 2026-08-08 01:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260807_0009"
down_revision = "20260807_0008"
branch_labels = None
depends_on = None


def _columns(inspector, table: str) -> set[str]:
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    if inspector.has_table("training_module_configs"):
        existing = _columns(inspector, "training_module_configs")
        if "skills_result_disclosure" not in existing:
            op.add_column(
                "training_module_configs",
                sa.Column(
                    "skills_result_disclosure",
                    sa.String(20),
                    nullable=True,
                    server_default="full",
                ),
            )
        if "skills_result_release" not in existing:
            op.add_column(
                "training_module_configs",
                sa.Column(
                    "skills_result_release",
                    sa.String(20),
                    nullable=True,
                    server_default="on_completion",
                ),
            )

    # skill_templates / skill_tests are model-only tables on some deployments —
    # create_all() materializes them with these columns already present, so a
    # fresh chain run has nothing to alter. Matches 20260227_0300 onward.
    if inspector.has_table("skill_templates"):
        existing = _columns(inspector, "skill_templates")
        for name, column in (
            (
                "result_disclosure",
                sa.Column("result_disclosure", sa.String(20), nullable=True),
            ),
            (
                "result_release",
                sa.Column("result_release", sa.String(20), nullable=True),
            ),
            (
                "result_viewer_positions",
                sa.Column("result_viewer_positions", sa.JSON(), nullable=True),
            ),
        ):
            if name not in existing:
                op.add_column("skill_templates", column)

    if inspector.has_table("skill_tests"):
        existing = _columns(inspector, "skill_tests")
        for name, column in (
            (
                "result_disclosure",
                sa.Column("result_disclosure", sa.String(20), nullable=True),
            ),
            (
                "result_release",
                sa.Column("result_release", sa.String(20), nullable=True),
            ),
            (
                "result_viewer_positions",
                sa.Column("result_viewer_positions", sa.JSON(), nullable=True),
            ),
            (
                "released_at",
                sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
            ),
            ("released_by", sa.Column("released_by", sa.String(36), nullable=True)),
        ):
            if name not in existing:
                op.add_column("skill_tests", column)

        if "released_by" not in existing:
            op.create_foreign_key(
                "fk_skill_tests_released_by_users",
                "skill_tests",
                "users",
                ["released_by"],
                ["id"],
                ondelete="SET NULL",
            )

    if not inspector.has_table("skill_test_viewers"):
        op.create_table(
            "skill_test_viewers",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "test_id",
                sa.String(36),
                sa.ForeignKey("skill_tests.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            # SET NULL requires nullable: the grant outlives its author.
            sa.Column(
                "granted_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "granted_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
            ),
            sa.UniqueConstraint("test_id", "user_id", name="uq_skill_test_viewer"),
        )
        op.create_index(
            "ix_skill_test_viewers_test_id", "skill_test_viewers", ["test_id"]
        )
        op.create_index(
            "ix_skill_test_viewers_user_id", "skill_test_viewers", ["user_id"]
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    if inspector.has_table("skill_test_viewers"):
        op.drop_table("skill_test_viewers")

    if inspector.has_table("skill_tests"):
        existing = _columns(inspector, "skill_tests")
        if "released_by" in existing:
            op.drop_constraint(
                "fk_skill_tests_released_by_users", "skill_tests", type_="foreignkey"
            )
        for name in (
            "released_by",
            "released_at",
            "result_viewer_positions",
            "result_release",
            "result_disclosure",
        ):
            if name in existing:
                op.drop_column("skill_tests", name)

    if inspector.has_table("skill_templates"):
        existing = _columns(inspector, "skill_templates")
        for name in ("result_viewer_positions", "result_release", "result_disclosure"):
            if name in existing:
                op.drop_column("skill_templates", name)

    if inspector.has_table("training_module_configs"):
        existing = _columns(inspector, "training_module_configs")
        for name in ("skills_result_release", "skills_result_disclosure"):
            if name in existing:
                op.drop_column("training_module_configs", name)
