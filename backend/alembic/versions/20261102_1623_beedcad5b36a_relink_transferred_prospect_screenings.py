"""File a transferred prospect's screening records under the member too

Revision ID: beedcad5b36a
Revises: 4c8e2f61a9d7
Create Date: 2026-11-02 16:23:29.386236

Departments that screen applicants before the membership election record those
screenings against the prospect. Until 2026-11-02 the transfer to membership
left them there, so the new member read "0 of N met" and owed screenings they
had already passed, while the records sat on a TRANSFERRED prospect no roster
shows (W71b-2). The transfer now sets ``user_id`` on the prospect's records
(``MembershipPipelineService._relink_screenings_to_member``). This does the
same for every prospect transferred before it.

What it changes: for each prospect with status ``transferred`` and a
``transferred_user_id`` naming a user that still exists in the same
organization, every screening record of that prospect with no ``user_id``
gets that user's id. ``prospect_id`` is kept. Records of prospects still in
the pipeline, records whose member was deleted, and records that already name
a member are left alone. No row is deleted and no other column is written.

Effect on existing installations: members converted from prospects may
change standing on upgrade, from "not compliant" to whatever the screenings
they passed as applicants say.

Downgrade is exact. Creating a record that names both a member and a prospect
is rejected (a 422 since 2026-10-05), so a record carrying both ids where the
member is its prospect's ``transferred_user_id`` is one this migration or a
transfer re-linked. Downgrade clears ``user_id`` on exactly those.

Both tables are guarded: ``prospective_members`` is built by a migration
today, but a database stamped by ``create_all`` and a partial schema are both
real, and a missing table means there is nothing to re-link.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "beedcad5b36a"
down_revision: Union[str, None] = "4c8e2f61a9d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_REQUIRED = {
    "screening_records": {"organization_id", "prospect_id", "user_id"},
    "prospective_members": {
        "id",
        "organization_id",
        "status",
        "transferred_user_id",
    },
    "users": {"id", "organization_id"},
}


def _schema_ready() -> bool:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for table, columns in _REQUIRED.items():
        if table not in tables:
            return False
        present = {column["name"] for column in inspector.get_columns(table)}
        if not columns <= present:
            return False
    return True


# The member a record's prospect became, when it is still a member of the same
# organization. The user join keeps the foreign key from naming a deleted
# member and keeps the reference inside one organization. Written as a
# correlated subquery rather than UPDATE ... JOIN so the same statement runs on
# MySQL and on the SQLite the migration test uses.
_TRANSFERRED_MEMBER = """
    SELECT pm.transferred_user_id
      FROM prospective_members pm
      JOIN users u
        ON u.id = pm.transferred_user_id
       AND u.organization_id = pm.organization_id
     WHERE pm.id = screening_records.prospect_id
       AND pm.organization_id = screening_records.organization_id
       AND LOWER(pm.status) = 'transferred'
       AND pm.transferred_user_id IS NOT NULL
"""


def upgrade() -> None:
    if not _schema_ready():
        return
    op.execute(
        sa.text(
            "UPDATE screening_records "
            f"SET user_id = ({_TRANSFERRED_MEMBER}) "
            "WHERE user_id IS NULL AND prospect_id IS NOT NULL "
            f"AND EXISTS ({_TRANSFERRED_MEMBER})"
        )
    )


def downgrade() -> None:
    if not _schema_ready():
        return
    op.execute(
        sa.text(
            "UPDATE screening_records SET user_id = NULL "
            "WHERE prospect_id IS NOT NULL AND user_id IS NOT NULL "
            "AND EXISTS (SELECT 1 FROM prospective_members pm "
            "WHERE pm.id = screening_records.prospect_id "
            "AND pm.organization_id = screening_records.organization_id "
            "AND pm.transferred_user_id = screening_records.user_id)"
        )
    )
