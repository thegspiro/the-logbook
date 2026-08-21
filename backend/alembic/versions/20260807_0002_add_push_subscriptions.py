"""Add push_subscriptions table for Web Push delivery.

Revision ID: 20260807_0002
Revises: 20260805_0011
Create Date: 2026-08-07

Stores one Web Push endpoint per browser/device per user, so a member who
installs the PWA on both a phone and a station tablet is reached on both.
"""

import sqlalchemy as sa
from alembic import op

revision = "20260807_0002"
down_revision = "20260805_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    existing_tables = set(sa.inspect(op.get_bind()).get_table_names())

    if "push_subscriptions" in existing_tables:
        # Web Push originally shipped with revision id 20260807_0001.  A
        # database which applied that short-lived revision already has this
        # table, but Alembic now interprets its stamp as the sibling officers
        # migration.  Repair that skipped side before continuing the graph.
        if "organization_officers" not in existing_tables:
            _create_organization_officers()
        return

    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        # Push endpoints are URLs with no documented upper bound; FCM values
        # already run past 200 characters, so this is TEXT rather than VARCHAR.
        sa.Column("endpoint", sa.Text(), nullable=False),
        # MySQL cannot put a unique index on an unbounded TEXT column, so
        # uniqueness and lookups go through a SHA-256 of the endpoint instead.
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
        # Naming a charset without a collation is not the same as naming
        # neither: the table then takes that charset's *server* default
        # collation (utf8mb4_general_ci on MariaDB, utf8mb4_0900_ai_ci on
        # MySQL 8) instead of the database default. organizations.id and
        # users.id are utf8mb4_unicode_ci, and a foreign key requires the
        # referencing and referenced columns to agree on collation as well as
        # type — without this line the table cannot be created at all
        # (errno 150).
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
        op.f("ix_push_subscriptions_user_id"), "push_subscriptions", ["user_id"]
    )


def _create_organization_officers() -> None:
    """Create the sibling table skipped by the legacy duplicate revision."""
    op.create_table(
        "organization_officers",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("office_key", sa.String(50), nullable=False),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("display_name", sa.String(200), nullable=True),
        sa.Column("title", sa.String(150), nullable=True),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("phone", sa.String(50), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.UniqueConstraint(
            "organization_id", "office_key", name="uq_org_officer_org_office"
        ),
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_push_subscriptions_user_id"), table_name="push_subscriptions"
    )
    op.drop_index(
        op.f("ix_push_subscriptions_organization_id"),
        table_name="push_subscriptions",
    )
    op.drop_index("idx_push_sub_org_user", table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
