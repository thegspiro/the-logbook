"""Milestone completion items, recipients and per-enrollment achievements

- ``program_milestones`` gains ``item_match_mode`` (all/any),
  ``counts_prior_completions``, ``notify_member``, ``notify_position_ids``,
  ``notify_user_ids`` and ``officer_message``. Every NOT NULL column has a
  server default, and the defaults are exactly the behavior every existing
  milestone already had: percentage only, member notified, nobody else.

- ``program_milestone_items``: the courses, skills tests and knowledge tests a
  milestone waits for. Starts empty. It references ``skill_templates``, which
  no migration creates (create_all builds it), so on a database without that
  table the step is skipped and create_all builds this one from the model.

- ``program_milestone_achievements``: one row per (milestone, enrollment) the
  first time the enrollment meets the milestone, unique on the pair.

Existing rows: a milestone used to fire only when progress moved past its
percentage; it now fires for any active enrollment that meets it and has no
achievement row. So every enrollment already at or past an existing
milestone's percentage gets a ``skipped`` row here. Without it, those members
would be congratulated again, for something they reached long ago, on their
next progress change.

Downgrade drops the two tables and the six columns; the chosen items,
recipients, officer messages and the record of who reached which milestone are
lost. The percentage, name and member message of each milestone survive.

Revision ID: 55e20c02dea7
Revises: 78f196079c95
Create Date: 2026-11-08 14:48:44.694462

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "55e20c02dea7"
down_revision: Union[str, None] = "78f196079c95"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MILESTONES = "program_milestones"
ITEMS = "program_milestone_items"
ACHIEVEMENTS = "program_milestone_achievements"
ENROLLMENTS = "program_enrollments"
ITEM_TARGETS = ("training_courses", "skill_templates", "knowledge_tests")

NEW_COLUMNS = (
    "item_match_mode",
    "counts_prior_completions",
    "notify_member",
    "notify_position_ids",
    "notify_user_ids",
    "officer_message",
)


# Every enrollment at or past an existing milestone's percentage is recorded as
# having reached it, without a notice. NOT EXISTS keeps a second run from
# colliding with the unique pair.
BACKFILL_SQL = (
    f"INSERT INTO {ACHIEVEMENTS} "
    "(id, milestone_id, enrollment_id, outcome, reached_at) "
    "SELECT UUID(), m.id, e.id, 'skipped', NOW() "
    f"FROM {MILESTONES} m "
    f"JOIN {ENROLLMENTS} e ON e.program_id = m.program_id "
    "WHERE m.completion_percentage_threshold IS NOT NULL "
    "AND e.progress_percentage IS NOT NULL "
    "AND e.progress_percentage >= m.completion_percentage_threshold "
    f"AND NOT EXISTS (SELECT 1 FROM {ACHIEVEMENTS} a "
    "WHERE a.milestone_id = m.id AND a.enrollment_id = e.id)"
)


def _has_table(bind, table: str) -> bool:
    return (
        bind.execute(
            sa.text(
                "SELECT COUNT(*) FROM information_schema.TABLES "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table"
            ),
            {"table": table},
        ).scalar()
        > 0
    )


def _has_column(bind, table: str, column: str) -> bool:
    return (
        bind.execute(
            sa.text(
                "SELECT COUNT(*) FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table "
                "AND COLUMN_NAME = :column"
            ),
            {"table": table, "column": column},
        ).scalar()
        > 0
    )


def _add_milestone_columns(bind) -> None:
    columns = {
        "item_match_mode": sa.Column(
            "item_match_mode", sa.String(10), nullable=False, server_default="all"
        ),
        "counts_prior_completions": sa.Column(
            "counts_prior_completions",
            sa.Boolean(),
            nullable=False,
            server_default="0",
        ),
        "notify_member": sa.Column(
            "notify_member", sa.Boolean(), nullable=False, server_default="1"
        ),
        "notify_position_ids": sa.Column(
            "notify_position_ids", sa.JSON(), nullable=True
        ),
        "notify_user_ids": sa.Column("notify_user_ids", sa.JSON(), nullable=True),
        "officer_message": sa.Column("officer_message", sa.Text(), nullable=True),
    }
    for name in NEW_COLUMNS:
        if not _has_column(bind, MILESTONES, name):
            op.add_column(MILESTONES, columns[name])


def _create_items(bind) -> None:
    if _has_table(bind, ITEMS):
        return
    if not all(_has_table(bind, target) for target in ITEM_TARGETS):
        return
    op.create_table(
        ITEMS,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "milestone_id",
            sa.String(36),
            sa.ForeignKey("program_milestones.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("item_type", sa.String(20), nullable=False),
        sa.Column(
            "course_id",
            sa.String(36),
            sa.ForeignKey("training_courses.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "skill_template_id",
            sa.String(36),
            sa.ForeignKey("skill_templates.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "knowledge_test_id",
            sa.String(36),
            sa.ForeignKey("knowledge_tests.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    for column in (
        "milestone_id",
        "course_id",
        "skill_template_id",
        "knowledge_test_id",
    ):
        op.create_index(f"ix_{ITEMS}_{column}", ITEMS, [column])


def _create_achievements(bind) -> None:
    if _has_table(bind, ACHIEVEMENTS):
        return
    op.create_table(
        ACHIEVEMENTS,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "milestone_id",
            sa.String(36),
            sa.ForeignKey("program_milestones.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "enrollment_id",
            sa.String(36),
            sa.ForeignKey("program_enrollments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("outcome", sa.String(20), nullable=False),
        sa.Column(
            "reached_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "milestone_id", "enrollment_id", name="uq_milestone_achievement"
        ),
    )
    op.create_index(f"ix_{ACHIEVEMENTS}_enrollment_id", ACHIEVEMENTS, ["enrollment_id"])

    # Settle the enrollments already past an existing milestone (see the
    # module docstring).
    if _has_table(bind, ENROLLMENTS):
        bind.execute(sa.text(BACKFILL_SQL))


def upgrade() -> None:
    bind = op.get_bind()
    # Defensive only: an ancestor migration creates program_milestones.
    if not _has_table(bind, MILESTONES):
        return
    _add_milestone_columns(bind)
    _create_items(bind)
    _create_achievements(bind)


def downgrade() -> None:
    bind = op.get_bind()
    if _has_table(bind, ACHIEVEMENTS):
        op.drop_table(ACHIEVEMENTS)
    if _has_table(bind, ITEMS):
        op.drop_table(ITEMS)
    if _has_table(bind, MILESTONES):
        for name in reversed(NEW_COLUMNS):
            if _has_column(bind, MILESTONES, name):
                op.drop_column(MILESTONES, name)
