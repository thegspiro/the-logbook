"""Add system folders for apparatus, facilities, and events

Inserts 'Apparatus Files', 'Facility Files', and 'Event Attachments'
system folders into document_folders for each existing organization.
New organizations will get them automatically via SYSTEM_FOLDERS
during onboarding.

Per-entity sub-folders are created lazily on first access via
ensure_apparatus_folder(), ensure_facility_folder(), and
ensure_event_folder().

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

# System folders to create
SYSTEM_FOLDERS_TO_ADD = [
    {
        "slug": "apparatus",
        "name": "Apparatus Files",
        "description": "Per-vehicle folders with categorized sub-folders",
        "icon": "truck",
        "color": "text-orange-400",
        "sort_order": 8,
        "visibility": "leadership",
    },
    {
        "slug": "facilities",
        "name": "Facility Files",
        "description": "Per-facility folders with categorized sub-folders",
        "icon": "building",
        "color": "text-indigo-400",
        "sort_order": 9,
        "visibility": "leadership",
    },
    {
        "slug": "events",
        "name": "Event Attachments",
        "description": "Per-event attachment folders",
        "icon": "calendar",
        "color": "text-rose-400",
        "sort_order": 10,
        "visibility": "organization",
    },
]


def upgrade() -> None:
    conn = op.get_bind()
    orgs = conn.execute(sa.select(organizations_table.c.id)).fetchall()

    for (org_id,) in orgs:
        for folder_def in SYSTEM_FOLDERS_TO_ADD:
            existing = conn.execute(
                sa.select(document_folders_table.c.id).where(
                    sa.and_(
                        document_folders_table.c.organization_id == org_id,
                        document_folders_table.c.slug == folder_def["slug"],
                        document_folders_table.c.is_system == True,
                    )
                )
            ).fetchone()

            if not existing:
                conn.execute(
                    document_folders_table.insert().values(
                        id=str(uuid4()),
                        organization_id=org_id,
                        is_system=True,
                        **folder_def,
                    )
                )


def downgrade() -> None:
    conn = op.get_bind()
    slugs_to_remove = [f["slug"] for f in SYSTEM_FOLDERS_TO_ADD]
    for slug in slugs_to_remove:
        conn.execute(
            document_folders_table.delete().where(
                sa.and_(
                    document_folders_table.c.slug == slug,
                    document_folders_table.c.is_system == True,
                )
            )
        )
