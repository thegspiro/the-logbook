"""join main's three heads after three rejoins of the same fork

On 2026-11-14 ``4d8e2b6f1c93`` (history documents) and ``c4e81b7a2d95``
(election and minutes email templates) left main with two heads. Three pull
requests each added their own revision joining exactly those two:

* ``b91f3c6d2e48`` (#4318), on which the leave-request chain was then built,
  ending at ``c8d2f61a7e34``;
* ``e2b7d94c1a63`` (#4316);
* ``169a11ebf589`` (#4319).

All three merged, so main had three heads and ``alembic upgrade head``
refused to run again. This revision joins them. Every one of the three is a
no-op over the same two parents, so an installation stamped at any of them
applies the others, and the leave-request revisions, on its next upgrade.

Nothing is created here.

Revision ID: d3a7f5e2c916
Revises: c8d2f61a7e34, e2b7d94c1a63, 169a11ebf589
Create Date: 2026-11-15 11:00:00.000000

"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "d3a7f5e2c916"
# One line: scripts/validate_migrations.py reads down_revision line by line.
down_revision = ("c8d2f61a7e34", "e2b7d94c1a63", "169a11ebf589")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: each parent revision already performed its work."""


def downgrade() -> None:
    """No-op: reversing this merge restores the three heads."""
