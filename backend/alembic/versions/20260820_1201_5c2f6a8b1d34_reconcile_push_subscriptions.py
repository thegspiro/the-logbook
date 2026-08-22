"""Create push_subscriptions when a revision-id collision skipped it.

The program-enrollment notes migration was briefly released with revision id
``20260807_0002``.  That id now belongs to the Web Push table migration, so a
database upgraded during that window is treated as though the table migration
ran even though ``push_subscriptions`` is absent.

Repeat the table creation downstream and guard it with schema inspection.  It
is a no-op for normal databases and repairs databases carrying the stale
revision stamp.

Revision ID: 5c2f6a8b1d34
Revises: 7ed8593bc904
Create Date: 2026-08-20
"""

import sqlalchemy as sa
from alembic import op

revision = "5c2f6a8b1d34"
down_revision = "7ed8593bc904"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if sa.inspect(op.get_bind()).has_table("push_subscriptions"):
        return

    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("endpoint_hash", sa.String(length=64), nullable=False),
        sa.Column("p256dh", sa.String(length=255), nullable=False),
        sa.Column("auth", sa.String(length=255), nullable=False),
        sa.Column("user_agent", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint_hash", name="uq_push_sub_endpoint"),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )
    op.create_index(
        "idx_push_sub_org_user",
        "push_subscriptions",
        ["organization_id", "user_id"],
    )
    op.create_index(
        op.f("ix_push_subscriptions_organization_id"),
        "push_subscriptions",
        ["organization_id"],
    )
    op.create_index(
        op.f("ix_push_subscriptions_user_id"),
        "push_subscriptions",
        ["user_id"],
    )


def downgrade() -> None:
    # The original table migration remains applied when this reconciliation is
    # reversed, so removing its table would break unaffected databases.
    pass
