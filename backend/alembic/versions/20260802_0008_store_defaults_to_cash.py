"""Start a store on cash rather than a list of unconfigured methods

New stores were seeded with Venmo, PayPal, cash and check all ticked, but only
cash works with nothing configured — the other three are hidden from members
until a handle is entered. The settings screen therefore showed a quartermaster
three methods that were switched on and did nothing.

Cash is the honest floor: it needs no setup, and everything else gets ticked as
it is configured. Existing stores that have ended up with no methods at all are
moved to the same floor, since a store nobody can pay is not a state worth
preserving.

Revision ID: 20260802_0008
Revises: 20260802_0007
Create Date: 2026-08-05
"""

from alembic import op

# revision identifiers
revision = "20260802_0008"
down_revision = "20260802_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Only the empty cases. A department that has deliberately chosen its
    # methods keeps them, whatever they are.
    op.execute("""
        UPDATE store_settings
           SET accepted_payment_methods = '["cash"]'
         WHERE accepted_payment_methods IS NULL
            OR JSON_LENGTH(accepted_payment_methods) = 0
        """)


def downgrade() -> None:
    # Nothing to undo: the previous state was "no method at all", which is not
    # worth restoring, and we cannot tell which rows this touched.
    pass
