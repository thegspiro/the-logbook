"""Merge the meeting-agenda-items and ballot/license-merge heads

The meeting agenda items feature (``38a57d984653``) and the earlier
same-day merge of the ballot-send-job-kind / directory-account-license
fork (``fccdac60063f``) both revise the chain independently, leaving two
heads once both are on ``main``. ``alembic upgrade head`` fails until they
are rejoined.

Nothing is created here. Both revisions already ran their own DDL; Alembic
runs each revision exactly once no matter how many merge paths reach it.

Revision ID: 1117b642643b
Revises: 38a57d984653, fccdac60063f
Create Date: 2026-10-17 18:49:32.272431
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "1117b642643b"
down_revision: Union[str, Sequence[str], None] = ("38a57d984653", "fccdac60063f")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
