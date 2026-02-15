"""Add apparatus system folder for per-vehicle document hierarchy

Inserts the 'Apparatus Files' system folder into document_folders
for each existing organization. New organizations will get it
automatically via SYSTEM_FOLDERS during onboarding.

Per-vehicle sub-folders (Photos, Registration & Insurance,
Maintenance Records, Inspection & Compliance, Manuals & References)
are created lazily on first access via ensure_apparatus_folder().

Revision ID: 20260215_0200
Revises: 20260215_0100
Create Date: 2026-02-15
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import table, column
from uuid import uuid4

# revision identifiers
revision = "20260215_0200"
down_revision = "20260215_0100"
branch_labels = None
depends_on = None

# Inline references to avoid importing app code in migrations
organizations_table = table("organizations", column("id", sa.String))
document_folders_table = table(
    "document_folders",
    column("id", sa.String),
    column("organization_id", sa.String),
    column("name", sa.String),
    column("slug", sa.String),
    column("description", sa.Text),
    column("icon", sa.String),
    column("color", sa.String),
    column("sort_order", sa.Integer),
    column("is_system", sa.Boolean),
    column("visibility", sa.String),
)


def upgrade() -> None:
    conn = op.get_bind()
    orgs = conn.execute(sa.select(organizations_table.c.id)).fetchall()

    for (org_id,) in orgs:
        # Check if this org already has the apparatus system folder
        existing = conn.execute(
            sa.select(document_folders_table.c.id).where(
                sa.and_(
                    document_folders_table.c.organization_id == org_id,
                    document_folders_table.c.slug == "apparatus",
                    document_folders_table.c.is_system == True,
                )
            )
        ).fetchone()

        if not existing:
            conn.execute(
                document_folders_table.insert().values(
                    id=str(uuid4()),
                    organization_id=org_id,
                    name="Apparatus Files",
                    slug="apparatus",
                    description="Per-vehicle folders with categorized sub-folders",
                    icon="truck",
                    color="text-orange-400",
                    sort_order=8,
                    is_system=True,
                    visibility="leadership",
                )
            )


def downgrade() -> None:
    conn = op.get_bind()
    # Remove apparatus system folders (cascade will remove any sub-folders/docs)
    conn.execute(
        document_folders_table.delete().where(
            sa.and_(
                document_folders_table.c.slug == "apparatus",
                document_folders_table.c.is_system == True,
            )
        )
    )
