"""merge shift finalization and email preference heads

Two pull requests branched off ``20260816_0005`` and merged without seeing
each other, leaving the chain with two heads:

* #1509 (unify email notification preference) added ``20260816_0007``.
* The shift-finalization backfill added ``20260816_0006``.

Alembic refuses ``upgrade head`` while more than one head exists, so this is
not only a red test — it stops migrations running at all, which means both
deployment and CI's "Run database migrations" step. It went unnoticed because
several pull requests merged in quick succession and ci.yml's
``cancel-in-progress`` concurrency group cancelled each main run before it
reported a conclusion.

Nothing is created here — every table and column already came from one side or
the other, and Alembic runs each revision exactly once regardless of how many
merge paths reach it.

The revision id is Alembic-generated rather than the older ``YYYYMMDD_SSSS``
form used by the earlier merge revisions in this directory: that form collides
when two branches are open on the same day, which is the very failure this
revision exists to repair. ``scripts/validate_migrations.py`` enforces it.

Revision ID: 71d86eba9a9e
Revises: 20260816_0006, 20260816_0007
Create Date: 2026-08-17 17:57:46.534452

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "71d86eba9a9e"
down_revision: Union[str, Sequence[str], None] = ("20260816_0006", "20260816_0007")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into two heads needs no DDL."""
