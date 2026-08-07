"""Create organization_officers table

Records which member holds each department office (President, Chief,
Secretary, ...) so outgoing email can be signed by the officeholder rather
than by whoever triggered the send. The office keys come from OFFICE_CATALOG
in app.core.constants — only the assignment lives in the database.

Revision ID: 20260807_0001
Revises: 20260805_0011
Create Date: 2026-08-07

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260807_0001"
down_revision = "20260805_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "organization_officers" in inspector.get_table_names():
        return

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
        # SET NULL, so nullable=True (MySQL error 1830 rejects SET NULL on a
        # NOT NULL column). Deleting a member empties the office rather than
        # deleting the row, preserving any admin overrides on it.
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
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "organization_officers" not in inspector.get_table_names():
        return

    op.drop_table("organization_officers")
