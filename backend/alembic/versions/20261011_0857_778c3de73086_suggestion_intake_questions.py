"""Suggestion boxes ask branching intake questions that can route a submission

* ``suggestion_boxes.intake_questions`` — the questions a box asks on
  submission. NULL (every existing box) asks nothing, which is the behaviour
  before this revision.
* ``suggestions.intake_answers`` — the answers, stored with the question
  labels as they read when the member answered.
* ``suggestions.routed_from_box_id`` (``SET NULL``) — the box the member
  submitted to when an answer moved the submission to another box.

Every column is nullable and no row is backfilled. ``suggestion_boxes`` and
``suggestions`` are created by ``20260923_2218_80e2004cd691``, but each step
still checks for the table and column so a re-run, or a database whose tables
``create_all`` built, is a no-op.

The downgrade drops the three columns. A routed submission stays in the box it
was routed to; only the record of where it started, and its answers, are lost.

Revision ID: 778c3de73086
Revises: 0a55dae43a0a
Create Date: 2026-10-11 08:57:42.119049

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "778c3de73086"
down_revision: Union[str, None] = "0a55dae43a0a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BOXES = "suggestion_boxes"
SUGGESTIONS = "suggestions"
FK_ROUTED_FROM = "fk_suggestions_routed_from_box_id"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in _inspector().get_columns(table)}


def _fk_names(table: str) -> set[str]:
    return {fk.get("name") for fk in _inspector().get_foreign_keys(table)}


def upgrade() -> None:
    if _has_table(BOXES) and "intake_questions" not in _columns(BOXES):
        op.add_column(BOXES, sa.Column("intake_questions", sa.JSON(), nullable=True))

    if not _has_table(SUGGESTIONS):
        return
    existing = _columns(SUGGESTIONS)
    if "intake_answers" not in existing:
        op.add_column(
            SUGGESTIONS, sa.Column("intake_answers", sa.JSON(), nullable=True)
        )
    if "routed_from_box_id" not in existing:
        op.add_column(
            SUGGESTIONS,
            sa.Column("routed_from_box_id", sa.String(36), nullable=True),
        )
    if FK_ROUTED_FROM not in _fk_names(SUGGESTIONS):
        op.create_foreign_key(
            FK_ROUTED_FROM,
            SUGGESTIONS,
            BOXES,
            ["routed_from_box_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    if _has_table(SUGGESTIONS):
        if FK_ROUTED_FROM in _fk_names(SUGGESTIONS):
            op.drop_constraint(FK_ROUTED_FROM, SUGGESTIONS, type_="foreignkey")
        existing = _columns(SUGGESTIONS)
        if "routed_from_box_id" in existing:
            op.drop_column(SUGGESTIONS, "routed_from_box_id")
        if "intake_answers" in existing:
            op.drop_column(SUGGESTIONS, "intake_answers")
    if _has_table(BOXES) and "intake_questions" in _columns(BOXES):
        op.drop_column(BOXES, "intake_questions")
