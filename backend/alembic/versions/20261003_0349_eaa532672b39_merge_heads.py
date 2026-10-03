"""merge the bottom-nav-slots and location-nfc-check-in heads

Two branches each added a revision on top of a then-current head and merged
into `main` independently:

* `8464e9962f76` added `users.bottom_nav_slots` ("Let each member choose
  their phone bottom-bar tabs"), on top of `f73b449bdb8b`.
* `040ae44ad286` added `locations.nfc_badge_check_in_enabled` ("Add room NFC
  tags that check a member into the room's current event"), on top of
  `5bed4c485d2f`.

`main` advanced past the first branch's head before the second branch's own
PR merged, so both landed as heads and `alembic upgrade head` refuses to run.
This joins them. Nothing is created here — each revision below already runs
on its own side, and Alembic applies a revision once however many paths
reach it.

Revision ID: eaa532672b39
Revises: 040ae44ad286, 8464e9962f76
Create Date: 2026-10-03 03:49:51.815540

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "eaa532672b39"
down_revision: Union[str, Sequence[str], None] = ("040ae44ad286", "8464e9962f76")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
