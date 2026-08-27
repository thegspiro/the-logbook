"""Clear the operational rank of every administrative member.

An operational rank is a place in the response chain of command: it grants its
default permissions through ``_collect_user_permissions`` and decides which
shift seats ``ShiftEligibilityService`` will let a member sign up for. An
administrative member does not respond, so a rank on one grants both to
somebody the department has said does not ride.

The application now refuses the combination on write, but rows that predate the
rule keep whatever rank they were last given.  Left alone they would be
corrected only by the next write that happened to touch the member — so the
roster, the reports and the eligibility check would each keep showing a rank
for an unpredictable subset of administrative members, for an unpredictable
length of time.

Not reversible, and deliberately so: the cleared value is exactly the state the
rule exists to forbid, and restoring it on downgrade would re-grant the
permissions.  The rank that was cleared is recoverable from the audit log for
any member whose class was changed through the tier endpoint.

Revision ID: b6c1d9e4a705
Revises: 8fb3757b80ec
Create Date: 2026-08-27 10:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "b6c1d9e4a705"
down_revision = "8fb3757b80ec"
branch_labels = None
depends_on = None

# Mirrors `split_membership_type`: `member_class` is the authority, and the
# legacy `membership_type` answers only for the rows where nobody has set one.
# A row with neither is left alone — an unrecognised `membership_type` is a
# custom membership tier, not evidence that the member is administrative, and
# clearing on that guess would strip ranks the rule never meant to touch.
_ADMINISTRATIVE_MEMBERS = """
    rank IS NOT NULL
    AND rank <> ''
    AND (
        LOWER(TRIM(member_class)) = 'administrative'
        OR (
            member_class IS NULL
            AND LOWER(TRIM(membership_type)) = 'administrative'
        )
    )
"""


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "users" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("users")}
    # `member_class` arrived with the class/status split. A database old enough
    # to predate it still has `membership_type`, which answers for every row
    # there anyway.
    if not {"rank", "membership_type"} <= columns:
        return
    predicate = _ADMINISTRATIVE_MEMBERS
    if "member_class" not in columns:
        predicate = "rank IS NOT NULL AND rank <> '' AND LOWER(TRIM(membership_type)) = 'administrative'"

    bind.execute(sa.text(f"UPDATE users SET rank = NULL WHERE {predicate}"))


def downgrade() -> None:
    """No-op. See the module docstring: the cleared rank is not restorable."""
