"""Normalize system roots for hierarchical document authorization.

Revision ID: a8e4c1f7b930
Revises: f7b3c8d2e569
Create Date: 2026-09-02 00:01:00.000000

Member owners and facility permission holders must be admitted by their roots,
while the apparatus root is intentionally leadership-only. Older provisioning
paths inherited the model's organization default for every system folder, so
normalize existing rows before ancestor ACLs rely on those roots.
"""

import sqlalchemy as sa
from alembic import op

revision = "a8e4c1f7b930"
down_revision = "f7b3c8d2e569"
branch_labels = None
depends_on = None

_FACILITY_PERMISSIONS = (
    '["facilities.view_sensitive", "facilities.edit", "facilities.manage"]'
)


def upgrade() -> None:
    bind = op.get_bind()
    if "document_folders" not in sa.inspect(bind).get_table_names():
        return

    bind.execute(
        sa.text(
            "UPDATE document_folders SET visibility = 'organization' "
            "WHERE is_system = true AND slug IN ('members', 'facilities')"
        )
    )
    bind.execute(
        sa.text(
            "UPDATE document_folders SET visibility = 'leadership' "
            "WHERE is_system = true AND slug = 'apparatus'"
        )
    )
    bind.execute(
        sa.text(
            "UPDATE document_folders SET required_permissions = :permissions "
            "WHERE is_system = true AND slug = 'facilities'"
        ),
        {"permissions": _FACILITY_PERMISSIONS},
    )


def downgrade() -> None:
    # Restoring inconsistent root ACLs would reintroduce the authorization bug.
    pass
