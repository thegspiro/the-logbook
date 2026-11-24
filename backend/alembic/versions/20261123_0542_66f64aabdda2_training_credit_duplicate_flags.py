"""Create training_credit_duplicate_flags for possible double credit

Owner decision 2026-11-23 ("Double credit: flag, never merge"). When a Training
event's finalize credits a member who already holds an approved self-report or
a hand-entered completed record for the same day and the same course or a close
name, the pair is recorded here for an officer to keep both or void one. The
unique ``(event_record_id, other_record_id)`` pair is what makes a re-finalize
record nothing new (pitfall #36).

A new table only, so no existing row is touched and nothing needs settling
(pitfall #35). It starts empty: finalizes before this revision flagged nothing,
and a pair already credited twice is found the next time that event is
finalized. Skipped when the table already exists, so a database ``create_all``
built first upgrades cleanly.

Downgrade drops the table with every flag in it, open or resolved. The training
records the flags pointed at are untouched; an officer's "keep both" decisions
are lost, so a later re-upgrade and re-finalize would flag those pairs again.

Revision ID: 66f64aabdda2
Revises: 9c41e7b2d5a3
Create Date: 2026-11-23 05:42:11.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "66f64aabdda2"
down_revision: Union[str, None] = "9c41e7b2d5a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "training_credit_duplicate_flags"


def _has_table(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def upgrade() -> None:
    if _has_table(_TABLE):
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "event_record_id",
            sa.String(36),
            sa.ForeignKey("training_records.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "other_record_id",
            sa.String(36),
            sa.ForeignKey("training_records.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("match_reason", sa.String(20), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("resolution", sa.String(20), nullable=True),
        sa.Column(
            "resolved_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "event_record_id", "other_record_id", name="uq_training_credit_dup_pair"
        ),
    )
    op.create_index(
        "idx_training_credit_dup_org_open", _TABLE, ["organization_id", "resolution"]
    )
    op.create_index("idx_training_credit_dup_other", _TABLE, ["other_record_id"])


def downgrade() -> None:
    if _has_table(_TABLE):
        op.drop_table(_TABLE)
