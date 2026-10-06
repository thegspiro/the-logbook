"""merge the badge-code and known-limitations heads

Joins #2954's users.badge_code (ad3b979746f1) with #2918's line, whose head
is the self-report attachment retention period (cdb725bb1d12). Both lines
add a column to users, but different ones (badge_code here,
password_expiry_notified_at there), so they do not depend on each other and
the merge itself changes nothing.

Revision ID: 15802f3df5c4
Revises: ad3b979746f1, cdb725bb1d12
Create Date: 2026-10-06 00:00:00.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "15802f3df5c4"
down_revision: Union[str, None] = ("ad3b979746f1", "cdb725bb1d12")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
