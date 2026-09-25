"""Suggestion status events: the submitter's timeline

Creates ``suggestion_status_events``. Each row is one step a reviewer took that
the submitter can see: a disposition change, a public response, or both.

**Backfill.** A suggestion already moved past ``new`` gets one event, for its
current disposition, dated ``disposition_updated_at``. Earlier steps were never
recorded anywhere, so they cannot be recovered. The timeline for such a
suggestion reads "received, then <current status>", which is true, only
coarser than it will be from now on. Receipt itself is not an event: it is the
suggestion's own ``created_at``.

The table is created only when absent, because a fresh install that ran
``create_all`` already has it. The backfill runs only when it is empty, so a
re-run cannot duplicate rows.

**Downgrade** drops the table, and with it every public response reviewers
have written. Dispositions themselves live on ``suggestions`` and survive.

Revision ID: 0010291816fd
Revises: 1ae1ffbc445e
Create Date: 2026-09-25 16:10:51.531617

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0010291816fd"
down_revision: Union[str, None] = "1ae1ffbc445e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table("suggestion_status_events"):
        op.create_table(
            "suggestion_status_events",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), nullable=False),
            sa.Column("suggestion_id", sa.String(36), nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("disposition", sa.String(32), nullable=False),
            sa.Column("public_response", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["organization_id"], ["organizations.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["suggestion_id"], ["suggestions.id"], ondelete="CASCADE"
            ),
            sa.UniqueConstraint(
                "suggestion_id", "sequence", name="uq_suggestion_status_event_seq"
            ),
        )
        op.create_index(
            "idx_suggestion_status_events_org_suggestion",
            "suggestion_status_events",
            ["organization_id", "suggestion_id"],
        )

    _backfill(op.get_bind())


def _backfill(bind) -> None:
    """One event per suggestion already past ``new``. Skipped once the table
    holds anything, so a re-run cannot duplicate rows."""
    if bind.execute(sa.text("SELECT COUNT(*) FROM suggestion_status_events")).scalar():
        return
    bind.execute(
        sa.text(
            "INSERT INTO suggestion_status_events "
            "(id, organization_id, suggestion_id, sequence, disposition, "
            "public_response, created_at) "
            "SELECT UUID(), organization_id, id, 1, disposition, NULL, "
            "disposition_updated_at "
            "FROM suggestions "
            "WHERE disposition <> 'new' AND disposition_updated_at IS NOT NULL"
        )
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS suggestion_status_events")
