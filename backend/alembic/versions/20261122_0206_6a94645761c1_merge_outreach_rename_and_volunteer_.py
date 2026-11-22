"""Merge the two heads that branched from 3daf47506e9e

The outreach vocabulary rename (1a5c18b46791: seeded position names and the
headcount-reminder template's wording) and volunteer RSVPs as crew
(c7e1a94d2f58: ``event_rsvps.is_volunteer`` and its backfill) each revise
3daf47506e9e and merged to main separately, leaving two heads and an
``alembic upgrade head`` that refuses to run. Neither touches the other's
tables (``positions`` and ``email_templates`` against ``event_rsvps`` and
``shift_assignments``), so the merge carries no operations.

Revision ID: 6a94645761c1
Revises: 1a5c18b46791, c7e1a94d2f58
Create Date: 2026-11-22 02:06:00.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "6a94645761c1"
down_revision = ("1a5c18b46791", "c7e1a94d2f58")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
