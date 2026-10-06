"""integration health: error fields on integrations, integration_sync_logs table

Owner decision (integrations-health-and-triggers): integrations get a detail
page with their last error, their consecutive-failure count, a sync history and
a Retry Sync control.

- ``integrations`` gains ``last_success_at``, ``last_error``,
  ``last_error_at`` and ``consecutive_error_count`` (NOT NULL, default 0).
  Existing rows start with no error and a zero count — nothing was recorded
  before this revision, so "no known failure" is the truthful starting state.
- ``integration_sync_logs`` holds the run history, at most 50 rows per
  integration (pruned on every write by ``app.services.integration_health``).
  Error text is sanitized before it is written; ``summary`` holds integer
  counts only.

``integrations`` is built by ``create_all`` rather than by any migration, so
both steps are skipped on a database where it does not exist yet: the models
already declare the columns and the table, and ``create_all`` builds them.

The downgrade drops the table and the four columns. That discards the
recorded history and error state, which is the correct consequence of
removing the feature; nothing older reads them.

Revision ID: 4e8b1c6d2a90
Revises: 9a4c2e7b5d18
Create Date: 2026-10-05 18:30:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4e8b1c6d2a90"
down_revision: Union[str, None] = "9a4c2e7b5d18"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INTEGRATIONS = "integrations"
_LOGS = "integration_sync_logs"
_INDEX = "ix_integration_sync_logs_integration_started"

_NEW_COLUMNS = (
    ("last_success_at", lambda: sa.DateTime(timezone=True), {"nullable": True}),
    ("last_error", lambda: sa.Text(), {"nullable": True}),
    ("last_error_at", lambda: sa.DateTime(timezone=True), {"nullable": True}),
    (
        "consecutive_error_count",
        lambda: sa.Integer(),
        {"nullable": False, "server_default": sa.text("0")},
    ),
)


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    tables = _tables()
    if _INTEGRATIONS not in tables:
        return

    existing = _columns(_INTEGRATIONS)
    for name, type_, kwargs in _NEW_COLUMNS:
        if name not in existing:
            op.add_column(_INTEGRATIONS, sa.Column(name, type_(), **kwargs))

    if _LOGS in tables:
        return
    op.create_table(
        _LOGS,
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("integration_id", sa.String(length=36), nullable=False),
        sa.Column("operation", sa.String(length=50), nullable=False),
        sa.Column("trigger_source", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("summary", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("triggered_by", sa.String(length=36), nullable=True),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["integration_id"], ["integrations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["triggered_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(_INDEX, _LOGS, ["integration_id", "started_at"])


def downgrade() -> None:
    tables = _tables()
    if _LOGS in tables:
        op.execute(sa.text(f"DROP TABLE IF EXISTS {_LOGS}"))
    if _INTEGRATIONS in tables:
        existing = _columns(_INTEGRATIONS)
        for name, _type, _kwargs in reversed(_NEW_COLUMNS):
            if name in existing:
                op.drop_column(_INTEGRATIONS, name)
