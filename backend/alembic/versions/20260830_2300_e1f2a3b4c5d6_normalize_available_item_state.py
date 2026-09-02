"""Normalize inventory items stored as AVAILABLE with an unsafe condition.

Revision ID: e1f2a3b4c5d6
Revises: f6a7b8c9d0e1
Create Date: 2026-08-30 23:00:00.000000

``_VALID_STATE_COMBOS`` began requiring an AVAILABLE item to be in
excellent/good/fair condition, but the rule arrived as a validator on writes
only. Rows carrying the forbidden combinations already existed in quantity —
the item edit modal offers Poor/Damaged/Out of Service/Retired in its
Condition dropdown and has no status control at all, so recording a damaged
in-stock item that way was the normal path — and several write paths
(unassign with no body, maintenance completion) kept producing more.

Two consequences, both live: assign and checkout gate on status alone, so an
item recorded as damaged stayed distributable; and any later edit of such a
row, even one changing only its storage location, failed with "Invalid state"
naming two fields the edit never touched.

Quarantine rather than relabel. The alternative — rewriting the condition to
fair so the pair validates — would make the row saveable by asserting the
equipment is in better shape than it is, which is the wrong direction for a
fire department's turnout gear and SCBA.

NOT REVERSIBLE. The downgrade is a no-op: the pre-migration state is not
recoverable, because AVAILABLE + poor is indistinguishable after the fact
from an item that was legitimately in maintenance already. Downgrading the
schema does not need it, and re-introducing an unsafe-but-distributable row
is not a state worth restoring.
"""

import sqlalchemy as sa
from alembic import op

revision = "e1f2a3b4c5d6"
down_revision = "4e7e125cb00f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # Pitfall #26: guard on the table, not just the rows. CI runs
    # `alembic upgrade head` against an empty database, and a table that only
    # create_all() builds is absent there — reflecting it would kill the whole
    # upgrade, not just this step.
    if "inventory_items" not in sa.inspect(bind).get_table_names():
        return

    # Unsafe but repairable -> quarantined for maintenance.
    bind.execute(
        sa.text(
            # `condition` is a reserved word in MySQL/MariaDB — unquoted it is
            # a syntax error, which is why this is executed here rather than
            # only read.
            "UPDATE inventory_items SET status = 'in_maintenance' "
            "WHERE status = 'available' "
            "AND `condition` IN ('poor', 'damaged', 'out_of_service')"
        )
    )
    # Retired stock is not in maintenance; it is out of the pool entirely.
    bind.execute(
        sa.text(
            "UPDATE inventory_items SET status = 'retired' "
            "WHERE status = 'available' AND `condition` = 'retired'"
        )
    )


def downgrade() -> None:
    """Deliberately empty — see the module docstring."""
