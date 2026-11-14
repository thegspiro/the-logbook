"""Approve the meetings whose minutes are already approved

From this release, approving a set of minutes also approves the meeting record
they were taken from (W51-9): before it, nothing moved a meeting's status, so
every meeting read "Draft" beside approved, published minutes and stayed
deletable after its attendance became the settled record that membership tiers
count. This settles the rows already there the same way.

A meeting with at least one approved set of minutes linked to it, in the same
organization, becomes ``approved`` and takes the earliest of those approvals'
``approved_at`` and ``approved_by``. A meeting already approved keeps its own
stamp. Minutes approved before approvals were stamped carry no ``approved_at``;
their meeting is approved with no stamp rather than left deletable.

Downgrade returns to ``draft`` exactly the meetings this rule approves: those
whose stamp is copied from an approved set of their minutes, or that carry no
stamp at all. ``approve_meeting`` always stamps its own approver, so a meeting
approved through it is left alone. A meeting that was ``pending_approval``
before the upgrade comes back as ``draft``: the upgrade did not record which
meetings were pending, and none could be through any screen.

Revision ID: 6b81e95d4157
Revises: 82944d255c0c
Create Date: 2026-11-03 04:56:39.527097

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6b81e95d4157"
down_revision: Union[str, None] = "82944d255c0c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    # Either table may be built only by create_all on an empty database; with
    # no rows there is nothing to settle.
    if not (_has_table("meetings") and _has_table("meeting_minutes")):
        return
    # The earliest approval of each meeting's minutes, joined back to the row
    # that holds it so the approver comes from the same approval.
    op.execute("""
        UPDATE meetings m
        JOIN (
            SELECT meeting_id, organization_id, MIN(approved_at) AS first_at
            FROM meeting_minutes
            WHERE status = 'approved'
              AND meeting_id IS NOT NULL
              AND approved_at IS NOT NULL
            GROUP BY meeting_id, organization_id
        ) f ON f.meeting_id = m.id AND f.organization_id = m.organization_id
        JOIN meeting_minutes mm
          ON mm.meeting_id = f.meeting_id
         AND mm.organization_id = f.organization_id
         AND mm.status = 'approved'
         AND mm.approved_at = f.first_at
        SET m.status = 'approved',
            m.approved_at = f.first_at,
            m.approved_by = mm.approved_by
        WHERE m.status <> 'approved'
        """)
    # Minutes approved before approvals were stamped.
    op.execute("""
        UPDATE meetings m
        JOIN meeting_minutes mm
          ON mm.meeting_id = m.id
         AND mm.organization_id = m.organization_id
         AND mm.status = 'approved'
        SET m.status = 'approved'
        WHERE m.status <> 'approved'
        """)


def downgrade() -> None:
    if not (_has_table("meetings") and _has_table("meeting_minutes")):
        return
    op.execute("""
        UPDATE meetings m
        JOIN meeting_minutes mm
          ON mm.meeting_id = m.id
         AND mm.organization_id = m.organization_id
         AND mm.status = 'approved'
        SET m.status = 'draft',
            m.approved_at = NULL,
            m.approved_by = NULL
        WHERE m.status = 'approved'
          AND (
            (m.approved_at IS NULL AND m.approved_by IS NULL)
            OR (m.approved_at = mm.approved_at AND m.approved_by <=> mm.approved_by)
          )
        """)
