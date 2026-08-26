"""Recover member class and status from the membership "positions".

Onboarding's role setup used to offer Probationary, Junior, Life,
Administrative, Social and Exempt as *positions*, and created a
permission-bearing ``positions`` row for each. They are not positions — they
are a member's class and status — so a department that used them recorded
standing in two unconnected places: the member's ``member_class`` /
``member_status``, and a held position no backend rule reads.

The role setup no longer offers them, so no new organization gets them. This
recovers the information from the installs that already do.

**The positions are not deleted.** Each carries real permissions (the
``member`` or ``probationary`` template), and a member whose only position is
``life_member`` would lose everything it grants. Reclassifying somebody is not
a reason to cut their access, so the rows stay and a department can retire them
from the position editor once it is satisfied the standing is right.

**Only plainly-default members are touched.** The update applies where the
member currently reads as ``operational``/``regular`` — the value derived from
``membership_type = "active"`` — so anything more specific already recorded on
the member wins over a stale position. Members left unclassified by
``f1a2b3c4d5e6`` (a custom membership tier id, deliberately not guessed at) are
skipped too: promoting them out of "unknown" here would undo that decision.

``membership_type`` is updated alongside, because a SQL migration does not go
through the ``_reconcile_membership`` listener that normally keeps the three
in step.

Revision ID: c3d4e5f6a7b8
Revises: 8bffd3c53428
Create Date: 2026-08-26 16:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c3d4e5f6a7b8"
down_revision = "8bffd3c53428"
branch_labels = None
depends_on = None


# --- frozen copy of the mapping, as of this revision -----------------------
# position slug -> (member_class, member_status, legacy membership_type)
#
# Inlined rather than imported: a migration must keep transforming rows the
# way it did the day it ran (CLAUDE.md pitfall #20).
_FROM_POSITION = {
    "probationary_member": ("operational", "probationary", "probationary"),
    "junior_member": ("operational", "junior", "probationary"),
    "life_member": ("operational", "life", "life"),
    "administrative_member": ("administrative", "regular", "administrative"),
    "social_member": ("social", "regular", "honorary"),
    # "Exempt / Retired Member" in the role setup that created these.
    "exempt_member": ("operational", "retired", "retired"),
}

# Applied in this order, so the most specific standing wins when a member
# somehow holds more than one of these. Administrative and social are classes
# and outrank the operational statuses; among the statuses, the further from
# plain "regular" the more specific.
_PRECEDENCE = (
    "administrative_member",
    "social_member",
    "exempt_member",
    "life_member",
    "junior_member",
    "probationary_member",
)


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    # `positions` and `user_positions` are among the tables no migration
    # creates — create_all() builds them on first boot (pitfall #26). A fresh
    # database has nothing to recover.
    for table in ("users", "positions", "user_positions"):
        if not _has_table(table):
            return

    bind = op.get_bind()

    for slug in _PRECEDENCE:
        member_class, member_status, membership_type = _FROM_POSITION[slug]
        bind.execute(
            sa.text("""
                UPDATE users u
                JOIN user_positions up ON up.user_id = u.id
                JOIN positions p ON p.id = up.position_id
                SET u.member_class = :cls,
                    u.member_status = :status,
                    u.membership_type = :legacy
                WHERE p.slug = :slug
                  AND p.organization_id = u.organization_id
                  AND u.member_class = 'operational'
                  AND u.member_status = 'regular'
                """),
            {
                "cls": member_class,
                "status": member_status,
                "legacy": membership_type,
                "slug": slug,
            },
        )


def downgrade() -> None:
    """No-op — the standing recovered here cannot be told from any other.

    Nothing records which members were reclassified by this migration rather
    than by an officer, so putting them all back to operational/regular would
    also flatten standings a department set deliberately. Leaving the recovered
    values in place is the safe direction: they describe the member either way,
    and the positions they came from were never deleted.
    """
