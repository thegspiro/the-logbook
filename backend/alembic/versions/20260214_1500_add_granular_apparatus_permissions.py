"""Add granular apparatus permissions to existing roles

Revision ID: 20260214_1500
Revises: 20260214_1400
Create Date: 2026-02-14

Adds apparatus.view, apparatus.create, apparatus.edit, apparatus.delete,
and apparatus.maintenance permissions to the default system roles. Fixes
the apparatus_manager role which was missing all apparatus permissions.
"""
import json
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260214_1500'
down_revision = '20260214_1400'
branch_labels = None
depends_on = None

# Maps role slugs to the new apparatus permissions they should receive
ROLE_PERMISSION_UPDATES = {
    # Full access roles get all granular + manage
    "chief": [
        "apparatus.view", "apparatus.create", "apparatus.edit",
        "apparatus.delete", "apparatus.maintenance",
    ],
    "assistant_chief": [
        "apparatus.view", "apparatus.create", "apparatus.edit",
        "apparatus.delete", "apparatus.maintenance",
    ],
    "president": [
        "apparatus.view", "apparatus.create", "apparatus.edit",
        "apparatus.delete", "apparatus.maintenance",
    ],
    # Apparatus manager gets day-to-day operations (no delete)
    "apparatus_manager": [
        "apparatus.view", "apparatus.create", "apparatus.edit",
        "apparatus.maintenance",
    ],
    # View-only roles
    "vice_president": ["apparatus.view"],
    "quartermaster": ["apparatus.view"],
    "secretary": ["apparatus.view"],
    "officers": ["apparatus.view"],
    "member": ["apparatus.view"],
}


def upgrade() -> None:
    conn = op.get_bind()

    for slug, new_permissions in ROLE_PERMISSION_UPDATES.items():
        # Get all roles with this slug (one per organization)
        results = conn.execute(
            sa.text("SELECT id, permissions FROM roles WHERE slug = :slug"),
            {"slug": slug},
        ).fetchall()

        for row in results:
            role_id = row[0]
            existing_perms = json.loads(row[1]) if row[1] else []

            # Skip wildcard roles
            if "*" in existing_perms:
                continue

            # Add only permissions that don't already exist
            updated = False
            for perm in new_permissions:
                if perm not in existing_perms:
                    existing_perms.append(perm)
                    updated = True

            if updated:
                conn.execute(
                    sa.text("UPDATE roles SET permissions = :perms WHERE id = :id"),
                    {"perms": json.dumps(existing_perms), "id": role_id},
                )


def downgrade() -> None:
    conn = op.get_bind()

    # Remove the new granular permissions from all roles
    perms_to_remove = {
        "apparatus.view", "apparatus.create", "apparatus.edit",
        "apparatus.delete", "apparatus.maintenance",
    }

    for slug in ROLE_PERMISSION_UPDATES.keys():
        results = conn.execute(
            sa.text("SELECT id, permissions FROM roles WHERE slug = :slug"),
            {"slug": slug},
        ).fetchall()

        for row in results:
            role_id = row[0]
            existing_perms = json.loads(row[1]) if row[1] else []

            if "*" in existing_perms:
                continue

            cleaned = [p for p in existing_perms if p not in perms_to_remove]
            if len(cleaned) != len(existing_perms):
                conn.execute(
                    sa.text("UPDATE roles SET permissions = :perms WHERE id = :id"),
                    {"perms": json.dumps(cleaned), "id": role_id},
                )
