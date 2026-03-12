"""Create prospect event links table

Revision ID: 20260312_0100
Revises: 20260308_0300
Create Date: 2026-03-12

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260312_0100"
down_revision = "20260308_0300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "prospect_event_links",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "prospect_id",
            sa.String(36),
            sa.ForeignKey("prospective_members.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "event_id",
            sa.String(36),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column(
            "linked_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )

    op.create_index(
        "idx_prospect_event_link_prospect",
        "prospect_event_links",
        ["prospect_id"],
    )
    op.create_index(
        "idx_prospect_event_link_event",
        "prospect_event_links",
        ["event_id"],
    )
    op.create_index(
        "idx_prospect_event_link_unique",
        "prospect_event_links",
        ["prospect_id", "event_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "idx_prospect_event_link_unique",
        table_name="prospect_event_links",
    )
    op.drop_index(
        "idx_prospect_event_link_event",
        table_name="prospect_event_links",
    )
    op.drop_index(
        "idx_prospect_event_link_prospect",
        table_name="prospect_event_links",
    )
    op.drop_table("prospect_event_links")
