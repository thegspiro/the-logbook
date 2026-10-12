"""Add knowledge tests: question bank, attempts and grading.

Revision ID: 7c2e9a41b6d3
Revises: 56c91e7d9e10
Create Date: 2026-10-05 23:50:00

Three new tables only; no existing row is read or changed. Each is guarded on
its existence because a fresh install that ran ``create_all()`` from the models
already has it.

**Downgrade** drops the three tables, and with them every question and every
attempt — members' online test results. A score an attempt recorded on a
requirement lives in that requirement's progress notes and survives.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7c2e9a41b6d3"
down_revision: Union[str, None] = "56c91e7d9e10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _timestamps() -> list:
    return [
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
    ]


def upgrade() -> None:
    if not _has_table("knowledge_tests"):
        op.create_table(
            "knowledge_tests",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), nullable=False),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("instructions", sa.Text(), nullable=True),
            sa.Column("requirement_id", sa.String(36), nullable=True),
            sa.Column("passing_score", sa.Float(), nullable=True),
            sa.Column("time_limit_minutes", sa.Integer(), nullable=True),
            sa.Column("question_count", sa.Integer(), nullable=True),
            sa.Column(
                "shuffle_questions",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
            sa.Column(
                "show_correct_answers",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
            sa.Column("created_by", sa.String(36), nullable=True),
            *_timestamps(),
            sa.ForeignKeyConstraint(
                ["organization_id"], ["organizations.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["requirement_id"], ["training_requirements.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        )
        op.create_index(
            "ix_knowledge_tests_organization_id", "knowledge_tests", ["organization_id"]
        )
        op.create_index(
            "idx_knowledge_test_org_status",
            "knowledge_tests",
            ["organization_id", "status"],
        )

    if not _has_table("knowledge_test_questions"):
        op.create_table(
            "knowledge_test_questions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), nullable=False),
            sa.Column("test_id", sa.String(36), nullable=False),
            sa.Column("prompt", sa.Text(), nullable=False),
            sa.Column("question_type", sa.String(20), nullable=False),
            sa.Column("options", sa.JSON(), nullable=False),
            sa.Column("correct_option_ids", sa.JSON(), nullable=False),
            sa.Column("explanation", sa.Text(), nullable=True),
            sa.Column("points", sa.Float(), nullable=False, server_default="1"),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            *_timestamps(),
            sa.ForeignKeyConstraint(
                ["organization_id"], ["organizations.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["test_id"], ["knowledge_tests.id"], ondelete="CASCADE"
            ),
        )
        op.create_index(
            "ix_knowledge_test_questions_organization_id",
            "knowledge_test_questions",
            ["organization_id"],
        )
        op.create_index(
            "ix_knowledge_test_questions_test_id",
            "knowledge_test_questions",
            ["test_id"],
        )

    if not _has_table("knowledge_test_attempts"):
        op.create_table(
            "knowledge_test_attempts",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), nullable=False),
            sa.Column("test_id", sa.String(36), nullable=False),
            sa.Column("user_id", sa.String(36), nullable=False),
            sa.Column(
                "status", sa.String(20), nullable=False, server_default="in_progress"
            ),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("questions_snapshot", sa.JSON(), nullable=False),
            sa.Column("answers", sa.JSON(), nullable=True),
            sa.Column("score", sa.Float(), nullable=True),
            sa.Column("points_earned", sa.Float(), nullable=True),
            sa.Column("points_possible", sa.Float(), nullable=True),
            sa.Column("passed", sa.Boolean(), nullable=True),
            sa.Column("passing_score", sa.Float(), nullable=False),
            sa.Column("requirement_id", sa.String(36), nullable=True),
            sa.Column(
                "show_correct_answers",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column(
                "credited", sa.Boolean(), nullable=False, server_default=sa.false()
            ),
            sa.Column("credit_note", sa.String(500), nullable=True),
            *_timestamps(),
            sa.ForeignKeyConstraint(
                ["organization_id"], ["organizations.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["test_id"], ["knowledge_tests.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["requirement_id"], ["training_requirements.id"], ondelete="SET NULL"
            ),
        )
        op.create_index(
            "idx_knowledge_attempt_test_user",
            "knowledge_test_attempts",
            ["test_id", "user_id", "status"],
        )
        op.create_index(
            "idx_knowledge_attempt_user", "knowledge_test_attempts", ["user_id"]
        )
        op.create_index(
            "ix_knowledge_test_attempts_organization_id",
            "knowledge_test_attempts",
            ["organization_id"],
        )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS knowledge_test_attempts")
    op.execute("DROP TABLE IF EXISTS knowledge_test_questions")
    op.execute("DROP TABLE IF EXISTS knowledge_tests")
