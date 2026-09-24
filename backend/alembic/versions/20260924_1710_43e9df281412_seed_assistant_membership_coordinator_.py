"""Seed the Assistant Membership Coordinator position onto existing organizations

``DEFAULT_POSITIONS`` is materialized only when an organization is onboarded,
so the new ``assistant_membership_coordinator`` system position would reach
fresh installs and nobody else. It matters beyond the positions screen: holders
of it receive the applicant-withdrawal notice alongside the Membership
Coordinator, so a department that upgrades without it has nowhere to put the
person who helps run its applicant pipeline.

One idempotent pass: every organization that has been onboarded (holds any
system position) and has no position with this slug gets one, carrying the
permission set from ``DEFAULT_POSITIONS``. A department that already created a
position under the same slug keeps its own — the ``(organization_id, slug)``
unique index would refuse a second, and theirs is the one their members hold.

Revision ID: 43e9df281412
Revises: 77d4aa7798dd
Create Date: 2026-09-24 17:10:57.227987

"""

import json
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "43e9df281412"
down_revision: Union[str, None] = "77d4aa7798dd"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Frozen copy of DEFAULT_POSITIONS["assistant_membership_coordinator"] as of this
# revision. A migration must keep writing what it wrote the day it ran, so it
# does not import the registry, which is free to change.
_POSITION = {
    "name": "Assistant Membership Coordinator",
    "slug": "assistant_membership_coordinator",
    "description": (
        "Helps run the applicant pipeline alongside the Membership Coordinator"
    ),
    "priority": 50,
    "permissions": [
        "users.view",
        "members.view",
        "prospective_members.manage",
        "positions.view",
        "organization.view",
        "storefront.view",
        "storefront.order",
        "events.view",
        "notifications.view",
    ],
}


def upgrade() -> None:
    bind = op.get_bind()
    # Defensive only: ``positions`` is created by the migration chain (the
    # initial schema's ``roles``, renamed by 20260805_0008), so it exists here.
    # Kept, as 20260816_0005 keeps it, because it costs one reflection.
    if "positions" not in sa.inspect(bind).get_table_names():
        return

    org_rows = bind.execute(
        sa.text("SELECT DISTINCT organization_id FROM positions WHERE is_system = 1")
    ).fetchall()
    for org_row in org_rows:
        exists = bind.execute(
            sa.text(
                "SELECT id FROM positions "
                "WHERE organization_id = :org AND slug = :slug"
            ),
            {"org": org_row.organization_id, "slug": _POSITION["slug"]},
        ).fetchone()
        if exists:
            continue
        bind.execute(
            sa.text(
                "INSERT INTO positions "
                "(id, organization_id, name, slug, description, permissions, "
                " is_system, priority) "
                "VALUES (:id, :org, :name, :slug, :description, :permissions, "
                " 1, :priority)"
            ),
            {
                "id": str(uuid.uuid4()),
                "org": org_row.organization_id,
                "name": _POSITION["name"],
                "slug": _POSITION["slug"],
                "description": _POSITION["description"],
                "permissions": json.dumps(_POSITION["permissions"]),
                "priority": _POSITION["priority"],
            },
        )


def downgrade() -> None:
    bind = op.get_bind()
    if "positions" not in sa.inspect(bind).get_table_names():
        return

    # Removed only where no member holds it, so a department that already
    # appointed an assistant does not silently lose the assignment. A
    # same-slug position the department created itself is not ``is_system``
    # and is never touched.
    bind.execute(
        sa.text(
            "DELETE FROM positions WHERE slug = :slug AND is_system = 1 "
            "AND id NOT IN (SELECT position_id FROM user_positions)"
        ),
        {"slug": _POSITION["slug"]},
    )
