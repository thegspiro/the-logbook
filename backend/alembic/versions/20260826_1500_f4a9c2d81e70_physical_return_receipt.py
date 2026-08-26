"""Add physical receipt evidence and return-request stages.

Revision ID: f4a9c2d81e70
Revises: 472a1e34aa84
Create Date: 2026-08-26 15:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "f4a9c2d81e70"
down_revision = "472a1e34aa84"
branch_labels = None
depends_on = None


_TABLE = "return_requests"
_COLUMNS = (
    "observed_condition",
    "verified_identifier",
    "received_quantity",
    "follow_up_type",
    "follow_up_id",
)


def _has_table(inspector, table: str) -> bool:
    return table in inspector.get_table_names()


def _has_column(inspector, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade():
    bind = op.get_bind()
    # No migration creates `return_requests` — it comes into being when
    # main.py's fast-path init calls create_all() and stamps Alembic at head.
    # CI runs `alembic upgrade head` against an empty database before anything
    # does that, so every statement below aborted the entire upgrade rather
    # than just this revision (CLAUDE.md pitfall 26). Skipping is correct:
    # create_all builds the table from the models, which already declare both
    # the widened status enum and all five columns.
    inspector = sa.inspect(bind)
    if not _has_table(inspector, _TABLE):
        return

    dialect = bind.dialect.name
    if dialect == "postgresql":
        for value in ("requested", "received", "inspected"):
            op.execute(
                sa.text(
                    f"ALTER TYPE returnrequeststatus ADD VALUE IF NOT EXISTS '{value}'"
                )
            )
    elif dialect in {"mysql", "mariadb"}:
        op.execute(
            "ALTER TABLE return_requests MODIFY status ENUM('pending','approved','requested','received','inspected','denied','completed') NOT NULL DEFAULT 'requested'"
        )
    op.execute(
        sa.text("UPDATE return_requests SET status='requested' WHERE status='pending'")
    )
    op.execute(
        sa.text("UPDATE return_requests SET status='received' WHERE status='approved'")
    )
    # Each column is guarded individually as well, covering the other order:
    # an installation that started the app before migrating already has them
    # from the models.
    existing = {c["name"] for c in inspector.get_columns(_TABLE)}
    with op.batch_alter_table("return_requests") as batch:
        if "observed_condition" not in existing:
            batch.add_column(
                sa.Column(
                    "observed_condition",
                    sa.Enum(
                        "excellent",
                        "good",
                        "fair",
                        "poor",
                        "damaged",
                        "out_of_service",
                        "retired",
                        name="itemcondition",
                    ),
                    nullable=True,
                )
            )
        if "verified_identifier" not in existing:
            batch.add_column(
                sa.Column("verified_identifier", sa.String(255), nullable=True)
            )
        if "received_quantity" not in existing:
            batch.add_column(
                sa.Column("received_quantity", sa.Integer(), nullable=True)
            )
        if "follow_up_type" not in existing:
            batch.add_column(sa.Column("follow_up_type", sa.String(32), nullable=True))
        if "follow_up_id" not in existing:
            batch.add_column(sa.Column("follow_up_id", sa.String(36), nullable=True))


def downgrade():
    inspector = sa.inspect(op.get_bind())
    if not _has_table(inspector, _TABLE):
        return

    op.execute(
        sa.text(
            "UPDATE return_requests SET status='pending' WHERE status IN ('requested','received','inspected')"
        )
    )
    existing = {c["name"] for c in inspector.get_columns(_TABLE)}
    with op.batch_alter_table("return_requests") as batch:
        for name in reversed(_COLUMNS):
            if name in existing:
                batch.drop_column(name)
